import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';
import { config } from '../config.js';
import { logger } from './logger.js';
import { extractNewsVisualQueries } from './text_utils.js';
import {
  isPexelsVideoUsed,
  markPexelsVideoUsed,
  pickUnusedFallbackClip,
} from './used_assets.js';
import {
  isClipRecentlyUsed,
  isClipOnCooldown,
  sortClipsByLeastRecentlyUsed,
  recordUsedClip,
} from './publish_history.js';
import { ensureSlot1Pool, getSlot1PoolClips } from './ensure_slot1_pool.js';
import { ensureCategoryPools } from './ensure_category_pools.js';

const CACHE_DIR = path.join(config.assetsDir, 'cache');
const DEFAULTS_DIR = path.join(config.assetsDir, 'defaults');
const CLIPS_DIR = path.join(config.assetsDir, 'clips');
const BABY_DIR = path.join(CLIPS_DIR, 'baby');
const DEVOTIONAL_DIR = path.join(CLIPS_DIR, 'devotional');
const NEWS_DIR = path.join(CLIPS_DIR, 'news');
const CRICKET_DIR = path.join(CLIPS_DIR, 'cricket');
const SCRIPTURES_DIR = path.join(CLIPS_DIR, 'scriptures');
const BIN_DIR = path.join(config.assetsDir, 'bin');
const YTDLP_BIN = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const YTDLP_PATH = fs.existsSync(path.join(BIN_DIR, YTDLP_BIN))
  ? path.join(BIN_DIR, YTDLP_BIN)
  : (fs.existsSync(path.join(BIN_DIR, 'yt-dlp.exe')) ? path.join(BIN_DIR, 'yt-dlp.exe') : 'yt-dlp');

// Ensure all clip directories exist
[CACHE_DIR, DEFAULTS_DIR, CLIPS_DIR, BABY_DIR, DEVOTIONAL_DIR, NEWS_DIR, CRICKET_DIR, SCRIPTURES_DIR, BIN_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const WIKIMEDIA_USER_AGENT = 'YtShortsAutopilot/1.0 (https://github.com/dailypulseshortss; contact@dailypulse.com) Mozilla/5.0 (compatible)';

/**
 * Searches Wikimedia Commons API for imagery (used for official player portraits)
 */
export async function searchWikimediaCommons(query, maxResults = 6) {
  try {
    const endpoint = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=${maxResults}&prop=imageinfo&iiprop=url|mime|size&format=json&origin=*`;
    const res = await fetch(endpoint, {
      headers: { 'User-Agent': WIKIMEDIA_USER_AGENT },
    });
    if (!res.ok) return [];

    const data = await res.json();
    if (!data.query || !data.query.pages) return [];

    const results = [];
    for (const page of Object.values(data.query.pages)) {
      const info = page.imageinfo?.[0];
      if (!info || !info.url) continue;

      const mime = (info.mime || '').toLowerCase();
      const isImage = mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp';
      const isVideo = mime.includes('webm') || mime.includes('mp4');

      if (mime.includes('svg') || (info.url || '').toLowerCase().endsWith('.svg')) continue;

      if ((isImage || isVideo) && (info.width >= 500 || info.height >= 500)) {
        results.push({
          url: info.url,
          mime,
          width: info.width,
          height: info.height,
          type: isVideo ? 'video' : 'image',
        });
      }
    }
    return results;
  } catch (err) {
    logger.warn(`Wikimedia Commons search error (${query}): ${err.message}`);
    return [];
  }
}

/**
 * Evaluates whether a video clip has sufficient visual brightness/luminance
 * to prevent rendering dark, blank, or pitch-black video frames.
 * @param {string} filePath
 * @param {number} [minBrightness=25]
 * @returns {Promise<boolean>}
 */
export async function isVideoClipBrightEnough(filePath, minBrightness = 25) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    const tmpFrame = path.join(CACHE_DIR, `lum_${crypto.randomBytes(6).toString('hex')}.jpg`);
    await new Promise((resolve, reject) => {
      execFile(
        process.env.FFMPEG_PATH || ffmpegStatic,
        ['-y', '-ss', '00:00:01', '-i', filePath, '-vframes', '1', tmpFrame],
        (err) => (err ? reject(err) : resolve())
      );
    });
    if (!fs.existsSync(tmpFrame)) return false;
    const { data } = await sharp(tmpFrame).raw().toBuffer({ resolveWithObject: true });
    try { fs.unlinkSync(tmpFrame); } catch (_) {}
    let sum = 0;
    for (let i = 0; i < data.length; i += 3) {
      sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    const avg = sum / (data.length / 3);
    return avg >= minBrightness;
  } catch (err) {
    return true; // Default to true if analysis fails to avoid blocking pipeline
  }
}

/**
 * Gets all verified moving MP4 clips in a category directory
 * @param {string} dirPath
 * @returns {string[]}
 */
export function getCategoryVideoPool(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((f) => f.toLowerCase().endsWith('.mp4'))
    .map((f) => path.join(dirPath, f))
    .filter((p) => {
      try {
        return fs.statSync(p).size > 50000;
      } catch (_) {
        return false;
      }
    });
}

/**
 * Downloads a file safely with proper headers and size validation
 */
export async function downloadFile(url, destPath) {
  const cleanUrl = url.split('?')[0]; // Strip tracking params
  const res = await fetch(cleanUrl, {
    headers: {
      'User-Agent': WIKIMEDIA_USER_AGENT,
      'Accept': 'video/*,image/*,*/*',
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 5000) {
    throw new Error(`Downloaded payload too small (${buffer.length} bytes), possible rate limit or robot warning.`);
  }

  fs.writeFileSync(destPath, buffer);
  return destPath;
}

/**
 * Downloads dynamic moving video from Pexels API if key is available.
 * Prioritizes 9:16 vertical / high-retention portrait footage with strict non-repeating deduplication.
 * @param {string} query
 * @param {'portrait' | 'all'} [orientation]
 * @param {Object} [options]
 */
export async function tryDownloadPexels(query, orientation = 'portrait', options = {}) {
  if (!config.pexelsApiKey) return null;
  try {
    // ALWAYS force native vertical portrait orientation for true 9:16 Shorts
    const orientParam = '&orientation=portrait';
    const page = options.page || (Math.floor(Math.random() * 4) + 1);
    const perPage = options.perPage || 15;
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}${orientParam}&per_page=${perPage}&page=${page}`;
    const res = await fetch(url, {
      headers: { Authorization: config.pexelsApiKey },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const videos = data.videos || [];
    if (videos.length === 0) {
      const words = query
        .replace(/\b(rcb|csk|mi|kkr|srh|dc|rr|gt|lsg|pbks|ipl|bcci|vs)\b/gi, '')
        .split(/\s+/)
        .filter((w) => w.length > 2);
      if (words.length >= 2 && words.join(' ') !== query.trim()) {
        const fallbackQuery = words.slice(0, 3).join(' ');
        return tryDownloadPexels(fallbackQuery, orientation, options);
      }
      return null;
    }

    // Filter out previously used video IDs to prevent consecutive repeats
    const unusedVideos = videos.filter((v) => !isPexelsVideoUsed(String(v.id)));
    const candidates = unusedVideos.length > 0 ? unusedVideos : videos;

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    // Strictly prioritize native vertical (9:16) video files where height > width
    const verticalFiles = (chosen.video_files || []).filter((f) => f.height && f.width && f.height > f.width);
    const candidateFiles = verticalFiles.length > 0 ? verticalFiles : (chosen.video_files || []);
    const file = candidateFiles.find((f) => f.height >= 1920 && f.width >= 1080) ||
      candidateFiles.find((f) => f.height >= 1280 && f.width >= 720) ||
      candidateFiles.find((f) => f.height >= 720) ||
      candidateFiles[0];

    if (!file || !file.link) return null;

    const hash = crypto.createHash('md5').update(`pexels_v_${chosen.id}`).digest('hex');
    const dest = path.join(CACHE_DIR, `pexels_${hash}.mp4`);
    if (!fs.existsSync(dest) || fs.statSync(dest).size < 50000) {
      logger.info(`Downloading fresh Pexels moving video for "${query}" (page ${page}, ID ${chosen.id})...`);
      await downloadFile(file.link, dest);
    } else {
      logger.info(`Using cached Pexels moving video (ID ${chosen.id}) for "${query}"`);
    }

    const isBright = await isVideoClipBrightEnough(dest, 25);
    if (!isBright) {
      logger.warn(`Downloaded Pexels clip (ID ${chosen.id}) is too dark (luminance < 25). Discarding...`);
      return null;
    }

    markPexelsVideoUsed(chosen.id, query);
    return { type: 'video', filePath: dest, pexelsId: chosen.id };
  } catch (e) {
    logger.warn(`Pexels video fetch failed for "${query}": ${e.message}`);
    return null;
  }
}

/**
 * Fetches 3-5 distinct moving MP4 video clips matching the topic scene queries
 * for dynamic visual scene transitions every 4-6 seconds.
 * Strictly guarantees 100% moving video, no static frames, and persistent deduplication.
 * @param {Object} params
 * @param {string} params.slotType - 'slot1' | 'slot2' | 'slot3' | 'slot4' | 'slot5'
 * @param {string} [params.title]
 * @param {string[]} [params.visualSceneQueries]
 * @param {number} [params.count] - target number of clips (default 4, between 3 and 5)
 * @param {string} [params.clipPath] - optional pre-selected primary clip
 * @param {string} [params.deity] - optional deity or epic name for strict spiritual lock
 * @param {string} [params.epic] - optional epic name (Mahabharata/Ramayana)
 * @returns {Promise<string[]>} Array of valid video file paths
 */
export function detectDevotionalRealm(text = '') {
  const str = String(text).toLowerCase();
  if (/shiva|mahadev|bhole|kedarnath|somnath|markandeya|shivling|lingam|trishul|neelkanth|kailash|tandav|namah shivaya|rudra|nataraja|mrityunjaya|kashi/i.test(str)) {
    return 'shiva';
  }
  if (/mahabharata|kurukshetra|bhishma|karna|yudhishthira|yaksha|dronacharya|vidura|shibi|arjuna|gandiva|pandav|duryodhana|hastinapur/i.test(str)) {
    return 'mahabharata';
  }
  if (/krishna|sudama|dwarka|vrindavan|mathura|geeta|gita|parthasarathi|makhan|bansuri|flute|radha|govinda|yashoda/i.test(str)) {
    return 'krishna';
  }
  if (/ramayan|ayodhya|shabari|raghunandan|paduka|lanka vijay|dandakaranya|kodanda|\b(rama|ram|sita|lakshman|bharata)\b/i.test(str)) {
    return 'rama';
  }
  if (/hanuman|bajrangbali|sanjeevani|lanka dahan|ravana|anjaneya|maruti|sundarkand|dronagiri/i.test(str)) {
    return 'hanuman';
  }
  if (/ganesh|ganpati|vinayaka|siddhivinayak|modak|lambodara/i.test(str)) {
    return 'ganesha';
  }
  if (/vishnu|narayana|vaikuntha|gajendra|bhrigu|narasimha|prahlada|dhruva|sheshnag|garuda|lakshmi|kanakadhara|ksheera|sudarshan/i.test(str)) {
    return 'vishnu';
  }
  return 'universal_sacred';
}

export function getClipDevotionalRealm(filePath = '') {
  const base = path.basename(filePath).toLowerCase();
  if (/shiva|kedarnath|kailash|himalayas/i.test(base)) return 'shiva';
  if (/krishna/i.test(base)) return 'krishna';
  if (/geeta|kurukshetra|arjuna|bhishma|karna/i.test(base)) return 'mahabharata';
  if (/ram_mandir|ramayana|rama/i.test(base)) return 'rama';
  if (/hanuman/i.test(base)) return 'hanuman';
  if (/ganesh/i.test(base)) return 'ganesha';
  if (/vishnu|vishwaroop|sudarshan/i.test(base)) return 'vishnu';
  if (/aarti|temple|ganga/i.test(base)) return 'universal_sacred';
  return 'other';
}

export async function fetchMultiClipSequence({
  slotType,
  title = '',
  visualSceneQueries = [],
  count = 4,
  clipPath = null,
  deity = null,
  epic = null,
}) {
  const targetCount = Math.max(3, Math.min(5, count));
  const selectedClips = [];
  const selectedKeys = new Set();

  // If a primary clip is already designated (e.g. video-first Slot 1 or Slot 4 epic clip), start with it
  if (clipPath && fs.existsSync(clipPath)) {
    selectedClips.push(clipPath);
    selectedKeys.add(path.basename(clipPath).toLowerCase());
  }

  // 1. Determine slot directory and fallback pool
  let categoryDir = BABY_DIR;
  if (slotType === 'slot2') {
    await ensureCategoryPools();
    categoryDir = DEVOTIONAL_DIR;
  } else if (slotType === 'slot3') {
    categoryDir = NEWS_DIR;
  } else if (slotType === 'slot4') {
    await ensureCategoryPools();
    categoryDir = SCRIPTURES_DIR;
  } else if (slotType === 'slot5') {
    await ensureCategoryPools();
    categoryDir = CRICKET_DIR;
  }

  const localPool = getCategoryVideoPool(categoryDir);

  // 2. Query Pexels for distinct scene queries if key is available
  const queries = Array.isArray(visualSceneQueries) && visualSceneQueries.length > 0
    ? visualSceneQueries
    : [title, 'cinematic vertical video'];

  for (const query of queries) {
    if (selectedClips.length >= targetCount) break;
    if (!query) continue;

    try {
      const pexelsResult = await tryDownloadPexels(query, 'portrait');
      if (pexelsResult && pexelsResult.filePath && fs.existsSync(pexelsResult.filePath)) {
        const key = `pexels_${pexelsResult.pexelsId}`;
        if (!selectedKeys.has(key)) {
          selectedClips.push(pexelsResult.filePath);
          selectedKeys.add(key);
          recordUsedClip(pexelsResult.pexelsId, slotType);
          logger.info(`[Multi-Clip] Matched Pexels clip ${selectedClips.length}/${targetCount} for "${query}"`);
        }
      }
    } catch (e) {
      logger.warn(`[Multi-Clip] Pexels query "${query}" failed: ${e.message}`);
    }
  }

  // 3. Fill from local category video pool with strict deity/story lock and non-repeating deduplication
  if (selectedClips.length < targetCount && localPool.length > 0) {
    const available = localPool.filter((f) => !selectedKeys.has(path.basename(f).toLowerCase()));
    let candidateClips = available;

    // STRICT DEITY & KATHA VISUAL LOCK FOR SLOTS 2 & 4
    if (slotType === 'slot2' || slotType === 'slot4') {
      const storyContext = `${deity || ''} ${epic || ''} ${title || ''} ${(visualSceneQueries || []).join(' ')}`;
      const targetRealm = detectDevotionalRealm(storyContext);
      logger.info(`[Multi-Clip] Enforcing strict spiritual visual lock: target realm [${targetRealm.toUpperCase()}] for [${slotType}]`);

      const primaryMatches = [];
      const sacredAtmosphere = [];

      for (const clip of available) {
        const clipRealm = getClipDevotionalRealm(clip);
        if (targetRealm !== 'universal_sacred') {
          if (clipRealm === targetRealm) {
            primaryMatches.push(clip);
          } else if (clipRealm === 'universal_sacred') {
            sacredAtmosphere.push(clip);
          } else if (targetRealm === 'krishna' && clipRealm === 'mahabharata') {
            primaryMatches.push(clip);
          } else if (targetRealm === 'mahabharata' && clipRealm === 'krishna') {
            primaryMatches.push(clip);
          }
          // Conflicting specific deities (e.g. Shiva vs Krishna, Rama vs Shiva) are strictly excluded!
        } else {
          if (clipRealm === 'universal_sacred') {
            primaryMatches.push(clip);
          } else {
            sacredAtmosphere.push(clip);
          }
        }
      }

      // Sort both groups by Least Recently Used (LRU)
      const sortedPrimary = sortClipsByLeastRecentlyUsed(primaryMatches, slotType);
      const sortedSacred = sortClipsByLeastRecentlyUsed(sacredAtmosphere, slotType);

      // Prioritize primary deity matches first, then neutral sacred temple/aarti B-roll
      candidateClips = [...sortedPrimary, ...sortedSacred];

      // If still need more clips, also pull matching deity / universal sacred clips from the peer directory
      if (candidateClips.length < (targetCount - selectedClips.length)) {
        const peerDir = slotType === 'slot2' ? SCRIPTURES_DIR : DEVOTIONAL_DIR;
        const peerPool = getCategoryVideoPool(peerDir).filter((f) => !selectedKeys.has(path.basename(f).toLowerCase()));
        for (const clip of peerPool) {
          const clipRealm = getClipDevotionalRealm(clip);
          if (clipRealm === targetRealm || clipRealm === 'universal_sacred' ||
              (targetRealm === 'krishna' && clipRealm === 'mahabharata') ||
              (targetRealm === 'mahabharata' && clipRealm === 'krishna')) {
            candidateClips.push(clip);
          }
        }
      }
    } else {
      candidateClips = sortClipsByLeastRecentlyUsed(available, slotType);
    }

    // Prefer clips not on cooldown (7 days); if all are on cooldown, LRU ensures the oldest is picked
    const offCooldown = candidateClips.filter((clip) => !isClipOnCooldown(clip, slotType, 7));
    const finalCandidates = offCooldown.length >= (targetCount - selectedClips.length) ? offCooldown : candidateClips;

    for (const clip of finalCandidates) {
      if (selectedClips.length >= targetCount) break;
      const base = path.basename(clip).toLowerCase();
      if (!selectedKeys.has(base)) {
        const isBright = await isVideoClipBrightEnough(clip, 25);
        if (isBright) {
          selectedClips.push(clip);
          selectedKeys.add(base);
          recordUsedClip(path.basename(clip), slotType);
          logger.info(`[Multi-Clip] Selected deity-locked local clip ${selectedClips.length}/${targetCount} for [${slotType}]: ${path.basename(clip)}`);
        }
      }
    }
  }

  // 3b. Backup pools (NEVER pull cricket or news for devotional or scripture slots!)
  if (selectedClips.length < targetCount) {
    let backupPools = [];
    if (slotType === 'slot2' || slotType === 'slot4') {
      const storyContext = `${deity || ''} ${epic || ''} ${title || ''}`;
      const targetRealm = detectDevotionalRealm(storyContext);
      backupPools = [
        ...getCategoryVideoPool(DEVOTIONAL_DIR),
        ...getCategoryVideoPool(SCRIPTURES_DIR),
      ].filter((f) => {
        const r = getClipDevotionalRealm(f);
        return r === targetRealm || r === 'universal_sacred';
      });
    } else {
      backupPools = [
        getCategoryVideoPool(CRICKET_DIR),
        getCategoryVideoPool(NEWS_DIR),
        getCategoryVideoPool(DEVOTIONAL_DIR),
        getCategoryVideoPool(SCRIPTURES_DIR),
      ].flat();
    }

    const sortedBackups = sortClipsByLeastRecentlyUsed(
      backupPools.filter((f) => !selectedKeys.has(path.basename(f).toLowerCase())),
      slotType
    );

    for (const clip of sortedBackups) {
      if (selectedClips.length >= targetCount) break;
      const base = path.basename(clip).toLowerCase();
      if (!selectedKeys.has(base)) {
        const isBright = await isVideoClipBrightEnough(clip, 25);
        if (isBright) {
          selectedClips.push(clip);
          selectedKeys.add(base);
          recordUsedClip(path.basename(clip), slotType);
          logger.info(`[Multi-Clip] Selected LRU backup clip ${selectedClips.length}/${targetCount} for [${slotType}]: ${path.basename(clip)}`);
        }
      }
    }
  }

  // 4. Emergency fallback: if still empty, use defaults
  if (selectedClips.length === 0) {
    const defaultMp4 = slotType === 'slot2' || slotType === 'slot4'
      ? path.join(DEVOTIONAL_DIR, 'temple_sacred_aarti.mp4')
      : path.join(DEFAULTS_DIR, 'slot1_dance.mp4');
    if (fs.existsSync(defaultMp4)) {
      selectedClips.push(defaultMp4);
    }
  }

  logger.info(`[Multi-Clip] Prepared ${selectedClips.length} distinct moving clips for [${slotType.toUpperCase()}]`);
  return selectedClips;
}

/**
 * Fetches 100% dynamic moving video MP4 background footage for any slot.
 * ZERO static image fallbacks. Every slot returns guaranteed moving video.
 * @param {Object} params
 * @param {string} params.slotType - 'slot1' | 'slot2' | 'slot3' | 'slot4' | 'slot5'
 * @param {string} [params.title]
 * @param {string} [params.customTopic]
 * @param {string} [params.clipPath]
 * @param {string} [params.themeType]
 * @param {string} [params.visualQuery]
 * @param {string} [params.secondaryQuery]
 * @param {string[]} [params.altQueries]
 * @returns {Promise<{ type: 'video', filePath: string, isTopicVideo?: boolean, topicQuery?: string }>}
 */
export async function fetchSlotBackgroundMedia({
  slotType,
  title = '',
  customTopic = null,
  clipPath = null,
  themeType = null,
  visualQuery = null,
  secondaryQuery = null,
  altQueries = [],
}) {
  const combinedText = `${customTopic || ''} ${title || ''}`.trim();

  // =================================================================
  // SLOT 1: BABY & TODDLER REELS (100% Moving Video)
  // =================================================================
  if (slotType === 'slot1') {
    // 0. If a valid clipPath is already provided (video-first pipeline), honor it directly
    if (clipPath && fs.existsSync(clipPath) && !clipPath.endsWith('slot1_baby.mp4')) {
      logger.info(`[Slot 1] Using pre-selected video clip: ${path.basename(clipPath)}`);
      return { type: 'video', filePath: clipPath };
    }

    // 1. Build cinematic high-retention video queries
    const scenarioQueries = [];
    if (visualQuery) scenarioQueries.push(`${visualQuery} cinematic vertical`);
    if (Array.isArray(altQueries) && altQueries.length > 0) {
      const shuffledAlt = [...altQueries].sort(() => 0.5 - Math.random());
      scenarioQueries.push(...shuffledAlt.map((q) => `${q} cute toddler`));
    }

    const contextualPool = themeType === 'dance'
      ? ['cute toddler dancing energetic vertical', 'baby grooving funny music 4k', 'happy toddler dance rhythm reels']
      : themeType === 'mischief'
      ? ['naughty toddler smiling funny expressions', 'cute baby playing mischief reels', 'funny toddler surprise reaction']
      : ['cute baby laughing hysterically vertical', 'baby funny reaction tasting 4k', 'happy toddler giggling smiles'];

    scenarioQueries.push(...contextualPool);

    // 2. Query dynamic Pexels video clips
    for (const q of scenarioQueries) {
      const pexelsVideo = await tryDownloadPexels(q, 'portrait');
      if (pexelsVideo) {
        logger.success(`Dynamic Pexels moving video matched for [Slot 1] "${q}": ${path.basename(pexelsVideo.filePath)}`);
        return pexelsVideo;
      }
    }

    // 3. Fallback: Rotate through expanded local moving video pool in assets/clips/baby/
    const babyPool = [
      ...getCategoryVideoPool(BABY_DIR),
      ...getSlot1PoolClips(),
    ].filter((v, idx, arr) => arr.indexOf(v) === idx);

    if (babyPool.length > 0) {
      const chosenFallback = pickUnusedFallbackClip(babyPool, 'baby');
      if (chosenFallback && fs.existsSync(chosenFallback)) {
        logger.success(`[Slot 1] Selected non-repeating moving video: ${path.basename(chosenFallback)}`);
        return { type: 'video', filePath: chosenFallback };
      }
    }

    // 4. Default baby video fallback
    const defaultMp4 = path.join(DEFAULTS_DIR, 'slot1_baby.mp4');
    if (fs.existsSync(defaultMp4)) {
      return { type: 'video', filePath: defaultMp4 };
    }
    const danceMp4 = path.join(DEFAULTS_DIR, 'slot1_dance.mp4');
    return { type: 'video', filePath: danceMp4 };
  }

  // =================================================================
  // SLOT 2: DEVOTIONAL & SANATAN DHARMA (100% Moving Video)
  // =================================================================
  if (slotType === 'slot2') {
    const textLower = combinedText.toLowerCase();

    // 1. Build deity-aware cinematic spiritual video queries
    const devotionalQueries = [];
    if (textLower.includes('shiva') || textLower.includes('mahadev') || textLower.includes('neelkanth') || textLower.includes('bhole')) {
      devotionalQueries.push(
        'shiva temple sacred smoke meditation',
        'himalayas sacred mountain sunrise clouds',
        'hindu temple sanctum prayer darshan',
        'sacred incense smoke golden spiritual'
      );
    } else if (textLower.includes('hanuman') || textLower.includes('bajrangbali') || textLower.includes('ramayan') || textLower.includes('rama')) {
      devotionalQueries.push(
        'hindu temple aarti golden lamp flame',
        'ancient hindu temple stone architecture sacred',
        'sacred diya flame spiritual prayer',
        'hindu ritual temple bells flags'
      );
    } else if (textLower.includes('krishna') || textLower.includes('sudama') || textLower.includes('dwarka') || textLower.includes('gita')) {
      devotionalQueries.push(
        'sacred temple lamps golden spiritual light',
        'hindu temple sanctum prayer darshan',
        'spiritual meditation holy river ganga'
      );
    } else if (textLower.includes('ganesh') || textLower.includes('ganpati')) {
      devotionalQueries.push(
        'sacred diya lamp temple flame night',
        'hindu festival temple celebrations colors',
        'hindu temple prayer flowers aarti'
      );
    } else {
      devotionalQueries.push(
        'hindu temple sanctum prayer darshan',
        'ancient hindu temple architecture sacred',
        'sacred diya lamp temple spiritual',
        'golden temple lamps peaceful spirituality'
      );
    }

    // 2. Query Pexels videos
    for (const q of devotionalQueries) {
      let pexelsVideo = await tryDownloadPexels(q, 'portrait');
      if (!pexelsVideo) pexelsVideo = await tryDownloadPexels(q, 'all');
      if (pexelsVideo) {
        logger.success(`Dynamic Pexels moving video matched for [Slot 2] "${q}": ${path.basename(pexelsVideo.filePath)}`);
        return pexelsVideo;
      }
    }

    // 3. Fallback: Context-aware selection from assets/clips/devotional/
    const allDevotionalClips = getCategoryVideoPool(DEVOTIONAL_DIR);
    const targetRealm = detectDevotionalRealm(combinedText);
    const primaryMatches = [];
    const sacredAtmosphere = [];

    for (const clip of allDevotionalClips) {
      const clipRealm = getClipDevotionalRealm(clip);
      if (targetRealm !== 'universal_sacred') {
        if (clipRealm === targetRealm) primaryMatches.push(clip);
        else if (clipRealm === 'universal_sacred') sacredAtmosphere.push(clip);
      } else {
        if (clipRealm === 'universal_sacred') primaryMatches.push(clip);
        else sacredAtmosphere.push(clip);
      }
    }

    const candidatePool = primaryMatches.length > 0
      ? primaryMatches
      : (sacredAtmosphere.length > 0 ? sacredAtmosphere : allDevotionalClips);
    const sortedPool = sortClipsByLeastRecentlyUsed(candidatePool, 'slot2');
    const offCooldown = sortedPool.filter((c) => !isClipOnCooldown(c, 'slot2', 7));
    const chosenClip = (offCooldown.length > 0 ? offCooldown[0] : sortedPool[0]) ||
      pickUnusedFallbackClip(candidatePool, 'devotional');

    if (chosenClip && fs.existsSync(chosenClip)) {
      recordUsedClip(path.basename(chosenClip), 'slot2');
      logger.success(`[Slot 2 Devotional] Selected LRU non-repeating moving video: ${path.basename(chosenClip)}`);
      return { type: 'video', filePath: chosenClip };
    }

    // Guaranteed fallback to any available devotional or scripture video
    const scripturePool = getCategoryVideoPool(SCRIPTURES_DIR);
    const emergencyClip = scripturePool[0] || path.join(DEFAULTS_DIR, 'slot1_dance.mp4');
    return { type: 'video', filePath: emergencyClip };
  }

  // =================================================================
  // SLOT 3: NEWS EXPLAINER (100% Moving Video)
  // =================================================================
  if (slotType === 'slot3') {
    // 1. Build prioritized search queries
    const queriesToTry = [];
    if (visualQuery) queriesToTry.push(visualQuery);
    if (secondaryQuery) queriesToTry.push(secondaryQuery);
    if (Array.isArray(altQueries)) queriesToTry.push(...altQueries);

    if (queriesToTry.length === 0) {
      const extracted = extractNewsVisualQueries(combinedText);
      queriesToTry.push(extracted.primaryQuery, extracted.secondaryQuery, ...(extracted.altQueries || []));
    }

    // 2. Query dynamic Pexels video clips matching the specific context of the news topic
    for (const q of queriesToTry) {
      let pexelsVideo = await tryDownloadPexels(q, 'portrait');
      if (!pexelsVideo) pexelsVideo = await tryDownloadPexels(q, 'all');
      if (pexelsVideo) {
        logger.success(`Matched dynamic Pexels video for News topic "${q}": ${path.basename(pexelsVideo.filePath)}`);
        return {
          type: 'video',
          filePath: pexelsVideo.filePath,
          isTopicVideo: true,
          topicQuery: q,
        };
      }
    }

    // 2b. Generic high-motion news video queries
    const GENERIC_NEWS_FALLBACKS = [
      'breaking news studio reporter',
      'city skyline drone motion',
      'global finance trading data screen',
      'press conference microphones reporter',
      'geopolitics world map network',
    ];

    for (const gq of GENERIC_NEWS_FALLBACKS) {
      let pexelsVideo = await tryDownloadPexels(gq, 'portrait');
      if (!pexelsVideo) pexelsVideo = await tryDownloadPexels(gq, 'all');
      if (pexelsVideo) {
        logger.success(`Matched generic news fallback Pexels video "${gq}": ${path.basename(pexelsVideo.filePath)}`);
        return {
          type: 'video',
          filePath: pexelsVideo.filePath,
          isTopicVideo: true,
          topicQuery: gq,
        };
      }
    }

    // 3. Fallback: Context-aware selection from assets/clips/news/
    const allNewsClips = getCategoryVideoPool(NEWS_DIR);
    const textLower = combinedText.toLowerCase();
    let newsCandidates = [];

    if (/tech|ai|cyber|digital|space|satellite|globe/i.test(textLower)) {
      newsCandidates = allNewsClips.filter((f) => /tech|globe|network/i.test(f));
    } else if (/finance|market|stock|bank|rbi|economy|tax|money|trade/i.test(textLower)) {
      newsCandidates = allNewsClips.filter((f) => /financial|radar|traffic/i.test(f));
    } else if (/traffic|transport|highway|city|delhi|pollution|roads|train|flight/i.test(textLower)) {
      newsCandidates = allNewsClips.filter((f) => /city|traffic/i.test(f));
    } else if (/parliament|election|govt|minister|court|police|briefing/i.test(textLower)) {
      newsCandidates = allNewsClips.filter((f) => /geopolitics|network|newsroom/i.test(f));
    }

    const candidatePool = newsCandidates.length > 0 ? newsCandidates : allNewsClips;
    const chosenNewsClip = pickUnusedFallbackClip(candidatePool, 'news') ||
      pickUnusedFallbackClip(allNewsClips, 'news');

    if (chosenNewsClip && fs.existsSync(chosenNewsClip)) {
      logger.success(`[Slot 3 News] Selected non-repeating moving video: ${path.basename(chosenNewsClip)}`);
      return {
        type: 'video',
        filePath: chosenNewsClip,
        isTopicVideo: true,
        topicQuery: (visualQuery || 'NEWS DESK REPORT').toUpperCase().slice(0, 24),
      };
    }

    // Emergency news fallback video
    const defaultNewsMp4 = path.join(DEFAULTS_DIR, 'slot3_news.mp4');
    return {
      type: 'video',
      filePath: fs.existsSync(defaultNewsMp4) ? defaultNewsMp4 : path.join(DEFAULTS_DIR, 'slot1_dance.mp4'),
      isTopicVideo: true,
      topicQuery: 'BREAKING UPDATE',
    };
  }

  // =================================================================
  // SLOT 5: CRICKET & IPL BUZZ (100% Moving Video)
  // =================================================================
  if (slotType === 'slot5') {
    const stadiumQueries = [];
    if (visualQuery) stadiumQueries.push(visualQuery);
    if (secondaryQuery) stadiumQueries.push(secondaryQuery);
    if (Array.isArray(altQueries)) stadiumQueries.push(...altQueries);
    stadiumQueries.push(
      'cricket stadium floodlights night cinematic',
      'cricket match stadium crowd cheering 4k',
      'cricket ground night lights',
      'sports stadium floodlights'
    );

    for (const q of stadiumQueries) {
      let pexelsVideo = await tryDownloadPexels(q, 'portrait');
      if (!pexelsVideo) pexelsVideo = await tryDownloadPexels(q, 'all');
      if (pexelsVideo) {
        logger.success(`Matched dynamic Pexels cricket video for Slot 5 "${q}": ${path.basename(pexelsVideo.filePath)}`);
        return {
          type: 'video',
          filePath: pexelsVideo.filePath,
          isCricketStadium: true,
        };
      }
    }

    // Local fallback cricket moving video pool in assets/clips/cricket/
    const allCricketClips = getCategoryVideoPool(CRICKET_DIR);
    const chosenCricketClip = pickUnusedFallbackClip(allCricketClips, 'cricket');

    if (chosenCricketClip && fs.existsSync(chosenCricketClip)) {
      logger.success(`[Slot 5 Cricket] Selected non-repeating stadium video: ${path.basename(chosenCricketClip)}`);
      return { type: 'video', filePath: chosenCricketClip, isCricketStadium: true };
    }

    const defaultStadium = path.join(DEFAULTS_DIR, 'cricket', 'stadium_bg.mp4');
    return {
      type: 'video',
      filePath: fs.existsSync(defaultStadium) ? defaultStadium : path.join(DEFAULTS_DIR, 'slot1_dance.mp4'),
      isCricketStadium: true,
    };
  }

  // Absolute fallback: pick any verified moving video
  const anyClip = getCategoryVideoPool(BABY_DIR)[0] || path.join(DEFAULTS_DIR, 'slot1_dance.mp4');
  return { type: 'video', filePath: anyClip };
}

/**
 * Detects epic category from scripture metadata: 'ramayana' | 'mahabharata' | 'gita' | 'general'
 * @param {Object} item
 * @returns {string}
 */
export function detectScriptureEpic(item = {}) {
  const text = `${item.id || ''} ${item.epic || ''} ${item.dialogueTheme || ''} ${item.englishTitle || ''} ${(item.tags || []).join(' ')}`.toLowerCase();
  if (
    text.includes('ramayan') ||
    text.includes('hanuman') ||
    text.includes('rama') ||
    text.includes('sita') ||
    text.includes('ravana') ||
    text.includes('sundar') ||
    text.includes('lanka') ||
    text.includes('ayodhya')
  ) {
    return 'ramayana';
  }
  if (
    text.includes('gita') ||
    text.includes('geeta') ||
    text.includes('krishna') ||
    text.includes('vishwaroop') ||
    text.includes('arjun')
  ) {
    return 'gita';
  }
  if (
    text.includes('mahabharat') ||
    text.includes('bhishma') ||
    text.includes('karna') ||
    text.includes('kurukshetra') ||
    text.includes('pandav') ||
    text.includes('kaurav') ||
    text.includes('shantanu')
  ) {
    return 'mahabharata';
  }
  return 'general';
}

/**
 * Ensures high-quality moving video clip exists for Slot 4 (Epic Scriptures & Wisdom)
 * 100% MP4 video. ZERO static image fallbacks.
 * @param {Object} item - Scripture topic item
 * @returns {Promise<string>} Path to local moving video clip
 */
export async function fetchScriptureClip(item = {}) {
  const filename = item.clipFilename || `${item.id || 'scripture'}.mp4`;
  const targetPath = path.join(SCRIPTURES_DIR, filename);

  // 1. If dedicated clip already exists and is healthy (> 100KB), reuse it
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 100000) {
    logger.info(`Using cached scripture video clip: ${filename}`);
    return targetPath;
  }

  // 2. Category-Aware Local Moving Video Pool (100% MP4 videos, ZERO static images)
  const epicCategory = detectScriptureEpic(item);
  logger.info(`Resolving local scripture moving video for category: [${epicCategory.toUpperCase()}] (topic: "${item.englishTitle || item.id || ''}")`);

  let candidates = [];
  if (epicCategory === 'ramayana') {
    candidates = [
      path.join(SCRIPTURES_DIR, 'ramayana_rama.mp4'),
      path.join(SCRIPTURES_DIR, 'hanuman_ravana.mp4'),
    ];
  } else if (epicCategory === 'gita') {
    candidates = [
      path.join(SCRIPTURES_DIR, 'geeta_saar.mp4'),
      path.join(SCRIPTURES_DIR, 'vishwaroop_darshan.mp4'),
      path.join(SCRIPTURES_DIR, 'karna_daan.mp4'),
    ];
  } else if (epicCategory === 'mahabharata') {
    const itemText = `${item.id || ''} ${item.englishTitle || ''} ${item.dialogueTheme || ''}`.toLowerCase();
    if (itemText.includes('bhishma')) {
      candidates = [
        path.join(SCRIPTURES_DIR, 'bhishma_pratigya.mp4'),
        path.join(SCRIPTURES_DIR, 'geeta_saar.mp4'),
        path.join(SCRIPTURES_DIR, 'karna_daan.mp4'),
      ];
    } else if (itemText.includes('karna')) {
      candidates = [
        path.join(SCRIPTURES_DIR, 'karna_daan.mp4'),
        path.join(SCRIPTURES_DIR, 'geeta_saar.mp4'),
        path.join(SCRIPTURES_DIR, 'bhishma_pratigya.mp4'),
      ];
    } else {
      candidates = [
        path.join(SCRIPTURES_DIR, 'geeta_saar.mp4'),
        path.join(SCRIPTURES_DIR, 'karna_daan.mp4'),
        path.join(SCRIPTURES_DIR, 'bhishma_pratigya.mp4'),
      ];
    }
  } else {
    candidates = getCategoryVideoPool(SCRIPTURES_DIR);
  }

  const validCandidates = candidates.filter((f) => fs.existsSync(f) && fs.statSync(f).size > 50000);
  const pool = validCandidates.length > 0 ? validCandidates : getCategoryVideoPool(SCRIPTURES_DIR);
  const sortedScriptures = sortClipsByLeastRecentlyUsed(pool, 'slot4');
  const offCooldown = sortedScriptures.filter((c) => !isClipOnCooldown(c, 'slot4', 7));
  const chosen = (offCooldown.length > 0 ? offCooldown[0] : sortedScriptures[0]) ||
    pickUnusedFallbackClip(pool, `scriptures_${epicCategory}`);

  if (chosen && fs.existsSync(chosen)) {
    recordUsedClip(path.basename(chosen), 'slot4');
    logger.success(`Matched local ${epicCategory.toUpperCase()} scripture moving video: ${path.basename(chosen)}`);
    return chosen;
  }

  return path.join(SCRIPTURES_DIR, 'geeta_saar.mp4');
}

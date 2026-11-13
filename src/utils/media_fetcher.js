import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import { config } from '../config.js';
import { logger } from './logger.js';
import { extractNewsVisualQueries } from './text_utils.js';
import {
  isPexelsVideoUsed,
  markPexelsVideoUsed,
  pickUnusedFallbackClip,
} from './used_assets.js';
import { ensureSlot1Pool, getSlot1PoolClips } from './ensure_slot1_pool.js';

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

const WIKIMEDIA_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'video/*,*/*',
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
    const orientParam = orientation === 'portrait' ? '&orientation=portrait' : '';
    const page = options.page || (Math.floor(Math.random() * 4) + 1);
    const perPage = options.perPage || 15;
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}${orientParam}&per_page=${perPage}&page=${page}`;
    const res = await fetch(url, {
      headers: { Authorization: config.pexelsApiKey },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const videos = data.videos || [];
    if (videos.length === 0) return null;

    // Filter out previously used video IDs to prevent consecutive repeats
    const unusedVideos = videos.filter((v) => !isPexelsVideoUsed(String(v.id)));
    const candidates = unusedVideos.length > 0 ? unusedVideos : videos;

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    // Prioritize high-resolution 1080p or 720p vertical video files
    const file = chosen.video_files.find((f) => f.height >= 1080 && f.width >= 720) ||
      chosen.video_files.find((f) => f.height >= 720) ||
      chosen.video_files[0];

    if (!file || !file.link) return null;

    const hash = crypto.createHash('md5').update(`pexels_v_${chosen.id}`).digest('hex');
    const dest = path.join(CACHE_DIR, `pexels_${hash}.mp4`);
    if (!fs.existsSync(dest) || fs.statSync(dest).size < 50000) {
      logger.info(`Downloading fresh Pexels moving video for "${query}" (page ${page}, ID ${chosen.id})...`);
      await downloadFile(file.link, dest);
    } else {
      logger.info(`Using cached Pexels moving video (ID ${chosen.id}) for "${query}"`);
    }

    markPexelsVideoUsed(chosen.id, query);
    return { type: 'video', filePath: dest, pexelsId: chosen.id };
  } catch (e) {
    logger.warn(`Pexels video fetch failed for "${query}": ${e.message}`);
    return null;
  }
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
    let matchedCandidates = [];

    if (textLower.includes('shiva') || textLower.includes('mahadev') || textLower.includes('kedarnath')) {
      matchedCandidates = allDevotionalClips.filter((f) => /shiva|kedarnath|himalayas/i.test(f));
    } else if (textLower.includes('hanuman') || textLower.includes('bajrangbali')) {
      matchedCandidates = allDevotionalClips.filter((f) => /hanuman|aarti/i.test(f));
    } else if (textLower.includes('krishna') || textLower.includes('sudama') || textLower.includes('gita')) {
      matchedCandidates = allDevotionalClips.filter((f) => /krishna|aarti/i.test(f));
    } else if (textLower.includes('ganesh') || textLower.includes('ganpati')) {
      matchedCandidates = allDevotionalClips.filter((f) => /ganesha|aarti/i.test(f));
    }

    const candidatePool = matchedCandidates.length > 0 ? matchedCandidates : allDevotionalClips;
    const chosenClip = pickUnusedFallbackClip(candidatePool, 'devotional') ||
      pickUnusedFallbackClip(allDevotionalClips, 'devotional');

    if (chosenClip && fs.existsSync(chosenClip)) {
      logger.success(`[Slot 2 Devotional] Selected non-repeating moving video: ${path.basename(chosenClip)}`);
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

  // 2. Try yt-dlp slicing if yt-dlp is available
  if (fs.existsSync(YTDLP_PATH) || YTDLP_PATH === 'yt-dlp') {
    const theme = item.dialogueTheme || item.englishTitle || 'Mahabharat Krishna Arjun Geeta';
    const searchQuery = `ytsearch1:${theme} animation scene`;
    logger.info(`Executing yt-dlp to slice 30s scripture clip: "${searchQuery}"...`);

    const ytdlpArgs = [
      '--ffmpeg-location', ffmpegStatic,
      '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--download-sections', '*00:15-00:50',
      '--no-playlist',
      '-o', targetPath,
      searchQuery,
    ];

    try {
      await new Promise((resolve, reject) => {
        execFile(YTDLP_PATH, ytdlpArgs, { timeout: 45000 }, (err, stdout, stderr) => {
          if (err) reject(err);
          else resolve(stdout);
        });
      });

      if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 100000) {
        logger.success(`Successfully sliced and saved scripture clip: ${filename}`);
        return targetPath;
      }
    } catch (_) {
      logger.info('yt-dlp slice skipped or failed; selecting from verified category video pool.');
    }
  }

  // 3. Category-Aware Local Moving Video Pool (100% MP4 videos, ZERO static images)
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
  const chosen = pickUnusedFallbackClip(pool, `scriptures_${epicCategory}`);

  if (chosen && fs.existsSync(chosen)) {
    logger.success(`Matched local ${epicCategory.toUpperCase()} scripture moving video: ${path.basename(chosen)}`);
    return chosen;
  }

  return path.join(SCRIPTURES_DIR, 'geeta_saar.mp4');
}

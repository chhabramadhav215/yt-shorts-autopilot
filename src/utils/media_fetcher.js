import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import { config } from '../config.js';
import { logger } from './logger.js';
import { extractNewsVisualQueries } from './text_utils.js';

const WIKIMEDIA_USER_AGENT = 'YouTubeAutoShortsBot/1.0 (https://youtube.com/@auto-shorts; contact.autoshorts@gmail.com) NodeFetch/3.0';

const CACHE_DIR = path.join(config.assetsDir, 'cache');
const DEFAULTS_DIR = path.join(config.assetsDir, 'defaults');
const SCRIPTURES_DIR = path.join(config.assetsDir, 'clips', 'scriptures');
const BIN_DIR = path.join(config.assetsDir, 'bin');
const YTDLP_BIN = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const YTDLP_PATH = fs.existsSync(path.join(BIN_DIR, YTDLP_BIN))
  ? path.join(BIN_DIR, YTDLP_BIN)
  : (fs.existsSync(path.join(BIN_DIR, 'yt-dlp.exe')) ? path.join(BIN_DIR, 'yt-dlp.exe') : 'yt-dlp');

// Ensure required directories exist
[CACHE_DIR, DEFAULTS_DIR, SCRIPTURES_DIR, BIN_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

/**
 * Downloads a file safely with proper headers and size validation
 */
async function downloadFile(url, destPath) {
  const cleanUrl = url.split('?')[0]; // Strip tracking params
  const res = await fetch(cleanUrl, {
    headers: {
      'User-Agent': WIKIMEDIA_USER_AGENT,
      'Accept': 'image/*,video/*,*/*',
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
 * Searches Wikimedia Commons API for high-resolution images
 */
async function searchWikimediaCommons(query, maxResults = 6) {
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

      // Block SVGs, vector graphics, and unreadable charts/maps/diagrams
      if (mime.includes('svg') || (info.url || '').toLowerCase().endsWith('.svg')) continue;

      const titleLower = (page.title || '').toLowerCase();
      const urlLower = (info.url || '').toLowerCase();
      const isUnwantedGraphic = [
        'map', 'chart', 'diagram', 'graph', 'locator', 'plan', 'schema',
        'flag', 'logo', 'symbol', 'icon', 'infographic', 'coat_of_arms',
        'table', 'plot', 'census', 'poll', 'drawing', 'sketch', 'vector',
        'illustration', 'line_art', 'contour', 'topographic', 'relief',
        'satellit', 'geology', 'projection', 'demographic', 'division',
        'boundary', 'blank', 'template', 'overview', 'infobox', 'sheet',
        'economic', 'stimulus', 'crisis', 'distribution', 'percentage'
      ].some((k) => titleLower.includes(k) || urlLower.includes(k));

      if (isUnwantedGraphic) continue;

      if ((isImage || isVideo) && (info.width >= 800 || info.height >= 800)) {
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
 * Attempts to download Pexels video if API key is configured
 * @param {string} query
 * @param {'portrait' | 'all'} [orientation]
 */
async function tryDownloadPexels(query, orientation = 'portrait') {
  if (!config.pexelsApiKey) return null;
  try {
    const orientParam = orientation === 'portrait' ? '&orientation=portrait' : '';
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}${orientParam}&per_page=5`;
    const res = await fetch(url, {
      headers: { Authorization: config.pexelsApiKey },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const videos = data.videos || [];
    if (videos.length === 0) return null;

    const chosen = videos[Math.floor(Math.random() * videos.length)];
    const file = chosen.video_files.find((f) => f.height >= 1080) || chosen.video_files[0];
    if (!file || !file.link) return null;

    const hash = crypto.createHash('md5').update(`pexels_v_${query}_${chosen.id}`).digest('hex');
    const dest = path.join(CACHE_DIR, `pexels_${hash}.mp4`);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 50000) return { type: 'video', filePath: dest };

    logger.info(`Downloading Pexels video for "${query}" (${orientation})...`);
    await downloadFile(file.link, dest);
    return { type: 'video', filePath: dest };
  } catch (e) {
    logger.warn(`Pexels video fetch failed: ${e.message}`);
    return null;
  }
}

/**
 * Attempts to download high-res Pexels photo if API key is configured
 */
async function tryDownloadPexelsPhoto(query) {
  if (!config.pexelsApiKey) return null;
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5`;
    const res = await fetch(url, {
      headers: { Authorization: config.pexelsApiKey },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const photos = data.photos || [];
    if (photos.length === 0) return null;

    const chosen = photos[Math.floor(Math.random() * photos.length)];
    const imgUrl = chosen.src?.large2x || chosen.src?.large || chosen.src?.original;
    if (!imgUrl) return null;

    const hash = crypto.createHash('md5').update(`pexels_p_${query}_${chosen.id}`).digest('hex');
    const dest = path.join(CACHE_DIR, `pexels_${hash}.jpg`);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 20000) return { type: 'image', filePath: dest };

    logger.info(`Downloading Pexels photo for "${query}"...`);
    await downloadFile(imgUrl, dest);
    return { type: 'image', filePath: dest };
  } catch (e) {
    logger.warn(`Pexels photo fetch failed: ${e.message}`);
    return null;
  }
}

/**
 * Fetches background HD media (video or high-res image) for Slots 1, 2, and 3
 * @param {Object} params
 * @param {string} params.slotType - 'slot1' | 'slot2' | 'slot3'
 * @param {string} [params.title] - Content headline or title
 * @param {string} [params.customTopic] - User custom topic
 * @param {string} [params.clipPath] - Optional direct video clip path
 * @param {string} [params.themeType] - Optional theme type (e.g. 'jokes', 'dance', 'mischief')
 * @param {string} [params.visualQuery] - Specific context query for dynamic video matching
 * @param {string[]} [params.altQueries] - Alternative fallback queries for dynamic matching
 * @returns {Promise<{ type: 'video' | 'image', filePath: string }>}
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

  // Determine query list & fallback asset per slot
  let queries = [];
  let defaultAsset = null;

  if (slotType === 'slot1') {
    // 1. Build prioritized search queries matching the specific context of the joke
    const scenarioQueries = [];
    if (visualQuery) scenarioQueries.push(visualQuery);
    if (Array.isArray(altQueries)) scenarioQueries.push(...altQueries);

    // Add theme-relevant contextual queries
    if (themeType === 'dance') {
      scenarioQueries.push('toddler dancing funny', 'cute baby dancing', 'baby grooving music');
    } else if (themeType === 'mischief') {
      scenarioQueries.push('naughty kid smiling', 'cute baby playing', 'toddler mischief funny');
    } else {
      scenarioQueries.push('cute baby talking', 'toddler laughing', 'naughty kid', 'cute baby smiling');
    }

    // 2. Query dynamic Pexels video clips matching the specific context of the generated joke
    for (const q of scenarioQueries) {
      const pexelsVideo = await tryDownloadPexels(q);
      if (pexelsVideo) {
        logger.success(`Dynamic Pexels vertical video matched for context "${q}": ${path.basename(pexelsVideo.filePath)}`);
        return pexelsVideo;
      }
    }

    // 3. Fallback to curated theme-specific video clips if Pexels is unconfigured or returns nothing
    if (clipPath && fs.existsSync(clipPath)) {
      logger.info(`Using theme clip for Slot 1: ${path.basename(clipPath)}`);
      return { type: 'video', filePath: clipPath };
    }

    if (themeType) {
      const themeMp4 = path.join(DEFAULTS_DIR, `slot1_${themeType}.mp4`);
      if (fs.existsSync(themeMp4)) {
        logger.info(`Using curated real baby video for theme [${themeType}]: ${path.basename(themeMp4)}`);
        return { type: 'video', filePath: themeMp4 };
      }
    }

    const defaultMp4 = path.join(DEFAULTS_DIR, 'slot1_baby.mp4');
    if (fs.existsSync(defaultMp4)) {
      logger.info(`Using curated moving real baby video: slot1_baby.mp4`);
      return { type: 'video', filePath: defaultMp4 };
    }
    defaultAsset = path.join(DEFAULTS_DIR, 'slot1_baby.jpg');
  } else if (slotType === 'slot2') {
    const textLower = combinedText.toLowerCase();
    if (textLower.includes('shiva') || textLower.includes('mahadev') || textLower.includes('neelkanth') || textLower.includes('bhole')) {
      queries = [
        'Lord Shiva statue Dharmasthala',
        'Lord Shiva statue meditation Himalayas',
        'Shiva temple kedarnath darshan',
      ];
      defaultAsset = path.join(DEFAULTS_DIR, 'slot2_shiva.jpg');
    } else if (textLower.includes('hanuman') || textLower.includes('bajrangbali') || textLower.includes('ramayan')) {
      queries = [
        'Hanuman Hindu deity statue temple',
        'Hanuman Pushkar temple statue',
        'Lord Rama Hanuman devotion',
      ];
      defaultAsset = path.join(DEFAULTS_DIR, 'slot2_hanuman.jpg');
    } else if (textLower.includes('krishna') || textLower.includes('sudama') || textLower.includes('dwarka')) {
      queries = [
        'Lord Krishna deity temple statue',
        'Krishna Vrindavan temple sacred',
        'Lord Krishna idol darshan',
      ];
      defaultAsset = path.join(DEFAULTS_DIR, 'slot2_shiva.jpg');
    } else if (textLower.includes('ganesh') || textLower.includes('ganpati')) {
      queries = [
        'Lord Ganesha idol temple sacred',
        'Ganesha statue Hindu deity',
      ];
      defaultAsset = path.join(DEFAULTS_DIR, 'slot2_shiva.jpg');
    } else {
      queries = [
        'Hindu temple sanctum prayer darshan',
        'Ancient Hindu temple architecture sacred',
        'Lord Shiva statue Dharmasthala',
      ];
      defaultAsset = path.join(DEFAULTS_DIR, 'slot2_shiva.jpg');
    }
  } else if (slotType === 'slot3') {
    // Slot 3: Dynamic newsroom video background + smart topic footage / leader photo
    const newsVideo = path.join(DEFAULTS_DIR, 'slot3_news.mp4');

    // 1. Build smart search queries (extracting broad visual terms rather than raw headline)
    const queriesToTry = [];
    if (visualQuery) queriesToTry.push(visualQuery);
    if (secondaryQuery) queriesToTry.push(secondaryQuery);
    if (Array.isArray(altQueries)) queriesToTry.push(...altQueries);

    if (queriesToTry.length === 0) {
      const extracted = extractNewsVisualQueries(combinedText);
      queriesToTry.push(extracted.primaryQuery, extracted.secondaryQuery, ...(extracted.altQueries || []));
    }

    logger.info(`[SLOT 3] Smart news visual queries to search: ${queriesToTry.slice(0, 3).map((q) => `"${q}"`).join(', ')}`);

    // 2. Query dynamic Pexels video clips matching the specific context of the news topic
    for (const q of queriesToTry) {
      // First try portrait orientation
      let pexelsVideo = await tryDownloadPexels(q, 'portrait');
      // If no portrait video, try any orientation (landscape fits into center 16:9 box or blurred canvas)
      if (!pexelsVideo) {
        pexelsVideo = await tryDownloadPexels(q, 'all');
      }
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

    // 2b. If topic queries returned 0 results, retry with generic news fallbacks on Pexels
    const GENERIC_NEWS_FALLBACKS = [
      'breaking news studio',
      'geopolitics briefing',
      'breaking news reporter',
      'military press conference',
      'press conference microphones',
      'geopolitics world map',
    ];

    logger.warn(`[SLOT 3] Topic queries returned 0 Pexels videos. Retrying with generic news fallbacks: ${GENERIC_NEWS_FALLBACKS.slice(0, 3).map((g) => `"${g}"`).join(', ')}...`);

    for (const gq of GENERIC_NEWS_FALLBACKS) {
      let pexelsVideo = await tryDownloadPexels(gq, 'portrait');
      if (!pexelsVideo) {
        pexelsVideo = await tryDownloadPexels(gq, 'all');
      }
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

    // 3. If no video from Pexels, search Pexels for high-res topic photos (topic queries, then generic fallbacks)
    const photoQueries = [...queriesToTry, ...GENERIC_NEWS_FALLBACKS];
    for (const q of photoQueries) {
      const pexelsPhoto = await tryDownloadPexelsPhoto(q);
      if (pexelsPhoto) {
        logger.success(`Matched dynamic Pexels photo for News topic "${q}": ${path.basename(pexelsPhoto.filePath)}`);
        return {
          type: 'video',
          filePath: fs.existsSync(newsVideo) ? newsVideo : pexelsPhoto.filePath,
          topicImage: pexelsPhoto.filePath,
          leaderBadge: q.toUpperCase().slice(0, 24),
        };
      }
    }

    // 4. Detect high-impact leaders or institutions mentioned in headline
    const textLower = combinedText.toLowerCase();
    let leaderQuery = null;
    let leaderBadge = null;
    let localLeaderFile = null;

    if (textLower.includes('modi')) {
      leaderQuery = 'Narendra Modi official portrait';
      leaderBadge = 'PM NARENDRA MODI';
      localLeaderFile = path.join(DEFAULTS_DIR, 'leaders', 'modi.jpg');
    } else if (textLower.includes('zelensky') || textLower.includes('zelenskyy')) {
      leaderQuery = 'Volodymyr Zelenskyy official portrait';
      leaderBadge = 'VOLODYMYR ZELENSKYY';
      localLeaderFile = path.join(DEFAULTS_DIR, 'leaders', 'zelenskyy.jpg');
    } else if (textLower.includes('jaishankar')) {
      leaderQuery = 'Subrahmanyam Jaishankar official portrait';
      leaderBadge = 'S. JAISHANKAR';
      localLeaderFile = path.join(DEFAULTS_DIR, 'leaders', 'jaishankar.jpg');
    } else if (textLower.includes('putin')) {
      leaderQuery = 'Vladimir Putin official portrait';
      leaderBadge = 'VLADIMIR PUTIN';
      localLeaderFile = path.join(DEFAULTS_DIR, 'leaders', 'putin.jpg');
    } else if (textLower.includes('trump')) {
      leaderQuery = 'Donald Trump official portrait';
      leaderBadge = 'DONALD TRUMP';
      localLeaderFile = path.join(DEFAULTS_DIR, 'leaders', 'trump.jpg');
    } else if (textLower.includes('biden')) {
      leaderQuery = 'Joe Biden official portrait';
      leaderBadge = 'JOE BIDEN';
      localLeaderFile = path.join(DEFAULTS_DIR, 'leaders', 'biden.jpg');
    } else if (textLower.includes('clinton')) {
      leaderQuery = 'Bill Clinton official portrait';
      leaderBadge = 'BILL CLINTON';
    } else if (textLower.includes('sonia')) {
      leaderQuery = 'Sonia Gandhi portrait';
      leaderBadge = 'SONIA GANDHI';
    } else if (textLower.includes('rahul')) {
      leaderQuery = 'Rahul Gandhi portrait';
      leaderBadge = 'RAHUL GANDHI';
    } else if (textLower.includes('obama')) {
      leaderQuery = 'Barack Obama official portrait';
      leaderBadge = 'BARACK OBAMA';
    } else if (textLower.includes('harris') || textLower.includes('kamala')) {
      leaderQuery = 'Kamala Harris official portrait';
      leaderBadge = 'KAMALA HARRIS';
    } else if (textLower.includes('netanyahu')) {
      leaderQuery = 'Benjamin Netanyahu official portrait';
      leaderBadge = 'BENJAMIN NETANYAHU';
    } else if (textLower.includes('sunita') || textLower.includes('williams')) {
      leaderQuery = 'Sunita Williams astronaut';
      leaderBadge = 'SUNITA WILLIAMS';
    } else if (textLower.includes('isro')) {
      leaderQuery = 'ISRO rocket launch spacecraft';
      leaderBadge = 'ISRO MISSION';
    } else if (textLower.includes('supreme court')) {
      leaderQuery = 'Supreme Court of India courtroom';
      leaderBadge = 'SUPREME COURT';
    } else if (textLower.includes('parliament') || textLower.includes('lok sabha')) {
      leaderQuery = 'Parliament of India building';
      leaderBadge = 'PARLIAMENT';
    } else if (textLower.includes('rbi') || textLower.includes('shaktikanta')) {
      leaderQuery = 'Reserve Bank of India building';
      leaderBadge = 'RESERVE BANK';
    } else if (textLower.includes('adani')) {
      leaderQuery = 'Gautam Adani photograph portrait';
      leaderBadge = 'BUSINESS REPORT';
    } else if (textLower.includes('ambani')) {
      leaderQuery = 'Mukesh Ambani photograph portrait';
      leaderBadge = 'BUSINESS REPORT';
    } else if (textLower.includes('kohli') || textLower.includes('cricket')) {
      leaderQuery = 'Virat Kohli photograph';
      leaderBadge = 'INDIAN CRICKET';
    }

    let topicImage = null;
    if (localLeaderFile && fs.existsSync(localLeaderFile)) {
      topicImage = localLeaderFile;
      logger.info(`Using curated official portrait for leader [${leaderBadge}]: ${path.basename(localLeaderFile)}`);
    } else if (leaderQuery) {
      const cacheKey = crypto.createHash('md5').update(`wiki_leader_${leaderQuery}`).digest('hex');
      const cachedJpg = path.join(CACHE_DIR, `${cacheKey}.jpg`);
      if (fs.existsSync(cachedJpg) && fs.statSync(cachedJpg).size > 20000) {
        topicImage = cachedJpg;
      } else {
        logger.info(`Searching high-impact official portrait for news: "${leaderQuery}"...`);
        const results = await searchWikimediaCommons(leaderQuery, 4);
        if (results.length > 0) {
          results.sort((a, b) => (b.width * b.height) - (a.width * a.height));
          try {
            await downloadFile(results[0].url, cachedJpg);
            topicImage = cachedJpg;
            logger.success(`Fetched high-impact leader portrait: ${path.basename(cachedJpg)}`);
          } catch (e) {
            logger.warn(`Could not download leader portrait: ${e.message}`);
          }
        }
      }
    }

    if (!topicImage) {
      // Intelligent fallback: search photo for headline topic (strictly excluding charts/maps/diagrams)
      const cleanNewsHeadline = combinedText
        .replace(/^(EXPLAINED|BREAKING UPDATE|BREAKING NEWS|BREAKING|WATCH|JUST IN|ALERT|REPORT|VIRAL):\s*/i, '')
        .trim();
      const stopWords = new Set(['explained', 'breaking', 'update', 'watch', 'just', 'news', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'is', 'are', 'was', 'were', 'by', 'with', 'from', 'as', 'that', 'this', 'after', 'over', 'into', 'says', 'amid', 'will', 'have', 'been']);
      const words = cleanNewsHeadline.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w.toLowerCase()));
      const searchTopic = words.slice(0, 2).join(' ');
      if (searchTopic) {
        const cacheKey = crypto.createHash('md5').update(`wiki_topic_${searchTopic}`).digest('hex');
        const cachedJpg = path.join(CACHE_DIR, `${cacheKey}.jpg`);
        if (fs.existsSync(cachedJpg) && fs.statSync(cachedJpg).size > 20000) {
          topicImage = cachedJpg;
          leaderBadge = searchTopic.toUpperCase().slice(0, 24);
        } else {
          const results = await searchWikimediaCommons(`${searchTopic} press photograph portrait`, 4);
          if (results.length > 0) {
            results.sort((a, b) => (b.width * b.height) - (a.width * a.height));
            try {
              await downloadFile(results[0].url, cachedJpg);
              topicImage = cachedJpg;
              leaderBadge = searchTopic.toUpperCase().slice(0, 24);
              logger.success(`Fetched high-impact topic image: ${path.basename(cachedJpg)}`);
            } catch (e) {
              logger.warn(`Could not download topic photo: ${e.message}`);
            }
          }
        }
      }
    }

    if (topicImage) {
      return { type: 'video', filePath: newsVideo, topicImage, leaderBadge };
    }

    if (fs.existsSync(newsVideo)) {
      logger.info(`Using curated dynamic newsroom video: slot3_news.mp4`);
      return { type: 'video', filePath: newsVideo, isDefaultFallback: true };
    }
    defaultAsset = path.join(DEFAULTS_DIR, 'slot3_news.jpg');
    return { type: 'image', filePath: defaultAsset, isDefaultFallback: true };
  }

  // 1. Try Pexels video if API key configured
  for (const q of queries) {
    const pexelsResult = await tryDownloadPexels(q);
    if (pexelsResult) return pexelsResult;
  }

  // 2. Search Wikimedia Commons for high-res royalty-free imagery
  for (const q of queries) {
    const cacheKey = crypto.createHash('md5').update(`wiki_${slotType}_${q}`).digest('hex');
    const cachedJpg = path.join(CACHE_DIR, `${cacheKey}.jpg`);
    const cachedMp4 = path.join(CACHE_DIR, `${cacheKey}.mp4`);

    if (fs.existsSync(cachedMp4) && fs.statSync(cachedMp4).size > 50000) {
      return { type: 'video', filePath: cachedMp4 };
    }
    if (fs.existsSync(cachedJpg) && fs.statSync(cachedJpg).size > 20000) {
      return { type: 'image', filePath: cachedJpg };
    }

    logger.info(`Searching royalty-free HD imagery on Wikimedia Commons: "${q}"...`);
    const results = await searchWikimediaCommons(q, 4);
    if (results.length > 0) {
      // Pick best resolution
      results.sort((a, b) => (b.width * b.height) - (a.width * a.height));
      const chosen = results[0];
      const ext = chosen.type === 'video' ? '.mp4' : '.jpg';
      const dest = path.join(CACHE_DIR, `${cacheKey}${ext}`);

      try {
        await downloadFile(chosen.url, dest);
        logger.success(`Fetched HD royalty-free asset (${chosen.width}x${chosen.height}): ${path.basename(dest)}`);
        return { type: chosen.type, filePath: dest };
      } catch (err) {
        logger.warn(`Download failed for ${chosen.url}: ${err.message}`);
      }
    }
  }

  // 3. Fallback to pre-cached curated default HD asset
  if (defaultAsset && fs.existsSync(defaultAsset)) {
    const isVideo = defaultAsset.toLowerCase().endsWith('.mp4');
    logger.info(`Using pre-cached curated ${isVideo ? 'moving video' : 'high-res asset'} for ${slotType}: ${path.basename(defaultAsset)}`);
    return { type: isVideo ? 'video' : 'image', filePath: defaultAsset };
  }

  // 4. Absolute fallback: Shiva or News default if available
  const anyDefault = fs.readdirSync(DEFAULTS_DIR).find((f) => f.endsWith('.jpg') || f.endsWith('.png'));
  if (anyDefault) {
    return { type: 'image', filePath: path.join(DEFAULTS_DIR, anyDefault) };
  }

  return null;
}

/**
 * Ensures high-quality 30-45s clip exists for Slot 4 (Epic Scriptures & Wisdom)
 * Downloads or slices via yt-dlp.exe, with fallback to pre-cached or local clip
 * @param {Object} item - Scripture topic item
 * @returns {Promise<string>} Path to local video clip
 */
export async function fetchScriptureClip(item = {}) {
  const filename = item.clipFilename || `${item.id || 'scripture'}.mp4`;
  const targetPath = path.join(SCRIPTURES_DIR, filename);

  // 1. If clip already exists and is healthy (> 200KB), reuse it
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 200000) {
    logger.info(`Using cached scripture video clip: ${filename}`);
    return targetPath;
  }

  // 2. Use yt-dlp to automatically slice high-quality clip from YouTube
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
        const proc = execFile(YTDLP_PATH, ytdlpArgs, { timeout: 60000 }, (err, stdout, stderr) => {
          if (err) {
            logger.warn(`yt-dlp slice error: ${stderr || err.message}`);
            reject(err);
          } else {
            resolve(stdout);
          }
        });
      });

      if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 200000) {
        logger.success(`Successfully sliced and saved scripture clip: ${filename}`);
        return targetPath;
      }
    } catch (e) {
      logger.warn(`yt-dlp clip extraction failed (${e.message}), checking fallbacks.`);
    }
  }

  // 3. Fallback: Check if ANY scripture clip exists in scriptures folder (e.g. geeta_saar.mp4)
  const existingClips = fs.readdirSync(SCRIPTURES_DIR).filter((f) => f.endsWith('.mp4'));
  for (const clip of existingClips) {
    const candidate = path.join(SCRIPTURES_DIR, clip);
    if (fs.statSync(candidate).size > 200000) {
      logger.info(`Reusing existing high-quality scripture footage: ${clip}`);
      return candidate;
    }
  }

  // 4. Return null if no clip available
  return null;
}

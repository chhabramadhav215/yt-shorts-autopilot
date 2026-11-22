import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from './logger.js';

const ROOT_DIR = process.cwd();
const HISTORY_FILE = path.join(ROOT_DIR, 'data', 'publish_history.json');
const RETENTION_MS = 60 * 24 * 60 * 60 * 1000; // 60 days in milliseconds

/**
 * Normalizes text for deduplication comparison (lowercased, alphanumeric tokens)
 */
function normalizeText(str = '') {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Computes simple token overlap ratio between two strings
 */
function tokenSimilarity(strA, strB) {
  const wordsA = new Set(normalizeText(strA).split(' ').filter((w) => w.length > 3));
  const wordsB = new Set(normalizeText(strB).split(' ').filter((w) => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let common = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) common++;
  }
  return (2 * common) / (wordsA.size + wordsB.size);
}

/**
 * Loads publication history from data/publish_history.json
 */
export function loadPublishHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
      const data = JSON.parse(raw);
      return {
        version: data.version || 1,
        lastUpdated: data.lastUpdated || new Date().toISOString(),
        publishedTopics: Array.isArray(data.publishedTopics) ? data.publishedTopics : [],
        usedVideoClips: Array.isArray(data.usedVideoClips) ? data.usedVideoClips : [],
        usedScriptures: Array.isArray(data.usedScriptures) ? data.usedScriptures : [],
        usedStories: Array.isArray(data.usedStories) ? data.usedStories : [],
      };
    }
  } catch (err) {
    logger.warn(`Failed to read publish_history.json: ${err.message}. Initializing empty history.`);
  }

  return {
    version: 1,
    lastUpdated: new Date().toISOString(),
    publishedTopics: [],
    usedVideoClips: [],
    usedScriptures: [],
    usedStories: [],
  };
}

/**
 * Saves publication history to data/publish_history.json after purging expired entries (>60 days)
 */
export function savePublishHistory(data) {
  try {
    const cutoff = Date.now() - RETENTION_MS;
    const cleaned = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      publishedTopics: (data.publishedTopics || []).filter((item) => new Date(item.publishedAt).getTime() > cutoff),
      usedVideoClips: (data.usedVideoClips || []).filter((item) => new Date(item.usedAt).getTime() > cutoff),
      usedScriptures: (data.usedScriptures || []).filter((item) => new Date(item.usedAt).getTime() > cutoff),
      usedStories: (data.usedStories || []).filter((item) => new Date(item.usedAt).getTime() > cutoff),
    };

    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(HISTORY_FILE, JSON.stringify(cleaned, null, 2), 'utf8');
    return cleaned;
  } catch (err) {
    logger.error(`Failed to save publish_history.json: ${err.message}`);
    return data;
  }
}

/**
 * Gets a list of recently published topics for a slot (or across all slots)
 * @param {string} [slot] - Optional slot filter ('slot1', 'slot2', etc.)
 * @param {number} [limit=15] - Maximum number of topics to return
 * @returns {string[]}
 */
export function getRecentTopicsForSlot(slot = null, limit = 15) {
  const history = loadPublishHistory();
  const filtered = (history.publishedTopics || [])
    .filter((t) => !slot || (t.slot && t.slot.toLowerCase() === slot.toLowerCase()))
    .map((t) => (t.title || t.headline || '').trim())
    .filter(Boolean);
  return filtered.slice(-limit).reverse();
}

/**
 * Checks if a news/cricket headline or topic was published within the last 60 days
 */
export function isTopicRecentlyPublished(headlineOrTitle, days = 60) {
  if (!headlineOrTitle) return false;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const history = loadPublishHistory();

  const normInput = normalizeText(headlineOrTitle);
  for (const item of history.publishedTopics) {
    if (new Date(item.publishedAt).getTime() <= cutoff) continue;

    // Exact or near-identical headline
    const normItem = normalizeText(item.headline || item.title || '');
    if (normItem === normInput) return true;

    // Substantial token overlap (> 65% match on significant words)
    if (tokenSimilarity(normInput, normItem) >= 0.65) {
      return true;
    }
  }

  return false;
}

/**
 * Records a published topic to prevent reuse for 60 days
 */
export function recordPublishedTopic({ slot, title = '', headline = '', url = '' }) {
  const history = loadPublishHistory();
  const hash = crypto.createHash('md5').update(`${slot}_${title}_${headline}`).digest('hex');

  history.publishedTopics.push({
    hash,
    slot,
    title: (title || '').slice(0, 120),
    headline: (headline || '').slice(0, 120),
    url: url || '',
    publishedAt: new Date().toISOString(),
  });

  savePublishHistory(history);
  logger.info(`[Publish History] Recorded topic: "${(headline || title).slice(0, 50)}..." [Slot: ${slot}]`);
}

/**
 * Gets the timestamp (in ms) when a video clip or photo was last used.
 * If slot is provided, checks usage in that specific slot; otherwise checks globally.
 * @param {string} clipIdOrName - Filename or Pexels ID
 * @param {string} [slot] - Optional slot filter ('slot1', 'slot2', etc.)
 * @returns {number} Timestamp in ms (0 if never used)
 */
export function getClipLastUsedTime(clipIdOrName, slot = null) {
  if (!clipIdOrName) return 0;
  const idStr = path.basename(String(clipIdOrName)).toLowerCase();
  const history = loadPublishHistory();

  let maxTime = 0;
  for (const c of history.usedVideoClips) {
    if (slot && c.slot && c.slot.toLowerCase() !== slot.toLowerCase()) {
      continue;
    }
    const cId = path.basename(String(c.id)).toLowerCase();
    if (cId === idStr) {
      const t = new Date(c.usedAt).getTime();
      if (t > maxTime) maxTime = t;
    }
  }

  return maxTime;
}

/**
 * Checks if a clip/image is on cooldown for a slot (or globally).
 * @param {string} clipIdOrName - Filename or asset ID
 * @param {string} [slot] - Target slot
 * @param {number} [cooldownDays=7] - Number of days cooldown
 * @returns {boolean}
 */
export function isClipOnCooldown(clipIdOrName, slot = null, cooldownDays = 7) {
  const lastUsed = getClipLastUsedTime(clipIdOrName, slot);
  if (lastUsed === 0) return false;
  const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
  return Date.now() - lastUsed < cooldownMs;
}

/**
 * Backwards compatible check: checks if clip was used within N days
 */
export function isClipRecentlyUsed(clipIdOrName, days = 60, slot = null) {
  return isClipOnCooldown(clipIdOrName, slot, days);
}

/**
 * Sorts an array of candidate file paths or clip names strictly by
 * Least Recently Used (LRU) in the specified slot.
 * Unused clips come first (timestamp = 0), followed by clips used longest ago.
 * @param {string[]} clipPaths - Array of file paths or clip IDs
 * @param {string} [slot] - Optional target slot
 * @returns {string[]} Sorted array with least recently used at the front
 */
export function sortClipsByLeastRecentlyUsed(clipPaths, slot = null) {
  if (!Array.isArray(clipPaths) || clipPaths.length === 0) return [];
  const history = loadPublishHistory();

  // Precompute last used timestamps
  const times = new Map();
  for (const p of clipPaths) {
    const idStr = path.basename(String(p)).toLowerCase();
    let maxTime = 0;
    for (const c of history.usedVideoClips) {
      if (slot && c.slot && c.slot.toLowerCase() !== slot.toLowerCase()) {
        continue;
      }
      if (path.basename(String(c.id)).toLowerCase() === idStr) {
        const t = new Date(c.usedAt).getTime();
        if (t > maxTime) maxTime = t;
      }
    }
    times.set(p, maxTime);
  }

  return [...clipPaths].sort((a, b) => {
    const timeA = times.get(a) || 0;
    const timeB = times.get(b) || 0;
    if (timeA !== timeB) return timeA - timeB;
    // Tie breaker: deterministic pseudo-random jitter
    return (crypto.createHash('md5').update(a).digest()[0] || 0) - (crypto.createHash('md5').update(b).digest()[0] || 0);
  });
}

/**
 * Records a used video clip or photo to guarantee per-slot and global cooldown
 */
export function recordUsedClip(clipIdOrName, slot = '', metadata = {}) {
  if (!clipIdOrName) return;
  const history = loadPublishHistory();
  const idStr = path.basename(String(clipIdOrName));

  history.usedVideoClips.push({
    id: idStr,
    slot: slot || '',
    type: metadata.type || 'video',
    usedAt: new Date().toISOString(),
    ...metadata,
  });

  savePublishHistory(history);
  logger.info(`[Publish History] Recorded media: "${idStr}" [Slot: ${slot || 'global'}]`);
}

/**
 * Checks if a story / dialogue / shloka ID is on cooldown in a given slot
 * @param {string} slot - 'slot2', 'slot4', etc.
 * @param {string} storyId - Unique story or scripture ID
 * @param {number} [cooldownDays=14] - Cooldown period in days
 * @returns {boolean}
 */
export function isStoryOnCooldown(slot, storyId, cooldownDays = 14) {
  if (!storyId) return false;
  const history = loadPublishHistory();
  const cutoff = Date.now() - cooldownDays * 24 * 60 * 60 * 1000;
  const sId = String(storyId).toLowerCase();

  return (history.usedStories || []).some((item) => {
    return (
      item.slot?.toLowerCase() === (slot || '').toLowerCase() &&
      item.id?.toLowerCase() === sId &&
      new Date(item.usedAt).getTime() > cutoff
    );
  });
}

/**
 * Records story usage in history
 */
export function recordUsedStory(slot, storyId, title = '') {
  if (!storyId) return;
  const history = loadPublishHistory();
  if (!Array.isArray(history.usedStories)) history.usedStories = [];

  history.usedStories.push({
    id: String(storyId),
    slot: slot || '',
    title: (title || '').slice(0, 100),
    usedAt: new Date().toISOString(),
  });

  savePublishHistory(history);
  logger.info(`[Publish History] Recorded story: "${storyId}" [Slot: ${slot}]`);
}

/**
 * Backwards compatible scripture tracking
 */
export function isScriptureRecentlyUsed(scriptureId, days = 60) {
  return isStoryOnCooldown('slot4', scriptureId, days);
}

export function recordUsedScripture(scriptureId) {
  recordUsedStory('slot4', scriptureId);
}

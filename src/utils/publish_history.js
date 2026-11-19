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
 * Checks if a video clip (Pexels ID or local filename) was used within the last 60 days
 */
export function isClipRecentlyUsed(clipIdOrName, days = 60) {
  if (!clipIdOrName) return false;
  const idStr = String(clipIdOrName).toLowerCase();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const history = loadPublishHistory();

  return history.usedVideoClips.some((c) => {
    return String(c.id).toLowerCase() === idStr && new Date(c.usedAt).getTime() > cutoff;
  });
}

/**
 * Records a used video clip to ensure varied visual B-roll across videos
 */
export function recordUsedClip(clipIdOrName, slot = '') {
  if (!clipIdOrName) return;
  const history = loadPublishHistory();
  const idStr = String(clipIdOrName);

  history.usedVideoClips.push({
    id: idStr,
    slot,
    usedAt: new Date().toISOString(),
  });

  savePublishHistory(history);
}

/**
 * Checks if a scripture story ID (e.g. 'hanuman_ravana') was used within the last 60 days
 */
export function isScriptureRecentlyUsed(scriptureId, days = 60) {
  if (!scriptureId) return false;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const history = loadPublishHistory();

  return history.usedScriptures.some((s) => {
    return s.id === scriptureId && new Date(s.usedAt).getTime() > cutoff;
  });
}

/**
 * Records scripture episode usage
 */
export function recordUsedScripture(scriptureId) {
  if (!scriptureId) return;
  const history = loadPublishHistory();

  history.usedScriptures.push({
    id: scriptureId,
    usedAt: new Date().toISOString(),
  });

  savePublishHistory(history);
  logger.info(`[Publish History] Recorded scripture episode: "${scriptureId}"`);
}

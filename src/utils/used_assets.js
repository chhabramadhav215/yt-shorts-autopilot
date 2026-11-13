import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { logger } from './logger.js';

const USED_ASSETS_FILE = path.join(config.assetsDir, 'used_assets.json');
const MAX_PEXELS_HISTORY = 60;
const MAX_FALLBACK_HISTORY = 25;

/**
 * Load used assets state safely
 */
function loadState() {
  try {
    if (fs.existsSync(USED_ASSETS_FILE)) {
      const data = JSON.parse(fs.readFileSync(USED_ASSETS_FILE, 'utf8'));
      return {
        usedPexelsVideoIds: Array.isArray(data.usedPexelsVideoIds) ? data.usedPexelsVideoIds : [],
        usedFallbackClips: Array.isArray(data.usedFallbackClips) ? data.usedFallbackClips : [],
        byCategory: (data.byCategory && typeof data.byCategory === 'object') ? data.byCategory : {},
        history: Array.isArray(data.history) ? data.history : [],
      };
    }
  } catch (e) {
    logger.warn(`Failed to read used_assets.json: ${e.message}`);
  }
  return {
    usedPexelsVideoIds: [],
    usedFallbackClips: [],
    byCategory: {},
    history: [],
  };
}

/**
 * Save used assets state
 */
function saveState(state) {
  try {
    const dir = path.dirname(USED_ASSETS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(USED_ASSETS_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    logger.warn(`Failed to save used_assets.json: ${e.message}`);
  }
}

/**
 * Check if a Pexels video ID has been used recently
 * @param {string|number} videoId
 * @returns {boolean}
 */
export function isPexelsVideoUsed(videoId) {
  if (!videoId) return false;
  const state = loadState();
  return state.usedPexelsVideoIds.map(String).includes(String(videoId));
}

/**
 * Mark a Pexels video ID as used
 * @param {string|number} videoId
 * @param {string} [context]
 */
export function markPexelsVideoUsed(videoId, context = '') {
  if (!videoId) return;
  const state = loadState();
  const idStr = String(videoId);
  if (!state.usedPexelsVideoIds.includes(idStr)) {
    state.usedPexelsVideoIds.push(idStr);
  }
  // Keep ring buffer limited to MAX_PEXELS_HISTORY
  if (state.usedPexelsVideoIds.length > MAX_PEXELS_HISTORY) {
    state.usedPexelsVideoIds = state.usedPexelsVideoIds.slice(-MAX_PEXELS_HISTORY);
  }
  state.history.push({
    type: 'pexels',
    id: idStr,
    context,
    timestamp: new Date().toISOString(),
  });
  if (state.history.length > 100) {
    state.history = state.history.slice(-100);
  }
  saveState(state);
}

/**
 * Check if a fallback clip has been used recently in a given category
 * @param {string} filename
 * @param {string} [category]
 * @returns {boolean}
 */
export function isFallbackClipUsed(filename, category = 'general') {
  if (!filename) return false;
  const state = loadState();
  const base = path.basename(filename);
  const catList = state.byCategory?.[category] || [];
  return catList.includes(base);
}

/**
 * Mark a fallback clip as used in a given category
 * @param {string} filename
 * @param {string} [category]
 */
export function markFallbackClipUsed(filename, category = 'general') {
  if (!filename) return;
  const state = loadState();
  const base = path.basename(filename);

  // Global ring buffer
  if (!state.usedFallbackClips.includes(base)) {
    state.usedFallbackClips.push(base);
  }
  if (state.usedFallbackClips.length > MAX_FALLBACK_HISTORY) {
    state.usedFallbackClips = state.usedFallbackClips.slice(-MAX_FALLBACK_HISTORY);
  }

  // Category-specific ring buffer
  if (!state.byCategory) state.byCategory = {};
  if (!Array.isArray(state.byCategory[category])) state.byCategory[category] = [];
  if (!state.byCategory[category].includes(base)) {
    state.byCategory[category].push(base);
  }
  if (state.byCategory[category].length > MAX_FALLBACK_HISTORY) {
    state.byCategory[category] = state.byCategory[category].slice(-MAX_FALLBACK_HISTORY);
  }

  state.history.push({
    type: 'fallback_video',
    file: base,
    category,
    timestamp: new Date().toISOString(),
  });
  if (state.history.length > 100) {
    state.history = state.history.slice(-100);
  }

  saveState(state);
}

/**
 * Pick an unused moving video clip from a list of candidate file paths.
 * Enforces strict category-aware non-repeating history so consecutive posts never repeat.
 * If all clips in pool have been used, recycles the least recently used (oldest).
 * @param {string[]} clipPaths - Candidate file paths
 * @param {string} [category] - Category name ('baby', 'devotional', 'news', 'cricket', 'scriptures')
 * @returns {string|null}
 */
export function pickUnusedFallbackClip(clipPaths, category = 'general') {
  if (!Array.isArray(clipPaths) || clipPaths.length === 0) return null;

  // Filter to valid existing files only
  const validClips = clipPaths.filter((p) => p && fs.existsSync(p));
  if (validClips.length === 0) return null;
  if (validClips.length === 1) {
    markFallbackClipUsed(validClips[0], category);
    return validClips[0];
  }

  const state = loadState();
  const catHistory = Array.isArray(state.byCategory?.[category]) ? state.byCategory[category] : [];

  // Candidate files not used recently in this category
  const unused = validClips.filter((p) => !catHistory.includes(path.basename(p)));

  let chosen;
  if (unused.length > 0) {
    // Pick randomly from unused pool for organic variety
    chosen = unused[Math.floor(Math.random() * unused.length)];
    logger.info(`[History Tracker] Picked fresh video for [${category}]: ${path.basename(chosen)} (${unused.length - 1} remaining in unplayed pool)`);
  } else {
    // All clips have been used once; pick the oldest used clip in history that exists in validClips
    const poolBases = validClips.map((p) => path.basename(p));
    const oldestBase = catHistory.find((name) => poolBases.includes(name));
    chosen = validClips.find((p) => path.basename(p) === oldestBase) || validClips[0];

    logger.info(`[History Tracker] All ${validClips.length} clips in [${category}] pool played; recycling oldest clip: ${path.basename(chosen)}`);

    // Remove oldest from history to cycle smoothly
    if (state.byCategory?.[category]) {
      state.byCategory[category] = state.byCategory[category].filter((name) => name !== path.basename(chosen));
      saveState(state);
    }
  }

  markFallbackClipUsed(chosen, category);
  return chosen;
}

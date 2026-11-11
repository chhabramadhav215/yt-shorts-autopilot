import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { logger } from './logger.js';

const USED_ASSETS_FILE = path.join(config.assetsDir, 'used_assets.json');
const MAX_PEXELS_HISTORY = 60;
const MAX_FALLBACK_HISTORY = 20;

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
        history: Array.isArray(data.history) ? data.history : [],
      };
    }
  } catch (e) {
    logger.warn(`Failed to read used_assets.json: ${e.message}`);
  }
  return {
    usedPexelsVideoIds: [],
    usedFallbackClips: [],
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
 * Check if a fallback clip has been used recently
 * @param {string} filename
 * @returns {boolean}
 */
export function isFallbackClipUsed(filename) {
  if (!filename) return false;
  const state = loadState();
  const base = path.basename(filename);
  return state.usedFallbackClips.includes(base);
}

/**
 * Mark a fallback clip as used
 * @param {string} filename
 */
export function markFallbackClipUsed(filename) {
  if (!filename) return;
  const state = loadState();
  const base = path.basename(filename);
  if (!state.usedFallbackClips.includes(base)) {
    state.usedFallbackClips.push(base);
  }
  if (state.usedFallbackClips.length > MAX_FALLBACK_HISTORY) {
    state.usedFallbackClips = state.usedFallbackClips.slice(-MAX_FALLBACK_HISTORY);
  }
  saveState(state);
}

/**
 * Pick an unused clip from a given list of file paths.
 * If all have been used, resets and picks the oldest used clip.
 * @param {string[]} clipPaths
 * @returns {string}
 */
export function pickUnusedFallbackClip(clipPaths) {
  if (!clipPaths || clipPaths.length === 0) return null;
  const state = loadState();
  const unused = clipPaths.filter((p) => !state.usedFallbackClips.includes(path.basename(p)));

  let chosen;
  if (unused.length > 0) {
    chosen = unused[Math.floor(Math.random() * unused.length)];
  } else {
    // If all clips in pool were used, find the one used furthest in the past
    logger.info('All fallback clips have been used once; recycling oldest fallback clip.');
    const poolBases = clipPaths.map((p) => path.basename(p));
    // Find first in usedFallbackClips that is in poolBases
    const oldest = state.usedFallbackClips.find((name) => poolBases.includes(name));
    chosen = clipPaths.find((p) => path.basename(p) === oldest) || clipPaths[0];
    // Remove oldest from used list so it re-enters rotation
    state.usedFallbackClips = state.usedFallbackClips.filter((name) => name !== path.basename(chosen));
    saveState(state);
  }

  markFallbackClipUsed(chosen);
  return chosen;
}

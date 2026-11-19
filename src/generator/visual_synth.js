import { createRequire } from 'module';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  fetchSlotBackgroundMedia,
  fetchMultiClipSequence,
  fetchScriptureClip,
  getCategoryVideoPool,
} from '../utils/media_fetcher.js';
import { summarizeNewsHeadline, toTitleCase } from '../utils/text_utils.js';
import { generateCricketVisualBackground } from './cricket_synth.js';

const require = createRequire(import.meta.url);

const ffmpegPath = process.env.FFMPEG_PATH || (function() {
  try {
    const { execSync } = require('child_process');
    const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
  } catch(e) {
    return require('ffmpeg-static');
  }
})();

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Renders a clean modern Reel/Shorts overlay for Slots 1-4:
 * ONLY a subtle top gradient vignette and a sleek top hook pill at y=110.
 * ZERO bulky colored boxes, ZERO middle cards, ZERO bottom tickers.
 */
export async function generateVisualOverlayImage({
  slotType,
  outputPath,
  title = '',
  headline = '',
  epicBadge = '',
  topicQuery = '',
  hasAvatar = false,
}) {
  let badgeText = '';
  let borderColor = '#ff007f';
  let dotColor = '#ff007f';
  let textColor = '#ffffff';

  if (slotType === 'slot1') {
    const raw = (epicBadge || title || 'DAILY FUN & BABY VIBES')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/['":]/g, '')
      .trim()
      .slice(0, 36);
    badgeText = escapeXml(raw.toUpperCase() || 'LITTLE BOSS COMEDY 👶');
    borderColor = '#ff007f';
    dotColor = '#ff007f';
    textColor = '#ffffff';
  } else if (slotType === 'slot2') {
    const raw = (epicBadge || title || 'DAILY DIVINE WISDOM')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/['":]/g, '')
      .trim()
      .slice(0, 38);
    badgeText = escapeXml(raw.toUpperCase() || 'SANATAN DHARMA 🕉️');
    borderColor = '#ffaa00';
    dotColor = '#ffd700';
    textColor = '#ffd700';
  } else if (slotType === 'slot3') {
    const raw = (topicQuery || headline || 'BREAKING UPDATE')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/['":]/g, '')
      .trim()
      .slice(0, 34);
    badgeText = escapeXml(`🚨 ${raw.toUpperCase() || 'BREAKING NEWS'}`);
    borderColor = '#ff3333';
    dotColor = '#ff3333';
    textColor = '#ffffff';
  } else if (slotType === 'slot4') {
    const raw = (epicBadge || 'SACRED SCRIPTURES & DHARMA')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/['":]/g, '')
      .trim()
      .slice(0, 36);
    badgeText = escapeXml(raw.toUpperCase() || 'SACRED SCRIPTURES 🔱');
    borderColor = '#ff9900';
    dotColor = '#ffaa00';
    textColor = '#ffd700';
  }

  const svg = `
    <svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          .pill-text {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            font-weight: 900;
            font-size: 24px;
            letter-spacing: 0.5px;
          }
        </style>
        <!-- Sleek Top Vignette Gradient for badge readability -->
        <linearGradient id="topVignette" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#000000" stop-opacity="0.75" />
          <stop offset="60%" stop-color="#000000" stop-opacity="0.25" />
          <stop offset="100%" stop-color="#000000" stop-opacity="0.0" />
        </linearGradient>
      </defs>

      <!-- Top Subtle Gradient -->
      <rect x="0" y="0" width="1080" height="240" fill="url(#topVignette)" />

      <!-- Sleek Top Hook Pill at y=110 (Max 1 clean line, clean semi-transparent dark pill) -->
      <rect x="190" y="85" width="700" height="52" rx="26" fill="#000000" fill-opacity="0.75" stroke="${borderColor}" stroke-width="2" />
      <circle cx="225" cy="111" r="7" fill="${dotColor}" />
      <text x="540" y="119" class="pill-text" fill="${textColor}" text-anchor="middle">${badgeText}</text>
    </svg>
  `;

  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  return outputPath;
}

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        logger.error('FFmpeg visual synth error:', stderr || err.message);
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Generates true full-screen 9:16 (1080x1920) moving video for Slots 1-5.
 * ZERO static photos, ZERO black bars, 100% full-bleed stitched moving video.
 */
export async function generateVisualBackground({
  slotType,
  duration = 15,
  outputPath,
  title = '',
  headline = '',
  clipPath = null,
  epicBadge = '',
  themeType = null,
  visualQuery = null,
  secondaryQuery = null,
  altQueries = [],
  visualSceneQueries = [],
  primaryPlayer = null,
  team = null,
  statBadge = null,
  customTopic = null,
}) {
  const roundDur = Math.ceil(duration) + 1;

  // =================================================================
  // SLOT 5 (IPL & Cricket Buzz): Dedicated Sports Visual Synth
  // =================================================================
  if (slotType === 'slot5') {
    return generateCricketVisualBackground({
      duration,
      outputPath,
      headline: headline || title,
      primaryPlayer,
      playerTitle: primaryPlayer,
      topic: customTopic || title,
      team,
      statBadge,
      visualQuery,
      secondaryQuery,
      visualSceneQueries,
    });
  }

  // =================================================================
  // SLOTS 1, 2, 3, 4: Dynamic Multi-Clip Moving Video Sequences (3-5 clips)
  // Switching scenes every 4-6 seconds with 100% full-bleed vertical moving video
  // =================================================================
  logger.info(`Fetching multi-clip moving video sequence for [${slotType.toUpperCase()}] (${roundDur}s)...`);

  const clips = await fetchMultiClipSequence({
    slotType,
    title: headline || title,
    visualSceneQueries,
    count: 4,
    clipPath,
  });

  const numClips = clips.length;
  const segDur = roundDur / numClips;
  logger.info(`Stitching ${numClips} moving video clips (~${segDur.toFixed(1)}s per scene) into true 9:16 vertical`);

  const ffmpegArgs = ['-y', '-loglevel', 'error'];
  const filterParts = [];

  // True full-bleed center-crop scaling for each clip:
  // scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30
  // Fills 100% of the 1080x1920 screen edge-to-edge with zero black bars!
  clips.forEach((c, idx) => {
    ffmpegArgs.push('-stream_loop', '-1', '-i', c);
    filterParts.push(`[${idx}:v]trim=0:${segDur.toFixed(3)},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[v_seg_${idx}]`);
  });

  const segConcatInputs = clips.map((_, idx) => `[v_seg_${idx}]`).join('');
  filterParts.push(`${segConcatInputs}concat=n=${numClips}:v=1:a=0[v_moving]`);

  // Render sleek modern overlay PNG (Only top hook pill + subtle top vignette)
  const overlayPngPath = path.join(path.dirname(outputPath), `${slotType}_overlay_${Date.now()}.png`);
  let currentTopNode = 'v_moving';

  const avatarRest = path.join(config.assetsDir, 'defaults', 'baby_avatar.png');
  const avatarTalk = path.join(config.assetsDir, 'defaults', 'baby_avatar_talk.png');
  const hasAvatar = slotType === 'slot1' && fs.existsSync(avatarRest) && fs.existsSync(avatarTalk);

  await generateVisualOverlayImage({
    slotType,
    outputPath: overlayPngPath,
    title,
    headline,
    epicBadge,
    topicQuery: visualQuery,
    hasAvatar,
  });

  let nextInputIdx = numClips;
  if (hasAvatar) {
    ffmpegArgs.push('-loop', '1', '-i', avatarRest);
    ffmpegArgs.push('-loop', '1', '-i', avatarTalk);
    // Position animated baby avatar at bottom-left (y=1260), safely clear of center captions
    filterParts.push(`[${nextInputIdx}:v]scale=240:240[a1]`);
    filterParts.push(`[${nextInputIdx + 1}:v]scale=240:240[a2]`);
    filterParts.push(`[${currentTopNode}][a1]overlay=x=60:y='1280 - 12*abs(sin(t*7.5))':enable='eq(mod(floor(t*4),2),0)'[t1]`);
    filterParts.push(`[t1][a2]overlay=x=60:y='1280 - 12*abs(sin(t*7.5))':enable='eq(mod(floor(t*4),2),1)'[t2]`);
    currentTopNode = 't2';
    nextInputIdx += 2;
  }

  // Overlay sleek top hook pill directly onto full-bleed moving video
  ffmpegArgs.push('-loop', '1', '-i', overlayPngPath);
  filterParts.push(`[${currentTopNode}][${nextInputIdx}:v]overlay=0:0:shortest=1[vout]`);

  ffmpegArgs.push(
    '-filter_complex', filterParts.join(';'),
    '-map', '[vout]',
    '-t', String(roundDur),
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath
  );

  logger.info(`Rendering 100% full-screen moving video for [${slotType.toUpperCase()}] (${roundDur}s)...`);
  try {
    await runFFmpeg(ffmpegArgs);
    logger.success(`Dynamic multi-clip moving video rendered for [${slotType.toUpperCase()}]: ${outputPath}`);
    return outputPath;
  } finally {
    try {
      if (fs.existsSync(overlayPngPath)) fs.unlinkSync(overlayPngPath);
    } catch (_) {}
  }
}

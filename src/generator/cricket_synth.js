import { createRequire } from 'module';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { summarizeNewsHeadline, toTitleCase } from '../utils/text_utils.js';
import { fetchMultiClipSequence } from '../utils/media_fetcher.js';

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

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        logger.error('FFmpeg cricket synth error:', stderr || err.message);
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

function toHex(col) {
  if (!col) return '#ffcc00';
  return col.startsWith('0x') ? '#' + col.slice(2) : col;
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const TEAM_COLORS = {
  RCB: { primary: '0x990000', accent: '0xffcc00', name: 'ROYAL CHALLENGERS' },
  MI: { primary: '0x004ba0', accent: '0xffcc00', name: 'MUMBAI INDIANS' },
  CSK: { primary: '0xb38600', accent: '0x002d62', name: 'CHENNAI SUPER KINGS' },
  KKR: { primary: '0x3a225d', accent: '0xffcc00', name: 'KOLKATA KNIGHT RIDERS' },
  SRH: { primary: '0xcc5200', accent: '0xff9900', name: 'SUNRISERS HYDERABAD' },
  DC: { primary: '0x004c97', accent: '0xff3333', name: 'DELHI CAPITALS' },
  RR: { primary: '0xc2185b', accent: '0x00d2ff', name: 'RAJASTHAN ROYALS' },
  GT: { primary: '0x1b2133', accent: '0xc89b3c', name: 'GUJARAT TITANS' },
  LSG: { primary: '0x00838f', accent: '0x00e5ff', name: 'LUCKNOW SUPER GIANTS' },
  PBKS: { primary: '0xb71c1c', accent: '0xffcc00', name: 'PUNJAB KINGS' },
  DEFAULT: { primary: '0x003366', accent: '0xffcc00', name: 'IPL 2027' },
};

/**
 * Renders a clean modern Reel/Shorts overlay:
 * ONLY a subtle top gradient vignette and a sleek top hook pill at y=110.
 * ZERO bulky colored boxes, ZERO middle cards, ZERO bottom tickers.
 */
async function generateCricketOverlayImage({
  outputPath,
  headline,
  primaryPlayer,
  topic,
  teamTheme,
}) {
  const accentHex = toHex(teamTheme.accent || '0xffcc00');
  const rawBadge = (topic || headline || 'IPL 2027 • CRICKET BUZZ 🏏')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/['":]/g, '')
    .trim()
    .slice(0, 36);
  const badgeText = escapeXml(rawBadge.toUpperCase() || 'IPL 2027 CRICKET BUZZ');

  const svg = `
    <svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          .pill-text {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            font-weight: 900;
            font-size: 24px;
            fill: #ffffff;
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
      <rect x="190" y="85" width="700" height="52" rx="26" fill="#000000" fill-opacity="0.75" stroke="${accentHex}" stroke-width="2" />
      <circle cx="225" cy="111" r="7" fill="${accentHex}" />
      <text x="540" y="119" class="pill-text" text-anchor="middle">${badgeText}</text>
    </svg>
  `;

  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  return outputPath;
}

/**
 * Generates true full-screen 9:16 (1080x1920) moving video for Slot 5 (Cricket & IPL Buzz)
 * ZERO static photos, ZERO black bars, 100% full-bleed stitched moving video.
 */
export async function generateCricketVisualBackground({
  duration = 30,
  outputPath,
  headline,
  primaryPlayer = 'Virat Kohli',
  playerTitle,
  topic,
  team = 'RCB',
  statBadge = 'IPL 2027 BUZZ',
  visualQuery = 'cricket stadium floodlights',
  secondaryQuery = 'cricket match stadium crowd',
  visualSceneQueries = [],
}) {
  const roundDur = Math.max(5, Math.ceil(duration));
  const teamTheme = TEAM_COLORS[team] || TEAM_COLORS.DEFAULT;

  const rawPlayer = playerTitle || primaryPlayer || 'Virat Kohli';
  const rawHeadline = headline || topic || 'IPL 2027 CRICKET BUZZ';

  // 1. Fetch 3-5 distinct moving MP4 video clips matching cricket stadium and action scenes
  const clips = await fetchMultiClipSequence({
    slotType: 'slot5',
    title: rawHeadline,
    visualSceneQueries: visualSceneQueries.length > 0 ? visualSceneQueries : [
      visualQuery || 'cricket stadium floodlights night',
      secondaryQuery || 'cricket pitch night stadium',
      'cricket batsman aggressive shot',
      'sports stadium floodlights'
    ],
    count: 4,
  });

  const numClips = clips.length;
  const segDur = roundDur / numClips;
  logger.info(`Stitching ${numClips} moving cricket clips (~${segDur.toFixed(1)}s per scene) into true 9:16 vertical`);

  // 2. Render sleek modern overlay PNG (Only top hook pill + subtle top vignette)
  const overlayPngPath = path.join(path.dirname(outputPath), `cricket_overlay_${Date.now()}.png`);
  await generateCricketOverlayImage({
    outputPath: overlayPngPath,
    headline: rawHeadline,
    primaryPlayer: rawPlayer,
    topic,
    teamTheme,
  });

  const ffmpegArgs = ['-y', '-loglevel', 'error'];
  const filterParts = [];

  // 3. True full-bleed center-crop scaling for each clip:
  // scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30
  // Fills 100% of the 1080x1920 screen edge-to-edge with zero black bars and zero blur!
  clips.forEach((c, idx) => {
    ffmpegArgs.push('-stream_loop', '-1', '-i', c);
    filterParts.push(`[${idx}:v]trim=0:${segDur.toFixed(3)},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[v_seg_${idx}]`);
  });

  const segConcatInputs = clips.map((_, idx) => `[v_seg_${idx}]`).join('');
  filterParts.push(`${segConcatInputs}concat=n=${numClips}:v=1:a=0[v_moving]`);

  // 4. Overlay sleek top hook pill directly onto full-bleed moving video
  ffmpegArgs.push('-loop', '1', '-i', overlayPngPath);
  filterParts.push(`[v_moving][${numClips}:v]overlay=0:0:shortest=1[vout]`);

  ffmpegArgs.push(
    '-filter_complex', filterParts.join(';'),
    '-map', '[vout]',
    '-t', String(roundDur),
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-pix_fmt', 'yuv420p',
    outputPath
  );

  logger.info(`Rendering 100% full-screen moving video for Slot 5 (${roundDur}s)...`);
  try {
    await runFFmpeg(ffmpegArgs);
    logger.success(`Slot 5 full-screen 9:16 moving video rendered: ${outputPath}`);
  } finally {
    try {
      if (fs.existsSync(overlayPngPath)) fs.unlinkSync(overlayPngPath);
    } catch (_) {}
  }

  // Auto-generate high-contrast thumbnail/cover frame at 0.1s for Instagram/YouTube
  const coverPath = path.join(path.dirname(outputPath), 'cover.jpg');
  try {
    await runFFmpeg([
      '-y',
      '-ss', '00:00:00.100',
      '-i', outputPath,
      '-vframes', '1',
      '-q:v', '2',
      coverPath,
    ]);
  } catch (e) {
    // Non-critical
  }

  return outputPath;
}

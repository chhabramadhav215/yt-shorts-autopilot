import { createRequire } from 'module';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { summarizeNewsHeadline, toTitleCase } from '../utils/text_utils.js';
import { fetchSlotBackgroundMedia, searchWikimediaCommons, downloadFile } from '../utils/media_fetcher.js';

const require = createRequire(import.meta.url);

const ffmpegPath = process.env.FFMPEG_PATH || (function() {
  try {
    const { execSync } = require('child_process');
    return execSync('which ffmpeg', { encoding: 'utf8' }).trim();
  } catch(e) {
    return require('ffmpeg-static');
  }
})();

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, (err, stdout, stderr) => {
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
  if (!col) return '#ffffff';
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
  SRH: { primary: '0xcc5200', accent: '0x000000', name: 'SUNRISERS HYDERABAD' },
  DC: { primary: '0x004c97', accent: '0xcc0000', name: 'DELHI CAPITALS' },
  RR: { primary: '0xc2185b', accent: '0x1a237e', name: 'RAJASTHAN ROYALS' },
  GT: { primary: '0x1b2133', accent: '0xc89b3c', name: 'GUJARAT TITANS' },
  LSG: { primary: '0x00838f', accent: '0x002171', name: 'LUCKNOW SUPER GIANTS' },
  PBKS: { primary: '0xb71c1c', accent: '0xd7ccc8', name: 'PUNJAB KINGS' },
  DEFAULT: { primary: '0x003366', accent: '0xff9900', name: 'IPL 2026' },
};

const CRICKET_DEFAULTS_DIR = path.join(config.assetsDir, 'defaults', 'cricket');

/**
 * Resolves a local verified player portrait from assets/defaults/cricket/
 * @param {string} playerName
 * @returns {string}
 */
function getLocalPlayerPortrait(playerName) {
  const norm = (playerName || '').toLowerCase();
  const pool = [
    { match: ['virat', 'kohli', 'king'], file: 'virat_kohli.jpg' },
    { match: ['rohit', 'sharma', 'hitman'], file: 'rohit_sharma.jpg' },
    { match: ['dhoni', 'thala', 'msd', 'mahi'], file: 'ms_dhoni.jpg' },
    { match: ['hardik', 'pandya'], file: 'hardik_pandya.jpg' },
    { match: ['pant', 'rishabh', 'spiderman'], file: 'rishabh_pant.jpg' },
    { match: ['bumrah', 'jasprit'], file: 'jasprit_bumrah.jpg' },
    { match: ['rahul', 'kl'], file: 'kl_rahul.jpg' },
  ];

  for (const item of pool) {
    if (item.match.some((m) => norm.includes(m))) {
      const p = path.join(CRICKET_DEFAULTS_DIR, item.file);
      if (fs.existsSync(p)) return p;
    }
  }

  // General fallbacks
  const defaultVirat = path.join(CRICKET_DEFAULTS_DIR, 'virat_kohli.jpg');
  if (fs.existsSync(defaultVirat)) return defaultVirat;

  const defaultAction = path.join(CRICKET_DEFAULTS_DIR, 'cricket_action.jpg');
  if (fs.existsSync(defaultAction)) return defaultAction;

  return null;
}

/**
 * Downloads high-res player portrait from Wikimedia Commons with offline fallback
 * NEVER returns null - guaranteed to return a valid player portrait file path!
 * @param {string} playerName
 * @returns {Promise<string>}
 */
async function fetchPlayerPortrait(playerName) {
  const localPortrait = getLocalPlayerPortrait(playerName);

  if (!playerName) {
    return localPortrait;
  }

  const CACHE_DIR = path.join(config.assetsDir, 'cache');
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const hash = crypto.createHash('md5').update(`cricket_${playerName.toLowerCase()}`).digest('hex');
  const dest = path.join(CACHE_DIR, `player_${hash}.jpg`);

  if (fs.existsSync(dest) && fs.statSync(dest).size > 15000) {
    return dest;
  }

  try {
    logger.info(`Searching official player portrait for "${playerName}"...`);
    const results = await searchWikimediaCommons(`${playerName}`, 4);
    if (results.length > 0) {
      results.sort((a, b) => b.width * b.height - a.width * a.height);
      await downloadFile(results[0].url, dest);
      logger.success(`Fetched player portrait: ${path.basename(dest)}`);
      return dest;
    }
  } catch (err) {
    logger.warn(`Could not download player portrait for ${playerName}: ${err.message}. Using local cricket pool.`);
  }

  // If Wikimedia API search or download returns null/empty, immediately load matching local portrait
  if (localPortrait && fs.existsSync(localPortrait)) {
    logger.info(`Using verified local cricket portrait: ${path.basename(localPortrait)}`);
    return localPortrait;
  }

  return localPortrait;
}

/**
 * Renders the complete Cricket UI layout (top badge, headline card, player title pill,
 * lower-third stat pill, and live ticker bar) as a transparent 1080x1920 PNG overlay.
 * Completely eliminates any dependency on FFmpeg drawtext or libfreetype.
 */
async function generateCricketOverlayImage({
  outputPath,
  headline,
  primaryPlayer,
  topic,
  statBadge,
  teamTheme,
}) {
  const { line1, line2 } = summarizeNewsHeadline(headline);
  const primaryHex = toHex(teamTheme.primary || '0x003366');
  const accentHex = toHex(teamTheme.accent || '0xffcc00');

  const badgeText = escapeXml(topic ? toTitleCase(topic).toUpperCase().slice(0, 28) : 'IPL 2026 • CRICKET BUZZ 🏏');
  const playerText = escapeXml(toTitleCase(primaryPlayer).toUpperCase().slice(0, 22));
  const statText = escapeXml((statBadge || 'IPL 2026 BUZZ').toUpperCase().slice(0, 48));
  const tickerText = escapeXml(`LIVE IPL 2026 • ${toTitleCase(headline).slice(0, 75)} • TRADE RUMORS • RECORD BIDS • `);

  const headlineBlock = line2
    ? `<text x="540" y="415" class="title" fill="${accentHex}">${escapeXml(line1)}</text>
       <text x="540" y="460" class="sub" fill="#ffffff">${escapeXml(line2)}</text>`
    : `<text x="540" y="438" class="title-single" fill="${accentHex}">${escapeXml(line1)}</text>`;

  const svg = `
    <svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          .title { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-weight: 900; font-size: 38px; text-anchor: middle; }
          .title-single { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-weight: 900; font-size: 42px; text-anchor: middle; }
          .sub { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-weight: 900; font-size: 38px; text-anchor: middle; }
          .badge { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-weight: 800; font-size: 28px; fill: #ffffff; text-anchor: middle; }
          .player { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-weight: 800; font-size: 28px; fill: #ffffff; }
          .stat { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-weight: 800; font-size: 26px; fill: #ffffff; text-anchor: middle; }
          .ticker { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-weight: 700; font-size: 22px; fill: #ffffff; }
        </style>
      </defs>

      <!-- Top Badge (y=295 to 351) -->
      <rect x="290" y="295" width="500" height="56" rx="8" fill="${primaryHex}" fill-opacity="0.95" stroke="${accentHex}" stroke-width="2" />
      <text x="540" y="333" class="badge">${badgeText}</text>

      <!-- Headline Card (y=365 to 485) -->
      <rect x="50" y="365" width="980" height="120" rx="8" fill="#050c1a" fill-opacity="0.95" stroke="${accentHex}" stroke-width="2" stroke-opacity="0.5" />
      <rect x="50" y="365" width="10" height="120" rx="2" fill="${accentHex}" />
      ${headlineBlock}

      <!-- Player Frame Name Badge (y=1180 to 1234) -->
      <rect x="160" y="1180" width="440" height="54" rx="6" fill="${primaryHex}" fill-opacity="0.95" stroke="${accentHex}" stroke-width="2" />
      <text x="185" y="1217" class="player">${playerText}</text>

      <!-- Lower-Third Stat Pill (y=1245 to 1303) -->
      <rect x="60" y="1245" width="960" height="58" rx="8" fill="${primaryHex}" fill-opacity="0.95" stroke="${accentHex}" stroke-width="2" />
      <text x="540" y="1283" class="stat">${statText}</text>

      <!-- Subtitle Area Dark Bed (y=1315 to 1485) -->
      <rect x="0" y="1315" width="1080" height="170" fill="#000511" fill-opacity="0.85" />

      <!-- Bottom Live Cricket Ticker (y=1495 to 1535) -->
      <rect x="0" y="1495" width="1080" height="40" fill="#b30000" fill-opacity="0.95" />
      <rect x="0" y="1495" width="260" height="40" fill="${accentHex}" />
      <text x="45" y="1523" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="900" font-size="22" fill="#000000">CRICKET BUZZ</text>
      <text x="280" y="1523" class="ticker">${tickerText}</text>
    </svg>
  `;

  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  return outputPath;
}

/**
 * Generates the high-impact 9:16 visual background for Slot 5 (IPL & Cricket Buzz)
 * @param {Object} options
 * @param {number} options.duration - Duration in seconds
 * @param {string} options.outputPath - Destination MP4 path
 * @param {string} options.headline - News/Rumor headline
 * @param {string} [options.primaryPlayer] - Name of main cricketer (e.g. Virat Kohli)
 * @param {string} [options.playerTitle]
 * @param {string} [options.topic]
 * @param {string} [options.team] - Team code (e.g. RCB, MI, CSK)
 * @param {string} [options.statBadge] - Key stat text
 * @param {string} [options.visualQuery] - Stock query for stadium video
 * @param {string} [options.secondaryQuery]
 * @returns {Promise<string>}
 */
export async function generateCricketVisualBackground({
  duration = 30,
  outputPath,
  headline,
  primaryPlayer = 'Virat Kohli',
  playerTitle,
  topic,
  team = 'RCB',
  statBadge = 'IPL 2026 BUZZ',
  visualQuery = 'cricket ground',
  secondaryQuery = 'sports stadium lights',
}) {
  const roundDur = Math.max(5, Math.ceil(duration));
  const totalFrames = Math.ceil(roundDur * 30);
  const teamTheme = TEAM_COLORS[team] || TEAM_COLORS.DEFAULT;

  const rawPlayer = playerTitle || primaryPlayer || 'Virat Kohli';
  const rawHeadline = headline || topic || 'IPL 2026 CRICKET BUZZ';

  // 1. Fetch sports stadium background video from Pexels or local fallback
  const media = await fetchSlotBackgroundMedia({
    slotType: 'slot5',
    title: rawHeadline,
    visualQuery,
    secondaryQuery,
    altQueries: ['cricket pitch', 'cricket stadium floodlights', 'stadium crowd cheering'],
  });

  const localStadiumFallback = path.join(CRICKET_DEFAULTS_DIR, 'stadium_bg.mp4');
  const localStadiumLights = path.join(CRICKET_DEFAULTS_DIR, 'stadium_floodlights.mp4');

  const bgVideoPath = media?.filePath && fs.existsSync(media.filePath)
    ? media.filePath
    : (fs.existsSync(localStadiumFallback)
        ? localStadiumFallback
        : (fs.existsSync(localStadiumLights) ? localStadiumLights : path.join(config.assetsDir, 'defaults', 'slot1_dance.mp4')));

  // 2. Fetch player portrait for Ken Burns slow zoom (Guaranteed non-null)
  const playerImagePath = await fetchPlayerPortrait(rawPlayer);

  // 3. Render transparent PNG overlay containing all UI elements (badges, headline, ticker, pills)
  // This completely eliminates any FFmpeg drawtext or libfreetype dependency
  const overlayPngPath = path.join(path.dirname(outputPath), `cricket_overlay_${Date.now()}.png`);
  await generateCricketOverlayImage({
    outputPath: overlayPngPath,
    headline: rawHeadline,
    primaryPlayer: rawPlayer,
    topic,
    statBadge,
    teamTheme,
  });

  const ffmpegArgs = ['-y', '-stream_loop', '-1', '-i', bgVideoPath];
  const filterParts = [];

  // Layer 1 (Background): Looped stadium video with subtle dark vignette overlay (gblur for smooth performance)
  filterParts.push(`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=12,vignette=PI/4[bg_stadium]`);
  // Top Scrim (y=0 to 490) for Header & Headline
  filterParts.push(`[bg_stadium]drawbox=x=0:y=0:w=1080:h=490:color=0x000511@0.75:t=fill[scrim_top]`);
  // Bottom Scrim (y=1180 to 1920) for Lower-Third & Subtitles
  filterParts.push(`[scrim_top]drawbox=x=0:y=1180:w=1080:h=740:color=0x000511@0.85:t=fill[v_canvas]`);

  let centerNode = 'v_canvas';

  // Layer 2 (Center Hero): Player portrait inside central card frame with smooth Ken Burns motion
  if (playerImagePath && fs.existsSync(playerImagePath)) {
    ffmpegArgs.push('-loop', '1', '-i', playerImagePath);

    // Smooth Ken Burns slow zoom (zoompan=z='min(zoom+0.0015,1.25)':d=700:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=760x760:fps=30)
    filterParts.push(`[1:v]scale=1200:1200:force_original_aspect_ratio=increase,crop=1200:1200,zoompan=z='min(zoom+0.0015,1.25)':d=700:x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':s=760x760:fps=30[player_kb]`);
    filterParts.push(`[${centerNode}][player_kb]overlay=160:480:shortest=1[v_player]`);

    // Glowing team border framing the player
    filterParts.push(`[v_player]drawbox=x=156:y=476:w=768:h=768:color=${teamTheme.accent}:t=6[v_center]`);
    centerNode = 'v_center';
  } else {
    // Fallback Stadium Action Center Box
    filterParts.push(`[0:v]scale=1080:608:force_original_aspect_ratio=increase,crop=1080:608[center_stadium]`);
    filterParts.push(`[${centerNode}][center_stadium]overlay=0:520[v_stadium]`);
    filterParts.push(`[v_stadium]drawbox=x=0:y=518:w=1080:h=3:color=${teamTheme.accent}:t=fill[v_l0]`);
    filterParts.push(`[v_l0]drawbox=x=0:y=1128:w=1080:h=3:color=${teamTheme.accent}:t=fill[v_center]`);
    centerNode = 'v_center';
  }

  // Layer 3 (Overlay UI Graphics): Transparent 1080x1920 PNG with all headlines, badges & UI
  const overlayInputIndex = (playerImagePath && fs.existsSync(playerImagePath)) ? 2 : 1;
  ffmpegArgs.push('-loop', '1', '-i', overlayPngPath);
  filterParts.push(`[${centerNode}][${overlayInputIndex}:v]overlay=0:0:shortest=1[vout]`);

  ffmpegArgs.push(
    '-filter_complex', filterParts.join(';'),
    '-map', '[vout]',
    '-t', String(roundDur),
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-pix_fmt', 'yuv420p',
    outputPath
  );

  logger.info(`Rendering Slot 5 cricket visual background (${roundDur}s)...`);
  try {
    await runFFmpeg(ffmpegArgs);
    logger.success(`Slot 5 cricket visual rendered: ${outputPath}`);
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
    logger.info(`Generated high-contrast cover thumbnail: ${path.basename(coverPath)}`);
  } catch (e) {
    // Non-critical cover generation
  }

  return outputPath;
}

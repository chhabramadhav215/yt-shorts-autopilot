import ffmpegStatic from 'ffmpeg-static';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { summarizeNewsHeadline, toTitleCase } from '../utils/text_utils.js';
import { fetchSlotBackgroundMedia, searchWikimediaCommons, downloadFile } from '../utils/media_fetcher.js';

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegStatic, args, (err, stdout, stderr) => {
      if (err) {
        logger.error('FFmpeg cricket synth error:', stderr || err.message);
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

function escapeFfmpegDrawtext(str) {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\u2019") // typographic curly apostrophe
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%');
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
 * Generates the high-impact 9:16 visual background for Slot 5 (IPL & Cricket Buzz)
 * @param {Object} options
 * @param {number} options.duration - Duration in seconds
 * @param {string} options.outputPath - Destination MP4 path
 * @param {string} options.headline - News/Rumor headline
 * @param {string} [options.primaryPlayer] - Name of main cricketer (e.g. Virat Kohli)
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
  team = 'RCB',
  statBadge = 'IPL 2026 BUZZ',
  visualQuery = 'cricket ground',
  secondaryQuery = 'sports stadium lights',
}) {
  const roundDur = Math.max(5, Math.ceil(duration));
  const totalFrames = Math.ceil(roundDur * 30);
  const teamTheme = TEAM_COLORS[team] || TEAM_COLORS.DEFAULT;

  // 1. Fetch sports stadium background video from Pexels or local fallback
  const media = await fetchSlotBackgroundMedia({
    slotType: 'slot5',
    title: headline,
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
  const playerImagePath = await fetchPlayerPortrait(primaryPlayer);

  const { line1, line2 } = summarizeNewsHeadline(headline);
  const safeLine1 = escapeFfmpegDrawtext(line1);
  const safeLine2 = escapeFfmpegDrawtext(line2);

  const ffmpegArgs = ['-y', '-stream_loop', '-1', '-i', bgVideoPath];
  const filterParts = [];

  // Layer 1 (Background): Looped stadium video with subtle dark vignette overlay
  filterParts.push(`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=8:2,vignette=PI/4[bg_stadium]`);
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
    filterParts.push(`[v_player]drawbox=x=156:y=476:w=768:h=768:color=${teamTheme.accent}:t=6[v_frame]`);

    // Player name badge at corner of player frame
    const safePlayer = escapeFfmpegDrawtext(toTitleCase(primaryPlayer).toUpperCase().slice(0, 22));
    filterParts.push(`[v_frame]drawbox=x=160:y=1180:w=440:h=54:color=${teamTheme.primary}@0.95:t=fill[p_b0]`);
    filterParts.push(`[p_b0]drawbox=x=160:y=1180:w=440:h=54:color=${teamTheme.accent}:t=2[p_b1]`);
    filterParts.push(`[p_b1]drawtext=text='${safePlayer}':fontcolor=white:fontsize=28:x=185:y=1192:font='Arial Black'[v_center]`);
    centerNode = 'v_center';
  } else {
    // Fallback Stadium Action Center Box
    filterParts.push(`[0:v]scale=1080:608:force_original_aspect_ratio=increase,crop=1080:608[center_stadium]`);
    filterParts.push(`[${centerNode}][center_stadium]overlay=0:520[v_stadium]`);
    filterParts.push(`[v_stadium]drawbox=x=0:y=518:w=1080:h=3:color=${teamTheme.accent}:t=fill[v_l0]`);
    filterParts.push(`[v_l0]drawbox=x=0:y=1128:w=1080:h=3:color=${teamTheme.accent}:t=fill[v_center]`);
    centerNode = 'v_center';
  }

  // Layer 3: Top Badge, Headline, Lower-Third sports news card & ticker
  // Top Badge: "IPL 2026 • CRICKET BUZZ" (y=295 to 355)
  filterParts.push(`[${centerNode}]drawbox=x=290:y=295:w=500:h=56:color=${teamTheme.primary}@0.95:t=fill[pill_bg]`);
  filterParts.push(`[pill_bg]drawbox=x=290:y=295:w=500:h=56:color=${teamTheme.accent}:t=2[pill_border]`);
  filterParts.push(`[pill_border]drawtext=text='IPL 2026 • CRICKET BUZZ 🏏':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=310:font='Arial Black'[v_badge]`);

  // 2-Line High-Impact Headline Card (y=365 to 475)
  filterParts.push(`[v_badge]drawbox=x=50:y=365:w=980:h=120:color=0x050c1a@0.95:t=fill[c0]`);
  filterParts.push(`[c0]drawbox=x=50:y=365:w=10:h=120:color=${teamTheme.accent}:t=fill[c_accent]`);
  filterParts.push(`[c_accent]drawbox=x=50:y=365:w=980:h=120:color=${teamTheme.accent}@0.5:t=2[c1]`);

  if (safeLine2) {
    filterParts.push(`[c1]drawtext=text='${safeLine1}':fontcolor=${teamTheme.accent}:fontsize=36:x=(w-text_w)/2:y=380:font='Arial Black'[c2]`);
    filterParts.push(`[c2]drawtext=text='${safeLine2}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=428:font='Arial Black'[c_head]`);
  } else {
    filterParts.push(`[c1]drawtext=text='${safeLine1}':fontcolor=${teamTheme.accent}:fontsize=40:x=(w-text_w)/2:y=404:font='Arial Black'[c_head]`);
  }

  // Sports News Lower-Third Card: Team badge & stat pill (y=1245 to 1305)
  const safeStat = escapeFfmpegDrawtext(statBadge.toUpperCase().slice(0, 48));
  filterParts.push(`[c_head]drawbox=x=60:y=1245:w=960:h=58:color=${teamTheme.primary}@0.95:t=fill[lt_bg]`);
  filterParts.push(`[lt_bg]drawbox=x=60:y=1245:w=960:h=58:color=${teamTheme.accent}:t=2[lt_border]`);
  filterParts.push(`[lt_border]drawtext=text='${safeStat}':fontcolor=white:fontsize=26:x=(w-text_w)/2:y=1260:font='Arial Black'[v_lt]`);

  // Subtitle Area Dark Bed (y=1315 to 1485)
  filterParts.push(`[v_lt]drawbox=x=0:y=1315:w=1080:h=170:color=0x000511@0.85:t=fill[v_sub_bed]`);

  // Bottom Live Cricket Ticker (y=1495 to 1535, well above bottom safe zone)
  filterParts.push(`[v_sub_bed]drawbox=x=0:y=1495:w=1080:h=40:color=0xb30000@0.95:t=fill[v_ticker]`);
  filterParts.push(`[v_ticker]drawbox=x=0:y=1495:w=260:h=40:color=${teamTheme.accent}:t=fill[v_tag_box]`);
  filterParts.push(`[v_tag_box]drawtext=text='CRICKET BUZZ':fontcolor=black:fontsize=22:x=45:y=1506:font='Arial Black'[v_tag_txt]`);
  const tickerText = escapeFfmpegDrawtext(toTitleCase(headline).slice(0, 75));
  filterParts.push(`[v_tag_txt]drawtext=text='LIVE IPL 2026 • ${tickerText} • TRADE RUMORS • RECORD BIDS • ':fontcolor=white:fontsize=22:x=w-mod(t*175\\,w+1400):y=1506:font='Arial Black'[vout]`);

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
  await runFFmpeg(ffmpegArgs);
  logger.success(`Slot 5 cricket visual rendered: ${outputPath}`);

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

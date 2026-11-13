import { createRequire } from 'module';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { fetchSlotBackgroundMedia, fetchScriptureClip, getCategoryVideoPool } from '../utils/media_fetcher.js';
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
 * Renders graphical UI elements (top scenario banners, headline cards, breaking news cards,
 * narrator labels) onto a transparent 1080x1920 PNG overlay.
 * Completely eliminates any dependency on FFmpeg drawtext or libfreetype.
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
  let innerSvg = '';

  const commonStyle = `
    .font-sans { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  `;

  if (slotType === 'slot1') {
    const rawBadge = (epicBadge || title || 'DAILY FUN & BABY VIBES')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/['":]/g, '')
      .trim()
      .substring(0, 35) || 'DAILY FUN & BABY VIBES';
    const badge = escapeXml(rawBadge.toUpperCase());

    innerSvg = `
      <!-- Top Party Banner -->
      <rect x="60" y="140" width="960" height="130" rx="16" fill="#220033" fill-opacity="0.88" stroke="#ff007f" stroke-width="6" />
      <text x="540" y="222" class="font-sans" font-size="42" font-weight="900" fill="#ffffff" text-anchor="middle">${badge}</text>
      ${hasAvatar ? `
      <!-- Narrator Pill Badge -->
      <rect x="90" y="1330" width="320" height="48" rx="8" fill="#220033" fill-opacity="0.90" stroke="#ff007f" stroke-width="3" />
      <text x="250" y="1363" class="font-sans" font-size="26" font-weight="800" fill="#ffcc00" text-anchor="middle">LITTLE BOSS</text>
      ` : ''}
    `;
  } else if (slotType === 'slot2') {
    const rawBadge = (epicBadge || 'DAILY DIVINE WISDOM | SANATAN DHARMA').substring(0, 42);
    const badge = escapeXml(rawBadge.toUpperCase());
    innerSvg = `
      <!-- Top Divine Banner -->
      <rect x="50" y="150" width="980" height="150" rx="16" fill="#260c00" fill-opacity="0.88" stroke="#ff9900" stroke-width="6" />
      <text x="540" y="240" class="font-sans" font-size="36" font-weight="900" fill="#ffd700" text-anchor="middle">${badge}</text>
    `;
  } else if (slotType === 'slot4') {
    const rawBadge = (epicBadge || 'SACRED SCRIPTURES & DHARMA')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/['":]/g, '')
      .trim()
      .substring(0, 42) || 'SACRED SCRIPTURES';
    const badge = escapeXml(rawBadge.toUpperCase());

    // Extract clean episode headline: strip trailing epics, emojis, quotes
    let cleanTitle = (title || 'Epic Scripture Wisdom')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/[|].*$/g, '')
      .replace(/\s+(?:Mahabharata|Ramayana|Bhagavad Gita|Epic Wisdom).*$/i, '')
      .replace(/['":]/g, '')
      .trim();

    const titleLines = wrapText(cleanTitle, 26).slice(0, 3);
    let titleBlock = '';
    if (titleLines.length <= 1) {
      titleBlock = `<text x="540" y="325" class="font-sans" font-size="42" font-weight="900" fill="#ffcc00" text-anchor="middle">${escapeXml(titleLines[0] || cleanTitle)}</text>`;
    } else if (titleLines.length === 2) {
      titleBlock = `
        <text x="540" y="292" class="font-sans" font-size="38" font-weight="900" fill="#ffcc00" text-anchor="middle">${escapeXml(titleLines[0])}</text>
        <text x="540" y="352" class="font-sans" font-size="38" font-weight="900" fill="#ffffff" text-anchor="middle">${escapeXml(titleLines[1])}</text>
      `;
    } else if (titleLines.length >= 3) {
      titleBlock = `
        <text x="540" y="278" class="font-sans" font-size="34" font-weight="900" fill="#ffcc00" text-anchor="middle">${escapeXml(titleLines[0])}</text>
        <text x="540" y="328" class="font-sans" font-size="34" font-weight="900" fill="#ffffff" text-anchor="middle">${escapeXml(titleLines[1])}</text>
        <text x="540" y="378" class="font-sans" font-size="32" font-weight="900" fill="#ffd700" text-anchor="middle">${escapeXml(titleLines[2])}</text>
      `;
    }

    innerSvg = `
      <!-- Top Scripture Category Pill -->
      <rect x="190" y="135" width="700" height="48" rx="8" fill="#4a1500" fill-opacity="0.94" stroke="#ffaa00" stroke-width="2" />
      <text x="540" y="168" class="font-sans" font-size="22" font-weight="800" fill="#ffd700" text-anchor="middle">${badge}</text>

      <!-- Top Story Title Card -->
      <rect x="50" y="198" width="980" height="220" rx="16" fill="#1f0900" fill-opacity="0.95" stroke="#ff9900" stroke-width="4" />
      <rect x="50" y="198" width="10" height="220" rx="4" fill="#ffd700" />
      ${titleBlock}
    `;
  } else if (slotType === 'slot3') {
    const rawHead = headline || title || 'Breaking News Update';
    const { line1, line2 } = summarizeNewsHeadline(rawHead);
    const line1Esc = escapeXml(line1);
    const line2Esc = escapeXml(line2);
    const badgeText = escapeXml(toTitleCase(topicQuery || 'Special Report').slice(0, 26));
    const tickerText = escapeXml(toTitleCase(rawHead).slice(0, 70));

    const headlineBlock = line2Esc
      ? `<text x="540" y="420" class="font-sans" font-size="38" font-weight="900" fill="#ffcc00" text-anchor="middle">${line1Esc}</text>
         <text x="540" y="472" class="font-sans" font-size="38" font-weight="900" fill="#ffffff" text-anchor="middle">${line2Esc}</text>`
      : `<text x="540" y="445" class="font-sans" font-size="42" font-weight="900" fill="#ffcc00" text-anchor="middle">${line1Esc}</text>`;

    innerSvg = `
      <!-- Center Topic Pill Badge (corner of 16:9 box at y=1070) -->
      <rect x="40" y="1070" width="380" height="46" rx="6" fill="#071126" fill-opacity="0.90" stroke="#ffcc00" stroke-width="2" />
      <text x="55" y="1102" class="font-sans" font-size="24" font-weight="800" fill="#ffcc00">${badgeText}</text>

      <!-- Top Breaking Pill -->
      <rect x="330" y="295" width="420" height="56" rx="8" fill="#cc0000" fill-opacity="0.95" stroke="#ffcc00" stroke-width="2" />
      <text x="540" y="334" class="font-sans" font-size="32" font-weight="900" fill="#ffffff" text-anchor="middle">BREAKING UPDATE</text>

      <!-- 2-Line Headline Card -->
      <rect x="50" y="370" width="980" height="130" rx="8" fill="#071126" fill-opacity="0.95" stroke="#ffcc00" stroke-width="2" stroke-opacity="0.6" />
      <rect x="50" y="370" width="8" height="130" rx="2" fill="#ffcc00" />
      ${headlineBlock}

      <!-- Subtitle Bar (y=1145 to 1490) -->
      <rect x="0" y="1145" width="1080" height="345" fill="#071126" fill-opacity="0.85" />
      <rect x="0" y="1145" width="1080" height="2" fill="#ffcc00" fill-opacity="0.4" />

      <!-- Live News Ticker (y=1495 to 1535) -->
      <rect x="0" y="1495" width="1080" height="40" fill="#b30000" fill-opacity="0.95" />
      <rect x="0" y="1495" width="260" height="40" fill="#ffcc00" />
      <text x="45" y="1523" class="font-sans" font-size="22" font-weight="900" fill="#000000">LIVE REPORT</text>
      <text x="280" y="1523" class="font-sans" font-size="22" font-weight="700" fill="#ffffff">LIVE UPDATE • ${tickerText} • VERIFIED REPORT •</text>
    `;
  }

  const svg = `<svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
    <defs><style>${commonStyle}</style></defs>
    ${innerSvg}
  </svg>`;

  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  return outputPath;
}

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, (err, stdout, stderr) => {
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
 * Wraps text into multiple lines of at most maxChars per line
 * @param {string} text
 * @param {number} maxChars
 * @returns {string[]}
 */
function wrapText(text, maxChars = 28) {
  const words = (text || '').replace(/[\r\n\t]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if (!currentLine) {
      currentLine = word;
    } else if ((currentLine + ' ' + word).length <= maxChars) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * Generates dynamic 1080x1920 vertical video with 100% genuine moving video MP4 footage.
 * ZERO static image fallbacks. ZERO zoompan / Ken Burns effects.
 * Every slot (Baby Reels, Sanatan Dharma, Scriptures, News, Cricket) uses moving MP4 video.
 * @param {Object} options
 * @param {string} options.slotType - 'slot1' | 'slot2' | 'slot3' | 'slot4' | 'slot5'
 * @param {number} options.duration - Duration in seconds
 * @param {string} options.outputPath - Destination MP4 file path
 * @param {string} [options.title] - Headline / title for banners
 * @param {string} [options.headline] - Uncut full headline for news
 * @param {string} [options.clipPath] - Optional local video clip path (e.g. for slot 4)
 * @param {string} [options.epicBadge] - Optional badge title
 * @param {string} [options.customTopic] - Optional custom topic
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
    });
  }

  // =================================================================
  // SLOT 4 (Epic Hindu Scriptures & Wisdom Clips): 100% Moving Video
  // =================================================================
  if (slotType === 'slot4') {
    logger.info(`Synthesizing Slot 4 (Epic Scriptures & Wisdom) with moving video clip (${roundDur}s)...`);
    const safeBadge = (epicBadge || 'MAHABHARATA & GITA WISDOM').replace(/['":]/g, '').substring(0, 35);

    let resolvedClipPath = clipPath;
    if (!resolvedClipPath || !fs.existsSync(resolvedClipPath)) {
      resolvedClipPath = await fetchScriptureClip({
        englishTitle: title,
        dialogueTheme: customTopic || title,
        epic: epicBadge,
      });
    }

    if (!resolvedClipPath || !fs.existsSync(resolvedClipPath)) {
      const scripturesDir = path.join(config.assetsDir, 'clips', 'scriptures');
      const pool = getCategoryVideoPool(scripturesDir);
      resolvedClipPath = pool[0] || path.join(config.assetsDir, 'defaults', 'slot1_dance.mp4');
    }

    logger.info(`Formatting scripture moving clip with 9:16 vertical blur margins: ${path.basename(resolvedClipPath)}`);
    const overlayPngPath = path.join(path.dirname(outputPath), `slot4_overlay_${Date.now()}.png`);
    await generateVisualOverlayImage({
      slotType: 'slot4',
      outputPath: overlayPngPath,
      title,
      epicBadge: safeBadge,
    });

    const filter = [
      `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=16[bg]`,
      `[0:v]scale=1020:574:force_original_aspect_ratio=decrease[fg]`,
      `[bg][fg]overlay=(W-w)/2:520[base]`,
      `[base]drawbox=x=30:y=518:w=1020:h=578:color=0xffaa00:t=5[b0]`,
      `[b0][1:v]overlay=0:0:shortest=1[vout]`
    ].join(';');

    try {
      await runFFmpeg([
        '-y',
        '-stream_loop', '-1',
        '-i', resolvedClipPath,
        '-loop', '1',
        '-i', overlayPngPath,
        '-filter_complex', filter,
        '-map', '[vout]',
        '-t', String(roundDur),
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-pix_fmt', 'yuv420p',
        outputPath
      ]);

      logger.success(`Slot 4 visual with 100% moving video rendered: ${outputPath}`);
      return outputPath;
    } finally {
      try {
        if (fs.existsSync(overlayPngPath)) fs.unlinkSync(overlayPngPath);
      } catch (_) {}
    }
  }

  // =================================================================
  // SLOTS 1, 2, 3: Dynamic 100% Moving Video Backgrounds
  // =================================================================
  logger.info(`Fetching dynamic moving video footage for [${slotType.toUpperCase()}]...`);
  const media = await fetchSlotBackgroundMedia({
    slotType,
    title: headline || title,
    customTopic,
    clipPath,
    themeType,
    visualQuery,
    secondaryQuery,
    altQueries,
  });

  // Ensure resolved video file path is valid
  let videoPath = media?.filePath;
  if (!videoPath || !fs.existsSync(videoPath)) {
    const fallbackDir = slotType === 'slot2'
      ? path.join(config.assetsDir, 'clips', 'devotional')
      : (slotType === 'slot3' ? path.join(config.assetsDir, 'clips', 'news') : path.join(config.assetsDir, 'clips', 'baby'));
    const pool = getCategoryVideoPool(fallbackDir);
    videoPath = pool[0] || path.join(config.assetsDir, 'defaults', 'slot1_dance.mp4');
  }

  logger.info(`Applying 100% dynamic moving video background: ${path.basename(videoPath)}`);
  const filterParts = [];
  const ffmpegArgs = ['-y', '-stream_loop', '-1', '-i', videoPath];

  const overlayPngPath = path.join(path.dirname(outputPath), `${slotType}_overlay_${Date.now()}.png`);
  let nextInputIdx = 1;

  if (slotType === 'slot1') {
    const avatarRest = path.join(config.assetsDir, 'defaults', 'baby_avatar.png');
    const avatarTalk = path.join(config.assetsDir, 'defaults', 'baby_avatar_talk.png');
    const hasAvatar = fs.existsSync(avatarRest) && fs.existsSync(avatarTalk);

    await generateVisualOverlayImage({
      slotType: 'slot1',
      outputPath: overlayPngPath,
      title,
      epicBadge,
      hasAvatar,
    });

    filterParts.push(`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[v0]`);

    let currentTopNode = 'v0';
    if (hasAvatar) {
      ffmpegArgs.push('-loop', '1', '-i', avatarRest);
      ffmpegArgs.push('-loop', '1', '-i', avatarTalk);
      filterParts.push(`[1:v]scale=360:360[a1]`);
      filterParts.push(`[2:v]scale=360:360[a2]`);
      filterParts.push(`[${currentTopNode}][a1]overlay=x=70:y='980 - 16*abs(sin(t*7.5))':enable='eq(mod(floor(t*4),2),0)'[t1]`);
      filterParts.push(`[t1][a2]overlay=x=70:y='980 - 16*abs(sin(t*7.5))':enable='eq(mod(floor(t*4),2),1)'[t2]`);
      currentTopNode = 't2';
      nextInputIdx = 3;
    }

    ffmpegArgs.push('-loop', '1', '-i', overlayPngPath);
    filterParts.push(`[${currentTopNode}][${nextInputIdx}:v]overlay=0:0:shortest=1[vout]`);

  } else if (slotType === 'slot3') {
    const centerTop = 520;
    const centerBottom = 1128;
    const centerH = centerBottom - centerTop; // 608px (exact 16:9 ratio)

    const topicQuery = media?.topicQuery || 'Special Report';
    await generateVisualOverlayImage({
      slotType: 'slot3',
      outputPath: overlayPngPath,
      title,
      headline,
      topicQuery,
    });

    // 100% Dynamic Moving Video: Center box plays moving video with blurred moving video margins
    filterParts.push(`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=12[bg_blurred]`);
    filterParts.push(`[0:v]scale=1080:${centerH}:force_original_aspect_ratio=increase,crop=1080:${centerH}[center_video]`);
    filterParts.push(`[bg_blurred][center_video]overlay=0:${centerTop}[v_base]`);
    filterParts.push(`[v_base]drawbox=x=0:y=${centerTop - 2}:w=1080:h=3:color=0xffcc00:t=fill[v_l0]`);
    filterParts.push(`[v_l0]drawbox=x=0:y=${centerBottom}:w=1080:h=3:color=0xffcc00:t=fill[v_center]`);

    ffmpegArgs.push('-loop', '1', '-i', overlayPngPath);
    filterParts.push(`[v_center][1:v]overlay=0:0:shortest=1[vout]`);

  } else {
    // Slot 2 Devotional Video Background
    await generateVisualOverlayImage({
      slotType: 'slot2',
      outputPath: overlayPngPath,
      title,
      epicBadge,
    });

    filterParts.push(`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[v0]`);
    ffmpegArgs.push('-loop', '1', '-i', overlayPngPath);
    filterParts.push(`[v0][1:v]overlay=0:0:shortest=1[vout]`);
  }

  ffmpegArgs.push(
    '-filter_complex', filterParts.join(';'),
    '-map', '[vout]',
    '-t', String(roundDur),
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-pix_fmt', 'yuv420p',
    outputPath
  );

  try {
    await runFFmpeg(ffmpegArgs);
    logger.success(`Dynamic 100% moving video background rendered: ${outputPath}`);
    return outputPath;
  } finally {
    try {
      if (fs.existsSync(overlayPngPath)) fs.unlinkSync(overlayPngPath);
    } catch (_) {}
  }
}

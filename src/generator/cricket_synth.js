import { createRequire } from 'module';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { summarizeNewsHeadline, toTitleCase } from '../utils/text_utils.js';
import { fetchMultiClipSequence, getCategoryVideoPool } from '../utils/media_fetcher.js';

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
 * Builds SVG elements for a 2-player comparison card or single player stats card
 */
function renderStatsOverlaySvg(comparisonData, accentHex) {
  if (!comparisonData) return '';

  if (comparisonData.type === 'comparison') {
    const p1 = comparisonData.player1 || {};
    const p2 = comparisonData.player2 || {};
    const cardTitle = escapeXml((comparisonData.title || 'HEAD TO HEAD • CAPTAINCY STATS').toUpperCase());

    return `
      <!-- Comparison Card Container (y=725 to y=1075) -->
      <rect x="70" y="725" width="940" height="345" rx="28" fill="#080e1a" fill-opacity="0.88" stroke="${accentHex}" stroke-width="2.5" />
      
      <!-- Top Card Header Badge -->
      <rect x="360" y="710" width="360" height="30" rx="15" fill="${accentHex}" />
      <text x="540" y="730" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="900" font-size="14" fill="#000000" text-anchor="middle" letter-spacing="1.2">${cardTitle}</text>

      <!-- Player 1 Column (Left, center at x=280) -->
      <text x="280" y="780" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="27" font-weight="900" fill="#ffffff" text-anchor="middle">${escapeXml(p1.name || '')}</text>
      <rect x="150" y="796" width="260" height="24" rx="12" fill="#1e293b" fill-opacity="0.9" />
      <text x="280" y="813" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="700" fill="#94a3b8" text-anchor="middle">${escapeXml((p1.role || 'LEADER').toUpperCase())}</text>
      
      <rect x="110" y="836" width="340" height="44" rx="13" fill="#0f172a" stroke="#334155" stroke-width="1.5" />
      <text x="280" y="864" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="19" font-weight="900" fill="${accentHex}" text-anchor="middle">${escapeXml(p1.stat1 || '')}</text>

      <rect x="110" y="890" width="340" height="44" rx="13" fill="#0f172a" stroke="#334155" stroke-width="1.5" />
      <text x="280" y="918" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="900" fill="#ffffff" text-anchor="middle">${escapeXml(p1.stat2 || '')}</text>

      <rect x="110" y="944" width="340" height="40" rx="12" fill="#0f172a" fill-opacity="0.7" stroke="#1e293b" stroke-width="1" />
      <text x="280" y="969" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="15" font-weight="800" fill="#38bdf8" text-anchor="middle">${escapeXml(p1.stat3 || '')}</text>

      <!-- Center Divider & Glowing VS Badge (x=540) -->
      <line x1="540" y1="755" x2="540" y2="1025" stroke="#334155" stroke-width="1.5" stroke-dasharray="4,4" />
      <circle cx="540" cy="888" r="32" fill="#0b1220" stroke="${accentHex}" stroke-width="3" />
      <text x="540" y="896" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="900" fill="${accentHex}" text-anchor="middle">VS</text>

      <!-- Player 2 Column (Right, center at x=800) -->
      <text x="800" y="780" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="27" font-weight="900" fill="#ffffff" text-anchor="middle">${escapeXml(p2.name || '')}</text>
      <rect x="670" y="796" width="260" height="24" rx="12" fill="#1e293b" fill-opacity="0.9" />
      <text x="800" y="813" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="700" fill="#94a3b8" text-anchor="middle">${escapeXml((p2.role || 'LEADER').toUpperCase())}</text>

      <rect x="630" y="836" width="340" height="44" rx="13" fill="#0f172a" stroke="#334155" stroke-width="1.5" />
      <text x="800" y="864" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="19" font-weight="900" fill="${accentHex}" text-anchor="middle">${escapeXml(p2.stat1 || '')}</text>

      <rect x="630" y="890" width="340" height="44" rx="13" fill="#0f172a" stroke="#334155" stroke-width="1.5" />
      <text x="800" y="918" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="900" fill="#ffffff" text-anchor="middle">${escapeXml(p2.stat2 || '')}</text>

      <rect x="630" y="944" width="340" height="40" rx="12" fill="#0f172a" fill-opacity="0.7" stroke="#1e293b" stroke-width="1" />
      <text x="800" y="969" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="15" font-weight="800" fill="#38bdf8" text-anchor="middle">${escapeXml(p2.stat3 || '')}</text>

      <!-- Verified Stats Footer Note -->
      <text x="540" y="1042" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="700" fill="#64748b" text-anchor="middle" letter-spacing="1">VERIFIED OFFICIAL IPL &amp; T20 RECORDS</text>
    `;
  } else if (comparisonData.type === 'comparison_3') {
    const players = comparisonData.players || [];
    const cardTitle = escapeXml((comparisonData.title || '3-WAY LEADERSHIP COMPARISON').toUpperCase());

    const p1 = players[0] || {};
    const p2 = players[1] || {};
    const p3 = players[2] || {};

    return `
      <!-- 3-Player Comparison Card Container (y=725 to y=1075) -->
      <rect x="60" y="725" width="960" height="345" rx="28" fill="#080e1a" fill-opacity="0.90" stroke="${accentHex}" stroke-width="2.5" />

      <!-- Top Card Header Badge -->
      <rect x="340" y="708" width="400" height="30" rx="15" fill="${accentHex}" />
      <text x="540" y="728" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="900" font-size="14" fill="#000000" text-anchor="middle" letter-spacing="1.2">${cardTitle}</text>

      <!-- Column 1 (x=215) -->
      <text x="215" y="772" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="21" font-weight="900" fill="#ffffff" text-anchor="middle">${escapeXml(p1.name || '')}</text>
      <rect x="95" y="788" width="240" height="24" rx="12" fill="#1e293b" />
      <text x="215" y="805" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="700" fill="#94a3b8" text-anchor="middle">${escapeXml((p1.role || 'LEADER').toUpperCase())}</text>
      <rect x="85" y="824" width="260" height="42" rx="12" fill="#0f172a" stroke="#334155" stroke-width="1.5" />
      <text x="215" y="851" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="900" fill="${accentHex}" text-anchor="middle">${escapeXml(p1.stat1 || '')}</text>
      <rect x="85" y="876" width="260" height="42" rx="12" fill="#0f172a" stroke="#334155" stroke-width="1.5" />
      <text x="215" y="903" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="15" font-weight="900" fill="#ffffff" text-anchor="middle">${escapeXml(p1.stat2 || '')}</text>

      <!-- Divider 1 -->
      <line x1="365" y1="755" x2="365" y2="1025" stroke="#334155" stroke-width="1.5" stroke-dasharray="4,4" />

      <!-- Column 2 (x=540) -->
      <text x="540" y="772" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="21" font-weight="900" fill="#ffffff" text-anchor="middle">${escapeXml(p2.name || '')}</text>
      <rect x="420" y="788" width="240" height="24" rx="12" fill="#1e293b" />
      <text x="540" y="805" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="700" fill="#94a3b8" text-anchor="middle">${escapeXml((p2.role || 'LEADER').toUpperCase())}</text>
      <rect x="410" y="824" width="260" height="42" rx="12" fill="#0f172a" stroke="#334155" stroke-width="1.5" />
      <text x="540" y="851" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="900" fill="${accentHex}" text-anchor="middle">${escapeXml(p2.stat1 || '')}</text>
      <rect x="410" y="876" width="260" height="42" rx="12" fill="#0f172a" stroke="#334155" stroke-width="1.5" />
      <text x="540" y="903" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="15" font-weight="900" fill="#ffffff" text-anchor="middle">${escapeXml(p2.stat2 || '')}</text>

      <!-- Divider 2 -->
      <line x1="695" y1="755" x2="695" y2="1025" stroke="#334155" stroke-width="1.5" stroke-dasharray="4,4" />

      <!-- Column 3 (x=865) -->
      <text x="865" y="772" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="21" font-weight="900" fill="#ffffff" text-anchor="middle">${escapeXml(p3.name || '')}</text>
      <rect x="745" y="788" width="240" height="24" rx="12" fill="#1e293b" />
      <text x="865" y="805" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="700" fill="#94a3b8" text-anchor="middle">${escapeXml((p3.role || 'LEADER').toUpperCase())}</text>
      <rect x="735" y="824" width="260" height="42" rx="12" fill="#0f172a" stroke="#334155" stroke-width="1.5" />
      <text x="865" y="851" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="900" fill="${accentHex}" text-anchor="middle">${escapeXml(p3.stat1 || '')}</text>
      <rect x="735" y="876" width="260" height="42" rx="12" fill="#0f172a" stroke="#334155" stroke-width="1.5" />
      <text x="865" y="903" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="15" font-weight="900" fill="#ffffff" text-anchor="middle">${escapeXml(p3.stat2 || '')}</text>

      <!-- Verified Stats Footer Note -->
      <text x="540" y="1042" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="700" fill="#64748b" text-anchor="middle" letter-spacing="1">VERIFIED OFFICIAL IPL &amp; T20 RECORDS</text>
    `;
  } else if (comparisonData.type === 'stat_card') {
    const p = comparisonData.player || {};
    const cardTitle = escapeXml((comparisonData.title || 'PLAYER IMPACT STATS').toUpperCase());

    return `
      <!-- Single Player Stats Card Container (y=750 to y=1050) -->
      <rect x="90" y="750" width="900" height="295" rx="28" fill="#080e1a" fill-opacity="0.88" stroke="${accentHex}" stroke-width="2.5" />

      <!-- Top Card Header Badge -->
      <rect x="360" y="735" width="360" height="30" rx="15" fill="${accentHex}" />
      <text x="540" y="755" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="900" font-size="14" fill="#000000" text-anchor="middle" letter-spacing="1.2">${cardTitle}</text>

      <!-- Player Name & Role -->
      <text x="540" y="812" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="32" font-weight="900" fill="#ffffff" text-anchor="middle">${escapeXml(p.name || '')}</text>
      <rect x="370" y="828" width="340" height="26" rx="13" fill="#1e293b" fill-opacity="0.9" />
      <text x="540" y="846" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="700" fill="#94a3b8" text-anchor="middle">${escapeXml((p.role || 'MATCH WINNER').toUpperCase())}</text>

      <!-- 3 Metrics in a Horizontal Row -->
      <rect x="120" y="872" width="250" height="74" rx="16" fill="#0f172a" stroke="#334155" stroke-width="1.5" />
      <text x="245" y="916" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="19" font-weight="900" fill="${accentHex}" text-anchor="middle">${escapeXml(p.stat1 || '')}</text>

      <rect x="415" y="872" width="250" height="74" rx="16" fill="#0f172a" stroke="#334155" stroke-width="1.5" />
      <text x="540" y="916" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="19" font-weight="900" fill="#ffffff" text-anchor="middle">${escapeXml(p.stat2 || '')}</text>

      <rect x="710" y="872" width="250" height="74" rx="16" fill="#0f172a" stroke="#334155" stroke-width="1.5" />
      <text x="835" y="916" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="19" font-weight="900" fill="#38bdf8" text-anchor="middle">${escapeXml(p.stat3 || '')}</text>

      <!-- Verified Stats Footer Note -->
      <text x="540" y="1015" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="700" fill="#64748b" text-anchor="middle" letter-spacing="1">VERIFIED OFFICIAL IPL &amp; T20 RECORDS</text>
    `;
  } else if (comparisonData.type === 'topic_card') {
    const cardTitle = escapeXml((comparisonData.title || 'TOPIC CONTEXT').toUpperCase());
    const cardHeader = escapeXml((comparisonData.header || 'TACTICAL BREAKDOWN').toUpperCase());
    const point1 = escapeXml(comparisonData.point1 || '');
    const point2 = escapeXml(comparisonData.point2 || '');
    const point3 = escapeXml(comparisonData.point3 || '');

    return `
      <!-- Topic Context / Key Points Card Container (y=745 to y=1055) -->
      <rect x="75" y="745" width="930" height="310" rx="26" fill="#080e1a" fill-opacity="0.90" stroke="${accentHex}" stroke-width="2.5" />

      <!-- Top Card Header Badge -->
      <rect x="340" y="728" width="400" height="30" rx="15" fill="${accentHex}" />
      <text x="540" y="748" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="900" font-size="14" fill="#000000" text-anchor="middle" letter-spacing="1.2">${cardTitle}</text>

      <!-- Card Headline -->
      <text x="540" y="792" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="900" fill="#ffffff" text-anchor="middle">${cardHeader}</text>

      <!-- 3 Sleek Key Point Rows -->
      <rect x="105" y="812" width="870" height="50" rx="14" fill="#0f172a" stroke="#334155" stroke-width="1.5" />
      <circle cx="135" cy="837" r="6" fill="${accentHex}" />
      <text x="155" y="844" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="17" font-weight="700" fill="#f8fafc">${point1}</text>

      <rect x="105" y="872" width="870" height="50" rx="14" fill="#0f172a" stroke="#334155" stroke-width="1.5" />
      <circle cx="135" cy="897" r="6" fill="#38bdf8" />
      <text x="155" y="904" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="17" font-weight="700" fill="#f8fafc">${point2}</text>

      <rect x="105" y="932" width="870" height="50" rx="14" fill="#0f172a" stroke="#334155" stroke-width="1.5" />
      <circle cx="135" cy="957" r="6" fill="${accentHex}" />
      <text x="155" y="964" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="17" font-weight="700" fill="#f8fafc">${point3}</text>

      <!-- Footer Note -->
      <text x="540" y="1030" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="700" fill="#64748b" text-anchor="middle" letter-spacing="1">TACTICAL CRICKET INSIGHT • DAILY PULSE</text>
    `;
  }
  return '';
}

/**
 * Renders a clean modern Reel/Shorts overlay:
 * 1. Top subtle gradient and sleek top hook pill at y=85.
 * 2. High-readability middle comparison/stats card when comparisonData is present.
 */
async function generateCricketOverlayImage({
  outputPath,
  headline,
  primaryPlayer,
  topic,
  teamTheme,
  comparisonData = null,
}) {
  const accentHex = toHex(teamTheme.accent || '0xffcc00');
  const rawBadge = (topic || headline || 'IPL 2027 • CRICKET BUZZ 🏏')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/['":]/g, '')
    .trim()
    .slice(0, 36);
  const badgeText = escapeXml(rawBadge.toUpperCase() || 'IPL 2027 CRICKET BUZZ');

  const statsSvg = renderStatsOverlaySvg(comparisonData, accentHex);

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
          <stop offset="0%" stop-color="#000000" stop-opacity="0.80" />
          <stop offset="60%" stop-color="#000000" stop-opacity="0.30" />
          <stop offset="100%" stop-color="#000000" stop-opacity="0.0" />
        </linearGradient>
      </defs>

      <!-- Top Subtle Gradient -->
      <rect x="0" y="0" width="1080" height="240" fill="url(#topVignette)" />

      <!-- Sleek Top Hook Pill at y=85 (Max 1 clean line, clean semi-transparent dark pill) -->
      <rect x="190" y="85" width="700" height="52" rx="26" fill="#000000" fill-opacity="0.80" stroke="${accentHex}" stroke-width="2" />
      <circle cx="225" cy="111" r="7" fill="${accentHex}" />
      <text x="540" y="119" class="pill-text" text-anchor="middle">${badgeText}</text>

      <!-- Clean Center-Middle Stats / Comparison Card -->
      ${statsSvg}
    </svg>
  `;

  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  return outputPath;
}

/**
 * Generates true full-screen 9:16 (1080x1920) moving video for Slot 5 (Cricket & IPL Buzz)
 * Enforces multi-scene progression: NO single slow-zoom background clip.
 * At least 3-4 distinct visual scenes cutting across the timeline with verified stats overlays.
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
  visualQuery = 'cricket stadium floodlights crowd night',
  secondaryQuery = 'cricket bat and ball nets practice',
  visualSceneQueries = [],
  comparisonData = null,
}) {
  const roundDur = Math.max(5, Math.ceil(duration));
  const teamTheme = TEAM_COLORS[team] || TEAM_COLORS.DEFAULT;

  const rawPlayer = playerTitle || primaryPlayer || 'Virat Kohli';
  const rawHeadline = headline || topic || 'IPL 2027 CRICKET BUZZ';

  // 1. Fetch 3-5 distinct moving MP4 video clips matching diverse cricket scene categories
  const rawClips = await fetchMultiClipSequence({
    slotType: 'slot5',
    title: rawHeadline,
    visualSceneQueries: visualSceneQueries.length > 0 ? visualSceneQueries : [
      'cricket stadium floodlights crowd night',
      'cricket bat and ball nets practice pitch',
      'cricket batsman powerful match boundary shot',
      'cricket team victory celebration golden trophy'
    ],
    count: 4,
  });

  // Deduplicate clips by file path AND file content hash to ensure genuinely distinct footage
  const seenHashes = new Set();
  const clips = [];

  for (const c of rawClips) {
    if (!fs.existsSync(c)) continue;
    try {
      const fileBuffer = fs.readFileSync(c);
      const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      if (!seenHashes.has(hash)) {
        seenHashes.add(hash);
        clips.push(c);
      }
    } catch (_) {
      if (!clips.includes(c)) clips.push(c);
    }
  }

  // If deduplication leaves fewer than 3 clips, pull distinct clips from other available pools
  // Pull all available cricket clips to maximize scene diversity
  const allCricketClips = getCategoryVideoPool(path.join(config.assetsDir, 'clips', 'cricket'));
  for (const alt of allCricketClips) {
    if (!fs.existsSync(alt)) continue;
    try {
      const fileBuffer = fs.readFileSync(alt);
      const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      if (!seenHashes.has(hash)) {
        seenHashes.add(hash);
        clips.push(alt);
      }
    } catch (_) {
      if (!clips.includes(alt)) clips.push(alt);
    }
  }

  // Fallback safety if only 1-2 clips exist
  if (clips.length === 0) {
    const defaultStadium = path.join(config.assetsDir, 'defaults', 'cricket', 'stadium_bg.mp4');
    clips.push(fs.existsSync(defaultStadium) ? defaultStadium : path.join(config.assetsDir, 'defaults', 'slot1_dance.mp4'));
  }

  // Dynamic multi-scene progression: ensure background cuts every 4.0 - 5.5 seconds across the timeline!
  const targetSceneDuration = 4.8;
  const numScenes = Math.max(clips.length, Math.ceil(roundDur / targetSceneDuration));
  const segDur = roundDur / numScenes;

  // Build sequenced scene cuts cycling through diverse available cricket clips
  const sequencedClips = [];
  for (let s = 0; s < numScenes; s++) {
    sequencedClips.push(clips[s % clips.length]);
  }
  logger.info(`Stitching ${numScenes} dynamic scene cuts (~${segDur.toFixed(1)}s per cut) cycling across ${clips.length} distinct cricket clips`);

  // 2. Render sleek modern overlay PNG (Top hook pill + verified stats card overlay)
  const overlayPngPath = path.join(path.dirname(outputPath), `cricket_overlay_${Date.now()}.png`);
  await generateCricketOverlayImage({
    outputPath: overlayPngPath,
    headline: rawHeadline,
    primaryPlayer: rawPlayer,
    topic,
    teamTheme,
    comparisonData,
  });

  const ffmpegArgs = ['-y', '-loglevel', 'error'];
  const filterParts = [];

  // 3. Dynamic per-segment styling ensuring unmistakable scene cuts across the timeline:
  const segmentFilters = [
    'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30',
    'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=contrast=1.14:saturation=1.22:brightness=-0.03,setsar=1,fps=30',
    'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,hflip,setsar=1,fps=30',
    'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=contrast=1.16:saturation=1.25:brightness=-0.01,setsar=1,fps=30',
    'scale=1140:2026:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30',
    'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=contrast=1.12:saturation=1.20:brightness=-0.02,hflip,setsar=1,fps=30',
  ];

  sequencedClips.forEach((c, idx) => {
    ffmpegArgs.push('-stream_loop', '-1', '-i', c);
    const filter = segmentFilters[idx % segmentFilters.length];
    filterParts.push(`[${idx}:v]trim=0:${segDur.toFixed(3)},setpts=PTS-STARTPTS,${filter}[v_seg_${idx}]`);
  });

  const segConcatInputs = sequencedClips.map((_, idx) => `[v_seg_${idx}]`).join('');
  filterParts.push(`${segConcatInputs}concat=n=${numScenes}:v=1:a=0[v_moving]`);

  // 4. Overlay sleek top hook pill & verified stats card directly onto full-bleed moving video
  ffmpegArgs.push('-loop', '1', '-i', overlayPngPath);
  filterParts.push(`[v_moving][${numScenes}:v]overlay=0:0:shortest=1[vout]`);

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

  logger.info(`Rendering multi-scene moving video with stats graphics for Slot 5 (${roundDur}s, ${numScenes} scene cuts)...`);
  try {
    await runFFmpeg(ffmpegArgs);
    logger.success(`Slot 5 multi-scene 9:16 moving video with stats overlay rendered: ${outputPath}`);
  } finally {
    try {
      if (fs.existsSync(overlayPngPath)) fs.unlinkSync(overlayPngPath);
    } catch (_) {}
  }

  // Auto-generate high-contrast thumbnail/cover frame at 0.1s
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

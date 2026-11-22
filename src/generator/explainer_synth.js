import { createRequire } from 'module';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
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
        logger.error('FFmpeg explainer synth error:', stderr || err.message);
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
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

/**
 * Splits text into wrapped SVG tspans
 */
function renderWrappedTspans(text, x, startY, lineSpacing = 28, maxChars = 46) {
  if (!text) return '';
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = '';

  for (const w of words) {
    if ((currentLine + ' ' + w).trim().length <= maxChars) {
      currentLine = (currentLine + ' ' + w).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = w;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines
    .map((line, idx) => `<tspan x="${x}" dy="${idx === 0 ? 0 : lineSpacing}">${escapeXml(line)}</tspan>`)
    .join('');
}

const TEAM_THEMES = {
  KKR: { primary: '#3a225d', accent: '#ffcc00', textAccent: '#ffd700', name: 'KOLKATA KNIGHT RIDERS' },
  CSK: { primary: '#002d62', accent: '#f59e0b', textAccent: '#fbbf24', name: 'CHENNAI SUPER KINGS' },
  MI: { primary: '#004ba0', accent: '#38bdf8', textAccent: '#67e8f9', name: 'MUMBAI INDIANS' },
  RCB: { primary: '#990000', accent: '#f59e0b', textAccent: '#fbbf24', name: 'ROYAL CHALLENGERS' },
  SRH: { primary: '#ea580c', accent: '#f97316', textAccent: '#fdba74', name: 'SUNRISERS HYDERABAD' },
  PBKS: { primary: '#b71c1c', accent: '#ef4444', textAccent: '#fca5a5', name: 'PUNJAB KINGS' },
  DC: { primary: '#004c97', accent: '#ef4444', textAccent: '#fca5a5', name: 'DELHI CAPITALS' },
  RR: { primary: '#be185d', accent: '#06b6d4', textAccent: '#67e8f9', name: 'RAJASTHAN ROYALS' },
  GT: { primary: '#1e293b', accent: '#eab308', textAccent: '#fde047', name: 'GUJARAT TITANS' },
  LSG: { primary: '#0891b2', accent: '#06b6d4', textAccent: '#a5f3fc', name: 'LUCKNOW SUPER GIANTS' },
  DEFAULT: { primary: '#0f172a', accent: '#38bdf8', textAccent: '#7dd3fc', name: 'IPL TACTICAL SQUAD' },
};

/**
 * Builds SVG elements for Beat 0: Big Stat & Hook Card
 */
function renderBigStatCard(cardData, headlineTag, accentHex, textAccentHex) {
  const stat = escapeXml(cardData.bigStat || 'AUCTION RESET');
  const subStat = escapeXml(cardData.subStat || 'TACTICAL SQUAD BREAKDOWN');
  const context1 = cardData.context1 || 'Title winners entered auction without designated captain';
  const context2 = cardData.context2 || '6 elite retentions locked, 19 roster spots to fill';

  return `
    <!-- Mode A: Big Number Hook Card (Safe Area: y=320 to 1160) -->
    <rect x="70" y="330" width="940" height="780" rx="32" fill="#070c18" fill-opacity="0.80" stroke="${accentHex}" stroke-width="2.5" />
    
    <!-- Header Badge -->
    <rect x="330" y="312" width="420" height="34" rx="17" fill="${accentHex}" />
    <text x="540" y="335" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="900" font-size="14" fill="#000000" text-anchor="middle" letter-spacing="1.5">⚡ AUCTION WAR CHEST &amp; HOOK</text>

    <!-- Sub-label -->
    <text x="540" y="415" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="800" fill="#94a3b8" text-anchor="middle" letter-spacing="2">AVAILABLE FINANCIAL MUSCLE</text>

    <!-- Giant Glowing Number -->
    <rect x="130" y="445" width="820" height="150" rx="24" fill="#0c1527" stroke="#1e293b" stroke-width="2" />
    <text x="540" y="555" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="82" font-weight="900" fill="${textAccentHex}" text-anchor="middle" letter-spacing="-1">${stat}</text>

    <!-- Sub-stat Pill -->
    <rect x="230" y="625" width="620" height="48" rx="24" fill="#0e2238" stroke="${accentHex}" stroke-width="1.5" />
    <text x="540" y="656" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="1">${subStat}</text>

    <!-- Context 1 Box -->
    <rect x="110" y="705" width="860" height="88" rx="18" fill="#0b1324" stroke="#1e293b" stroke-width="1.5" />
    <circle cx="145" cy="749" r="8" fill="${accentHex}" />
    <text x="175" y="755" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="700" fill="#f8fafc">
      ${renderWrappedTspans(context1, 175, 742, 28, 42)}
    </text>

    <!-- Context 2 Box -->
    <rect x="110" y="815" width="860" height="88" rx="18" fill="#0b1324" stroke="#1e293b" stroke-width="1.5" />
    <circle cx="145" cy="859" r="8" fill="#38bdf8" />
    <text x="175" y="865" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="700" fill="#f8fafc">
      ${renderWrappedTspans(context2, 175, 852, 28, 42)}
    </text>

    <!-- Card Footer -->
    <text x="540" y="1065" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="800" fill="#64748b" text-anchor="middle" letter-spacing="1.5">VERIFIED OFFICIAL IPL SQUAD &amp; PURSE DATA</text>
  `;
}

/**
 * Builds SVG elements for Beat 1: Squad Grid Slots Card
 */
function renderSquadGridCard(cardData, headlineTag, accentHex, textAccentHex) {
  const gridTitle = escapeXml((cardData.gridTitle || 'SQUAD BALANCE & VACANCIES').toUpperCase());
  const items = Array.isArray(cardData.gridItems) ? cardData.gridItems : [];

  let rowsSvg = '';
  const startY = 430;
  const rowHeight = 118;
  const gap = 16;

  items.slice(0, 4).forEach((item, idx) => {
    const y = startY + idx * (rowHeight + gap);
    const slot = escapeXml((item.slot || 'ROLE').toUpperCase());
    const player = escapeXml(item.player || 'Player Name');
    const status = (item.status || 'LOCKED').toUpperCase();
    const tag = escapeXml((item.tag || status).toUpperCase());

    let statusBg = '#064e3b';
    let statusBorder = '#10b981';
    let statusText = '#34d399';

    if (status.includes('VACANT') || status.includes('OPEN') || status.includes('THIN')) {
      statusBg = '#4c0519';
      statusBorder = '#f43f5e';
      statusText = '#fb7185';
    } else if (status.includes('TARGET') || status.includes('PRIORITY')) {
      statusBg = '#083344';
      statusBorder = '#06b6d4';
      statusText = '#67e8f9';
    } else if (status.includes('WARN') || status.includes('REBUILD')) {
      statusBg = '#451a03';
      statusBorder = '#f59e0b';
      statusText = '#fcd34d';
    }

    rowsSvg += `
      <!-- Grid Row ${idx} -->
      <rect x="110" y="${y}" width="860" height="${rowHeight}" rx="20" fill="#0b1324" stroke="#1e293b" stroke-width="1.8" />
      
      <!-- Slot Role Label -->
      <text x="140" y="${y + 36}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="15" font-weight="800" fill="${accentHex}" letter-spacing="1">${slot}</text>
      
      <!-- Main Player Name -->
      <text x="140" y="${y + 78}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="25" font-weight="900" fill="#ffffff">${player}</text>
      
      <!-- Status Pill -->
      <rect x="750" y="${y + 38}" width="190" height="44" rx="22" fill="${statusBg}" stroke="${statusBorder}" stroke-width="1.5" />
      <text x="845" y="${y + 65}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="900" fill="${statusText}" text-anchor="middle" letter-spacing="1">${tag}</text>
    `;
  });

  return `
    <!-- Mode B: Squad Grid Card (Safe Area: y=320 to 1160) -->
    <rect x="70" y="330" width="940" height="780" rx="32" fill="#070c18" fill-opacity="0.80" stroke="${accentHex}" stroke-width="2.5" />
    
    <!-- Header Badge -->
    <rect x="330" y="312" width="420" height="34" rx="17" fill="${accentHex}" />
    <text x="540" y="335" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="900" font-size="14" fill="#000000" text-anchor="middle" letter-spacing="1.5">📋 SQUAD BALANCE &amp; SLOTS</text>

    <!-- Sub-label -->
    <text x="540" y="395" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="1">${gridTitle}</text>

    ${rowsSvg}

    <!-- Card Footer -->
    <text x="540" y="1065" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="800" fill="#64748b" text-anchor="middle" letter-spacing="1.5">ROSTER AUDIT • CRICKET TACTICAL RADAR</text>
  `;
}

/**
 * Builds SVG elements for Beat 2: Departure vs Replacement Card
 */
function renderDepartureReplacementCard(cardData, headlineTag, accentHex, textAccentHex) {
  const cardTitle = escapeXml((cardData.title || 'ROSTER TRANSITION & TARGET').toUpperCase());
  const outP = cardData.outPlayer || { name: 'Key Outgoing Player', price: 'Released', role: 'Departed Star' };
  const inP = cardData.inTarget || { name: 'Target Replacement', price: 'Priority', role: 'Target Star' };
  const takeaway = cardData.takeaway || 'Replacing championship experience is the hardest auction assignment.';

  return `
    <!-- Mode C: Departure vs Replacement Card (Safe Area: y=320 to 1160) -->
    <rect x="70" y="330" width="940" height="780" rx="32" fill="#070c18" fill-opacity="0.80" stroke="${accentHex}" stroke-width="2.5" />
    
    <!-- Header Badge -->
    <rect x="330" y="312" width="420" height="34" rx="17" fill="${accentHex}" />
    <text x="540" y="335" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="900" font-size="14" fill="#000000" text-anchor="middle" letter-spacing="1.5">🔄 ROSTER TRANSITION</text>

    <!-- Sub-label -->
    <text x="540" y="395" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="1">${cardTitle}</text>

    <!-- OUT Box (Red/Rose accent) -->
    <rect x="110" y="425" width="860" height="180" rx="24" fill="#180a13" stroke="#f43f5e" stroke-width="2" />
    <rect x="135" y="445" width="160" height="32" rx="16" fill="#f43f5e" />
    <text x="215" y="466" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="900" fill="#000000" text-anchor="middle" letter-spacing="1.2">OUT / RELEASED</text>
    <text x="140" y="525" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="32" font-weight="900" fill="#ffffff">${escapeXml(outP.name)}</text>
    <text x="140" y="568" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="700" fill="#fda4af">${escapeXml(outP.role)} • ${escapeXml(outP.price || 'Released')}</text>

    <!-- Transition Divider Pill -->
    <rect x="420" y="618" width="240" height="34" rx="17" fill="${accentHex}" />
    <text x="540" y="640" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="900" fill="#000000" text-anchor="middle" letter-spacing="1.5">⚡ TACTICAL VOID ⚡</text>

    <!-- IN Box (Emerald/Green accent) -->
    <rect x="110" y="665" width="860" height="180" rx="24" fill="#071b16" stroke="#10b981" stroke-width="2" />
    <rect x="135" y="685" width="180" height="32" rx="16" fill="#10b981" />
    <text x="225" y="706" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="900" fill="#000000" text-anchor="middle" letter-spacing="1.2">IN / TARGET HUNT</text>
    <text x="140" y="765" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="32" font-weight="900" fill="#ffffff">${escapeXml(inP.name)}</text>
    <text x="140" y="808" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="700" fill="#6ee7b7">${escapeXml(inP.role)} • ${escapeXml(inP.price || 'Target')}</text>

    <!-- Takeaway Banner -->
    <rect x="110" y="870" width="860" height="90" rx="18" fill="#0b1324" stroke="#1e293b" stroke-width="1.5" />
    <text x="540" y="910" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="700" fill="#cbd5e1" text-anchor="middle">
      ${renderWrappedTspans(takeaway, 540, 910, 26, 48)}
    </text>

    <!-- Card Footer -->
    <text x="540" y="1065" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="800" fill="#64748b" text-anchor="middle" letter-spacing="1.5">AUCTION DYNAMICS • SQUAD SUCCESSION</text>
  `;
}

/**
 * Builds SVG elements for Beat 3: Tactical Twist / Paradox Card
 */
function renderTacticalTwistCard(cardData, headlineTag, accentHex, textAccentHex) {
  const twistTitle = escapeXml((cardData.twistTitle || 'THE STRATEGIC DILEMMA').toUpperCase());
  const point1 = cardData.point1 || 'High-scoring pitches require minimum 6 genuine bowling options.';
  const point2 = cardData.point2 || 'Death overs execution determines playoff qualification.';

  return `
    <!-- Mode D: Tactical Twist Card (Safe Area: y=320 to 1160) -->
    <rect x="70" y="330" width="940" height="780" rx="32" fill="#070c18" fill-opacity="0.80" stroke="${accentHex}" stroke-width="2.5" />
    
    <!-- Header Badge -->
    <rect x="330" y="312" width="420" height="34" rx="17" fill="#ef4444" />
    <text x="540" y="335" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="900" font-size="14" fill="#ffffff" text-anchor="middle" letter-spacing="1.5">⚠️ THE TACTICAL PARADOX</text>

    <!-- Twist Title -->
    <text x="540" y="405" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="26" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="0.5">${twistTitle}</text>

    <!-- Tactical Point 1 Box -->
    <rect x="110" y="450" width="860" height="200" rx="24" fill="#0b1324" stroke="#f59e0b" stroke-width="2" />
    <circle cx="155" cy="495" r="14" fill="#f59e0b" />
    <text x="155" y="501" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="900" fill="#000000" text-anchor="middle">1</text>
    <text x="195" y="502" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="800" fill="#f59e0b" letter-spacing="1">PITCH &amp; MATCH REALITY</text>
    <text x="155" y="550" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="21" font-weight="700" fill="#f8fafc">
      ${renderWrappedTspans(point1, 155, 550, 32, 42)}
    </text>

    <!-- Tactical Point 2 Box -->
    <rect x="110" y="680" width="860" height="200" rx="24" fill="#0b1324" stroke="#38bdf8" stroke-width="2" />
    <circle cx="155" cy="725" r="14" fill="#38bdf8" />
    <text x="155" y="731" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="900" fill="#000000" text-anchor="middle">2</text>
    <text x="195" y="732" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="800" fill="#38bdf8" letter-spacing="1">CHAMPIONSHIP SQUAD DEPTH</text>
    <text x="155" y="780" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="21" font-weight="700" fill="#f8fafc">
      ${renderWrappedTspans(point2, 155, 780, 32, 42)}
    </text>

    <!-- Card Footer -->
    <text x="540" y="1065" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="800" fill="#64748b" text-anchor="middle" letter-spacing="1.5">TACTICAL INTELLIGENCE • DEEP CRICKET ANALYSIS</text>
  `;
}

/**
 * Builds SVG elements for Beat 4: Verdict & Viewer Question Card
 */
function renderQuestionHookCard(cardData, headlineTag, accentHex, textAccentHex) {
  const rawQ = cardData.questionTitle || 'THE BIG VERDICT';
  const qTitle = escapeXml(rawQ.toUpperCase().replace(/\bVEROICT\b/gi, 'VERDICT'));
  const optA = cardData.optionA || 'Back Young Indian Core';
  const optB = cardData.optionB || 'Spend Big on Overseas Match-Winner';

  return `
    <!-- Mode E: Question & Debate Card (Safe Area: y=320 to 1160) -->
    <rect x="70" y="330" width="940" height="780" rx="32" fill="#070c18" fill-opacity="0.80" stroke="${accentHex}" stroke-width="2.5" />
    
    <!-- Header Badge -->
    <rect x="330" y="312" width="420" height="34" rx="17" fill="#6366f1" />
    <text x="540" y="335" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="900" font-size="14" fill="#ffffff" text-anchor="middle" letter-spacing="1.5">💬 VIEWER VERDICT &amp; DEBATE</text>

    <!-- Question Title -->
    <text x="540" y="405" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="0.5">${qTitle}</text>

    <!-- Option A Box -->
    <rect x="110" y="450" width="860" height="150" rx="22" fill="#0b1324" stroke="${accentHex}" stroke-width="2" />
    <rect x="135" y="475" width="50" height="50" rx="14" fill="${accentHex}" />
    <text x="160" y="508" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="24" font-weight="900" fill="#000000" text-anchor="middle">A</text>
    <text x="210" y="525" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="800" fill="#ffffff">
      ${renderWrappedTspans(optA, 210, 520, 30, 36)}
    </text>

    <!-- Option B Box -->
    <rect x="110" y="630" width="860" height="150" rx="22" fill="#0b1324" stroke="#38bdf8" stroke-width="2" />
    <rect x="135" y="655" width="50" height="50" rx="14" fill="#38bdf8" />
    <text x="160" y="688" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="24" font-weight="900" fill="#000000" text-anchor="middle">B</text>
    <text x="210" y="705" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="800" fill="#ffffff">
      ${renderWrappedTspans(optB, 210, 700, 30, 36)}
    </text>

    <!-- Comments Callout Box -->
    <rect x="160" y="825" width="760" height="64" rx="32" fill="#dc2626" />
    <text x="540" y="865" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="1">🔥 DROP YOUR VERDICT IN COMMENTS! 🔥</text>

    <!-- Card Footer -->
    <text x="540" y="1065" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="800" fill="#64748b" text-anchor="middle" letter-spacing="1.5">JOIN THE CRICKET DEBATE • @DAILYPULSESHORTSS</text>
  `;
}

/**
 * Builds the complete 1080x1920 SVG for a single timed beat
 */
function buildBeatSvg({
  beat,
  headline,
  teamTheme,
}) {
  const accentHex = teamTheme.accent;
  const textAccentHex = teamTheme.textAccent || accentHex;
  const rawTag = beat.headlineTag || headline || 'TACTICAL EXPLAINER';
  const headlineTag = rawTag.replace(/\bVEROICT\b/gi, 'VERDICT');

  // Render top hook pill at y=105 to y=175
  const topBadgeSvg = `
    <!-- Top Hook Pill (Safe Area: y=95 to 175) -->
    <rect x="90" y="100" width="900" height="74" rx="37" fill="#070c18" fill-opacity="0.94" stroke="${accentHex}" stroke-width="2" />
    <circle cx="135" cy="137" r="9" fill="${accentHex}" />
    <text x="160" y="145" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="900" font-size="21" fill="#ffffff" letter-spacing="1">${escapeXml(headlineTag.toUpperCase())}</text>
    <rect x="790" y="115" width="180" height="44" rx="22" fill="${accentHex}" />
    <text x="880" y="143" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="900" font-size="14" fill="#000000" text-anchor="middle" letter-spacing="1">IPL TACTICS</text>
  `;

  let cardBody = '';
  switch (beat.visualMode) {
    case 'big_stat':
      cardBody = renderBigStatCard(beat.cardData || {}, headlineTag, accentHex, textAccentHex);
      break;
    case 'squad_grid':
      cardBody = renderSquadGridCard(beat.cardData || {}, headlineTag, accentHex, textAccentHex);
      break;
    case 'departure_replacement':
      cardBody = renderDepartureReplacementCard(beat.cardData || {}, headlineTag, accentHex, textAccentHex);
      break;
    case 'tactical_twist':
      cardBody = renderTacticalTwistCard(beat.cardData || {}, headlineTag, accentHex, textAccentHex);
      break;
    case 'question_hook':
      cardBody = renderQuestionHookCard(beat.cardData || {}, headlineTag, accentHex, textAccentHex);
      break;
    default:
      cardBody = renderBigStatCard(beat.cardData || {}, headlineTag, accentHex, textAccentHex);
      break;
  }

  return `
    <svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="topVignette" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#000000" stop-opacity="0.75" />
          <stop offset="100%" stop-color="#000000" stop-opacity="0.0" />
        </linearGradient>
      </defs>

      <!-- Subtle Top Gradient -->
      <rect x="0" y="0" width="1080" height="320" fill="url(#topVignette)" />

      <!-- Top Hook Pill -->
      ${topBadgeSvg}

      <!-- Center Beat Card (y=320 to 1180) -->
      ${cardBody}
    </svg>
  `;
}

/**
 * Generates true full-screen 9:16 (1080x1920) moving video for Slot 6 (Tactical / Squad Explainer)
 * Multi-scene progression with beat-by-beat synchronized graphic cards.
 */
export async function generateExplainerVisualBackground({
  duration = 50,
  outputPath,
  headline,
  team = 'KKR',
  beats = [],
  visualSceneQueries = [],
  customTopic = null,
}) {
  const roundDur = Math.max(5, Math.ceil(duration));
  const teamTheme = TEAM_THEMES[team] || TEAM_THEMES.DEFAULT;
  const rawHeadline = headline || customTopic || 'IPL TACTICAL SQUAD EXPLAINER';

  logger.info(`[Explainer Synth] Generating Slot 6 visual background for ${teamTheme.name} (${roundDur}s, ${beats.length} beats)...`);

  // 1. Fetch 3-5 distinct moving MP4 video clips matching cricket atmospheres
  const rawClips = await fetchMultiClipSequence({
    slotType: 'slot6',
    title: rawHeadline,
    visualSceneQueries: visualSceneQueries.length > 0 ? visualSceneQueries : [
      'cricket stadium floodlights crowd night',
      'cricket bat and ball nets practice pitch',
      'cricket batsman powerful match boundary shot',
      'cricket team victory celebration golden trophy',
    ],
    count: 4,
  });

  // Deduplicate clips
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

  if (clips.length === 0) {
    const defaultStadium = path.join(config.assetsDir, 'defaults', 'cricket', 'stadium_bg.mp4');
    clips.push(fs.existsSync(defaultStadium) ? defaultStadium : path.join(config.assetsDir, 'defaults', 'slot1_dance.mp4'));
  }

  // Separate into Stadium/Atmosphere and Action/Motion categories so adjacent cuts alternate
  const stadiumClips = clips.filter((c) => /stadium|crowd|atmosphere/i.test(path.basename(c)));
  const actionClips = clips.filter((c) => !/stadium|crowd|atmosphere/i.test(path.basename(c)));

  const alternatingClips = [];
  const maxPool = Math.max(stadiumClips.length, actionClips.length);
  for (let p = 0; p < maxPool; p++) {
    if (stadiumClips.length > 0) alternatingClips.push(stadiumClips[p % stadiumClips.length]);
    if (actionClips.length > 0) alternatingClips.push(actionClips[p % actionClips.length]);
  }
  const effectivePool = alternatingClips.length > 0 ? alternatingClips : clips;

  // Dynamic multi-scene progression: ensure background cuts every 4.0 - 5.0 seconds across the timeline!
  const targetSceneDuration = 4.5;
  const numScenes = Math.max(effectivePool.length, Math.ceil(roundDur / targetSceneDuration));
  const segDur = roundDur / numScenes;

  // Build sequenced scene cuts cycling through diverse available cricket clips
  const sequencedClips = [];
  for (let s = 0; s < numScenes; s++) {
    sequencedClips.push(effectivePool[s % effectivePool.length]);
  }
  logger.info(`Stitching ${numScenes} dynamic scene cuts (~${segDur.toFixed(1)}s per cut) cycling across ${effectivePool.length} distinct cricket clips`);

  // 2. Compute proportional start and end timestamps for each beat
  const totalWords = beats.reduce((sum, b) => {
    const words = (b.narration || '').trim().split(/\s+/).filter(Boolean).length;
    return sum + Math.max(words, 1);
  }, 0);

  let accumulatedTime = 0;
  const timedBeats = beats.map((b, idx) => {
    const words = (b.narration || '').trim().split(/\s+/).filter(Boolean).length;
    const beatFraction = Math.max(words, 1) / totalWords;
    const beatDur = beatFraction * roundDur;
    const start = accumulatedTime;
    const end = idx === beats.length - 1 ? roundDur : Math.min(roundDur, accumulatedTime + beatDur);
    accumulatedTime = end;
    return {
      ...b,
      startTime: Math.max(0, start),
      endTime: Math.max(start + 1.0, end),
    };
  });

  // 3. Render SVG -> PNG for each beat
  const overlayPngPaths = [];
  const outDir = path.dirname(outputPath);

  for (let i = 0; i < timedBeats.length; i++) {
    const b = timedBeats[i];
    const beatSvg = buildBeatSvg({
      beat: b,
      headline: rawHeadline,
      teamTheme,
    });

    const beatPngPath = path.join(outDir, `explainer_beat_${i}_${Date.now()}.png`);
    await sharp(Buffer.from(beatSvg))
      .png()
      .toFile(beatPngPath);

    overlayPngPaths.push({
      path: beatPngPath,
      startTime: b.startTime,
      endTime: b.endTime,
    });
  }

  // 4. Build FFmpeg command with sequenced clip background + timed beat overlays
  const ffmpegArgs = ['-y', '-loglevel', 'error'];
  const filterParts = [];

  // Add background video clips cycling across diverse camera angles and dynamic motion
  const segDurStr = segDur.toFixed(2);
  const segmentFilters = [
    // 0: Dynamic downward camera glide
    `scale=1200:2133:force_original_aspect_ratio=increase,crop=1080:1920:\'(in_w-1080)/2\':\'(in_h-1920)*(t/${segDurStr})\',setsar=1,fps=30`,
    // 1: Dynamic push-in zoom
    `scale=\'1080+140*(t/${segDurStr})\':\'1920+248*(t/${segDurStr})\':eval=frame,crop=1080:1920,eq=contrast=1.12:saturation=1.2:brightness=0.01,setsar=1,fps=30`,
    // 2: Dynamic horizontal pan left-to-right
    `scale=1280:1920:force_original_aspect_ratio=increase,crop=1080:1920:\'(in_w-1080)*(t/${segDurStr})\':\'(in_h-1920)/2\',setsar=1,fps=30`,
    // 3: Dynamic pull-out zoom
    `scale=\'1220-140*(t/${segDurStr})\':\'2168-248*(t/${segDurStr})\':eval=frame,crop=1080:1920,eq=contrast=1.14:saturation=1.22:brightness=-0.02,setsar=1,fps=30`,
    // 4: Dynamic horizontal pan right-to-left with hflip
    `scale=1280:1920:force_original_aspect_ratio=increase,crop=1080:1920:\'(in_w-1080)*(1-t/${segDurStr})\':\'(in_h-1920)/2\',hflip,setsar=1,fps=30`,
    // 5: Dynamic upward camera push
    `scale=1200:2133:force_original_aspect_ratio=increase,crop=1080:1920:\'(in_w-1080)/2\':\'(in_h-1920)*(1-t/${segDurStr})\',eq=contrast=1.10:saturation=1.20,setsar=1,fps=30`,
  ];

  sequencedClips.forEach((c, idx) => {
    ffmpegArgs.push('-stream_loop', '-1', '-i', c);
    const filter = segmentFilters[idx % segmentFilters.length];
    filterParts.push(`[${idx}:v]trim=0:${segDur.toFixed(3)},setpts=PTS-STARTPTS,${filter}[v_seg_${idx}]`);
  });

  const segConcatInputs = sequencedClips.map((_, idx) => `[v_seg_${idx}]`).join('');
  filterParts.push(`${segConcatInputs}concat=n=${numScenes}:v=1:a=0[v_moving]`);

  // Add loop inputs for each beat PNG overlay
  let currentNode = 'v_moving';
  overlayPngPaths.forEach((item, idx) => {
    const inputIdx = numScenes + idx;
    ffmpegArgs.push('-loop', '1', '-i', item.path);
    const outNode = idx === overlayPngPaths.length - 1 ? 'vout' : `v_beat_${idx}`;
    filterParts.push(
      `[${currentNode}][${inputIdx}:v]overlay=0:0:enable='between(t,${item.startTime.toFixed(2)},${item.endTime.toFixed(2)})'[${outNode}]`
    );
    currentNode = outNode;
  });

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

  logger.info(`Rendering Slot 6 beat-by-beat explainer video (${roundDur}s, ${overlayPngPaths.length} visual beats)...`);
  try {
    await runFFmpeg(ffmpegArgs);
    logger.success(`Slot 6 beat-driven explainer video rendered: ${outputPath}`);
  } finally {
    // Clean up temporary beat PNG overlays
    for (const item of overlayPngPaths) {
      try {
        if (fs.existsSync(item.path)) fs.unlinkSync(item.path);
      } catch (_) {}
    }
  }

  // Auto-generate cover frame at 0.1s
  const coverPath = path.join(outDir, 'cover.jpg');
  try {
    await runFFmpeg([
      '-y',
      '-ss', '00:00:00.100',
      '-i', outputPath,
      '-vframes', '1',
      '-q:v', '2',
      coverPath,
    ]);
  } catch (_) {}

  return outputPath;
}

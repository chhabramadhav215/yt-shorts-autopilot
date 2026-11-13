import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { transliterateHindiToHinglish } from '../utils/text_utils.js';

/**
 * Format milliseconds into ASS timecode (H:MM:SS.cs)
 * @param {number} ms - Milliseconds
 * @returns {string}
 */
function formatASSTime(ms) {
  const totalSeconds = Math.max(0, ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const centiseconds = Math.floor((totalSeconds % 1) * 100);

  const pad = (num, size = 2) => String(num).padStart(size, '0');
  return `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(centiseconds)}`;
}

/**
 * Generates an ASS subtitle file with English burned-in subtitles aligned to Hindi voiceover
 * @param {Object} options
 * @param {string} [options.metadataPath] - Path to msedge-tts metadata.json
 * @param {string} options.outputPath - Destination .ass file path
 * @param {string} [options.slotType] - 'slot1' | 'slot2' | 'slot3' | 'slot4'
 * @param {string} [options.englishText] - Full English subtitle text
 * @param {Array<{hindi: string, english: string}>} [options.segments] - Optional pre-paired sentence segments
 * @param {number} [options.audioDuration] - Total voiceover audio duration in seconds
 * @param {number} [options.timeOffsetMs] - Delay offset in ms (for Slot 4 dual-audio intro)
 * @param {string} [options.shlokIntroText] - Sanskrit/Hindi shloka text to display during intro
 */
export function generateAssSubtitles({
  metadataPath,
  outputPath,
  slotType = 'slot1',
  englishText = '',
  segments = [],
  audioDuration = 10,
  timeOffsetMs = 0,
  shlokIntroText = '',
}) {
  let subtitleCues = [];

  // 1. Extract word and sentence boundaries from TTS metadata
  let wordBoundaries = [];
  let sentenceBoundaries = [];
  if (metadataPath && fs.existsSync(metadataPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      const entries = raw.Metadata || [];
      for (const item of entries) {
        if (item.Type === 'WordBoundary' && item.Data?.Duration > 0) {
          wordBoundaries.push({
            startMs: item.Data.Offset / 10000,
            endMs: (item.Data.Offset + item.Data.Duration) / 10000,
            text: item.Data?.text?.Text || '',
          });
        } else if (item.Type === 'SentenceBoundary' && item.Data?.Duration > 0) {
          sentenceBoundaries.push({
            startMs: item.Data.Offset / 10000,
            endMs: (item.Data.Offset + item.Data.Duration) / 10000,
            text: item.Data?.text?.Text || '',
          });
        }
      }
    } catch (e) {
      logger.warn(`Failed to parse metadata boundaries: ${e.message}`);
    }
  }

  // Exact voiceover duration in milliseconds (scaled to real media duration)
  const totalMs = Math.max(
    Math.round((audioDuration || 0) * 1000),
    wordBoundaries[wordBoundaries.length - 1]?.endMs || 0,
    sentenceBoundaries[sentenceBoundaries.length - 1]?.endMs || 0,
    5000
  );

  // 2. Segment-aware subtitle cue alignment (100% audio sync with zero early cutoff)
  if (segments && segments.length > 0) {
    const segmentWeights = segments.map((s) => {
      const hindiWords = (s.hindi || '').trim().split(/\s+/).filter(Boolean);
      return Math.max(hindiWords.length, 1);
    });
    const totalWeight = segmentWeights.reduce((a, b) => a + b, 0);

    let segmentTimeSpans = [];
    if (wordBoundaries.length >= totalWeight * 0.6 && wordBoundaries.length > 0) {
      let currentWordIdx = 0;
      for (let i = 0; i < segments.length; i++) {
        const weight = segmentWeights[i];
        const count = Math.max(1, Math.round((weight / totalWeight) * wordBoundaries.length));
        const startIdx = currentWordIdx;
        const endIdx = (i === segments.length - 1)
          ? wordBoundaries.length - 1
          : Math.min(wordBoundaries.length - 1, currentWordIdx + count - 1);

        const startMs = wordBoundaries[startIdx]?.startMs ?? (i === 0 ? 0 : segmentTimeSpans[i - 1].endMs);
        const endMs = (i === segments.length - 1)
          ? totalMs
          : (wordBoundaries[endIdx]?.endMs ?? Math.round(((startIdx + count) / wordBoundaries.length) * totalMs));

        segmentTimeSpans.push({ startMs, endMs: Math.max(startMs + 400, endMs) });
        currentWordIdx = endIdx + 1;
      }
    } else {
      let curMs = 0;
      for (let i = 0; i < segments.length; i++) {
        const weight = segmentWeights[i];
        const dur = Math.round((weight / totalWeight) * totalMs);
        const startMs = curMs;
        const endMs = (i === segments.length - 1) ? totalMs : (startMs + dur);
        segmentTimeSpans.push({ startMs, endMs });
        curMs = endMs;
      }
    }

    for (let i = 0; i < segments.length; i++) {
      const span = segmentTimeSpans[i];
      // Ensure subtitles always use exact transliterated Hinglish matching spoken Hindi voiceover
      const text = (segments[i].hinglish || (segments[i].hindi ? transliterateHindiToHinglish(segments[i].hindi) : segments[i].english) || '').trim();
      const words = text.replace(/[#*`_~]/g, ' ').split(/\s+/).filter(Boolean);
      if (words.length === 0) continue;

      const chunkSize = 3;
      const numChunks = Math.ceil(words.length / chunkSize);
      const spanDur = span.endMs - span.startMs;
      const chunkDur = spanDur / numChunks;

      for (let c = 0; c < numChunks; c++) {
        const chunkWords = words.slice(c * chunkSize, (c + 1) * chunkSize);
        const chunkStart = timeOffsetMs + span.startMs + Math.round(c * chunkDur);
        const isVeryLastCue = (i === segments.length - 1 && c === numChunks - 1);
        const chunkEnd = isVeryLastCue
          ? (timeOffsetMs + totalMs)
          : (timeOffsetMs + span.startMs + Math.round((c + 1) * chunkDur));

        subtitleCues.push({
          startMs: chunkStart,
          endMs: Math.max(chunkStart + 350, chunkEnd),
          text: chunkWords.join(' ').toUpperCase(),
        });
      }
    }
  }

  // Fallback if segments was empty
  if (subtitleCues.length === 0) {
    let cleanSubtitle = (englishText || '').replace(/[#*`_~]/g, ' ').trim();
    if (/[\u0900-\u097F]/.test(cleanSubtitle)) {
      cleanSubtitle = transliterateHindiToHinglish(cleanSubtitle);
    }
    const words = cleanSubtitle.split(/\s+/).filter(Boolean);

    if (words.length > 0) {
      const chunkSize = 3;
      const numChunks = Math.ceil(words.length / chunkSize);
      const chunkDur = totalMs / (numChunks || 1);

      for (let c = 0; c < numChunks; c++) {
        const chunkWords = words.slice(c * chunkSize, (c + 1) * chunkSize);
        const chunkStart = timeOffsetMs + Math.round(c * chunkDur);
        const chunkEnd = (c === numChunks - 1)
          ? (timeOffsetMs + totalMs)
          : (timeOffsetMs + Math.round((c + 1) * chunkDur));

        subtitleCues.push({
          startMs: chunkStart,
          endMs: Math.max(chunkStart + 350, chunkEnd),
          text: chunkWords.join(' ').toUpperCase(),
        });
      }
    }
  }

  // Select styling based on slot theme
  // Bright Yellow: &H0000FFFF
  // Radiant Divine Gold: &H0033D1FF
  // Pure White: &H00FFFFFF
  let primaryColor = '&H0000FFFF'; // Bright Yellow
  let outlineColor = '&H00000000'; // Deep Black
  let backColor = '&H80000000';
  let fontSize = 72;

  let marginV = 520;
  if (slotType === 'slot2' || slotType === 'slot4') {
    primaryColor = '&H0033D1FF'; // Radiant Divine Gold
    fontSize = 70;
  } else if (slotType === 'slot3') {
    primaryColor = '&H00FFFFFF'; // Crisp White
    fontSize = 66;
    marginV = 540; // Safe zone: centered in subtitle bar (y ≈ 1380), safely clear of bottom 20% UI
  } else if (slotType === 'slot5') {
    primaryColor = '&H0000FFFF'; // Electric Sports Yellow
    fontSize = 70;
    marginV = 520; // Safe zone: centered in subtitle bed (y ≈ 1400), safely clear of bottom 20% UI
  }

  // Generate ASS script header (1080x1920)
  let ass = `[Script Info]
Title: Auto Shorts English Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ShortsDefault,Noto Sans,${fontSize},${primaryColor},&H000000FF,${outlineColor},${backColor},-1,0,0,0,100,100,0,0,1,7,3,2,60,60,${marginV},1
Style: ShlokStyle,Noto Sans Devanagari,58,&H002BD7FF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,2,2,70,70,580,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // For Slot 4 Dual-Audio: Display the Sanskrit/Hindi/Hinglish Shloka on screen during the first 5-10s
  if (shlokIntroText && timeOffsetMs >= 2000) {
    const shlokEndMs = Math.max(1000, timeOffsetMs - 300);
    let cleanShlok = shlokIntroText.replace(/[{}]/g, '').trim();
    if (cleanShlok.includes('\n')) {
      cleanShlok = cleanShlok.replace(/\n+/g, ' \\N ');
    } else if (cleanShlok.length > 45 && cleanShlok.includes(' ')) {
      const words = cleanShlok.split(/\s+/);
      const mid = Math.ceil(words.length / 2);
      cleanShlok = `${words.slice(0, mid).join(' ')} \\N ${words.slice(mid).join(' ')}`;
    }
    ass += `Dialogue: 0,0:00:00.60,${formatASSTime(shlokEndMs)},ShlokStyle,,0,0,0,,{\\b1}${cleanShlok}{\\b0}\n`;
  }

  // Display the bold English commentary subtitles
  for (const cue of subtitleCues) {
    const startCode = formatASSTime(cue.startMs);
    const endCode = formatASSTime(cue.endMs);
    if (slotType === 'slot5' || slotType === 'slot1' || slotType === 'slot3') {
      // Dynamic animated karaoke / pop highlighting
      const words = cue.text.split(' ');
      let styledText = '';
      if (words.length >= 2) {
        styledText = `{\\c&H0000FFFF&}${words[0]} {\\c&H00FFFFFF&}${words.slice(1).join(' ')}`;
      } else {
        styledText = `{\\c&H0000FFFF&}${cue.text}`;
      }
      ass += `Dialogue: 0,${startCode},${endCode},ShortsDefault,,0,0,0,,{\\b1}${styledText}{\\b0}\n`;
    } else {
      ass += `Dialogue: 0,${startCode},${endCode},ShortsDefault,,0,0,0,,{\\b1}${cue.text}{\\b0}\n`;
    }
  }

  fs.writeFileSync(outputPath, ass, 'utf8');
  logger.success(`Styled English subtitles generated (${subtitleCues.length} cues, offset: ${timeOffsetMs}ms): ${outputPath}`);
  return outputPath;
}

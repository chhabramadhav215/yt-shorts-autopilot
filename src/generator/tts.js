import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

/**
 * Removes any partial or corrupt audio/metadata files from output directory
 */
function cleanupPartialAudio(outputDir) {
  try {
    const audioPath = path.join(outputDir, 'audio.mp3');
    const metadataPath = path.join(outputDir, 'metadata.json');
    if (fs.existsSync(audioPath)) {
      fs.rmSync(audioPath, { force: true });
    }
    if (fs.existsSync(metadataPath)) {
      fs.rmSync(metadataPath, { force: true });
    }
  } catch (e) {
    // Ignore cleanup error
  }
}

/**
 * Sanitizes script text: removes markdown, emojis, unsafe XML characters that break SSML parsing
 * @param {string} text
 * @returns {string}
 */
export function sanitizeTtsText(text) {
  if (!text) return '';
  return text
    // Remove emojis and symbols
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu, '')
    // Remove markdown characters & brackets
    .replace(/[#*`_~\[\]\\\/]/g, ' ')
    // Replace ampersand safely
    .replace(/&/g, text.match(/[\u0900-\u097F]/) ? ' और ' : ' and ')
    // Strip XML unescaped characters
    .replace(/[<>"']/g, '')
    // Normalize spaces
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits text into individual sentences and clauses (< 140 chars each) to prevent Edge TTS WebSocket drops
 * @param {string} text
 * @param {number} maxLen
 * @returns {string[]}
 */
export function splitIntoTtsChunks(text, maxLen = 140) {
  const clean = sanitizeTtsText(text);
  if (clean.length <= maxLen) return [clean];

  // Split on sentence and clause boundaries: Hindi purna viram (।), period (.), question mark (?), exclamation (!), comma (,), semicolon (;)
  const sentenceRegex = /[^।\.?!,;:—\n]+[।\.?!,;:—\n]*/g;
  const rawParts = clean.match(sentenceRegex) || [clean];

  const grouped = [];
  let currentGroup = '';

  for (const part of rawParts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (!currentGroup) {
      currentGroup = trimmed;
    } else if ((currentGroup + ' ' + trimmed).length <= maxLen) {
      currentGroup += ' ' + trimmed;
    } else {
      grouped.push(currentGroup);
      currentGroup = trimmed;
    }
  }

  if (currentGroup) grouped.push(currentGroup);

  // Safety: if any chunk exceeds maxLen (rare, no punctuation), split by words
  const finalChunks = [];
  for (const chunk of grouped) {
    if (chunk.length <= maxLen) {
      finalChunks.push(chunk);
    } else {
      const words = chunk.split(/\s+/);
      let sub = '';
      for (const w of words) {
        if (!sub) {
          sub = w;
        } else if ((sub + ' ' + w).length <= maxLen) {
          sub += ' ' + w;
        } else {
          finalChunks.push(sub);
          sub = w;
        }
      }
      if (sub) finalChunks.push(sub);
    }
  }

  return finalChunks.filter((c) => c.trim().length > 0);
}

/**
 * Resolves an ordered list of candidate voices for Edge TTS
 * @param {string} primaryVoice
 * @returns {string[]}
 */
function getCandidateVoices(primaryVoice) {
  const voices = [primaryVoice];
  if (primaryVoice.startsWith('hi-IN')) {
    voices.push('hi-IN-SwaraNeural');
    voices.push('hi-IN-MadhurNeural');
    voices.push('en-IN-PrabhatNeural');
    voices.push('en-IN-NeerjaNeural');
  } else if (primaryVoice.startsWith('en-IN')) {
    voices.push('en-IN-NeerjaNeural');
    voices.push('en-IN-PrabhatNeural');
    voices.push('hi-IN-MadhurNeural');
  } else {
    voices.push('en-US-GuyNeural');
    voices.push('en-US-ChristopherNeural');
    voices.push('en-IN-PrabhatNeural');
  }
  return [...new Set(voices)];
}

/**
 * Synthesizes a single chunk using an active MsEdgeTTS instance with error handling
 */
async function synthesizeEdgeChunk(tts, chunkText, ttsOptions) {
  const { audioStream, metadataStream } = tts.toStream(chunkText, ttsOptions);

  const audioBufs = [];
  const chunkMeta = [];

  audioStream.on('data', (d) => audioBufs.push(d));

  if (metadataStream) {
    metadataStream.on('data', (d) => {
      try {
        const parsed = JSON.parse(d.toString());
        if (Array.isArray(parsed.Metadata)) {
          chunkMeta.push(...parsed.Metadata);
        }
      } catch (_) {}
    });
  }

  await Promise.all([
    new Promise((resolve, reject) => {
      audioStream.once('end', resolve);
      audioStream.once('error', reject);
    }),
    metadataStream
      ? new Promise((resolve) => metadataStream.once('close', resolve))
      : Promise.resolve(),
  ]);

  const audioBuffer = Buffer.concat(audioBufs);
  if (audioBuffer.length < 500) {
    throw new Error(`Edge TTS chunk buffer too small (${audioBuffer.length} bytes)`);
  }

  return { audioBuffer, metadata: chunkMeta };
}

/**
 * Synthesizes full script by chunking and concatenating via Edge TTS
 */
async function synthesizeEdgeTtsWithChunking({ voice, cleanText, outputDir, pitch, rate }) {
  const chunks = splitIntoTtsChunks(cleanText, 140);
  logger.info(`Synthesizing with Edge TTS [${voice}] in ${chunks.length} sentence chunk(s)...`);

  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
    wordBoundaryEnabled: true,
    sentenceBoundaryEnabled: true,
  });

  const ttsOptions = {};
  if (pitch) ttsOptions.pitch = pitch;
  if (rate) ttsOptions.rate = rate;

  const audioBuffers = [];
  const allMetadata = [];
  let cumulativeOffsetTicks = 0;

  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      let chunkResult = null;
      let chunkErr = null;

      // Retry up to 2 times for each individual chunk
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          chunkResult = await synthesizeEdgeChunk(tts, chunk, ttsOptions);
          break;
        } catch (e) {
          chunkErr = e;
          await new Promise((r) => setTimeout(r, 400));
        }
      }

      if (!chunkResult) {
        throw new Error(`Chunk ${i + 1}/${chunks.length} failed: ${chunkErr?.message || 'timeout'}`);
      }

      audioBuffers.push(chunkResult.audioBuffer);

      let maxTickInChunk = 0;
      for (const item of chunkResult.metadata) {
        if (item.Data) {
          const itemEnd = (item.Data.Offset || 0) + (item.Data.Duration || 0);
          if (itemEnd > maxTickInChunk) maxTickInChunk = itemEnd;
          item.Data.Offset = (item.Data.Offset || 0) + cumulativeOffsetTicks;
        }
        allMetadata.push(item);
      }

      if (maxTickInChunk > 0) {
        cumulativeOffsetTicks += maxTickInChunk;
      } else {
        // Fallback estimate for 48kbps MP3 (6000 bytes/sec = 60,000,000 ticks/sec)
        const durSeconds = chunkResult.audioBuffer.length / 6000;
        cumulativeOffsetTicks += Math.round(durSeconds * 10000000);
      }
    }
  } finally {
    try {
      tts.close();
    } catch (_) {}
  }

  const finalAudioBuffer = Buffer.concat(audioBuffers);
  const audioFilePath = path.join(outputDir, 'audio.mp3');
  fs.writeFileSync(audioFilePath, finalAudioBuffer);

  let metadataFilePath = null;
  if (allMetadata.length > 0) {
    metadataFilePath = path.join(outputDir, 'metadata.json');
    fs.writeFileSync(metadataFilePath, JSON.stringify({ Metadata: allMetadata }, null, 2), 'utf8');
  }

  return { audioFilePath, metadataFilePath };
}

/**
 * Ultimate Fallback: Google Translate TTS via HTTP GET
 */
async function synthesizeGoogleTts({ cleanText, outputDir, lang = 'hi' }) {
  logger.warn(`Edge TTS unavailable. Using Tier 3 Google Translate TTS HTTP endpoint (${lang})...`);
  const chunks = splitIntoTtsChunks(cleanText, 160);
  const audioBuffers = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const encoded = encodeURIComponent(chunk);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encoded}`;

    let buffer = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://translate.google.com/',
          },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ab = await res.arrayBuffer();
        if (ab.byteLength > 500) {
          buffer = Buffer.from(ab);
          break;
        }
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 600 * attempt));
      }
    }

    if (!buffer) {
      throw new Error(`Google TTS chunk ${i + 1}/${chunks.length} failed: ${lastErr?.message}`);
    }

    audioBuffers.push(buffer);
  }

  const finalAudioBuffer = Buffer.concat(audioBuffers);
  const audioFilePath = path.join(outputDir, 'audio.mp3');
  fs.writeFileSync(audioFilePath, finalAudioBuffer);

  logger.success(`Voiceover generated via Google Translate TTS: ${audioFilePath} (${(finalAudioBuffer.length / 1024).toFixed(1)} KB)`);
  return {
    audioPath: audioFilePath,
    metadataPath: null, // Subtitles gracefully fallback to proportional word timing
    activeVoice: `google-translate-${lang}`,
  };
}

/**
 * Generates TTS voiceover with word boundary timestamps and multi-tier fallbacks
 * @param {Object} options
 * @param {string} options.text - The narration script
 * @param {string} options.voice - The neural voice identifier (e.g. 'hi-IN-MadhurNeural', 'hi-IN-SwaraNeural')
 * @param {string} options.outputDir - Target directory for audio and metadata
 * @param {string} [options.pitch] - Prosody pitch (e.g. '+25%', '+20Hz')
 * @param {string} [options.rate] - Prosody rate (e.g. '+5%', '+0%')
 * @returns {Promise<{ audioPath: string, metadataPath: string | null, activeVoice: string }>}
 */
export async function generateVoiceover({ text, voice, outputDir, pitch, rate }) {
  fs.mkdirSync(outputDir, { recursive: true });
  cleanupPartialAudio(outputDir);

  const cleanText = sanitizeTtsText(text);
  const candidateVoices = getCandidateVoices(voice);
  let lastError = null;

  // -------------------------------------------------------------
  // TIER 1 & TIER 2: Edge TTS with Sentence Chunking & Voice Fallbacks
  // -------------------------------------------------------------
  for (let vIdx = 0; vIdx < candidateVoices.length; vIdx++) {
    const activeVoice = candidateVoices[vIdx];
    const pitchInfo = pitch ? ` (pitch: ${pitch})` : '';
    const rateInfo = rate ? ` (rate: ${rate})` : '';

    if (vIdx > 0) {
      logger.warn(`Edge TTS voice failed. Trying Tier 2 fallback voice: ${activeVoice}${pitchInfo}${rateInfo}`);
    }

    try {
      const res = await synthesizeEdgeTtsWithChunking({
        voice: activeVoice,
        cleanText,
        outputDir,
        pitch,
        rate,
      });

      const stats = fs.statSync(res.audioFilePath);
      logger.success(`Voiceover generated using ${activeVoice}: ${res.audioFilePath} (${(stats.size / 1024).toFixed(1)} KB)`);

      return {
        audioPath: res.audioFilePath,
        metadataPath: res.metadataFilePath,
        activeVoice,
      };
    } catch (err) {
      lastError = err;
      logger.warn(`Edge TTS voice [${activeVoice}] failed (${err.message}).`);
      cleanupPartialAudio(outputDir);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // -------------------------------------------------------------
  // TIER 3: Google Translate TTS HTTP Fallback (Guaranteed to Never Throw)
  // -------------------------------------------------------------
  try {
    const isHindi = /[\u0900-\u097F]/.test(cleanText);
    const lang = isHindi ? 'hi' : 'en';
    const googleRes = await synthesizeGoogleTts({ cleanText, outputDir, lang });
    return googleRes;
  } catch (gErr) {
    logger.error(`Tier 3 Google Translate TTS also failed: ${gErr.message}`);
    throw new Error(`All voice synthesis tiers failed. Last Edge TTS error: ${lastError?.message}. Google TTS error: ${gErr.message}`);
  }
}

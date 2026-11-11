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
 * Resolves an ordered list of candidate voices including fallbacks
 * @param {string} primaryVoice
 * @returns {string[]}
 */
function getCandidateVoices(primaryVoice) {
  const voices = [primaryVoice];
  if (primaryVoice === 'hi-IN-MadhurNeural') {
    voices.push('hi-IN-SwaraNeural');
  } else if (primaryVoice === 'hi-IN-SwaraNeural') {
    voices.push('hi-IN-MadhurNeural');
  } else if (primaryVoice.startsWith('hi-IN')) {
    voices.push('hi-IN-SwaraNeural');
  } else if (primaryVoice.startsWith('en-US')) {
    voices.push('en-US-GuyNeural');
  }
  return [...new Set(voices)];
}

/**
 * Generates TTS voiceover with word boundary timestamps
 * @param {Object} options
 * @param {string} options.text - The narration script
 * @param {string} options.voice - The neural voice identifier (e.g. 'en-US-ChristopherNeural', 'hi-IN-MadhurNeural', 'hi-IN-SwaraNeural')
 * @param {string} options.outputDir - Target directory for audio and metadata
 * @param {string} [options.pitch] - Prosody pitch (e.g. '+25%', '+20Hz')
 * @param {string} [options.rate] - Prosody rate (e.g. '+5%', '+0%')
 * @returns {Promise<{ audioPath: string, metadataPath: string | null, activeVoice: string }>}
 */
export async function generateVoiceover({ text, voice, outputDir, pitch, rate }) {
  fs.mkdirSync(outputDir, { recursive: true });

  const cleanText = text
    .replace(/[#*`_~]/g, '') // remove markdown
    .replace(/\s+/g, ' ')
    .trim();

  const candidateVoices = getCandidateVoices(voice);
  const maxRetriesPerVoice = 3;
  let lastError = null;

  for (let vIdx = 0; vIdx < candidateVoices.length; vIdx++) {
    const activeVoice = candidateVoices[vIdx];
    const pitchInfo = pitch ? ` (pitch: ${pitch})` : '';
    const rateInfo = rate ? ` (rate: ${rate})` : '';

    if (vIdx > 0) {
      logger.warn(`Primary voice failed. Switching to fallback voice: ${activeVoice}${pitchInfo}${rateInfo}`);
    } else {
      logger.info(`Synthesizing voiceover (${cleanText.length} chars) using voice: ${activeVoice}${pitchInfo}${rateInfo}`);
    }

    for (let attempt = 1; attempt <= maxRetriesPerVoice; attempt++) {
      let tts = null;
      try {
        cleanupPartialAudio(outputDir);
        tts = new MsEdgeTTS();

        await tts.setMetadata(activeVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
          wordBoundaryEnabled: true,
          sentenceBoundaryEnabled: true,
        });

        const ttsOptions = {};
        if (pitch) ttsOptions.pitch = pitch;
        if (rate) ttsOptions.rate = rate;

        const res = await tts.toFile(outputDir, cleanText, ttsOptions);

        if (!fs.existsSync(res.audioFilePath)) {
          throw new Error(`TTS audio file not created at ${res.audioFilePath}`);
        }

        const stats = fs.statSync(res.audioFilePath);
        if (stats.size < 1000) {
          throw new Error(`TTS audio file too small (${stats.size} bytes), likely truncated.`);
        }

        logger.success(`Voiceover generated using ${activeVoice}: ${res.audioFilePath} (${(stats.size / 1024).toFixed(1)} KB)`);
        return {
          audioPath: res.audioFilePath,
          metadataPath: res.metadataFilePath,
          activeVoice,
        };
      } catch (err) {
        lastError = err;
        cleanupPartialAudio(outputDir);

        // Ensure socket is completely closed before next attempt
        if (tts) {
          try {
            tts.close();
          } catch (closeErr) {}
          tts = null;
        }

        // Small pause to allow OS and sockets to finish closing
        await new Promise((r) => setTimeout(r, 200));

        if (attempt < maxRetriesPerVoice) {
          // Exponential backoff: 2s (attempt 1), 4s (attempt 2), 8s
          const backoffMs = 2000 * Math.pow(2, attempt - 1);
          logger.warn(
            `TTS [${activeVoice}] attempt ${attempt}/${maxRetriesPerVoice} failed (${err.message}). Retrying in ${backoffMs / 1000}s with exponential backoff...`
          );
          await new Promise((r) => setTimeout(r, backoffMs));
        } else {
          logger.warn(
            `TTS [${activeVoice}] exhausted all ${maxRetriesPerVoice} attempts (${err.message}).`
          );
        }
      } finally {
        if (tts) {
          try {
            tts.close();
          } catch (e) {}
          tts = null;
        }
      }
    }
  }

  throw new Error(`All voice synthesis attempts failed. Last error: ${lastError?.message || 'Unknown error'}`);
}

import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

/**
 * Generates TTS voiceover with word boundary timestamps
 * @param {Object} options
 * @param {string} options.text - The narration script
 * @param {string} options.voice - The neural voice identifier (e.g. 'en-US-ChristopherNeural', 'hi-IN-MadhurNeural', 'hi-IN-SwaraNeural')
 * @param {string} options.outputDir - Target directory for audio and metadata
 * @param {string} [options.pitch] - Prosody pitch (e.g. '+25%', '+20Hz')
 * @param {string} [options.rate] - Prosody rate (e.g. '+5%', '+0%')
 * @returns {Promise<{ audioPath: string, metadataPath: string | null }>}
 */
export async function generateVoiceover({ text, voice, outputDir, pitch, rate }) {
  fs.mkdirSync(outputDir, { recursive: true });

  const cleanText = text
    .replace(/[#*`_~]/g, '') // remove markdown
    .replace(/\s+/g, ' ')
    .trim();

  const pitchInfo = pitch ? ` (pitch: ${pitch})` : '';
  logger.info(`Synthesizing voiceover (${cleanText.length} chars) using voice: ${voice}${pitchInfo}`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
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

      logger.success(`Voiceover generated: ${res.audioFilePath}`);
      return {
        audioPath: res.audioFilePath,
        metadataPath: res.metadataFilePath,
      };
    } catch (err) {
      if (attempt === 3) throw err;
      logger.warn(`TTS attempt ${attempt} failed (${err.message}). Retrying in 2s...`);
      await new Promise((r) => setTimeout(r, 2000));
    } finally {
      try {
        tts.close();
      } catch (e) {}
    }
  }
}

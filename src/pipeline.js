import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { ensureAudioBeds } from './utils/audio_beds.js';
import { generateSlot1Content } from './content/slot1_entertainment.js';
import { generateSlot2Content } from './content/slot2_devotional.js';
import { generateSlot3Content } from './content/slot3_news.js';
import { generateSlot4Content } from './content/slot4_scriptures.js';
import { generateVoiceover } from './generator/tts.js';
import { generateAssSubtitles } from './generator/subtitles.js';
import { generateVisualBackground } from './generator/visual_synth.js';
import { buildShortVideo, getMediaDuration } from './generator/video_builder.js';
import { uploadShort } from './youtube/uploader.js';

/**
 * Generates the complete 1080x1920 Short video without uploading
 * @param {string} slot - 'slot1' | 'slot2' | 'slot3'
 * @param {string} [customTopic] - Optional user override
 * @returns {Promise<Object>} Generated video details and metadata
 */
export async function generateShortVideo(slot, customTopic = null) {
  // Ensure background audio beds exist
  await ensureAudioBeds();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slotDir = path.join(config.outputDir, `${timestamp}_${slot}`);
  fs.mkdirSync(slotDir, { recursive: true });

  logger.info(`=== Starting Media Pipeline for [${slot.toUpperCase()}] ===`);

  // 1. Generate Slot Content
  let content;
  if (slot === 'slot1') {
    content = await generateSlot1Content(customTopic);
  } else if (slot === 'slot2') {
    content = await generateSlot2Content(customTopic);
  } else if (slot === 'slot3') {
    content = await generateSlot3Content(customTopic);
  } else if (slot === 'slot4') {
    content = await generateSlot4Content(customTopic);
  } else {
    throw new Error(`Unknown slot identifier: ${slot}. Use 'slot1', 'slot2', 'slot3', or 'slot4'.`);
  }

  logger.slot(slot, `Title: "${content.title}"`);

  // 2. Synthesize Voiceover (TTS)
  const voiceoverResult = await generateVoiceover({
    text: content.voiceScript,
    voice: content.voice,
    outputDir: slotDir,
    pitch: content.pitch,
    rate: content.rate,
  });

  const audioDuration = await getMediaDuration(voiceoverResult.audioPath);
  logger.info(`Voiceover duration: ${audioDuration.toFixed(1)} seconds`);

  // Handle Slot 4 Dual-Audio Logic (Original Serial Dialogue + AI Commentary)
  const isDualAudio = Boolean(content.isDualAudio);
  const introDuration = isDualAudio ? (content.introDuration || 7.0) : 0;

  // 3. Generate Styled Bold English Subtitles (Burned-in for global reach)
  const subtitlesPath = path.join(slotDir, 'subtitles.ass');
  generateAssSubtitles({
    metadataPath: voiceoverResult.metadataPath,
    outputPath: subtitlesPath,
    slotType: slot,
    englishText: content.englishSubtitles,
    segments: content.segments,
    fallbackText: content.englishSubtitles || content.voiceScript,
    audioDuration,
    timeOffsetMs: Math.round(introDuration * 1000),
    shlokIntroText: content.shlokSanskrit || '',
  });

  // 4. Generate 1080x1920 Visual Background (with blur margins for clips)
  const totalVisualDuration = introDuration + audioDuration + 0.8;
  const visualBgPath = path.join(slotDir, 'visual_bg.mp4');
  await generateVisualBackground({
    slotType: slot,
    duration: totalVisualDuration,
    outputPath: visualBgPath,
    title: content.title,
    headline: content.headline || content.title,
    clipPath: content.clipPath,
    epicBadge: content.epicBadge,
    themeType: content.themeType,
    visualQuery: content.visualQuery,
    altQueries: content.altQueries,
    customTopic,
  });

  // 5. Final Video Compilation (Clean Dual-Audio mix + subtitles burn)
  const finalVideoPath = path.join(slotDir, 'short_final.mp4');
  await buildShortVideo({
    visualVideoPath: visualBgPath,
    voiceoverPath: voiceoverResult.audioPath,
    backgroundMusicPath: content.bgMusicPath,
    clipAudioPath: content.clipPath,
    subtitlesPath,
    outputPath: finalVideoPath,
    isDualAudio,
    introDuration,
  });

  return {
    slot,
    slotName: content.slotName,
    title: content.title,
    description: content.description,
    tags: content.tags,
    categoryId: content.categoryId,
    videoPath: finalVideoPath,
    duration: audioDuration,
    slotDir,
  };
}

/**
 * Generates and immediately uploads a Short to YouTube
 * @param {string} slot - 'slot1' | 'slot2' | 'slot3'
 * @param {string} [customTopic] - Optional topic
 * @param {string} [privacyStatus] - Optional privacy override
 */
export async function publishShort(slot, customTopic = null, privacyStatus = null) {
  const generated = await generateShortVideo(slot, customTopic);

  logger.info(`Uploading Short to YouTube...`);
  const uploadResult = await uploadShort({
    videoPath: generated.videoPath,
    title: generated.title,
    description: generated.description,
    tags: generated.tags,
    categoryId: generated.categoryId,
    privacyStatus: privacyStatus || config.youtube.privacyStatus,
  });

  return {
    ...generated,
    upload: uploadResult,
  };
}

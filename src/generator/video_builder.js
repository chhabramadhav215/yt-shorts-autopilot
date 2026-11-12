import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { createRequire } from 'module';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

const require = createRequire(import.meta.url);

const ffmpegPath = process.env.FFMPEG_PATH || (function() {
  try {
    const { execSync } = require('child_process');
    const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
  } catch(e) {
    return ffmpegStatic;
  }
})();

const ffprobePath = process.env.FFPROBE_PATH || (function() {
  try {
    const { execSync } = require('child_process');
    const cmd = process.platform === 'win32' ? 'where ffprobe' : 'which ffprobe';
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
  } catch(e) {
    return ffprobeStatic.path;
  }
})();

/**
 * Gets exact duration in seconds of an audio or video file
 */
export function getMediaDuration(filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobePath,
      [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      (err, stdout) => {
        if (err) return reject(err);
        const duration = parseFloat(stdout.trim());
        resolve(isNaN(duration) ? 10 : duration);
      }
    );
  });
}

/**
 * Checks if a media file has an audio stream
 */
export function hasAudioStream(filePath) {
  return new Promise((resolve) => {
    if (!filePath || !fs.existsSync(filePath)) return resolve(false);
    execFile(
      ffprobePath,
      [
        '-v', 'error',
        '-select_streams', 'a',
        '-show_entries', 'stream=codec_type',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      (err, stdout) => {
        if (err) return resolve(false);
        resolve(stdout.trim().includes('audio'));
      }
    );
  });
}

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, (err, stdout, stderr) => {
      if (err) {
        logger.error('FFmpeg builder error:', stderr || err.message);
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Compiles final 1080x1920 YouTube Short MP4
 * @param {Object} options
 * @param {string} options.visualVideoPath - 1080x1920 visual track
 * @param {string} options.voiceoverPath - TTS MP3 audio (Hindi commentary)
 * @param {string} [options.backgroundMusicPath] - Background music fallback MP3
 * @param {string} [options.clipAudioPath] - Original serial video clip containing authentic audio
 * @param {string} [options.subtitlesPath] - ASS subtitle file
 * @param {string} options.outputPath - Destination MP4
 * @param {boolean} [options.isDualAudio] - Whether to use dual-audio ducking logic
 * @param {number} [options.introDuration] - Duration in seconds for intro original dialogue (e.g. 7.0s)
 */
export async function buildShortVideo({
  visualVideoPath,
  voiceoverPath,
  backgroundMusicPath,
  clipAudioPath,
  sfxAudioPath,
  subtitlesPath,
  outputPath,
  isDualAudio = false,
  introDuration = 0,
}) {
  const vceDuration = await getMediaDuration(voiceoverPath);
  const totalDuration = isDualAudio && introDuration > 0
    ? introDuration + vceDuration + 0.8
    : vceDuration + 0.8;

  logger.info(`Building final YouTube Short (${totalDuration.toFixed(1)}s, DualAudio: ${isDualAudio})...`);

  // Prepare subtitle filter path for Windows/Linux FFmpeg
  let subtitleFilter = '';
  if (subtitlesPath && fs.existsSync(subtitlesPath)) {
    const escapedSubPath = subtitlesPath
      .replace(/\\/g, '/')
      .replace(/:/g, '\\:')
      .replace(/'/g, "'\\\\''");
    subtitleFilter = `subtitles='${escapedSubPath}'`;
  }

  const args = [
    '-y',
    '-stream_loop', '-1', '-i', visualVideoPath,     // [0] Visual background looped
    '-i', voiceoverPath,                              // [1] AI Voiceover track (Hindi commentary)
  ];

  // Check if original video clip has audio for Dual-Audio
  let originalAudioSource = null;
  if (isDualAudio && clipAudioPath && fs.existsSync(clipAudioPath)) {
    const clipHasAudio = await hasAudioStream(clipAudioPath);
    if (clipHasAudio) {
      originalAudioSource = clipAudioPath;
      logger.info(`Using original serial clip audio for dual-audio: ${path.basename(clipAudioPath)}`);
    } else {
      logger.warn(`Clip ${path.basename(clipAudioPath)} has no audio stream, falling back to background music.`);
    }
  }

  // Fallback to background music track if no clip audio
  if (!originalAudioSource && backgroundMusicPath && fs.existsSync(backgroundMusicPath)) {
    originalAudioSource = backgroundMusicPath;
  }

  let hasAudioTrack2 = false;
  if (originalAudioSource) {
    args.push('-stream_loop', '-1', '-i', originalAudioSource); // [2] Original serial audio or BGM
    hasAudioTrack2 = true;
  }

  let hasSfx = false;
  if (sfxAudioPath && fs.existsSync(sfxAudioPath)) {
    args.push('-i', sfxAudioPath); // [3] Transition whoosh SFX
    hasSfx = true;
  }

  // Build audio filter complex with strict format matching before amix
  let filterComplex = '';
  const fadeOutStart = Math.max(0, totalDuration - 0.6);
  const safeAudioFmt = 'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo';

  if (isDualAudio && hasAudioTrack2) {
    const delayMs = Math.round(introDuration * 1000);
    const duckingFilter = introDuration > 0
      ? `volume='if(lt(t,${introDuration}), 1.0, 0.15)':eval=frame`
      : `volume=0.20`;

    filterComplex += `[2:a]aresample=44100,${safeAudioFmt},${duckingFilter},atrim=0:${totalDuration},afade=t=out:st=${fadeOutStart}:d=0.6,${safeAudioFmt}[clip_ducked];`;
    filterComplex += delayMs > 0
      ? `[1:a]aresample=44100,${safeAudioFmt},adelay=${delayMs}|${delayMs},volume=1.0,${safeAudioFmt}[vce];`
      : `[1:a]aresample=44100,${safeAudioFmt},volume=1.0,${safeAudioFmt}[vce];`;
    filterComplex += `[clip_ducked][vce]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout];`;
  } else if (hasAudioTrack2 && hasSfx) {
    // Mix Voiceover + BGM + SFX impact
    const sfxIdx = 3;
    filterComplex += `[1:a]aresample=44100,${safeAudioFmt},volume=1.0,${safeAudioFmt}[vce];`;
    filterComplex += `[2:a]aresample=44100,${safeAudioFmt},volume=0.18,atrim=0:${totalDuration},afade=t=out:st=${fadeOutStart}:d=0.6,${safeAudioFmt}[bgm];`;
    filterComplex += `[${sfxIdx}:a]aresample=44100,${safeAudioFmt},adelay=150|150,volume=0.25,${safeAudioFmt}[sfx];`;
    filterComplex += `[vce][bgm][sfx]amix=inputs=3:duration=first:dropout_transition=2:normalize=0[aout];`;
  } else if (hasAudioTrack2) {
    // Normal BGM mix for Slots 1, 2, 3, 5
    filterComplex += `[1:a]aresample=44100,${safeAudioFmt},volume=1.0,${safeAudioFmt}[vce];`;
    filterComplex += `[2:a]aresample=44100,${safeAudioFmt},volume=0.15,atrim=0:${totalDuration},afade=t=out:st=${fadeOutStart}:d=0.6,${safeAudioFmt}[bgm];`;
    filterComplex += `[vce][bgm]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout];`;
  } else {
    filterComplex += `[1:a]aresample=44100,${safeAudioFmt},volume=1.0[aout];`;
  }

  // Build video filter
  if (subtitleFilter) {
    filterComplex += `[0:v]scale=1080:1920,${subtitleFilter}[vout]`;
  } else {
    filterComplex += `[0:v]scale=1080:1920[vout]`;
  }

  args.push(
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-map', '[aout]',
    '-t', String(totalDuration),
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    outputPath
  );

  await runFFmpeg(args);

  const fileSize = fs.statSync(outputPath).size;
  logger.success(`YouTube Short rendered successfully: ${outputPath} (${(fileSize / (1024 * 1024)).toFixed(2)} MB)`);

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
    logger.info(`Generated high-contrast cover thumbnail at 0.1s: ${path.basename(coverPath)}`);
  } catch (e) {
    // Non-critical cover generation
  }

  return {
    videoPath: outputPath,
    duration: totalDuration,
    fileSize,
    coverPath: fs.existsSync(coverPath) ? coverPath : null,
  };
}

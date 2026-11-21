import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { logger } from './utils/logger.js';
import { config } from './config.js';
import { uploadShort, isUploadLimitExceeded } from './youtube/uploader.js';

// Meta Graph API v21.0 configuration
const META_GRAPH_VERSION = 'v21.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

const FFMPEG_BIN = process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';
const FFPROBE_BIN = process.env.FFPROBE_PATH || ffprobeStatic.path || 'ffprobe';

/**
 * Utility delay function for polling
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes FFmpeg command with promise wrapper
 */
function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG_BIN, args, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`FFmpeg failed: ${stderr || err.message}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Probes audio duration accurately in seconds
 */
function probeAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ];
    execFile(FFPROBE_BIN, args, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`ffprobe failed: ${stderr || err.message}`));
      } else {
        const dur = parseFloat((stdout || '').trim());
        if (isNaN(dur) || dur <= 0) {
          reject(new Error(`Invalid duration returned by ffprobe: "${stdout}"`));
        } else {
          resolve(dur);
        }
      }
    });
  });
}

/**
 * Finds yt-dlp executable on PATH or local assets
 */
function findYtDlpBinary() {
  if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
    return process.env.YTDLP_PATH;
  }
  const localBin = path.join(
    process.cwd(),
    'assets',
    'bin',
    process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
  );
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

/**
 * Formats full diagnostic Meta error payload
 */
function formatMetaErrorPayload(data, status = 0) {
  const err = data?.error || (typeof data === 'object' ? data : {});
  const code = err.code !== undefined ? err.code : 'none';
  const subcode = err.error_subcode !== undefined ? err.error_subcode : 'none';
  const type = err.type || 'none';
  const msg = err.message || (typeof data === 'string' ? data : JSON.stringify(data));
  const fbtrace = err.fbtrace_id || 'none';
  return `HTTP ${status} | Code: ${code} | Subcode: ${subcode} | Type: ${type} | Message: ${msg} | fbtrace_id: ${fbtrace}`;
}

/**
 * Uploads video binary payload to Meta CDN (rupload.facebook.com) with retry loop
 */
async function uploadVideoBinary({ uploadUri, videoPath, accessToken, platform = 'Meta Reels', maxRetries = 3 }) {
  const fileStats = fs.statSync(videoPath);
  const fileSize = fileStats.size;

  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`[${platform}] Uploading video binary (attempt ${attempt}/${maxRetries}, ${(fileSize / 1024 / 1024).toFixed(2)} MB)...`);

      const headers = {
        Authorization: `OAuth ${accessToken}`,
        offset: '0',
        file_size: String(fileSize),
        'Content-Type': 'application/octet-stream',
      };

      const videoBuffer = fs.readFileSync(videoPath);
      const uploadRes = await fetch(uploadUri, {
        method: 'POST',
        headers,
        body: videoBuffer,
      });

      let uploadData = {};
      const responseText = await uploadRes.text();
      try {
        uploadData = JSON.parse(responseText);
      } catch (e) {
        uploadData = { raw: responseText };
      }

      const isSuccess = uploadRes.ok && uploadData.success !== false && !uploadData.error;
      if (isSuccess) {
        logger.success(`[${platform}] Video binary uploaded successfully on attempt ${attempt}.`);
        return uploadData;
      }

      const formattedErr = formatMetaErrorPayload(uploadData, uploadRes.status);
      logger.warn(`[${platform}] Binary upload attempt ${attempt} failed: ${formattedErr}`);
      lastError = new Error(`Binary upload failed: ${formattedErr}`);

      if (attempt < maxRetries) {
        await sleep(3000 * attempt);
      }
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(3000 * attempt);
      }
    }
  }

  throw lastError || new Error(`[${platform}] Binary upload failed after ${maxRetries} attempts.`);
}

/**
 * Resolves Facebook Page Access Token from Page node or /me/accounts
 */
async function resolveFacebookPageAccessToken(fbPageId, userAccessToken) {
  if (!fbPageId || !userAccessToken) {
    return { pageAccessToken: null, pageName: null, warning: 'Missing Facebook Page ID or Access Token' };
  }

  // 1. Try querying GET /{page_id}?fields=access_token,name
  try {
    const directUrl = `${GRAPH_API_BASE}/${fbPageId}?fields=access_token,name&access_token=${encodeURIComponent(userAccessToken)}`;
    const directRes = await fetch(directUrl);
    const directData = await directRes.json();
    if (directRes.ok && directData.access_token) {
      return {
        pageAccessToken: directData.access_token,
        pageName: directData.name || null,
        warning: null,
      };
    }
  } catch (_) {}

  // 2. Try querying GET /me/accounts?fields=id,name,access_token
  try {
    const accountsUrl = `${GRAPH_API_BASE}/me/accounts?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(userAccessToken)}`;
    const accountsRes = await fetch(accountsUrl);
    const accountsData = await accountsRes.json();
    if (accountsRes.ok && Array.isArray(accountsData.data)) {
      const match = accountsData.data.find((p) => String(p.id) === String(fbPageId));
      if (match && match.access_token) {
        return {
          pageAccessToken: match.access_token,
          pageName: match.name || null,
          warning: null,
        };
      }
    }
  } catch (_) {}

  return {
    pageAccessToken: userAccessToken,
    pageName: null,
    warning: 'Using direct configured token for Page upload.',
  };
}

/**
 * Publishes video to Facebook Page via fallback standard video endpoint
 */
async function uploadFacebookVideoFallback({ fbPageId, accessToken, videoPath, title, caption, pageName = null }) {
  logger.info(`[Facebook Fallback] Attempting direct Page video upload on ${pageName || fbPageId} via v21.0...`);
  const endpoint = `https://graph-video.facebook.com/${META_GRAPH_VERSION}/${fbPageId}/videos`;

  const videoBuffer = fs.readFileSync(videoPath);
  const formData = new FormData();
  formData.append('source', new Blob([videoBuffer], { type: 'video/mp4' }), path.basename(videoPath));
  formData.append('title', (title || '').slice(0, 100));
  formData.append('description', caption || '');
  formData.append('published', 'true');
  formData.append('access_token', accessToken);

  const res = await fetch(endpoint, {
    method: 'POST',
    body: formData,
  });

  const data = await res.json();
  if (!res.ok || !data.id) {
    const formattedErr = formatMetaErrorPayload(data, res.status);
    throw new Error(`Facebook direct video upload failed: ${formattedErr}`);
  }

  const permalink = `https://www.facebook.com/watch/?v=${data.id}`;
  logger.success(`[Facebook Fallback] Published successfully! Link: ${permalink}`);
  return { id: data.id, permalink, isFallback: true };
}

/**
 * Publishes video to Facebook Page Reels via Meta Graph API v21.0
 */
async function publishToFacebookReels({ fbPageId, accessToken, videoPath, title, caption }) {
  logger.info(`[Facebook Reels v21.0] Starting Reel upload on Page ${fbPageId}...`);

  const { pageAccessToken, pageName } = await resolveFacebookPageAccessToken(fbPageId, accessToken);
  const tokenToUse = pageAccessToken || accessToken;

  // Step 1: Start upload session via /{page-id}/video_reels
  const startEndpoint = `${GRAPH_API_BASE}/${fbPageId}/video_reels`;
  let startRes;
  try {
    startRes = await fetch(startEndpoint, {
      method: 'POST',
      body: new URLSearchParams({
        upload_phase: 'start',
        access_token: tokenToUse,
      }),
    });
  } catch (err) {
    logger.warn(`[Facebook Reels] Session start network error: ${err.message}. Trying fallback...`);
    return await uploadFacebookVideoFallback({ fbPageId, accessToken: tokenToUse, videoPath, title, caption, pageName });
  }

  const startData = await startRes.json();
  if (!startRes.ok || !startData.video_id || !startData.upload_url) {
    const formattedErr = formatMetaErrorPayload(startData, startRes.status);
    logger.warn(`[Facebook Reels] Session start failed: ${formattedErr}. Attempting fallback to Page videos...`);
    return await uploadFacebookVideoFallback({ fbPageId, accessToken: tokenToUse, videoPath, title, caption, pageName });
  }

  const videoId = startData.video_id;
  const uploadUrl = startData.upload_url;
  logger.success(`[Facebook Reels v21.0] Session started. Video ID: ${videoId}`);

  // Step 2: Upload video binary
  try {
    await uploadVideoBinary({
      uploadUri: uploadUrl,
      videoPath,
      accessToken: tokenToUse,
      platform: 'Facebook Reels v21.0',
      maxRetries: 3,
    });
  } catch (uploadErr) {
    logger.warn(`[Facebook Reels] Binary upload failed on video_reels: ${uploadErr.message}. Trying fallback...`);
    return await uploadFacebookVideoFallback({ fbPageId, accessToken: tokenToUse, videoPath, title, caption, pageName });
  }

  // Step 3: Finish and publish Reel
  logger.info(`[Facebook Reels v21.0] Publishing Reel ${videoId}...`);
  const finishRes = await fetch(startEndpoint, {
    method: 'POST',
    body: new URLSearchParams({
      upload_phase: 'finish',
      video_id: videoId,
      video_state: 'PUBLISHED',
      description: caption,
      title: (title || '').slice(0, 100),
      access_token: tokenToUse,
    }),
  });

  const finishData = await finishRes.json();
  if (!finishRes.ok || finishData.success === false) {
    const formattedErr = formatMetaErrorPayload(finishData, finishRes.status);
    logger.warn(`[Facebook Reels] Finish publish failed: ${formattedErr}. Attempting fallback...`);
    return await uploadFacebookVideoFallback({ fbPageId, accessToken: tokenToUse, videoPath, title, caption, pageName });
  }

  const permalink = `https://www.facebook.com/watch/?v=${videoId}`;
  logger.success(`[Facebook Reels v21.0] Published successfully! Link: ${permalink}`);
  return { id: videoId, permalink };
}

/**
 * Publishes video to Instagram Reels via Meta Graph API v21.0
 */
async function publishToInstagramReels({ igUserId, accessToken, videoPath, caption }) {
  logger.info(`[Instagram Reels v21.0] Initializing Reel container for Account ${igUserId}...`);

  // Step 1: Initialize container via /{ig-user-id}/media
  const initEndpoint = `${GRAPH_API_BASE}/${igUserId}/media`;
  const initRes = await fetch(initEndpoint, {
    method: 'POST',
    body: new URLSearchParams({
      media_type: 'REELS',
      upload_type: 'resumable',
      caption,
      share_to_feed: 'true',
      access_token: accessToken,
    }),
  });

  const initData = await initRes.json();
  if (!initRes.ok || !initData.id || !initData.uri) {
    const formattedErr = formatMetaErrorPayload(initData, initRes.status);
    throw new Error(`Instagram container initialization failed: ${formattedErr}`);
  }

  const containerId = initData.id;
  const uploadUri = initData.uri;
  logger.success(`[Instagram Reels v21.0] Container created: ${containerId}`);

  // Step 2: Upload video binary to uploadUri
  await uploadVideoBinary({
    uploadUri,
    videoPath,
    accessToken,
    platform: 'Instagram Reels v21.0',
    maxRetries: 3,
  });

  // Step 3: Poll container status until FINISHED
  logger.info(`[Instagram Reels v21.0] Waiting for video processing (container ${containerId})...`);
  const statusEndpoint = `${GRAPH_API_BASE}/${containerId}?fields=status_code,status&access_token=${accessToken}`;
  let isReady = false;
  const maxAttempts = 30; // 150 seconds

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(5000);
    const statusRes = await fetch(statusEndpoint);
    const statusData = await statusRes.json();
    const statusCode = statusData.status_code || '';

    logger.info(`[Instagram Reels v21.0] Processing status (attempt ${attempt}/${maxAttempts}): ${statusCode || 'CHECKING'}`);
    if (statusCode === 'FINISHED') {
      isReady = true;
      break;
    } else if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
      const formattedErr = formatMetaErrorPayload(statusData, statusRes.status);
      throw new Error(`Instagram container processing failed (${statusCode}): ${formattedErr}`);
    }
  }

  if (!isReady) {
    throw new Error(`Instagram container processing timed out after 150 seconds.`);
  }

  // Step 4: Publish container
  logger.info(`[Instagram Reels v21.0] Publishing container ${containerId}...`);
  const publishEndpoint = `${GRAPH_API_BASE}/${igUserId}/media_publish`;
  const pubRes = await fetch(publishEndpoint, {
    method: 'POST',
    body: new URLSearchParams({
      creation_id: containerId,
      access_token: accessToken,
    }),
  });

  const pubData = await pubRes.json();
  if (!pubRes.ok || !pubData.id) {
    const formattedErr = formatMetaErrorPayload(pubData, pubRes.status);
    throw new Error(`Instagram media publish failed: ${formattedErr}`);
  }

  const mediaId = pubData.id;
  logger.success(`[Instagram Reels v21.0] Published successfully! Media ID: ${mediaId}`);

  let permalink = `https://www.instagram.com/reel/`;
  try {
    const permalinkRes = await fetch(`${GRAPH_API_BASE}/${mediaId}?fields=permalink&access_token=${accessToken}`);
    const permalinkData = await permalinkRes.json();
    if (permalinkData.permalink) {
      permalink = permalinkData.permalink;
    }
  } catch (_) {}

  return { id: mediaId, permalink };
}

/**
 * Generates 4 glowing radial gradient orbs via sharp
 */
async function generateOrbs(workDir) {
  const createOrbSvg = (width, height, c1, c2, c3) => `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="g" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="${c1}" stop-opacity="0.95" />
          <stop offset="35%" stop-color="${c2}" stop-opacity="0.65" />
          <stop offset="70%" stop-color="${c3}" stop-opacity="0.22" />
          <stop offset="100%" stop-color="${c3}" stop-opacity="0" />
        </radialGradient>
      </defs>
      <circle cx="${width / 2}" cy="${height / 2}" r="${width / 2}" fill="url(#g)" />
    </svg>
  `;

  const orbSpecs = [
    { name: 'orb1.png', w: 850, h: 850, c1: '#8b5cf6', c2: '#6366f1', c3: '#312e81' }, // Deep Violet / Indigo
    { name: 'orb2.png', w: 850, h: 850, c1: '#06b6d4', c2: '#0284c7', c3: '#082f49' }, // Electric Cyan / Teal
    { name: 'orb3.png', w: 850, h: 850, c1: '#ec4899', c2: '#db2777', c3: '#4c0519' }, // Neon Hot Pink
    { name: 'orb4.png', w: 750, h: 750, c1: '#f59e0b', c2: '#ea580c', c3: '#451a03' }, // Sunset Amber / Coral
  ];

  const orbPaths = [];
  for (const spec of orbSpecs) {
    const orbPath = path.join(workDir, spec.name);
    const svgContent = createOrbSvg(spec.w, spec.h, spec.c1, spec.c2, spec.c3);
    await sharp(Buffer.from(svgContent)).png().toFile(orbPath);
    orbPaths.push(orbPath);
  }

  return orbPaths;
}

/**
 * Checks if a file contains an audio stream
 */
function hasAudioStream(filePath) {
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_type',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ];
    execFile(FFPROBE_BIN, args, (err, stdout) => {
      if (err || !stdout) resolve(false);
      else resolve(stdout.trim().toLowerCase().includes('audio'));
    });
  });
}

/**
 * Downloads audio and title from reel_url using yt-dlp and normalizes with ffmpeg
 */
async function extractAudioAndTitle(url, workDir) {
  const audioOutputPath = path.join(workDir, 'original_audio.aac');

  // Case 1: Local file input
  if (fs.existsSync(url)) {
    logger.info(`Extracting audio from local file: ${url}`);
    const hasAudio = await hasAudioStream(url);
    if (!hasAudio) {
      throw new Error(`The provided file "${url}" does not contain any audio stream. A valid voice or audio track is required.`);
    }

    await runFFmpeg([
      '-y',
      '-i', url,
      '-vn',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '44100',
      '-ac', '2',
      audioOutputPath,
    ]);
    const basenameTitle = path.basename(url, path.extname(url)).replace(/[_-]/g, ' ');
    return { audioPath: audioOutputPath, extractedTitle: basenameTitle };
  }

  // Case 2: Remote URL
  const ytdlpBin = findYtDlpBinary();
  logger.info(`Using yt-dlp binary: ${ytdlpBin}`);
  logger.info(`Fetching media and metadata from: ${url}`);

  // Fetch title
  let extractedTitle = '';
  try {
    extractedTitle = await new Promise((resolve) => {
      execFile(
        ytdlpBin,
        [
          '--no-warnings',
          '--no-playlist',
          '--print', 'title',
          '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          url,
        ],
        { timeout: 20000 },
        (err, stdout) => {
          if (err || !stdout) resolve('');
          else resolve((stdout || '').trim().split('\n')[0]);
        }
      );
    });
  } catch (_) {}

  // Download media
  const downloadTemplate = path.join(workDir, 'source_media.%(ext)s');
  logger.info('Downloading audio/video stream with yt-dlp...');
  await new Promise((resolve, reject) => {
    execFile(
      ytdlpBin,
      [
        '--no-playlist',
        '--no-warnings',
        '-f', 'ba/b',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '-o', downloadTemplate,
        url,
      ],
      { timeout: 120000 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`yt-dlp download failed: ${stderr || err.message}`));
        } else {
          resolve(stdout);
        }
      }
    );
  });

  // Find downloaded media file
  const files = fs.readdirSync(workDir);
  const downloadedFile = files.find((f) => f.startsWith('source_media.'));
  if (!downloadedFile) {
    throw new Error('yt-dlp completed but no source_media.* file was found in work_reel directory.');
  }

  const downloadedPath = path.join(workDir, downloadedFile);
  logger.info(`Normalizing audio stream from ${downloadedFile} via FFmpeg...`);

  await runFFmpeg([
    '-y',
    '-i', downloadedPath,
    '-vn',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '44100',
    '-ac', '2',
    audioOutputPath,
  ]);

  try {
    if (fs.existsSync(downloadedPath)) fs.unlinkSync(downloadedPath);
  } catch (_) {}

  return {
    audioPath: audioOutputPath,
    extractedTitle: extractedTitle || 'Viral Reel Audio Remastered',
  };
}

/**
 * Checks whether YouTube OAuth credentials are configured
 */
function isYouTubeConfigured() {
  const hasClient = !!(
    process.env.YOUTUBE_CLIENT_SECRET_JSON ||
    (process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET) ||
    fs.existsSync(config?.youtube?.clientSecretPath || '')
  );
  const hasToken = !!(
    process.env.YOUTUBE_TOKEN_JSON ||
    process.env.YOUTUBE_REFRESH_TOKEN ||
    fs.existsSync(config?.youtube?.tokenPath || '')
  );
  return hasClient && hasToken;
}

/**
 * Main execution flow
 */
async function main() {
  const reelUrl = (process.env.REEL_URL || process.argv[2] || '').trim();
  const customTitle = (process.env.CUSTOM_TITLE || process.argv[3] || '').trim();
  const privacyStatus = (process.env.PRIVACY_STATUS || process.env.UPLOAD_PRIVACY || process.argv[4] || 'public').trim().toLowerCase();

  console.log('\n=============================================================');
  console.log(' 🌌 REEL TO ANIMATED VERTICAL SHORT GENERATOR (1080x1920) ');
  console.log(` Target URL:     ${reelUrl || '(none)'}`);
  console.log(` Custom Title:   ${customTitle ? `"${customTitle}"` : '(auto-extract)'}`);
  console.log(` Privacy Status: [${privacyStatus.toUpperCase()}]`);
  console.log('=============================================================\n');

  if (!reelUrl) {
    logger.error('REEL_URL is required! Pass via REEL_URL environment variable or command-line argument.');
    process.exit(1);
  }

  const workDir = path.join(process.cwd(), 'work_reel');
  if (!fs.existsSync(workDir)) {
    fs.mkdirSync(workDir, { recursive: true });
  }

  const startTime = Date.now();

  // 1. Extract audio & title
  const { audioPath, extractedTitle } = await extractAudioAndTitle(reelUrl, workDir);
  const rawDuration = await probeAudioDuration(audioPath);
  const duration = Math.min(Math.max(rawDuration, 3), 60); // Clamp between 3s and 60s for YouTube Shorts / Reels
  const roundDur = Math.round(duration * 100) / 100;

  logger.success(`Extracted audio track: ${path.basename(audioPath)} (${roundDur}s duration)`);

  const displayTitle = customTitle || extractedTitle || 'Viral Reel Audio Remastered';
  logger.info(`Final Short Title: "${displayTitle}"`);

  // 2. Generate smooth glowing moving orbs
  logger.info('Generating high-resolution glowing orbs...');
  const [orb1, orb2, orb3, orb4] = await generateOrbs(workDir);

  // 3. Render 1080x1920 animated background with smooth moving orbs in FFmpeg
  const finalVideoPath = path.join(workDir, 'animated_final_1080x1920.mp4');
  logger.info(`Rendering 1080x1920 vertical animated background (${roundDur}s) with smooth moving orbs...`);

  const filterComplex = [
    `[0:v][1:v]overlay=x='(W-w)/2 + 280*sin(t*0.75)':y='(H-h)*0.32 + 320*cos(t*0.55)':eval=frame[v1]`,
    `[v1][2:v]overlay=x='(W-w)/2 - 320*cos(t*0.65)':y='(H-h)*0.68 + 280*sin(t*0.85)':eval=frame[v2]`,
    `[v2][3:v]overlay=x='(W-w)/2 + 300*sin(t*1.05+1.6)':y='(H-h)*0.48 + 360*cos(t*0.80+2.2)':eval=frame[v3]`,
    `[v3][4:v]overlay=x='(W-w)/2 - 260*sin(t*0.55+0.9)':y='(H-h)*0.82 + 240*sin(t*0.95+1.3)':eval=frame[vout]`,
  ].join(';');

  const ffmpegArgs = [
    '-y',
    '-f', 'lavfi', '-i', `color=c=0x070712:s=1080x1920:d=${roundDur}:r=30`,
    '-loop', '1', '-i', orb1,
    '-loop', '1', '-i', orb2,
    '-loop', '1', '-i', orb3,
    '-loop', '1', '-i', orb4,
    '-i', audioPath,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-map', '5:a',
    '-t', String(roundDur),
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    finalVideoPath,
  ];

  await runFFmpeg(ffmpegArgs);

  const videoStats = fs.statSync(finalVideoPath);
  logger.success(`Rendered animated final video: ${finalVideoPath} (${(videoStats.size / 1024 / 1024).toFixed(2)} MB)`);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // 4. Upload to YouTube Shorts via YouTube Data API v3 Resumable Upload
  let youtubeResult = null;
  if (isYouTubeConfigured()) {
    try {
      logger.info('=== Starting YouTube Shorts Upload (Resumable) ===');
      youtubeResult = await uploadShort({
        videoPath: finalVideoPath,
        title: displayTitle,
        description: `${displayTitle}\n\nOriginal audio remastered into vertical animated visuals.\n\n#Shorts #ViralShorts #ReelToAnimated #AudioReel`,
        tags: ['shorts', 'reels', 'animated', 'audio', 'viral'],
        privacyStatus: privacyStatus || 'public',
      });
    } catch (err) {
      if (isUploadLimitExceeded(err)) {
        logger.warn('⚠️ YouTube daily upload limit reached.');
        youtubeResult = { success: false, skipped: true, reason: 'Upload limit reached' };
      } else {
        logger.error(`YouTube Shorts upload failed: ${err.message}`);
        youtubeResult = { success: false, error: err.message };
      }
    }
  } else {
    logger.info('[YouTube] YouTube credentials not provided. Skipping YouTube Shorts upload.');
    youtubeResult = { success: false, skipped: true, reason: 'Credentials not configured' };
  }

  // 5. Publish to Meta Platforms (Facebook Page Reels & Instagram Reels via Meta Graph API v21.0)
  const metaAccessToken =
    process.env.META_ACCESS_TOKEN ||
    process.env.PAGE_ACCESS_TOKEN ||
    process.env.FACEBOOK_ACCESS_TOKEN;

  const igUserId =
    process.env.INSTAGRAM_ACCOUNT_ID ||
    process.env.IG_USER_ID;

  const fbPageId =
    process.env.FACEBOOK_PAGE_ID ||
    process.env.FB_PAGE_ID;

  const caption = `${displayTitle}\n\nOriginal audio remastered with vertical moving visuals.\n\n#reels #viral #animated #shorts #trending`;

  let igResult = null;
  let fbResult = null;

  if (metaAccessToken) {
    logger.info('=== Starting Meta Publishing via Graph API v21.0 ===');

    // Instagram Reels
    if (igUserId) {
      try {
        igResult = await publishToInstagramReels({
          igUserId,
          accessToken: metaAccessToken,
          videoPath: finalVideoPath,
          caption,
        });
      } catch (err) {
        logger.error(`Instagram Reels v21.0 publishing failed: ${err.message}`);
        igResult = { success: false, error: err.message };
      }
    } else {
      logger.info('[Instagram] INSTAGRAM_ACCOUNT_ID / IG_USER_ID not configured. Skipping Instagram Reels.');
      igResult = { success: false, skipped: true, reason: 'Account ID not configured' };
    }

    // Facebook Page Reels
    if (fbPageId) {
      try {
        fbResult = await publishToFacebookReels({
          fbPageId,
          accessToken: metaAccessToken,
          videoPath: finalVideoPath,
          title: displayTitle,
          caption,
        });
      } catch (err) {
        logger.error(`Facebook Page Reels v21.0 publishing failed: ${err.message}`);
        fbResult = { success: false, error: err.message };
      }
    } else {
      logger.info('[Facebook] FACEBOOK_PAGE_ID / FB_PAGE_ID not configured. Skipping Facebook Page Reels.');
      fbResult = { success: false, skipped: true, reason: 'Page ID not configured' };
    }
  } else {
    logger.info('[Meta] No Meta Access Token configured (META_ACCESS_TOKEN / PAGE_ACCESS_TOKEN). Skipping Meta publishing.');
    igResult = { success: false, skipped: true, reason: 'Meta token not configured' };
    fbResult = { success: false, skipped: true, reason: 'Meta token not configured' };
  }

  // Summary log
  console.log('\n-------------------------------------------------------------');
  console.log(`🎉 Reel-to-Animated processing complete in ${elapsed}s!`);
  console.log(`• Title:        "${displayTitle}"`);
  console.log(`• Duration:     ${roundDur}s`);
  console.log(`• Video Output: ${finalVideoPath} (${(videoStats.size / 1024 / 1024).toFixed(2)} MB)`);

  if (youtubeResult?.url) {
    console.log(`• YouTube:      ${youtubeResult.url}`);
  } else if (youtubeResult?.skipped) {
    console.log(`• YouTube:      SKIPPED -> ${youtubeResult.reason}`);
  } else if (youtubeResult?.error) {
    console.log(`• YouTube:      FAILED -> ${youtubeResult.error}`);
  }

  if (igResult?.permalink) {
    console.log(`• Instagram:    ${igResult.permalink}`);
  } else if (igResult?.skipped) {
    console.log(`• Instagram:    SKIPPED -> ${igResult.reason}`);
  } else if (igResult?.error) {
    console.log(`• Instagram:    FAILED -> ${igResult.error}`);
  }

  if (fbResult?.permalink) {
    console.log(`• Facebook:     ${fbResult.permalink}`);
  } else if (fbResult?.skipped) {
    console.log(`• Facebook:     SKIPPED -> ${fbResult.reason}`);
  } else if (fbResult?.error) {
    console.log(`• Facebook:     FAILED -> ${fbResult.error}`);
  }
  console.log('-------------------------------------------------------------\n');

  // Optional: Send Telegram notification
  if (process.env.TELEGRAM_BOT_TOKEN && (process.env.TELEGRAM_ALLOWED_USER_ID || process.env.TELEGRAM_CHAT_ID)) {
    try {
      const chatId = process.env.TELEGRAM_ALLOWED_USER_ID || process.env.TELEGRAM_CHAT_ID;
      let text = `🎬 *Reel to Animated Short Processed*\n\n` +
        `*Title:* ${displayTitle}\n` +
        `*Duration:* ${roundDur}s\n`;
      if (youtubeResult?.url) text += `*YouTube:* ${youtubeResult.url}\n`;
      if (igResult?.permalink) text += `*Instagram:* ${igResult.permalink}\n`;
      if (fbResult?.permalink) text += `*Facebook:* ${fbResult.permalink}\n`;
      text += `*Time:* ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`;

      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
      });
      logger.success('Sent Telegram notification.');
    } catch (_) {}
  }
}

main().catch((err) => {
  logger.error('Reel to animated conversion failed:', err);
  process.exit(1);
});

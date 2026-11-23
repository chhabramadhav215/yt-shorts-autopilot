import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
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
 * Probes video duration accurately in seconds
 */
function probeVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ];
    execFile(FFPROBE_BIN, args, (err, stdout) => {
      if (err) {
        reject(new Error(`ffprobe failed: ${err.message}`));
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
 * Probes video dimensions (width and height)
 */
function probeVideoDimensions(videoPath) {
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=s=x:p=0',
      videoPath,
    ];
    execFile(FFPROBE_BIN, args, (err, stdout) => {
      if (err || !stdout) {
        resolve({ width: 1080, height: 1920 });
      } else {
        const [w, h] = stdout.trim().split('x').map((n) => parseInt(n, 10));
        resolve({ width: w || 1080, height: h || 1920 });
      }
    });
  });
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
 * Creates a brand-new media container inside each retry attempt to prevent
 * "The ig container is not in the status to upload a video" errors.
 */
async function publishToInstagramReels({ igUserId, accessToken, videoPath, caption }) {
  const maxContainerAttempts = 3;
  let lastError = null;

  for (let containerAttempt = 1; containerAttempt <= maxContainerAttempts; containerAttempt++) {
    try {
      logger.info(
        `[Instagram Reels v21.0] Initializing Reel container (attempt ${containerAttempt}/${maxContainerAttempts}) for Account ${igUserId}...`
      );

      // Step 1: Initialize brand-new container via /{ig-user-id}/media
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

      // Step 2: Wait 3 seconds so Meta's CDN session is fully initialized
      logger.info('[Instagram Reels v21.0] Waiting 3 seconds for Meta CDN upload session initialization...');
      await new Promise((r) => setTimeout(r, 3000));

      // Step 3: Upload video binary to uploadUri (single attempt per container so failed container is never reused)
      await uploadVideoBinary({
        uploadUri,
        videoPath,
        accessToken,
        platform: 'Instagram Reels v21.0',
        maxRetries: 1,
      });

      // Step 4: Poll container status until FINISHED
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

      // Step 5: Publish container
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
    } catch (err) {
      lastError = err;
      logger.warn(
        `[Instagram Reels v21.0] Container attempt ${containerAttempt}/${maxContainerAttempts} failed: ${err.message}`
      );
      if (containerAttempt < maxContainerAttempts) {
        const backoffMs = containerAttempt * 3000;
        logger.info(`[Instagram Reels v21.0] Retrying with brand-new container in ${backoffMs / 1000}s...`);
        await sleep(backoffMs);
      }
    }
  }

  throw lastError || new Error(`Instagram Reels publishing failed after ${maxContainerAttempts} container attempts.`);
}

/**
 * Downloads or prepares the source video with audio into work_reel/source_video.mp4
 * Also extracts video title if not provided.
 */
async function downloadSourceVideoAndTitle(url, workDir) {
  const targetVideoPath = path.join(workDir, 'source_video.mp4');

  // Case 1: Local file input
  if (fs.existsSync(url)) {
    logger.info(`Using local video file: ${url}`);
    const hasAudio = await hasAudioStream(url);

    if (!hasAudio) {
      logger.warn(`Source video "${url}" has no audio stream. Adding default ambient audio track...`);
      const defaultAudio = path.join(process.cwd(), 'assets', 'audio', 'entertainment.mp3');
      if (fs.existsSync(defaultAudio)) {
        await runFFmpeg([
          '-y',
          '-i', url,
          '-i', defaultAudio,
          '-map', '0:v',
          '-map', '1:a',
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-shortest',
          targetVideoPath,
        ]).catch(async () => {
          await runFFmpeg([
            '-y',
            '-i', url,
            '-i', defaultAudio,
            '-map', '0:v',
            '-map', '1:a',
            '-c:v', 'libx264',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-shortest',
            targetVideoPath,
          ]);
        });
      } else {
        await runFFmpeg([
          '-y',
          '-i', url,
          '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
          '-map', '0:v',
          '-map', '1:a',
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-shortest',
          targetVideoPath,
        ]);
      }
    } else {
      await runFFmpeg([
        '-y',
        '-i', url,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        targetVideoPath,
      ]).catch(async () => {
        await runFFmpeg([
          '-y',
          '-i', url,
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '192k',
          targetVideoPath,
        ]);
      });
    }

    const basenameTitle = path.basename(url, path.extname(url)).replace(/[_-]/g, ' ');
    return {
      sourceVideoPath: targetVideoPath,
      extractedTitle: basenameTitle,
    };
  }

  // Case 2: Remote URL via yt-dlp
  const ytdlpBin = findYtDlpBinary();
  logger.info(`Using yt-dlp binary: ${ytdlpBin}`);
  logger.info(`Fetching video and metadata from: ${url}`);

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

  // Download best MP4 video + audio stream into downloaded_source.*
  const downloadTemplate = path.join(workDir, 'downloaded_source.%(ext)s');
  logger.info('Downloading best MP4 video + audio stream with yt-dlp...');
  await new Promise((resolve, reject) => {
    execFile(
      ytdlpBin,
      [
        '--no-playlist',
        '--no-warnings',
        '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
        '--merge-output-format', 'mp4',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '-o', downloadTemplate,
        url,
      ],
      { timeout: 180000 },
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
  const downloadedFile = files.find((f) => f.startsWith('downloaded_source.'));
  if (!downloadedFile) {
    throw new Error('yt-dlp completed but no downloaded_source.* file was found in work_reel directory.');
  }

  const downloadedPath = path.join(workDir, downloadedFile);
  logger.info(`Normalizing downloaded video stream from ${downloadedFile} to ${path.basename(targetVideoPath)}...`);

  await runFFmpeg([
    '-y',
    '-i', downloadedPath,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    targetVideoPath,
  ]).catch(async () => {
    await runFFmpeg([
      '-y',
      '-i', downloadedPath,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      targetVideoPath,
    ]);
  });

  try {
    if (fs.existsSync(downloadedPath) && downloadedPath !== targetVideoPath) {
      fs.unlinkSync(downloadedPath);
    }
  } catch (_) {}

  return {
    sourceVideoPath: targetVideoPath,
    extractedTitle: extractedTitle || 'Viral Reel Cartoon Animation',
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

  // 1. Download or prepare source_video.mp4
  const { sourceVideoPath, extractedTitle } = await downloadSourceVideoAndTitle(reelUrl, workDir);
  const rawDuration = await probeVideoDuration(sourceVideoPath);
  const duration = Math.min(Math.max(rawDuration, 3), 60); // Clamp between 3s and 60s for YouTube Shorts / Reels
  const roundDur = Math.round(duration * 100) / 100;
  const { width, height } = await probeVideoDimensions(sourceVideoPath);
  const hasAudio = await hasAudioStream(sourceVideoPath);

  logger.success(`Source video ready: ${path.basename(sourceVideoPath)} (${width}x${height}, ${roundDur}s duration)`);

  const displayTitle = customTitle || extractedTitle || 'Viral Reel Cartoon Animation';
  logger.info(`Final Video Title: "${displayTitle}"`);

  // 2. Convert work_reel/source_video.mp4 into stylized 2D cartoon / comic-book / rotoscope animated video
  const finalVideoPath = path.join(workDir, 'animated_final_1080x1920.mp4');
  logger.info(`Rendering 1080x1920 stylized cartoon/rotoscope video (${roundDur}s)...`);

  // Step A: Scaling & cropping/padding to 1080x1920 (30 fps, yuv420p)
  // If landscape (width > height * 1.2), blur background to preserve full subject; otherwise center crop
  let scaleFilter;
  if (width > height * 1.2) {
    scaleFilter = [
      `[0:v]fps=30,split=2[v_bg_raw][v_fg_raw]`,
      `[v_bg_raw]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=30[v_bg]`,
      `[v_fg_raw]scale=1080:1920:force_original_aspect_ratio=decrease[v_fg]`,
      `[v_bg][v_fg]overlay=(W-w)/2:(H-h)/2,setsar=1,split=2[v_base][v_edge_src]`,
    ].join(';');
  } else {
    scaleFilter = `[0:v]fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,split=2[v_base][v_edge_src]`;
  }

  // Step B: Multi-stage toon/comic stylization (Full-color rotoscope without color cast):
  // - Smooth cartoon/cel-shaded color styling with hqdn3d=6:6:8:8
  // - Balanced color saturation & contrast with eq=saturation=1.25:contrast=1.12:brightness=0.01
  // - Light, clean edge overlay (edgedetect=low=0.18:high=0.36, boxblur=1:1, clean threshold) to keep embedded text/emojis readable
  // - Neutral YUV chrominance (cb=128, cr=128) ensuring zero green tint or color cast
  // - Overlay ink lines onto color layer keeping original natural colors completely intact
  const toonFilter = [
    scaleFilter,
    `[v_base]hqdn3d=6:6:8:8,eq=saturation=1.25:contrast=1.12:brightness=0.01[v_color]`,
    `[v_edge_src]hqdn3d=6:6:8:8,format=gray,edgedetect=low=0.18:high=0.36:mode=wires,boxblur=1:1,geq='if(gt(lum(X,Y),40),255,0)',format=yuva420p,geq=lum='0':cb='128':cr='128':a='lum(X,Y)'[v_ink]`,
    `[v_color][v_ink]overlay=0:0[vout]`,
  ].join(';');

  const ffmpegArgs = [
    '-y',
    '-i', sourceVideoPath,
  ];

  if (!hasAudio) {
    ffmpegArgs.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  }

  ffmpegArgs.push(
    '-filter_complex', toonFilter,
    '-map', '[vout]',
    '-map', hasAudio ? '0:a' : '1:a',
    '-t', String(roundDur),
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '25',
    '-maxrate', '5M',
    '-bufsize', '10M',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    finalVideoPath
  );

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
        description: `${displayTitle}\n\nStylized 2D cartoon / rotoscope animation with original audio preserved.\n\nFollow`,
        tags: ['shorts', 'reels', 'animated', 'cartoon', 'comic', 'rotoscope', 'viral'],
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

  const caption = `${displayTitle}\n\nStylized 2D cartoon / rotoscope animation with original audio preserved.\n\nFollow`;

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

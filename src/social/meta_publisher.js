import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

const META_GRAPH_VERSION = 'v20.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

/**
 * Utility delay function for polling
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Publishes a video to Instagram Reels via Meta Graph API v20+
 * @param {Object} params
 * @param {string} params.igAccountId - Instagram Business/Creator Account ID
 * @param {string} params.accessToken - Meta User/Page Access Token
 * @param {string} params.videoPath - Absolute path to local video MP4 file
 * @param {string} params.caption - Formatted caption text including hashtags
 * @returns {Promise<{ id: string, permalink: string }>}
 */
async function uploadInstagramReel({ igAccountId, accessToken, videoPath, caption }) {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found at ${videoPath}`);
  }

  const fileStats = fs.statSync(videoPath);
  const fileSize = fileStats.size;
  logger.info(`[Instagram Reels] Initializing upload container for ${path.basename(videoPath)} (${(fileSize / 1024 / 1024).toFixed(2)} MB)...`);

  // Step 1: Initialize container via /media (with media_type=REELS, upload_type=resumable)
  const initEndpoint = `${GRAPH_API_BASE}/${igAccountId}/media`;
  const initBody = new URLSearchParams({
    media_type: 'REELS',
    upload_type: 'resumable',
    caption,
    share_to_feed: 'true',
    access_token: accessToken,
  });

  const initRes = await fetch(initEndpoint, {
    method: 'POST',
    body: initBody,
  });

  const initData = await initRes.json();
  if (!initRes.ok || !initData.id || !initData.uri) {
    const errMsg = initData?.error?.message || JSON.stringify(initData);
    throw new Error(`Instagram container initialization failed: ${errMsg}`);
  }

  const containerId = initData.id;
  const uploadUri = initData.uri;
  logger.success(`[Instagram Reels] Container created: ${containerId}`);

  // Step 2: Upload binary video payload to uploadUri
  logger.info(`[Instagram Reels] Uploading video binary to Meta CDN...`);
  const videoBuffer = fs.readFileSync(videoPath);

  const uploadRes = await fetch(uploadUri, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${accessToken}`,
      offset: '0',
      file_size: String(fileSize),
      'Content-Type': 'application/octet-stream',
    },
    body: videoBuffer,
  });

  const uploadData = await uploadRes.json();
  if (!uploadRes.ok || uploadData.success === false) {
    const errMsg = uploadData?.error?.message || JSON.stringify(uploadData);
    throw new Error(`Instagram binary upload failed: ${errMsg}`);
  }
  logger.success(`[Instagram Reels] Video binary uploaded successfully.`);

  // Step 3: Poll container status until FINISHED
  logger.info(`[Instagram Reels] Waiting for Meta video processing (container ${containerId})...`);
  const statusEndpoint = `${GRAPH_API_BASE}/${containerId}?fields=status_code,status&access_token=${accessToken}`;
  let isReady = false;
  const maxAttempts = 30; // 30 * 5s = 150 seconds max

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(5000);
    const statusRes = await fetch(statusEndpoint);
    const statusData = await statusRes.json();

    const statusCode = statusData.status_code || '';
    logger.info(`[Instagram Reels] Processing status (attempt ${attempt}/${maxAttempts}): ${statusCode || 'CHECKING'}`);

    if (statusCode === 'FINISHED') {
      isReady = true;
      break;
    } else if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
      const errDetails = statusData.status || statusData?.error?.message || statusCode;
      throw new Error(`Instagram container processing failed with status: ${errDetails}`);
    }
  }

  if (!isReady) {
    throw new Error(`Instagram container processing timed out after 150 seconds.`);
  }

  // Step 4: Trigger media publish
  logger.info(`[Instagram Reels] Publishing container ${containerId}...`);
  const publishEndpoint = `${GRAPH_API_BASE}/${igAccountId}/media_publish`;
  const publishBody = new URLSearchParams({
    creation_id: containerId,
    access_token: accessToken,
  });

  const pubRes = await fetch(publishEndpoint, {
    method: 'POST',
    body: publishBody,
  });

  const pubData = await pubRes.json();
  if (!pubRes.ok || !pubData.id) {
    const errMsg = pubData?.error?.message || JSON.stringify(pubData);
    throw new Error(`Instagram media publish failed: ${errMsg}`);
  }

  const mediaId = pubData.id;
  logger.success(`[Instagram Reels] Published successfully! Media ID: ${mediaId}`);

  // Step 5: Retrieve permalink
  let permalink = `https://www.instagram.com/reel/`;
  try {
    const permalinkRes = await fetch(`${GRAPH_API_BASE}/${mediaId}?fields=permalink&access_token=${accessToken}`);
    const permalinkData = await permalinkRes.json();
    if (permalinkData.permalink) {
      permalink = permalinkData.permalink;
    }
  } catch (e) {
    // Non-critical fallback
  }

  return { id: mediaId, permalink };
}

/**
 * Publishes a video to Facebook Page Reels via Meta Graph API v20+
 * @param {Object} params
 * @param {string} params.fbPageId - Facebook Page ID
 * @param {string} params.accessToken - Meta Page Access Token
 * @param {string} params.videoPath - Absolute path to local video MP4 file
 * @param {string} params.title - Reel title
 * @param {string} params.caption - Formatted description & hashtags
 * @returns {Promise<{ id: string, permalink: string }>}
 */
async function uploadFacebookReel({ fbPageId, accessToken, videoPath, title, caption }) {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found at ${videoPath}`);
  }

  const fileStats = fs.statSync(videoPath);
  const fileSize = fileStats.size;
  logger.info(`[Facebook Reels] Initializing Reel upload on Page ${fbPageId}...`);

  // Step 1: Start upload session via /{page-id}/video_reels
  const startEndpoint = `${GRAPH_API_BASE}/${fbPageId}/video_reels`;
  const startBody = new URLSearchParams({
    upload_phase: 'start',
    access_token: accessToken,
  });

  const startRes = await fetch(startEndpoint, {
    method: 'POST',
    body: startBody,
  });

  const startData = await startRes.json();
  if (!startRes.ok || !startData.video_id || !startData.upload_url) {
    const errMsg = startData?.error?.message || JSON.stringify(startData);
    throw new Error(`Facebook Reels initialization failed: ${errMsg}`);
  }

  const videoId = startData.video_id;
  const uploadUrl = startData.upload_url;
  logger.success(`[Facebook Reels] Session started. Video ID: ${videoId}`);

  // Step 2: Upload video binary to uploadUrl
  logger.info(`[Facebook Reels] Uploading video binary to Facebook...`);
  const videoBuffer = fs.readFileSync(videoPath);

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${accessToken}`,
      offset: '0',
      file_size: String(fileSize),
      'Content-Type': 'application/octet-stream',
    },
    body: videoBuffer,
  });

  const uploadData = await uploadRes.json();
  if (!uploadRes.ok || uploadData.success === false) {
    const errMsg = uploadData?.error?.message || JSON.stringify(uploadData);
    throw new Error(`Facebook binary upload failed: ${errMsg}`);
  }
  logger.success(`[Facebook Reels] Binary upload completed.`);

  // Step 3: Finish and publish Reel
  logger.info(`[Facebook Reels] Publishing Reel ${videoId}...`);
  const finishBody = new URLSearchParams({
    upload_phase: 'finish',
    video_id: videoId,
    video_state: 'PUBLISHED',
    description: caption,
    title: (title || '').slice(0, 100),
    access_token: accessToken,
  });

  const finishRes = await fetch(startEndpoint, {
    method: 'POST',
    body: finishBody,
  });

  const finishData = await finishRes.json();
  if (!finishRes.ok || finishData.success === false) {
    const errMsg = finishData?.error?.message || JSON.stringify(finishData);
    throw new Error(`Facebook Reels finish publish failed: ${errMsg}`);
  }

  const permalink = `https://www.facebook.com/watch/?v=${videoId}`;
  logger.success(`[Facebook Reels] Published successfully! Link: ${permalink}`);

  return { id: videoId, permalink };
}

/**
 * Main entry point: Publishes video to Instagram Reels (& Facebook Reels if enabled)
 * @param {Object} options
 * @param {string} options.videoPath - Local MP4 path
 * @param {string} options.title - Video title
 * @param {string} [options.description] - Description text
 * @param {string[]} [options.tags] - Hashtags / keywords
 * @param {string} [options.customCaption] - Full caption override
 * @returns {Promise<{ published: boolean, instagram?: Object, facebook?: Object, skipped?: boolean, error?: string }>}
 */
export async function publishToMetaReels({
  videoPath,
  title,
  description = '',
  tags = [],
  customCaption = null,
}) {
  const accessToken = process.env.META_ACCESS_TOKEN || config.meta?.accessToken;
  const igAccountId = process.env.INSTAGRAM_ACCOUNT_ID || config.meta?.instagramAccountId;
  const fbPageId = process.env.FACEBOOK_PAGE_ID || config.meta?.facebookPageId;
  const enableFbCrossPost = process.env.ENABLE_FACEBOOK_REELS !== 'false';

  if (!accessToken || !igAccountId) {
    logger.info('Meta / Instagram credentials not configured (META_ACCESS_TOKEN or INSTAGRAM_ACCOUNT_ID missing). Skipping Instagram Reels publishing.');
    return { published: false, skipped: true };
  }

  // Format clean caption with hashtags
  const cleanTags = (tags || [])
    .map((t) => `#${t.replace(/[^a-zA-Z0-9_]/g, '')}`)
    .filter((t) => t.length > 1)
    .slice(0, 25)
    .join(' ');

  const caption = customCaption || `${title}\n\n${description ? description.slice(0, 300) : ''}\n\n${cleanTags} #reels #viral #shorts #trending`.trim();

  const results = { published: true };

  // 1. Publish to Instagram Reels
  try {
    logger.info(`=== Starting Meta Instagram Reels Publishing ===`);
    const igResult = await uploadInstagramReel({
      igAccountId,
      accessToken,
      videoPath,
      caption,
    });
    results.instagram = igResult;
    logger.success(`🎉 Instagram Reel live: ${igResult.permalink}`);
  } catch (err) {
    logger.error(`Instagram Reels publishing failed: ${err.message}`);
    results.instagramError = err.message;
  }

  // 2. Cross-post to Facebook Page Reels if enabled
  if (fbPageId && enableFbCrossPost) {
    try {
      logger.info(`=== Starting Meta Facebook Page Reels Publishing ===`);
      const fbResult = await uploadFacebookReel({
        fbPageId,
        accessToken,
        videoPath,
        title,
        caption,
      });
      results.facebook = fbResult;
      logger.success(`🎉 Facebook Reel live: ${fbResult.permalink}`);
    } catch (err) {
      logger.error(`Facebook Reels publishing failed: ${err.message}`);
      results.facebookError = err.message;
    }
  }

  return results;
}

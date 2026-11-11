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
 * Checks whether an error from Meta API is retryable (ProcessingFailedError, 5xx, or transient CDN glitch)
 * @param {any} errOrData
 * @param {number} [status=0]
 * @returns {boolean}
 */
export function isRetryableMetaError(errOrData, status = 0) {
  if (status >= 500) return true;
  const msg = typeof errOrData === 'string'
    ? errOrData.toLowerCase()
    : (errOrData?.error?.message || errOrData?.message || JSON.stringify(errOrData || {})).toLowerCase();

  return (
    status >= 500 ||
    msg.includes('processingfailed') ||
    msg.includes('processing_failed') ||
    msg.includes('failed to process') ||
    msg.includes('transient') ||
    msg.includes('try again') ||
    msg.includes('temporarily') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up')
  );
}

/**
 * Uploads video binary payload to Meta CDN (rupload.facebook.com) with automatic retry loop
 * Resets headers (offset: 0, file_size) and buffer cleanly before each retry attempt.
 * @param {Object} params
 * @param {string} params.uploadUri - Resumable upload endpoint from container
 * @param {string} params.videoPath - Path to local MP4 video file
 * @param {string} params.accessToken - Meta OAuth access token
 * @param {string} [params.platform='Instagram Reels']
 * @param {number} [params.maxRetries=3]
 * @returns {Promise<Object>}
 */
export async function uploadVideoBinary({
  uploadUri,
  videoPath,
  accessToken,
  platform = 'Instagram Reels',
  maxRetries = 3,
}) {
  const fileStats = fs.statSync(videoPath);
  const fileSize = fileStats.size;

  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(
        `[${platform}] Uploading video binary to Meta CDN (attempt ${attempt}/${maxRetries}, ${(fileSize / 1024 / 1024).toFixed(2)} MB)...`
      );

      // Cleanly reset headers and buffer before each transmission
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

      const errMsg = uploadData?.error?.message || responseText || `HTTP ${uploadRes.status}`;
      const isRetryable = isRetryableMetaError(uploadData, uploadRes.status);

      logger.warn(`[${platform}] Binary upload attempt ${attempt} failed (HTTP ${uploadRes.status}): ${errMsg}`);
      lastError = new Error(`Binary upload failed: ${errMsg}`);

      if (attempt < maxRetries && isRetryable) {
        const backoffMs = attempt === 1 ? 3000 : 6000;
        logger.info(`[${platform}] Retrying binary upload in ${backoffMs / 1000}s (attempt ${attempt + 1}/${maxRetries})...`);
        await sleep(backoffMs);
      } else if (!isRetryable) {
        throw lastError;
      }
    } catch (err) {
      lastError = err;
      const isRetryable = isRetryableMetaError(err.message);
      if (attempt < maxRetries && isRetryable) {
        const backoffMs = attempt === 1 ? 3000 : 6000;
        logger.warn(
          `[${platform}] Binary upload error on attempt ${attempt}: ${err.message}. Retrying in ${backoffMs / 1000}s...`
        );
        await sleep(backoffMs);
      } else {
        throw err;
      }
    }
  }

  throw lastError || new Error(`[${platform}] Binary upload failed after ${maxRetries} attempts.`);
}

/**
 * Publishes a video to Instagram Reels via Meta Graph API v20+
 * Automatically recreates container upon ProcessingFailedError or 5xx.
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
  const maxContainerAttempts = 3;

  for (let containerAttempt = 1; containerAttempt <= maxContainerAttempts; containerAttempt++) {
    try {
      logger.info(
        `[Instagram Reels] Initializing upload container (attempt ${containerAttempt}/${maxContainerAttempts}) for ${path.basename(videoPath)} (${(fileSize / 1024 / 1024).toFixed(2)} MB)...`
      );

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
        if (containerAttempt < maxContainerAttempts && isRetryableMetaError(initData, initRes.status)) {
          const backoffMs = containerAttempt === 1 ? 3000 : 6000;
          logger.warn(`[Instagram Reels] Container initialization failed: ${errMsg}. Recreating container in ${backoffMs / 1000}s...`);
          await sleep(backoffMs);
          continue;
        }
        throw new Error(`Instagram container initialization failed: ${errMsg}`);
      }

      const containerId = initData.id;
      const uploadUri = initData.uri;
      logger.success(`[Instagram Reels] Container created: ${containerId}`);

      // Step 2: Upload binary video payload to uploadUri with 3 retries (3s, 6s backoff)
      await uploadVideoBinary({
        uploadUri,
        videoPath,
        accessToken,
        platform: 'Instagram Reels',
        maxRetries: 3,
      });

      // Step 3: Poll container status until FINISHED
      logger.info(`[Instagram Reels] Waiting for Meta video processing (container ${containerId})...`);
      const statusEndpoint = `${GRAPH_API_BASE}/${containerId}?fields=status_code,status&access_token=${accessToken}`;
      let isReady = false;
      const maxAttempts = 30; // 30 * 5s = 150 seconds max
      let needContainerRecreate = false;

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
          const isRetryable = isRetryableMetaError(errDetails);
          if (containerAttempt < maxContainerAttempts && isRetryable) {
            const backoffMs = containerAttempt === 1 ? 3000 : 6000;
            logger.warn(
              `[Instagram Reels] Container ${containerId} processing returned ${statusCode} (${errDetails}). Recreating upload container (attempt ${containerAttempt + 1}/${maxContainerAttempts}) after ${backoffMs / 1000}s...`
            );
            await sleep(backoffMs);
            needContainerRecreate = true;
            break;
          }
          throw new Error(`Instagram container processing failed with status: ${errDetails}`);
        }
      }

      if (needContainerRecreate) {
        continue;
      }

      if (!isReady) {
        if (containerAttempt < maxContainerAttempts) {
          logger.warn(`[Instagram Reels] Container processing timed out. Recreating upload container...`);
          await sleep(3000);
          continue;
        }
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
    } catch (err) {
      if (containerAttempt < maxContainerAttempts && isRetryableMetaError(err.message)) {
        const backoffMs = containerAttempt === 1 ? 3000 : 6000;
        logger.warn(
          `[Instagram Reels] Transient error during container attempt ${containerAttempt}: ${err.message}. Recreating container in ${backoffMs / 1000}s...`
        );
        await sleep(backoffMs);
      } else {
        throw err;
      }
    }
  }

  throw new Error(`[Instagram Reels] Publishing failed after ${maxContainerAttempts} container attempts.`);
}

/**
 * Resolves or exchanges for a Facebook Page Access Token using the configured Meta Access Token.
 * If META_ACCESS_TOKEN is a User Token, calls:
 *   1. GET /{page_id}?fields=access_token,name
 *   2. GET /me/accounts?fields=id,name,access_token
 * @param {string} fbPageId - Target Facebook Page ID
 * @param {string} userAccessToken - Configured Meta access token
 * @returns {Promise<{ pageAccessToken: string | null, pageName: string | null, warning: string | null }>}
 */
async function resolveFacebookPageAccessToken(fbPageId, userAccessToken) {
  if (!fbPageId || !userAccessToken) {
    return {
      pageAccessToken: null,
      pageName: null,
      warning: 'Missing Facebook Page ID or Meta Access Token',
    };
  }

  // 1. Try querying GET /{page_id}?fields=access_token,name using userAccessToken
  try {
    const directUrl = `${GRAPH_API_BASE}/${fbPageId}?fields=access_token,name&access_token=${encodeURIComponent(userAccessToken)}`;
    const directRes = await fetch(directUrl);
    const directData = await directRes.json();

    if (directRes.ok && directData.access_token) {
      logger.info(
        `[Facebook Reels] Resolved Page Access Token directly from Page ${directData.name ? `"${directData.name}"` : fbPageId}.`
      );
      return {
        pageAccessToken: directData.access_token,
        pageName: directData.name || null,
        warning: null,
      };
    }
  } catch (err) {
    // Proceed to /me/accounts check
  }

  // 2. Try querying GET /me/accounts?fields=id,name,access_token using userAccessToken
  try {
    const accountsUrl = `${GRAPH_API_BASE}/me/accounts?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(userAccessToken)}`;
    const accountsRes = await fetch(accountsUrl);
    const accountsData = await accountsRes.json();

    if (accountsRes.ok && Array.isArray(accountsData.data)) {
      const match = accountsData.data.find((p) => String(p.id) === String(fbPageId));
      if (match && match.access_token) {
        logger.info(
          `[Facebook Reels] Resolved Page Access Token from /me/accounts for Page "${match.name}" (ID: ${match.id}).`
        );
        return {
          pageAccessToken: match.access_token,
          pageName: match.name || null,
          warning: null,
        };
      }

      const availablePages = accountsData.data.map((p) => `"${p.name}" (${p.id})`).join(', ');
      const warning = `Target Page ID "${fbPageId}" was not found in user's managed pages: [${availablePages || 'None'}].`;
      logger.warn(`[Facebook Reels] ${warning}`);
      return {
        pageAccessToken: null,
        pageName: null,
        warning,
      };
    } else if (accountsData?.error) {
      const errMsg = accountsData.error.message || 'Unknown error';
      logger.warn(
        `[Facebook Reels] Query to /me/accounts returned error: ${errMsg} [Code #${accountsData.error.code || 'unknown'}]`
      );
    }
  } catch (err) {
    logger.warn(`[Facebook Reels] Error querying /me/accounts: ${err.message}`);
  }

  // 3. Fallback: If token cannot be exchanged, try using provided token directly (in case it is already a Page Token)
  return {
    pageAccessToken: userAccessToken,
    pageName: null,
    warning: 'Could not exchange for Page Access Token via Page node or /me/accounts; attempting direct upload with configured token.',
  };
}

/**
 * Publishes a video to Facebook Page Reels via Meta Graph API v20+
 * @param {Object} params
 * @param {string} params.fbPageId - Facebook Page ID
 * @param {string} params.accessToken - Meta Page Access Token
 * @param {string} params.videoPath - Absolute path to local video MP4 file
 * @param {string} params.title - Reel title
 * @param {string} params.caption - Formatted description & hashtags
 * @param {string} [params.pageName] - Optional name of page for display
 * @returns {Promise<{ id: string, permalink: string }>}
 */
async function uploadFacebookReel({ fbPageId, accessToken, videoPath, title, caption, pageName = null }) {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found at ${videoPath}`);
  }

  const fileStats = fs.statSync(videoPath);
  const fileSize = fileStats.size;
  logger.info(
    `[Facebook Reels] Initializing Reel upload on Page ${pageName ? `"${pageName}" (ID: ${fbPageId})` : fbPageId}...`
  );

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
    const errCode = startData?.error?.code ? ` (#${startData.error.code})` : '';
    throw new Error(`Facebook Reels initialization failed: ${errCode} ${errMsg}`.trim());
  }

  const videoId = startData.video_id;
  const uploadUrl = startData.upload_url;
  logger.success(`[Facebook Reels] Session started. Video ID: ${videoId}`);

  // Step 2: Upload video binary to uploadUrl with automatic retry
  await uploadVideoBinary({
    uploadUri: uploadUrl,
    videoPath,
    accessToken,
    platform: 'Facebook Reels',
    maxRetries: 3,
  });

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
    logger.info(`=== Starting Meta Facebook Page Reels Publishing ===`);
    try {
      const { pageAccessToken, pageName, warning } = await resolveFacebookPageAccessToken(fbPageId, accessToken);

      if (!pageAccessToken) {
        logger.warn(`[Facebook Reels] Skipping Facebook Reels publishing: ${warning || 'Unable to resolve Page Access Token'}`);
        results.facebookSkipped = true;
      } else {
        const fbResult = await uploadFacebookReel({
          fbPageId,
          accessToken: pageAccessToken,
          videoPath,
          title,
          caption,
          pageName,
        });

        if (fbResult) {
          results.facebook = fbResult;
          logger.success(`🎉 Facebook Reel live: ${fbResult.permalink}`);
        }
      }
    } catch (err) {
      logger.warn(`[Facebook Reels] Could not publish to Facebook Page Reels: ${err.message}`);
      if (err.message.includes('#200') || err.message.toLowerCase().includes('permission')) {
        logger.warn(
          `[Facebook Reels] ℹ Permission Note: Ensure your META_ACCESS_TOKEN was granted 'pages_show_list', 'pages_read_engagement', and 'pages_manage_posts' for Page ID ${fbPageId}, or supply a direct Page Access Token.`
        );
      }
      results.facebookError = err.message;
    }
  }

  return results;
}

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
 * Formats full diagnostic Meta error payload including HTTP code, code, subcode, type, message, and fbtrace_id
 */
export function formatMetaErrorPayload(data, status = 0) {
  const err = data?.error || (typeof data === 'object' ? data : {});
  const code = err.code !== undefined ? err.code : 'none';
  const subcode = err.error_subcode !== undefined ? err.error_subcode : 'none';
  const type = err.type || 'none';
  const msg = err.message || (typeof data === 'string' ? data : JSON.stringify(data));
  const fbtrace = err.fbtrace_id || 'none';
  return `HTTP ${status} | Code: ${code} | Subcode: ${subcode} | Type: ${type} | Message: ${msg} | fbtrace_id: ${fbtrace}`;
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

      const formattedErr = formatMetaErrorPayload(uploadData, uploadRes.status);
      const isRetryable = isRetryableMetaError(uploadData, uploadRes.status);

      logger.warn(`[${platform}] Binary upload attempt ${attempt} failed: ${formattedErr}`);
      logger.warn(`[${platform}] Raw Response: ${responseText.slice(0, 300)}`);
      lastError = new Error(`Binary upload failed: ${formattedErr}`);

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
          `[${platform}] Binary upload network error on attempt ${attempt}: ${err.message}. Retrying in ${backoffMs / 1000}s...`
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
 * Logs full HTTP status and JSON error payloads.
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
        const formattedErr = formatMetaErrorPayload(initData, initRes.status);
        logger.error(`[Instagram Reels] Container initialization failed: ${formattedErr}`);
        logger.error(`[Instagram Reels] Full JSON: ${JSON.stringify(initData)}`);

        if (containerAttempt < maxContainerAttempts && isRetryableMetaError(initData, initRes.status)) {
          const backoffMs = containerAttempt === 1 ? 3000 : 6000;
          logger.warn(`[Instagram Reels] Recreating container in ${backoffMs / 1000}s...`);
          await sleep(backoffMs);
          continue;
        }
        throw new Error(`Instagram container initialization failed: ${formattedErr}`);
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
          const formattedErr = formatMetaErrorPayload(statusData, statusRes.status);
          logger.error(`[Instagram Reels] Container processing returned ${statusCode}: ${formattedErr}`);
          logger.error(`[Instagram Reels] Full Status JSON: ${JSON.stringify(statusData)}`);

          const isRetryable = isRetryableMetaError(statusData);
          if (containerAttempt < maxContainerAttempts && isRetryable) {
            const backoffMs = containerAttempt === 1 ? 3000 : 6000;
            logger.warn(
              `[Instagram Reels] Recreating upload container (attempt ${containerAttempt + 1}/${maxContainerAttempts}) after ${backoffMs / 1000}s...`
            );
            await sleep(backoffMs);
            needContainerRecreate = true;
            break;
          }
          throw new Error(`Instagram container processing failed (${statusCode}): ${formattedErr}`);
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
        const formattedErr = formatMetaErrorPayload(pubData, pubRes.status);
        logger.error(`[Instagram Reels] Media publish failed: ${formattedErr}`);
        logger.error(`[Instagram Reels] Full Publish JSON: ${JSON.stringify(pubData)}`);
        throw new Error(`Instagram media publish failed: ${formattedErr}`);
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
    } else if (directData?.error) {
      logger.info(
        `[Facebook Reels] Direct Page query did not yield page token (${formatMetaErrorPayload(directData, directRes.status)}). Checking /me/accounts...`
      );
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
      const formattedErr = formatMetaErrorPayload(accountsData, accountsRes.status);
      logger.warn(`[Facebook Reels] Query to /me/accounts returned: ${formattedErr}`);
    }
  } catch (err) {
    logger.warn(`[Facebook Reels] Error querying /me/accounts: ${err.message}`);
  }

  // 3. Fallback: If token cannot be exchanged, try using provided token directly
  return {
    pageAccessToken: userAccessToken,
    pageName: null,
    warning: 'Could not exchange for Page Access Token via Page node or /me/accounts; attempting direct upload with configured token.',
  };
}

/**
 * Publishes a video to Facebook Page via standard Page Video endpoint fallback (graph-video.facebook.com).
 * Used when /{page-id}/video_reels fails due to permissions or endpoint availability.
 * On mobile/Instagram/Facebook Feed, vertical 9:16 videos published to Page are surfaced directly in Reels.
 * @param {Object} params
 * @param {string} params.fbPageId - Facebook Page ID
 * @param {string} params.accessToken - Facebook Page Access Token
 * @param {string} params.videoPath - Path to MP4
 * @param {string} params.title - Video title
 * @param {string} params.caption - Video caption / description
 * @param {string} [params.pageName] - Optional page name
 * @returns {Promise<{ id: string, permalink: string, isFallback: boolean }>}
 */
async function uploadFacebookVideoFallback({ fbPageId, accessToken, videoPath, title, caption, pageName = null }) {
  logger.info(
    `[Facebook Video Fallback] Attempting direct Page video upload on Page ${pageName ? `"${pageName}" (ID: ${fbPageId})` : fbPageId}...`
  );

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
    logger.error(`[Facebook Video Fallback] Direct video upload failed: ${formattedErr}`);
    logger.error(`[Facebook Video Fallback] Full JSON: ${JSON.stringify(data)}`);
    throw new Error(`Facebook direct video upload failed: ${formattedErr}`);
  }

  const permalink = `https://www.facebook.com/watch/?v=${data.id}`;
  logger.success(`[Facebook Video Fallback] Published successfully via Page video endpoint! Link: ${permalink}`);
  return { id: data.id, permalink, isFallback: true };
}

/**
 * Publishes a video to Facebook Page Reels via Meta Graph API v20+
 * Automatically falls back to standard Page Video endpoint if video_reels fails.
 * Logs full HTTP status and JSON error payloads.
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
    `[Facebook Reels] Initializing Reel upload on Page ${pageName ? `"${pageName}" (ID: ${fbPageId})` : fbPageId} (${(fileSize / 1024 / 1024).toFixed(2)} MB)...`
  );

  // Step 1: Start upload session via /{page-id}/video_reels
  const startEndpoint = `${GRAPH_API_BASE}/${fbPageId}/video_reels`;
  const startBody = new URLSearchParams({
    upload_phase: 'start',
    access_token: accessToken,
  });

  let startRes;
  try {
    startRes = await fetch(startEndpoint, {
      method: 'POST',
      body: startBody,
    });
  } catch (netErr) {
    logger.warn(`[Facebook Reels] Network error connecting to video_reels: ${netErr.message}. Attempting fallback...`);
    return await uploadFacebookVideoFallback({ fbPageId, accessToken, videoPath, title, caption, pageName });
  }

  const startData = await startRes.json();
  if (!startRes.ok || !startData.video_id || !startData.upload_url) {
    const formattedErr = formatMetaErrorPayload(startData, startRes.status);
    logger.warn(`[Facebook Reels] Session start failed on video_reels: ${formattedErr}`);
    logger.info(`[Facebook Reels] Falling back to universal Page video upload endpoint...`);
    return await uploadFacebookVideoFallback({ fbPageId, accessToken, videoPath, title, caption, pageName });
  }

  const videoId = startData.video_id;
  const uploadUrl = startData.upload_url;
  logger.success(`[Facebook Reels] Session started. Video ID: ${videoId}`);

  // Step 2: Upload video binary to uploadUrl with automatic retry
  try {
    await uploadVideoBinary({
      uploadUri: uploadUrl,
      videoPath,
      accessToken,
      platform: 'Facebook Reels',
      maxRetries: 3,
    });
  } catch (uploadErr) {
    logger.warn(`[Facebook Reels] Binary upload failed on video_reels: ${uploadErr.message}. Attempting fallback...`);
    return await uploadFacebookVideoFallback({ fbPageId, accessToken, videoPath, title, caption, pageName });
  }

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
    const formattedErr = formatMetaErrorPayload(finishData, finishRes.status);
    logger.warn(`[Facebook Reels] Finish publish failed: ${formattedErr}. Attempting fallback...`);
    return await uploadFacebookVideoFallback({ fbPageId, accessToken, videoPath, title, caption, pageName });
  }

  const permalink = `https://www.facebook.com/watch/?v=${videoId}`;
  logger.success(`[Facebook Reels] Published successfully! Link: ${permalink}`);

  return { id: videoId, permalink };
}

/**
 * Verifies Meta Access Token validity and logs detailed expiration/permission diagnostics
 * @param {string} accessToken
 * @returns {Promise<{ valid: boolean, user?: Object, error?: string, isExpired?: boolean }>}
 */
export async function verifyMetaAccessToken(accessToken) {
  if (!accessToken) {
    return { valid: false, error: 'No Meta Access Token provided' };
  }
  try {
    const res = await fetch(`${GRAPH_API_BASE}/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`);
    const data = await res.json();
    if (res.ok && data.id) {
      logger.info(`[Meta API] Token verified for account: "${data.name || 'Meta User'}" (ID: ${data.id})`);
      return { valid: true, user: data };
    }

    const formattedErr = formatMetaErrorPayload(data, res.status);
    const code = data?.error?.code;
    const subcode = data?.error?.error_subcode;
    const isExpired = code === 190 || subcode === 463 || subcode === 467;

    logger.error(`[Meta API] Token validation failed: ${formattedErr}`);
    if (isExpired) {
      logger.error('========================================================================');
      logger.error(' ❌ CRITICAL: META ACCESS TOKEN HAS EXPIRED (Code 190 / Subcode 463/467)');
      logger.error(' Meta User Access Tokens expire automatically after 60 days.');
      logger.error(' Instagram & Facebook publishing cannot proceed until a fresh token is set.');
      logger.error(' Steps to refresh:');
      logger.error(' 1. Go to https://developers.facebook.com/tools/explorer/');
      logger.error(' 2. Select your App and User Token with permissions:');
      logger.error('    instagram_basic, instagram_content_publish, pages_show_list,');
      logger.error('    pages_read_engagement, pages_manage_posts');
      logger.error(' 3. Exchange for a 60-day Long-Lived Token or Never-Expiring Page Token.');
      logger.error(' 4. Update the GitHub Repository Secret: META_ACCESS_TOKEN');
      logger.error('========================================================================');
    }

    return { valid: false, error: formattedErr, isExpired };
  } catch (err) {
    logger.warn(`[Meta API] Could not verify access token via network: ${err.message}`);
    return { valid: true, warning: err.message };
  }
}

/**
 * Main entry point: Publishes video to Instagram Reels (& Facebook Reels if enabled)
 * Fully decouples Instagram and Facebook so Facebook isn't skipped when IG ID is missing.
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
  const accessToken =
    process.env.META_ACCESS_TOKEN ||
    process.env.PAGE_ACCESS_TOKEN ||
    process.env.FACEBOOK_ACCESS_TOKEN ||
    config.meta?.accessToken;

  const igAccountId =
    process.env.INSTAGRAM_ACCOUNT_ID ||
    process.env.IG_USER_ID ||
    config.meta?.instagramAccountId;

  const fbPageId =
    process.env.FACEBOOK_PAGE_ID ||
    process.env.FB_PAGE_ID ||
    config.meta?.facebookPageId;

  const enableFbCrossPost = process.env.ENABLE_FACEBOOK_REELS !== 'false';

  if (!accessToken) {
    logger.info('[Meta Reels] No Meta Access Token configured (META_ACCESS_TOKEN / PAGE_ACCESS_TOKEN). Skipping Meta publishing.');
    logger.info('[Meta Reels] Configured credentials checklist:');
    logger.info('  • META_ACCESS_TOKEN: User/System Access Token (with instagram_basic, instagram_content_publish, pages_show_list, pages_read_engagement, pages_manage_posts)');
    logger.info('  • INSTAGRAM_ACCOUNT_ID / IG_USER_ID: Connected Instagram Business/Creator Account ID');
    logger.info('  • FACEBOOK_PAGE_ID / FB_PAGE_ID: Facebook Page ID (for Page Reels cross-posting)');
    return { published: false, skipped: true, reason: 'META_ACCESS_TOKEN not configured' };
  }

  // Pre-validate token
  const tokenCheck = await verifyMetaAccessToken(accessToken);
  if (!tokenCheck.valid && tokenCheck.isExpired) {
    return {
      published: false,
      skipped: false,
      error: 'Meta Access Token is expired (Code 190)',
      instagramError: 'Meta Access Token expired (Code 190)',
      facebookError: 'Meta Access Token expired (Code 190)',
    };
  }

  // Format clean caption with hashtags
  const cleanTags = (tags || [])
    .map((t) => `#${t.replace(/[^a-zA-Z0-9_]/g, '')}`)
    .filter((t) => t.length > 1)
    .slice(0, 25)
    .join(' ');

  const caption = customCaption || `${title}\n\n${description ? description.slice(0, 300) : ''}\n\n${cleanTags} #reels #viral #shorts #trending`.trim();

  const results = { published: true };

  // 1. Publish to Instagram Reels (if configured)
  if (igAccountId) {
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
  } else {
    logger.info('[Instagram Reels] INSTAGRAM_ACCOUNT_ID / IG_USER_ID is not configured. Skipping Instagram Reels.');
    results.instagramSkipped = true;
    results.instagramSkipReason = 'INSTAGRAM_ACCOUNT_ID / IG_USER_ID not configured';
  }

  // 2. Publish / Cross-post to Facebook Page Reels (if configured and enabled)
  if (!fbPageId) {
    logger.info('[Facebook Reels] FACEBOOK_PAGE_ID / FB_PAGE_ID is not configured. Skipping Facebook Reels.');
    results.facebookSkipped = true;
    results.facebookSkipReason = 'FACEBOOK_PAGE_ID / FB_PAGE_ID not configured';
  } else if (!enableFbCrossPost) {
    logger.info('[Facebook Reels] ENABLE_FACEBOOK_REELS is set to false. Skipping Facebook Reels.');
    results.facebookSkipped = true;
    results.facebookSkipReason = 'ENABLE_FACEBOOK_REELS is set to false';
  } else {
    logger.info(`=== Starting Meta Facebook Page Reels Publishing ===`);
    try {
      const { pageAccessToken, pageName, warning } = await resolveFacebookPageAccessToken(fbPageId, accessToken);

      const tokenToUse = pageAccessToken || accessToken;
      if (warning) {
        logger.warn(`[Facebook Reels] ${warning}`);
      }

      const fbResult = await uploadFacebookReel({
        fbPageId,
        accessToken: tokenToUse,
        videoPath,
        title,
        caption,
        pageName,
      });

      if (fbResult) {
        results.facebook = fbResult;
        logger.success(`🎉 Facebook Reel live: ${fbResult.permalink}`);
      }
    } catch (err) {
      logger.error(`Facebook Reels publishing failed: ${err.message}`);
      if (err.message.includes('#200') || err.message.toLowerCase().includes('permission')) {
        logger.warn(
          `[Facebook Reels] ℹ Permission Note: Ensure your token has 'pages_show_list', 'pages_read_engagement', and 'pages_manage_posts' for Page ID ${fbPageId}, or supply a direct Page Access Token.`
        );
      }
      results.facebookError = err.message;
    }
  }

  return results;
}

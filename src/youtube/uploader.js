import fs from 'fs';
import { getYouTubeService } from './client.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Checks whether an error is a YouTube uploadLimitExceeded error
 * @param {any} err
 * @returns {boolean}
 */
export function isUploadLimitExceeded(err) {
  if (!err) return false;

  const msg = (err.message || '').toLowerCase();
  if (
    msg.includes('uploadlimitexceeded') ||
    msg.includes('exceeded the number of videos') ||
    msg.includes('daily upload limit')
  ) {
    return true;
  }

  const errors = err.errors || err.response?.data?.error?.errors;
  if (Array.isArray(errors)) {
    const hasLimit = errors.some((e) => {
      const reason = (e.reason || '').toLowerCase();
      const message = (e.message || '').toLowerCase();
      return (
        reason === 'uploadlimitexceeded' ||
        reason === 'quotaexceeded' ||
        (message.includes('upload') && message.includes('limit'))
      );
    });
    if (hasLimit) return true;
  }

  const status = err.code || err.status || err.response?.status || err.response?.data?.error?.code;
  if ((status === 400 || status === '400') && (msg.includes('upload') || msg.includes('limit'))) {
    return true;
  }

  return false;
}

/**
 * Uploads a video to YouTube as a Short
 * @param {Object} params
 * @param {string} params.videoPath - Path to MP4 file
 * @param {string} params.title - Video title
 * @param {string} params.description - Video description
 * @param {string[]} params.tags - List of tags
 * @param {string} [params.categoryId] - YouTube video category ID (default '24' Entertainment)
 * @param {string} [params.privacyStatus] - 'public', 'unlisted', or 'private'
 */
export async function uploadShort({
  videoPath,
  title,
  description,
  tags = [],
  categoryId = '24',
  privacyStatus = config.youtube.privacyStatus,
}) {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file does not exist: ${videoPath}`);
  }

  const fileSize = fs.statSync(videoPath).size;
  if (fileSize < 1000) {
    throw new Error(`Invalid video file size (${fileSize} bytes) at ${videoPath}`);
  }

  // Ensure #Shorts is present in title
  let finalTitle = title.trim();
  if (!finalTitle.toLowerCase().includes('#shorts')) {
    finalTitle = `${finalTitle} #Shorts`;
  }
  // YouTube title limit is 100 characters
  if (finalTitle.length > 100) {
    finalTitle = finalTitle.substring(0, 92) + '... #Shorts';
  }

  const youtube = getYouTubeService();

  logger.info(`Starting YouTube Short upload: "${finalTitle}" (${(fileSize / (1024 * 1024)).toFixed(2)} MB)`);
  logger.info(`Privacy: ${privacyStatus.toUpperCase()}`);

  try {
    const res = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: finalTitle,
          description: `${description}\n\n#Shorts #YouTubeShorts #ViralShorts`,
          tags: Array.from(new Set(['shorts', 'youtube shorts', ...tags])),
          categoryId,
          defaultLanguage: 'en',
          defaultAudioLanguage: 'en',
        },
        status: {
          privacyStatus: privacyStatus || 'public',
          selfDeclaredMadeForKids: false,
          embeddable: true,
        },
      },
      media: {
        body: fs.createReadStream(videoPath),
      },
    });

    const videoId = res.data.id;
    const shortsUrl = `https://youtube.com/shorts/${videoId}`;

    logger.success(`Upload complete! Video ID: ${videoId}`);
    logger.success(`Shorts URL: ${shortsUrl}`);

    return {
      success: true,
      videoId,
      url: shortsUrl,
      title: finalTitle,
      privacyStatus,
    };
  } catch (err) {
    if (isUploadLimitExceeded(err)) {
      logger.warn('⚠️ YouTube daily upload limit reached. Skipping YouTube upload and continuing with Instagram and Facebook Reels.');
      return {
        success: false,
        skipped: true,
        reason: 'uploadLimitExceeded',
        url: 'Skipped (YouTube daily upload limit reached)',
        title: finalTitle,
        privacyStatus,
      };
    }
    throw err;
  }
}

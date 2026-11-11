import { publishShort } from './pipeline.js';
import { logger } from './utils/logger.js';
import { checkYouTubeAuth } from './youtube/client.js';
import { publishToMetaReels } from './social/meta_publisher.js';

/**
 * Resolves target slot from CLI args, environment variables, or GitHub Actions schedule cron
 */
function resolveTargetSlot() {
  const explicitSlot = (process.env.TARGET_SLOT || process.argv[2] || '').trim().toLowerCase();
  if (explicitSlot && explicitSlot !== 'auto') {
    if (explicitSlot.includes('1')) return 'slot1';
    if (explicitSlot.includes('2')) return 'slot2';
    if (explicitSlot.includes('3')) return 'slot3';
    if (explicitSlot.includes('4')) return 'slot4';
  }

  const cronSchedule = (process.env.SCHEDULE_CRON || '').trim();
  if (cronSchedule) {
    if (cronSchedule.includes('30 3')) return 'slot1';
    if (cronSchedule.includes('30 8')) return 'slot2';
    if (cronSchedule.includes('30 11')) return 'slot4';
    if (cronSchedule.includes('0 14')) return 'slot3';
  }

  // Fallback: Resolve by current Indian Standard Time (UTC + 5:30)
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const istMinutesTotal = (utcHours * 60 + utcMinutes) + 330;
  const istHour = Math.floor((istMinutesTotal % 1440) / 60);
  const istMin = String(istMinutesTotal % 60).padStart(2, '0');

  logger.info(`Resolving slot based on current IST time: ${istHour}:${istMin}`);

  if (istHour >= 7 && istHour < 12) return 'slot1';  // 09:00 AM IST window
  if (istHour >= 12 && istHour < 16) return 'slot2'; // 02:00 PM IST window
  if (istHour >= 16 && istHour < 18) return 'slot4'; // 05:00 PM IST window
  return 'slot3'; // 07:30 PM IST evening/night window
}

async function run() {
  const slot = resolveTargetSlot();
  const customTopic = process.env.CUSTOM_TOPIC || process.argv[3] || null;
  const privacyStatus = process.env.UPLOAD_PRIVACY || 'public';

  console.log('\n=============================================================');
  console.log(` 🚀 GITHUB ACTIONS CLOUD SHORTS PUBLISHER `);
  console.log(` Target Slot:    [${slot.toUpperCase()}]`);
  console.log(` Privacy Status: [${privacyStatus.toUpperCase()}]`);
  if (customTopic) console.log(` Custom Topic:   "${customTopic}"`);
  console.log('=============================================================\n');

  // Verify YouTube Authentication headlessly before starting heavy rendering
  logger.info('Verifying YouTube OAuth authentication credentials...');
  const authStatus = await checkYouTubeAuth();
  if (!authStatus.authenticated) {
    throw new Error(`YouTube authentication check failed: ${authStatus.error}`);
  }
  logger.success(`Authenticated Channel: "${authStatus.channelTitle}" (ID: ${authStatus.channelId})`);

  // Run full pipeline: content -> TTS -> subtitles -> video synthesis -> YouTube Upload
  const startTime = Date.now();
  const result = await publishShort(slot, customTopic, privacyStatus);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n-------------------------------------------------------------');
  logger.success(`🎉 Video Published Successfully to YouTube in ${elapsed}s!`);
  console.log(`• Slot:         ${result.slotName}`);
  console.log(`• Title:        ${result.title}`);
  console.log(`• Privacy:      ${result.upload.privacyStatus.toUpperCase()}`);
  console.log(`• YouTube URL:  ${result.upload.url}`);
  console.log('-------------------------------------------------------------\n');

  // Immediately publish to Instagram Reels & Facebook Reels if Meta credentials configured
  let metaResult = null;
  try {
    metaResult = await publishToMetaReels({
      videoPath: result.videoPath,
      title: result.title,
      description: result.description,
      tags: result.tags,
    });
    if (metaResult.instagram?.permalink) {
      console.log(`• Instagram:    ${metaResult.instagram.permalink}`);
    }
    if (metaResult.facebook?.permalink) {
      console.log(`• Facebook:     ${metaResult.facebook.permalink}`);
    }
  } catch (err) {
    logger.warn(`Meta publishing encountered an error: ${err.message}`);
  }

  // Optional: Send Telegram notification if configured
  if (process.env.TELEGRAM_BOT_TOKEN && (process.env.TELEGRAM_ALLOWED_USER_ID || process.env.TELEGRAM_CHAT_ID)) {
    try {
      const chatId = process.env.TELEGRAM_ALLOWED_USER_ID || process.env.TELEGRAM_CHAT_ID;
      let text = `🎬 *Short Published Across Platforms*\n\n` +
        `*Slot:* ${result.slotName}\n` +
        `*Title:* ${result.title}\n` +
        `*YouTube:* ${result.upload.url}\n`;
      if (metaResult?.instagram?.permalink) {
        text += `*Instagram Reel:* ${metaResult.instagram.permalink}\n`;
      }
      if (metaResult?.facebook?.permalink) {
        text += `*Facebook Reel:* ${metaResult.facebook.permalink}\n`;
      }
      text += `*Time:* ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`;

      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
      });
      logger.success('Sent publish notification to Telegram.');
    } catch (e) {
      logger.warn(`Could not send Telegram notification: ${e.message}`);
    }
  }
}

run().catch((err) => {
  logger.error('Cloud publishing job failed:', err);
  process.exit(1);
});

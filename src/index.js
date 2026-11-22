import fs from 'fs';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { ensureAudioBeds } from './utils/audio_beds.js';
import { checkYouTubeAuth } from './youtube/client.js';
import { initTelegramBot } from './telegram/bot.js';
import { startScheduler } from './scheduler/cron.js';

async function main() {
  console.log('\n=============================================================');
  console.log('       YOUTUBE SHORTS AUTOMATED 3-SLOT PUBLISHING PIPELINE   ');
  console.log('=============================================================\n');

  // 1. Check YouTube Token
  if (!fs.existsSync(config.youtube.tokenPath)) {
    logger.warn(`token.json NOT found at ${config.youtube.tokenPath}`);
    logger.info('Please run the one-time authentication script first:');
    console.log('\x1b[33m  npm run auth\x1b[0m\n');
  } else {
    logger.info('Checking YouTube credentials...');
    const authStatus = await checkYouTubeAuth();
    if (authStatus.authenticated) {
      logger.success(`Connected to Channel: "${authStatus.channelTitle}" (Subscribers: ${authStatus.subscribers || 'Hidden'})`);
    } else {
      logger.warn(`YouTube authentication check warning: ${authStatus.error}`);
      logger.info('You may need to re-run: npm run auth');
    }
  }

  // 2. Prepare Audio Beds
  await ensureAudioBeds();

  // 3. Start Telegram Listener
  initTelegramBot();

  // 4. Start Daily Scheduler
  startScheduler();

  console.log('\n-------------------------------------------------------------');
  console.log(' PIPELINE RUNNING & LISTENING');
  console.log(' • Slot 1 (Entertainment): 09:00 AM (Cute baby dance & vibes)');
  console.log(' • Slot 2 (Devotional):    02:00 PM (Hindu devotional darshan)');
  console.log(' • Slot 4 (Epic Wisdom):   05:00 PM (Epic Scriptures & Wisdom Clips)');
  console.log(' • Slot 3 (Viral News):    07:30 PM (Trending 30s explainer)');
  console.log(' • Slot 5 (Cricket Buzz):  09:00 PM (IPL & Cricket Buzz)');
  console.log(' • Slot 6 (Tactical):      10:30 PM (Cricket Tactical & Auction Explainer)');
  console.log('-------------------------------------------------------------\n');
  logger.info('Service is active. Press Ctrl+C anytime to stop.');
}

main().catch((err) => {
  logger.error('Fatal initialization error:', err);
  process.exit(1);
});

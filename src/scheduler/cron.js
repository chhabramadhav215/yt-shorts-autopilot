import cron from 'node-cron';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { publishShort } from '../pipeline.js';
import { notifyTelegramUpload } from '../telegram/bot.js';

export function startScheduler() {
  logger.info('Initializing Daily YouTube Shorts Cron Scheduler...');
  logger.info(`Timezone: ${config.cron.timezone}`);
  logger.info(`Slot 1 (Entertainment): "${config.cron.slot1}"`);
  logger.info(`Slot 2 (Devotional):    "${config.cron.slot2}"`);
  logger.info(`Slot 4 (Epic Scriptures):"${config.cron.slot4}"`);
  logger.info(`Slot 3 (Viral News):    "${config.cron.slot3}"`);
  logger.info(`Slot 5 (Cricket Buzz):   "${config.cron.slot5}"`);

  // 1. Morning Slot 1: Cute Baby Dance / Entertainment
  cron.schedule(
    config.cron.slot1,
    async () => {
      logger.slot('slot1', 'Executing daily morning scheduled run: Cute Baby Dance');
      try {
        const result = await publishShort('slot1');
        await notifyTelegramUpload(result);
      } catch (err) {
        logger.error('Scheduled Slot 1 error:', err.message);
      }
    },
    { timezone: config.cron.timezone }
  );

  // 2. Afternoon Slot 2: Hindu Devotional
  cron.schedule(
    config.cron.slot2,
    async () => {
      logger.slot('slot2', 'Executing daily afternoon scheduled run: Hindu Devotional');
      try {
        const result = await publishShort('slot2');
        await notifyTelegramUpload(result);
      } catch (err) {
        logger.error('Scheduled Slot 2 error:', err.message);
      }
    },
    { timezone: config.cron.timezone }
  );

  // 3. Evening Slot 4: Epic Hindu Scriptures & Wisdom Clips (05:00 PM IST)
  cron.schedule(
    config.cron.slot4,
    async () => {
      logger.slot('slot4', 'Executing daily evening scheduled run: Epic Hindu Scriptures & Wisdom Clips');
      try {
        const result = await publishShort('slot4');
        await notifyTelegramUpload(result);
      } catch (err) {
        logger.error('Scheduled Slot 4 error:', err.message);
      }
    },
    { timezone: config.cron.timezone }
  );

  // 4. Night Slot 3: Viral News Explainer
  cron.schedule(
    config.cron.slot3,
    async () => {
      logger.slot('slot3', 'Executing daily night scheduled run: Viral News Explainer');
      try {
        const result = await publishShort('slot3');
        await notifyTelegramUpload(result);
      } catch (err) {
        logger.error('Scheduled Slot 3 error:', err.message);
      }
    },
    { timezone: config.cron.timezone }
  );

  // 5. Prime-Time Night Slot 5: IPL & Cricket Buzz (09:00 PM IST)
  cron.schedule(
    config.cron.slot5,
    async () => {
      logger.slot('slot5', 'Executing daily prime-time scheduled run: IPL & Cricket Buzz');
      try {
        const result = await publishShort('slot5');
        await notifyTelegramUpload(result);
      } catch (err) {
        logger.error('Scheduled Slot 5 error:', err.message);
      }
    },
    { timezone: config.cron.timezone }
  );

  logger.success('All 5 Daily Shorts schedules are active and armed!');
}

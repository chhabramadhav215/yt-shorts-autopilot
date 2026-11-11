import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { publishShort, generateShortVideo } from '../pipeline.js';
import { checkYouTubeAuth } from '../youtube/client.js';

let botInstance = null;

export function initTelegramBot() {
  if (!config.telegram.botToken) {
    logger.warn('TELEGRAM_BOT_TOKEN not configured in .env. Telegram listener will be disabled.');
    logger.info('To enable Telegram control from your phone, add TELEGRAM_BOT_TOKEN in .env');
    return null;
  }

  const bot = new TelegramBot(config.telegram.botToken, { polling: true });
  botInstance = bot;

  logger.success('Telegram Bot listener started successfully in polling mode!');

  // Security authorization helper
  const isAuthorized = (msg) => {
    if (!config.telegram.allowedUserId) return true; // Open if not specified
    const allowed = config.telegram.allowedUserId.split(',').map((id) => id.trim());
    return allowed.includes(String(msg.from.id));
  };

  const handleUnauthorized = (msg) => {
    bot.sendMessage(
      msg.chat.id,
      `🔒 *Unauthorized Access*\n\nYour Telegram User ID is: \`${msg.from.id}\`\nAdd this ID to \`TELEGRAM_ALLOWED_USER_ID\` in your \`.env\` file to grant access.`,
      { parse_mode: 'Markdown' }
    );
  };

  // /start and /help command
  bot.onText(/\/(start|help)/, (msg) => {
    if (!isAuthorized(msg)) return handleUnauthorized(msg);

    const helpMessage = `
🎬 *YouTube Shorts Automation Dashboard* 🚀

Welcome to your automated channel publisher! Control your daily slots directly from your phone:

📌 *Instant Generation & Upload:*
• \`/slot1\` - 👶 Cute baby dance / funny animation short
• \`/slot2\` - 🕉️ Hindu devotional story with peaceful narration
• \`/slot4\` - 🏹 Epic Hindu scriptures & wisdom clips (Gita, Mahabharata, Ramayana)
• \`/slot3\` - 🚨 Viral breaking news / TRP explainer
• \`/slot5\` - 🏏 IPL & Cricket Buzz (Trades, Auction, Captaincy)
• \`/news <topic>\` - 📰 Explainer short on any specific custom news topic
• \`/cricket <topic>\` - 🏏 Cricket short on any player or team
• \`/custom <topic>\` - 💡 Custom short on any topic

👁️ *Preview Without Uploading:*
• \`/preview slot1\` - Generates Slot 1 video and sends MP4 here
• \`/preview slot2\` - Generates Slot 2 video and sends MP4 here
• \`/preview slot4\` - Generates Slot 4 video and sends MP4 here
• \`/preview slot3\` - Generates Slot 3 video and sends MP4 here
• \`/preview slot5\` - Generates Slot 5 video and sends MP4 here

⚙️ *Settings & Status:*
• \`/status\` - View YouTube channel status & token validity
• \`/privacy public|unlisted|private\` - Set upload privacy

⏰ *Daily Schedule:*
• Slot 1 (Entertainment): 09:00 AM
• Slot 2 (Devotional): 02:00 PM
• Slot 4 (Epic Wisdom Clips): 05:00 PM
• Slot 3 (Viral News): 07:30 PM
`;
    bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: 'Markdown' });
  });

  // /status command
  bot.onText(/\/status/, async (msg) => {
    if (!isAuthorized(msg)) return handleUnauthorized(msg);

    bot.sendMessage(msg.chat.id, '🔍 Checking YouTube Channel connection status...');
    const authStatus = await checkYouTubeAuth();

    if (authStatus.authenticated) {
      bot.sendMessage(
        msg.chat.id,
        `✅ *YouTube Connected!*\n\n• *Channel:* ${authStatus.channelTitle}\n• *Channel ID:* \`${authStatus.channelId}\`\n• *Subscribers:* ${authStatus.subscribers || 'Hidden'}\n• *Default Privacy:* \`${config.youtube.privacyStatus}\`\n• *Auto-refresher:* Active`,
        { parse_mode: 'Markdown' }
      );
    } else {
      bot.sendMessage(
        msg.chat.id,
        `❌ *YouTube Disconnected or Error:*\n${authStatus.error}\n\nPlease run \`npm run auth\` on your server or check client_secret.json.`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  // /privacy command
  bot.onText(/\/privacy\s*(.*)/, (msg, match) => {
    if (!isAuthorized(msg)) return handleUnauthorized(msg);

    const val = (match[1] || '').trim().toLowerCase();
    if (['public', 'unlisted', 'private'].includes(val)) {
      config.youtube.privacyStatus = val;
      bot.sendMessage(msg.chat.id, `✅ YouTube upload privacy set to: *${val.toUpperCase()}*`, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(msg.chat.id, `Current privacy is: \`${config.youtube.privacyStatus}\`\nUsage: \`/privacy public\` or \`/privacy private\` or \`/privacy unlisted\``, { parse_mode: 'Markdown' });
    }
  });

  // /slot1 command
  bot.onText(/\/(slot1|entertainment)/, async (msg) => {
    if (!isAuthorized(msg)) return handleUnauthorized(msg);
    triggerUpload(bot, msg.chat.id, 'slot1');
  });

  // /slot2 command
  bot.onText(/\/(slot2|devotional)/, async (msg) => {
    if (!isAuthorized(msg)) return handleUnauthorized(msg);
    triggerUpload(bot, msg.chat.id, 'slot2');
  });

  // /slot4 command (Epic Hindu Scriptures & Wisdom Clips)
  bot.onText(/\/(slot4|scriptures|epic|gita|mahabharata)/, async (msg) => {
    if (!isAuthorized(msg)) return handleUnauthorized(msg);
    triggerUpload(bot, msg.chat.id, 'slot4');
  });

  // /slot3 and /news command
  bot.onText(/\/(slot3|news)(?:\s+(.*))?/, async (msg, match) => {
    if (!isAuthorized(msg)) return handleUnauthorized(msg);
    const customTopic = match[2] ? match[2].trim() : null;
    triggerUpload(bot, msg.chat.id, 'slot3', customTopic);
  });

  // /slot5 and /cricket command
  bot.onText(/\/(slot5|cricket|ipl)(?:\s+(.*))?/, async (msg, match) => {
    if (!isAuthorized(msg)) return handleUnauthorized(msg);
    const customTopic = match[2] ? match[2].trim() : null;
    triggerUpload(bot, msg.chat.id, 'slot5', customTopic);
  });

  // /custom command
  bot.onText(/\/custom\s+(.+)/, async (msg, match) => {
    if (!isAuthorized(msg)) return handleUnauthorized(msg);
    const customTopic = match[1].trim();
    triggerUpload(bot, msg.chat.id, 'slot3', customTopic);
  });

  // /preview command (renders and sends MP4 back to user in Telegram)
  bot.onText(/\/preview(?:\s+(.*))?/, async (msg, match) => {
    if (!isAuthorized(msg)) return handleUnauthorized(msg);

    const slotInput = (match[1] || 'slot1').trim().toLowerCase();
    let slot = 'slot1';
    if (slotInput.includes('2') || slotInput.includes('devo')) slot = 'slot2';
    else if (slotInput.includes('4') || slotInput.includes('scrip') || slotInput.includes('epic') || slotInput.includes('gita')) slot = 'slot4';
    else if (slotInput.includes('3') || slotInput.includes('news')) slot = 'slot3';
    else if (slotInput.includes('5') || slotInput.includes('cric') || slotInput.includes('ipl')) slot = 'slot5';

    bot.sendMessage(msg.chat.id, `🎨 Generating video preview for *${slot.toUpperCase()}*...\nPlease wait ~15-20 seconds.`, { parse_mode: 'Markdown' });

    try {
      const generated = await generateShortVideo(slot);
      bot.sendMessage(msg.chat.id, `📤 Uploading MP4 preview (${(fs.statSync(generated.videoPath).size / (1024 * 1024)).toFixed(1)} MB)...`);
      await bot.sendVideo(msg.chat.id, generated.videoPath, {
        caption: `🎬 *Preview: ${generated.title}*\nDuration: ${generated.duration.toFixed(1)}s\n\nTo publish this slot live, send: \`/${slot}\``,
        parse_mode: 'Markdown',
      });
    } catch (err) {
      bot.sendMessage(msg.chat.id, `❌ Failed to generate preview: ${err.message}`);
    }
  });

  return bot;
}

async function triggerUpload(bot, chatId, slot, customTopic = null) {
  bot.sendMessage(
    chatId,
    `🚀 *Starting generation for [${slot.toUpperCase()}]*...\n${customTopic ? `Topic: _${customTopic}_\n` : ''}Generating voiceover, burned-in subtitles, and 1080x1920 video...`,
    { parse_mode: 'Markdown' }
  );

  try {
    const result = await publishShort(slot, customTopic);
    bot.sendMessage(
      chatId,
      `🎉 *YouTube Short Published Successfully!*\n\n• *Title:* ${result.title}\n• *Slot:* ${result.slotName}\n• *Privacy:* \`${result.upload.privacyStatus}\`\n• *Duration:* ${result.duration.toFixed(1)}s\n\n🔗 *Shorts Link:* ${result.upload.url}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    logger.error('Telegram triggered upload failed:', err);
    bot.sendMessage(
      chatId,
      `❌ *Upload Failed for [${slot.toUpperCase()}]:*\n\`${err.message}\``,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Sends notification to Telegram owner on scheduled cron upload
 */
export async function notifyTelegramUpload(result) {
  if (!botInstance || !config.telegram.allowedUserId) return;
  const chatIds = config.telegram.allowedUserId.split(',').map((id) => id.trim());

  const message = `
⏰ *Scheduled Daily Short Uploaded!* 🚀

• *Slot:* ${result.slotName}
• *Title:* ${result.title}
• *Privacy:* \`${result.upload.privacyStatus}\`
• *Duration:* ${result.duration.toFixed(1)}s

🔗 *Watch on YouTube Shorts:* ${result.upload.url}
`;

  for (const chatId of chatIds) {
    try {
      await botInstance.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (e) {
      logger.warn(`Failed to send Telegram notification to ${chatId}: ${e.message}`);
    }
  }
}

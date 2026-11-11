import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

const ROOT_DIR = process.cwd();

// Find client secret file (checks client_secret.json, then client_secret.json.json)
let clientSecretPath = process.env.YOUTUBE_CLIENT_SECRET_PATH 
  ? path.resolve(process.env.YOUTUBE_CLIENT_SECRET_PATH)
  : path.join(ROOT_DIR, 'client_secret.json');

if (!fs.existsSync(clientSecretPath) && fs.existsSync(path.join(ROOT_DIR, 'client_secret.json.json'))) {
  clientSecretPath = path.join(ROOT_DIR, 'client_secret.json.json');
}

const tokenPath = process.env.YOUTUBE_TOKEN_PATH
  ? path.resolve(process.env.YOUTUBE_TOKEN_PATH)
  : path.join(ROOT_DIR, 'token.json');

export const config = {
  rootDir: ROOT_DIR,
  outputDir: path.join(ROOT_DIR, 'output'),
  assetsDir: path.join(ROOT_DIR, 'assets'),
  
  youtube: {
    clientSecretPath,
    tokenPath,
    privacyStatus: process.env.UPLOAD_PRIVACY || process.env.YOUTUBE_PRIVACY_STATUS || 'public', // 'public' for permanent automatic live uploads
    scopes: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/youtube.force-ssl',
      'https://www.googleapis.com/auth/youtube.readonly'
    ]
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    allowedUserId: process.env.TELEGRAM_ALLOWED_USER_ID || '', // Optional: Telegram Chat/User ID allowed to trigger commands
  },

  cron: {
    slot1: process.env.SLOT1_CRON || '0 9 * * *',   // 9:00 AM Morning
    slot2: process.env.SLOT2_CRON || '0 14 * * *',  // 2:00 PM Afternoon
    slot4: process.env.SLOT4_CRON || '0 17 * * *',  // 5:00 PM Evening (Epic Scriptures & Wisdom)
    slot3: process.env.SLOT3_CRON || '30 19 * * *', // 7:30 PM Night
    slot5: process.env.SLOT5_CRON || '0 21 * * *',  // 9:00 PM Night (Prime IPL & Cricket Buzz)
    timezone: process.env.TIMEZONE || 'Asia/Kolkata',
  },

  voices: {
    slot1: process.env.SLOT1_VOICE || 'hi-IN-SwaraNeural',      // Cute child-like Hindi voice (with +38% pitch, +6% rate)
    slot2: process.env.SLOT2_VOICE || 'hi-IN-MadhurNeural',      // Peaceful Hindi voice (or hi-IN-SwaraNeural)
    slot3: process.env.SLOT3_VOICE || 'hi-IN-MadhurNeural',      // Fast-paced News Anchor Hindi voice
    slot4: process.env.SLOT4_VOICE || 'hi-IN-MadhurNeural',      // Epic Philosophical Hindi voice
    slot5: process.env.SLOT5_VOICE || 'hi-IN-MadhurNeural',      // High-energy Cricket Anchor Hindi voice (+10% speed)
  },

  meta: {
    accessToken: process.env.META_ACCESS_TOKEN || '',
    instagramAccountId: process.env.INSTAGRAM_ACCOUNT_ID || '',
    facebookPageId: process.env.FACEBOOK_PAGE_ID || '',
    enableFacebookReels: process.env.ENABLE_FACEBOOK_REELS !== 'false',
  },

  pexelsApiKey: process.env.PEXELS_API_KEY || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
};

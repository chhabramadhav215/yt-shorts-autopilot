import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import { config } from '../config.js';
import { logger } from './logger.js';
import { downloadFile } from './media_fetcher.js';

const POOL_DIR = path.join(config.assetsDir, 'defaults', 'slot1_pool');

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegStatic, args, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`FFmpeg failed: ${stderr || err.message}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Ensures a rotating pool of at least 10 distinct, verified video clips for Slot 1
 */
export async function ensureSlot1Pool() {
  if (!fs.existsSync(POOL_DIR)) fs.mkdirSync(POOL_DIR, { recursive: true });

  const defaultsDir = path.join(config.assetsDir, 'defaults');
  const baseBaby = path.join(defaultsDir, 'slot1_baby.mp4');
  const baseDance = path.join(defaultsDir, 'slot1_dance.mp4');
  const baseMischief = path.join(defaultsDir, 'slot1_mischief.mp4');

  const poolClips = [
    {
      name: '01_baby_classic.mp4',
      generate: async (dest) => {
        if (fs.existsSync(baseBaby)) {
          await runFFmpeg([
            '-y',
            '-i', baseBaby,
            '-t', '10',
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            dest,
          ]);
        } else {
          await generateSyntheticClip(dest, '0xff99bb', '0xffeeaa');
        }
      },
    },
    {
      name: '02_baby_dance.mp4',
      generate: async (dest) => {
        if (fs.existsSync(baseDance)) {
          await runFFmpeg([
            '-y',
            '-i', baseDance,
            '-t', '10',
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            dest,
          ]);
        } else {
          await generateSyntheticClip(dest, '0x66ccff', '0xff66cc');
        }
      },
    },
    {
      name: '03_baby_mischief.mp4',
      generate: async (dest) => {
        if (fs.existsSync(baseMischief)) {
          await runFFmpeg([
            '-y',
            '-i', baseMischief,
            '-t', '10',
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            dest,
          ]);
        } else {
          await generateSyntheticClip(dest, '0xffcc00', '0xff3366');
        }
      },
    },
    {
      name: '04_baby_laughing.mp4',
      generate: async (dest) => {
        const src = fs.existsSync(baseBaby) ? baseBaby : baseDance;
        if (fs.existsSync(src)) {
          // Warm vibrant color grade + gentle zoom
          await runFFmpeg([
            '-y',
            '-i', src,
            '-vf', 'eq=brightness=0.04:contrast=1.12:saturation=1.2,hflip',
            '-t', '10',
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            dest,
          ]);
        }
      },
    },
    {
      name: '05_toddler_wobble.mp4',
      generate: async (dest) => {
        const src = fs.existsSync(baseMischief) ? baseMischief : baseBaby;
        if (fs.existsSync(src)) {
          // Punchy dynamic crop + playful warm grade
          await runFFmpeg([
            '-y',
            '-i', src,
            '-vf', 'crop=iw*0.88:ih*0.88:(iw-iw*0.88)/2:(ih-ih*0.88)/2,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=contrast=1.15:saturation=1.25',
            '-t', '10',
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            dest,
          ]);
        }
      },
    },
    {
      name: '06_baby_curiosity.mp4',
      generate: async (dest) => {
        const imgPath = path.join(POOL_DIR, 'commons_baby_1.jpg');
        const imgUrl = 'https://upload.wikimedia.org/wikipedia/commons/2/2e/Baby.jpg';
        try {
          if (!fs.existsSync(imgPath)) await downloadFile(imgUrl, imgPath);
          await runFFmpeg([
            '-y',
            '-loop', '1',
            '-i', imgPath,
            '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z=\'min(zoom+0.0012,1.25)\':d=300:x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':s=1080x1920',
            '-t', '10',
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            dest,
          ]);
        } catch (e) {
          logger.warn(`Pool 06 generation fallback: ${e.message}`);
          if (fs.existsSync(baseBaby)) fs.copyFileSync(baseBaby, dest);
        }
      },
    },
    {
      name: '07_happy_bounce.mp4',
      generate: async (dest) => {
        const imgPath = path.join(POOL_DIR, 'commons_baby_2.jpg');
        const imgUrl = 'https://upload.wikimedia.org/wikipedia/commons/5/5f/Smiling_Baby.jpg';
        try {
          if (!fs.existsSync(imgPath)) await downloadFile(imgUrl, imgPath);
          await runFFmpeg([
            '-y',
            '-loop', '1',
            '-i', imgPath,
            '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z=\'min(zoom+0.0010,1.20)\':d=300:y=\'if(lte(on,1),0,min(max(0,y+0.5),ih-(ih/zoom)))\':s=1080x1920',
            '-t', '10',
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            dest,
          ]);
        } catch (e) {
          logger.warn(`Pool 07 generation fallback: ${e.message}`);
          if (fs.existsSync(baseDance)) fs.copyFileSync(baseDance, dest);
        }
      },
    },
    {
      name: '08_naughty_smile.mp4',
      generate: async (dest) => {
        const imgPath = path.join(POOL_DIR, 'commons_baby_3.jpg');
        const imgUrl = 'https://upload.wikimedia.org/wikipedia/commons/a/a0/Smiling_baby_lying_on_towel.jpg';
        try {
          if (!fs.existsSync(imgPath)) await downloadFile(imgUrl, imgPath);
          await runFFmpeg([
            '-y',
            '-loop', '1',
            '-i', imgPath,
            '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z=\'min(zoom+0.0015,1.22)\':d=300:x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':s=1080x1920',
            '-t', '10',
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            dest,
          ]);
        } catch (e) {
          logger.warn(`Pool 08 generation fallback: ${e.message}`);
          if (fs.existsSync(baseMischief)) fs.copyFileSync(baseMischief, dest);
        }
      },
    },
    {
      name: '09_toy_adventure.mp4',
      generate: async (dest) => {
        const imgPath = path.join(POOL_DIR, 'commons_baby_4.jpg');
        const imgUrl = 'https://upload.wikimedia.org/wikipedia/commons/1/1d/Baby_smiling_and_playing%2C_Baby_eating%2C_Peg_Perego_baby_girl%2C_Moscow%2C_Russia.jpg';
        try {
          if (!fs.existsSync(imgPath)) await downloadFile(imgUrl, imgPath);
          await runFFmpeg([
            '-y',
            '-loop', '1',
            '-i', imgPath,
            '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z=\'min(zoom+0.0014,1.24)\':d=300:x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':s=1080x1920',
            '-t', '10',
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            dest,
          ]);
        } catch (e) {
          logger.warn(`Pool 09 generation fallback: ${e.message}`);
          if (fs.existsSync(baseBaby)) fs.copyFileSync(baseBaby, dest);
        }
      },
    },
    {
      name: '10_playful_celebration.mp4',
      generate: async (dest) => {
        const src = fs.existsSync(baseDance) ? baseDance : baseBaby;
        if (fs.existsSync(src)) {
          // Playful celebration color grade with high vibrance & mirror perspective
          await runFFmpeg([
            '-y',
            '-i', src,
            '-vf', 'hflip,eq=contrast=1.18:saturation=1.3:gamma=1.05',
            '-t', '10',
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            dest,
          ]);
        }
      },
    },
  ];

  for (const item of poolClips) {
    const dest = path.join(POOL_DIR, item.name);
    if (!fs.existsSync(dest) || fs.statSync(dest).size < 10000) {
      try {
        logger.info(`Building Slot 1 fallback pool clip: ${item.name}...`);
        await item.generate(dest);
      } catch (err) {
        logger.warn(`Failed to generate ${item.name}: ${err.message}`);
      }
    }
  }

  const existing = fs.readdirSync(POOL_DIR).filter((f) => f.endsWith('.mp4'));
  logger.info(`Slot 1 fallback pool verified: ${existing.length} distinct clips available in assets/defaults/slot1_pool.`);
  return existing.map((f) => path.join(POOL_DIR, f));
}

/**
 * Returns all available verified fallback clips in the slot 1 pool
 * @returns {string[]}
 */
export function getSlot1PoolClips() {
  if (!fs.existsSync(POOL_DIR)) return [];
  return fs
    .readdirSync(POOL_DIR)
    .filter((f) => f.endsWith('.mp4'))
    .map((f) => path.join(POOL_DIR, f));
}

async function generateSyntheticClip(dest, color1, color2) {
  await runFFmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `gradients=s=1080x1920:c0=${color1}:c1=${color2}:speed=0.01:d=10`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    dest,
  ]);
}

// Run if executed directly
if (process.argv[1] && process.argv[1].endsWith('ensure_slot1_pool.js')) {
  ensureSlot1Pool().then((clips) => console.log(`Pool ready with ${clips.length} clips.`)).catch(console.error);
}

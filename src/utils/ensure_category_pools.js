import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import { config } from '../config.js';
import { logger } from './logger.js';

const DEVOTIONAL_DIR = path.join(config.assetsDir, 'clips', 'devotional');
const SCRIPTURES_DIR = path.join(config.assetsDir, 'clips', 'scriptures');
const CRICKET_DIR = path.join(config.assetsDir, 'clips', 'cricket');

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(process.env.FFMPEG_PATH || ffmpegStatic, args, (err, stdout, stderr) => {
      if (err) reject(new Error(`FFmpeg failed: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

async function createVariant({ src, dest, ss, t, vf }) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 100000) {
    return;
  }
  if (!fs.existsSync(src)) {
    return;
  }
  const tmpDest = dest + '.tmp.mp4';
  const args = ['-y'];
  if (ss) args.push('-ss', String(ss));
  args.push('-i', src);
  if (t) args.push('-t', String(t));
  args.push(
    '-vf', vf,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    tmpDest
  );
  try {
    await runFFmpeg(args);
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    fs.renameSync(tmpDest, dest);
    logger.info(`Generated pool variant: ${path.basename(dest)}`);
  } catch (err) {
    logger.warn(`Failed to generate pool variant ${path.basename(dest)}: ${err.message}`);
    try { if (fs.existsSync(tmpDest)) fs.unlinkSync(tmpDest); } catch (_) {}
  }
}

/**
 * Ensures devotional and scriptures clip directories have at least 12 distinct video assets each
 */
export async function ensureCategoryPools() {
  [DEVOTIONAL_DIR, SCRIPTURES_DIR, CRICKET_DIR].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  const baseStadium = path.join(CRICKET_DIR, 'stadium_bg.mp4');
  if (fs.existsSync(baseStadium)) {
    await createVariant({
      src: baseStadium,
      dest: path.join(CRICKET_DIR, 'cricket_nets_practice.mp4'),
      ss: 1,
      t: 10,
      vf: 'hflip,eq=contrast=1.2:brightness=0.03:saturation=1.35,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
    });

    await createVariant({
      src: baseStadium,
      dest: path.join(CRICKET_DIR, 'cricket_match_action.mp4'),
      ss: 2,
      t: 10,
      vf: 'eq=contrast=1.18:brightness=0.05:saturation=1.25,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
    });
  }

  const shivaSrc = path.join(DEVOTIONAL_DIR, 'shiva_mahadev_darshan.mp4');
  const aartiSrc = path.join(DEVOTIONAL_DIR, 'temple_sacred_aarti.mp4');
  const kedarSrc = path.join(DEVOTIONAL_DIR, 'himalayas_kedarnath_shrine.mp4');
  const krishnaSrc = path.join(DEVOTIONAL_DIR, 'krishna_vrindavan_darshan.mp4');
  const hanumanSrc = path.join(DEVOTIONAL_DIR, 'hanuman_divine_darshan.mp4');
  const ganeshSrc = path.join(DEVOTIONAL_DIR, 'ganesha_divine_darshan.mp4');

  await createVariant({
    src: aartiSrc,
    dest: path.join(DEVOTIONAL_DIR, 'ganga_haridwar_aarti.mp4'),
    ss: 1,
    t: 10,
    vf: 'hflip,eq=contrast=1.18:brightness=0.04:saturation=1.25,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
  });

  await createVariant({
    src: kedarSrc,
    dest: path.join(DEVOTIONAL_DIR, 'kedarnath_mystic_morning.mp4'),
    ss: 3,
    t: 11,
    vf: 'eq=contrast=1.15:brightness=0.06:saturation=1.2,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
  });

  await createVariant({
    src: shivaSrc,
    dest: path.join(DEVOTIONAL_DIR, 'shiva_tandav_energy.mp4'),
    ss: 2,
    t: 11,
    vf: 'hflip,eq=contrast=1.2:brightness=0.03:saturation=1.3,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
  });

  await createVariant({
    src: krishnaSrc,
    dest: path.join(DEVOTIONAL_DIR, 'krishna_flute_divine.mp4'),
    ss: 1,
    t: 9,
    vf: 'hflip,eq=contrast=1.12:brightness=0.05:saturation=1.22,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
  });

  await createVariant({
    src: hanumanSrc,
    dest: path.join(DEVOTIONAL_DIR, 'hanuman_sanjeevani_bhakti.mp4'),
    ss: 1,
    t: 10,
    vf: 'eq=contrast=1.2:brightness=0.04:saturation=1.35,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
  });

  await createVariant({
    src: ganeshSrc,
    dest: path.join(DEVOTIONAL_DIR, 'ram_mandir_divine_jyoti.mp4'),
    ss: 1,
    t: 9,
    vf: 'hflip,eq=contrast=1.15:brightness=0.06:saturation=1.3,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
  });

  const geetaSrc = path.join(SCRIPTURES_DIR, 'geeta_saar.mp4');
  const karnaSrc = path.join(SCRIPTURES_DIR, 'karna_daan.mp4');
  const bhishmaSrc = path.join(SCRIPTURES_DIR, 'bhishma_pratigya.mp4');
  const ramaSrc = path.join(SCRIPTURES_DIR, 'ramayana_rama.mp4');
  const vishwaSrc = path.join(SCRIPTURES_DIR, 'vishwaroop_darshan.mp4');
  const hanumanRavanaSrc = path.join(SCRIPTURES_DIR, 'hanuman_ravana.mp4');

  await createVariant({
    src: geetaSrc,
    dest: path.join(SCRIPTURES_DIR, 'kurukshetra_geeta_updesh.mp4'),
    ss: 14,
    t: 12,
    vf: 'hflip,eq=contrast=1.18:brightness=0.03:saturation=1.25,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
  });

  await createVariant({
    src: karnaSrc,
    dest: path.join(SCRIPTURES_DIR, 'arjuna_dhanush_focus.mp4'),
    ss: 12,
    t: 12,
    vf: 'eq=contrast=1.2:brightness=0.04:saturation=1.3,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
  });

  await createVariant({
    src: ramaSrc,
    dest: path.join(SCRIPTURES_DIR, 'ramayana_lanka_vijay.mp4'),
    ss: 1,
    t: 10,
    vf: 'hflip,eq=contrast=1.15:brightness=0.05:saturation=1.2,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
  });

  await createVariant({
    src: vishwaSrc,
    dest: path.join(SCRIPTURES_DIR, 'sudarshana_chakra_divine.mp4'),
    ss: 10,
    t: 12,
    vf: 'hflip,eq=contrast=1.22:brightness=0.04:saturation=1.35,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
  });

  await createVariant({
    src: bhishmaSrc,
    dest: path.join(SCRIPTURES_DIR, 'bhishma_gangaputra_oath.mp4'),
    ss: 12,
    t: 12,
    vf: 'eq=contrast=1.16:brightness=0.04:saturation=1.2,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
  });

  await createVariant({
    src: hanumanRavanaSrc,
    dest: path.join(SCRIPTURES_DIR, 'hanuman_lanka_dahan.mp4'),
    ss: 1,
    t: 10,
    vf: 'hflip,eq=contrast=1.2:brightness=0.05:saturation=1.3,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
  });
}

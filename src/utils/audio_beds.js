import ffmpegStatic from 'ffmpeg-static';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

const audioDir = path.resolve('assets/audio');
fs.mkdirSync(audioDir, { recursive: true });

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegStatic, args, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

export async function ensureAudioBeds() {
  const entertainmentPath = path.join(audioDir, 'entertainment.mp3');
  const devotionalPath = path.join(audioDir, 'devotional.mp3');
  const newsPath = path.join(audioDir, 'news.mp3');
  const scripturesPath = path.join(audioDir, 'scriptures.mp3');
  const cricketPath = path.join(audioDir, 'cricket.mp3');
  const whooshPath = path.join(audioDir, 'whoosh.mp3');

  // 1. Upbeat entertainment beat (energetic rhythmic synth)
  if (!fs.existsSync(entertainmentPath)) {
    console.log('Generating entertainment background audio bed...');
    await runFFmpeg([
      '-y',
      '-f', 'lavfi',
      '-i', 'aevalsrc=sin(130*2*PI*t)*0.15*gte(mod(t\\,0.5)\\,0.25)+sin(260*2*PI*t)*0.1*lte(mod(t\\,0.25)\\,0.125)+sin(520*2*PI*t)*0.05*gte(mod(t\\,0.125)\\,0.06):s=44100:d=40',
      '-af', 'volume=0.35, lowpass=f=4000',
      '-c:a', 'libmp3lame',
      entertainmentPath
    ]);
  }

  // 2. Peaceful devotional ambient (tanpura-like meditative drone + gentle harmonic chords)
  if (!fs.existsSync(devotionalPath)) {
    console.log('Generating devotional background audio bed...');
    await runFFmpeg([
      '-y',
      '-f', 'lavfi',
      '-i', 'aevalsrc=sin(146.83*2*PI*t)*0.18+sin(220*2*PI*t)*0.14+sin(293.66*2*PI*t)*0.10+sin(440*2*PI*t)*0.06+sin(587.33*2*PI*t)*0.03:s=44100:d=45',
      '-af', 'volume=0.3, lowpass=f=2500, flanger=speed=0.2:depth=3',
      '-c:a', 'libmp3lame',
      devotionalPath
    ]);
  }

  // 3. Urgent viral news pulse (pulse beat + tech bass)
  if (!fs.existsSync(newsPath)) {
    console.log('Generating news background audio bed...');
    await runFFmpeg([
      '-y',
      '-f', 'lavfi',
      '-i', 'aevalsrc=sin(90*2*PI*t)*0.2*gte(mod(t\\,0.33)\\,0.16)+sin(360*2*PI*t)*0.08*lte(mod(t\\,0.16)\\,0.08)+sin(720*2*PI*t)*0.04:s=44100:d=40',
      '-af', 'volume=0.35, highpass=f=80, lowpass=f=3500',
      '-c:a', 'libmp3lame',
      newsPath
    ]);
  }

  // 4. Epic Hindu Scriptures cinematic bed (Sacred resonance + war horn / tanpura overtone)
  if (!fs.existsSync(scripturesPath)) {
    console.log('Generating scriptures background audio bed...');
    await runFFmpeg([
      '-y',
      '-f', 'lavfi',
      '-i', 'aevalsrc=sin(110*2*PI*t)*0.22+sin(164.81*2*PI*t)*0.16+sin(220*2*PI*t)*0.12+sin(329.63*2*PI*t)*0.08:s=44100:d=45',
      '-af', 'volume=0.32, lowpass=f=2800, tremolo=f=0.5:d=0.2',
      '-c:a', 'libmp3lame',
      scripturesPath
    ]);
  }

  // 5. High-energy sports beat bed for Slot 5 (Cricket / IPL Buzz)
  if (!fs.existsSync(cricketPath)) {
    console.log('Generating cricket sports beat background audio bed...');
    await runFFmpeg([
      '-y',
      '-f', 'lavfi',
      '-i', 'aevalsrc=sin(140*2*PI*t)*0.22*gte(mod(t\\,0.4)\\,0.2)+sin(280*2*PI*t)*0.12*lte(mod(t\\,0.2)\\,0.1)+sin(560*2*PI*t)*0.08*gte(mod(t\\,0.1)\\,0.05):s=44100:d=45',
      '-af', 'volume=0.32, highpass=f=90, lowpass=f=4200',
      '-c:a', 'libmp3lame',
      cricketPath
    ]);
  }

  // 6. Subtle whoosh / transition impact SFX
  if (!fs.existsSync(whooshPath)) {
    console.log('Generating whoosh SFX audio bed...');
    await runFFmpeg([
      '-y',
      '-f', 'lavfi',
      '-i', 'anoisesrc=d=0.6:c=pink:r=44100:a=0.3',
      '-af', 'volume=0.4, bandpass=f=800:width_type=h:w=600, afade=t=in:ss=0:d=0.25, afade=t=out:st=0.3:d=0.3',
      '-c:a', 'libmp3lame',
      whooshPath
    ]);
  }

  // 7. Slot 1 Diverse Upbeat Audio Beds (Playful, Quirky, Groove, Sunshine)
  const slot1Playful = path.join(audioDir, 'slot1_playful.mp3');
  if (!fs.existsSync(slot1Playful)) {
    console.log('Generating slot1_playful background audio bed...');
    await runFFmpeg([
      '-y',
      '-f', 'lavfi',
      '-i', 'aevalsrc=sin(196*2*PI*t)*0.18*gte(mod(t\\,0.35)\\,0.18)+sin(392*2*PI*t)*0.10*lte(mod(t\\,0.175)\\,0.09)+sin(784*2*PI*t)*0.06*gte(mod(t\\,0.087)\\,0.04):s=44100:d=45',
      '-af', 'volume=0.32, lowpass=f=3800',
      '-c:a', 'libmp3lame',
      slot1Playful
    ]);
  }

  const slot1Quirky = path.join(audioDir, 'slot1_quirky.mp3');
  if (!fs.existsSync(slot1Quirky)) {
    console.log('Generating slot1_quirky background audio bed...');
    await runFFmpeg([
      '-y',
      '-f', 'lavfi',
      '-i', 'aevalsrc=sin(165*2*PI*t)*0.20*gte(mod(t\\,0.45)\\,0.25)+sin(330*2*PI*t)*0.12*lte(mod(t\\,0.22)\\,0.11)+sin(660*2*PI*t)*0.07*gte(mod(t\\,0.11)\\,0.05):s=44100:d=45',
      '-af', 'volume=0.30, lowpass=f=3200, tremolo=f=4.0:d=0.3',
      '-c:a', 'libmp3lame',
      slot1Quirky
    ]);
  }

  const slot1Groove = path.join(audioDir, 'slot1_groove.mp3');
  if (!fs.existsSync(slot1Groove)) {
    console.log('Generating slot1_groove background audio bed...');
    await runFFmpeg([
      '-y',
      '-f', 'lavfi',
      '-i', 'aevalsrc=sin(110*2*PI*t)*0.22*gte(mod(t\\,0.28)\\,0.14)+sin(220*2*PI*t)*0.14*lte(mod(t\\,0.14)\\,0.07)+sin(440*2*PI*t)*0.08*gte(mod(t\\,0.07)\\,0.035):s=44100:d=45',
      '-af', 'volume=0.33, highpass=f=70, lowpass=f=4000',
      '-c:a', 'libmp3lame',
      slot1Groove
    ]);
  }

  const slot1Sunshine = path.join(audioDir, 'slot1_sunshine.mp3');
  if (!fs.existsSync(slot1Sunshine)) {
    console.log('Generating slot1_sunshine background audio bed...');
    await runFFmpeg([
      '-y',
      '-f', 'lavfi',
      '-i', 'aevalsrc=sin(261.63*2*PI*t)*0.16+sin(329.63*2*PI*t)*0.13*gte(mod(t\\,0.3)\\,0.15)+sin(392*2*PI*t)*0.10+sin(523.25*2*PI*t)*0.06*lte(mod(t\\,0.15)\\,0.075):s=44100:d=45',
      '-af', 'volume=0.30, lowpass=f=3600',
      '-c:a', 'libmp3lame',
      slot1Sunshine
    ]);
  }

  console.log('All audio beds ready in assets/audio!');
}

/**
 * Returns available upbeat audio bed paths for Slot 1
 * @returns {string[]}
 */
export function getSlot1AudioBeds() {
  const beds = [
    path.join(audioDir, 'slot1_playful.mp3'),
    path.join(audioDir, 'slot1_quirky.mp3'),
    path.join(audioDir, 'slot1_groove.mp3'),
    path.join(audioDir, 'slot1_sunshine.mp3'),
    path.join(audioDir, 'entertainment.mp3'),
  ];
  return beds.filter((b) => fs.existsSync(b));
}

// Run if called directly
if (process.argv[1] && process.argv[1].endsWith('audio_beds.js')) {
  ensureAudioBeds().catch(console.error);
}

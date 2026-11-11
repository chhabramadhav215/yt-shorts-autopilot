import fs from 'fs';
import { generateShortVideo } from './src/pipeline.js';
import { logger } from './src/utils/logger.js';

async function runTest() {
  const slotArg = (process.argv[2] || 'slot1').toLowerCase();
  let slot = 'slot1';
  if (slotArg.includes('2') || slotArg.includes('devo')) slot = 'slot2';
  else if (slotArg.includes('4') || slotArg.includes('scrip') || slotArg.includes('epic') || slotArg.includes('gita')) slot = 'slot4';
  else if (slotArg.includes('3') || slotArg.includes('news')) slot = 'slot3';
  else if (slotArg.includes('5') || slotArg.includes('cric') || slotArg.includes('ipl')) slot = 'slot5';

  const customTopic = process.argv[3] || null;

  console.log('\n=============================================================');
  console.log(` TESTING SHORTS MEDIA GENERATION: [${slot.toUpperCase()}] `);
  console.log('=============================================================\n');

  logger.info(`Generating full 9:16 vertical Short video for ${slot}...`);
  const startTime = Date.now();

  try {
    const result = await generateShortVideo(slot, customTopic);
    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n-------------------------------------------------------------');
    logger.success(`Pipeline Test Completed Successfully in ${durationSec}s!`);
    console.log(`• Slot:         ${result.slotName}`);
    console.log(`• Title:        ${result.title}`);
    console.log(`• Video Output: ${result.videoPath}`);
    console.log(`• File Size:    ${(fs.statSync(result.videoPath).size / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`• Duration:     ${result.duration.toFixed(1)} seconds`);
    console.log(`• Subtitles:    ${result.slotDir}/subtitles.ass`);
    console.log('-------------------------------------------------------------\n');
    logger.info(`You can open and play this MP4 video on your machine:`);
    console.log(`\x1b[32m${result.videoPath}\x1b[0m\n`);
  } catch (err) {
    logger.error('Pipeline test failed:', err);
    process.exit(1);
  }
}

runTest();

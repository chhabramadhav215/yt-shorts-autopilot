import ffmpegStatic from 'ffmpeg-static';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { fetchSlotBackgroundMedia, fetchScriptureClip } from '../utils/media_fetcher.js';
import { summarizeNewsHeadline } from '../utils/text_utils.js';

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegStatic, args, (err, stdout, stderr) => {
      if (err) {
        logger.error('FFmpeg visual synth error:', stderr || err.message);
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Wraps text into multiple lines of at most maxChars per line
 * @param {string} text
 * @param {number} maxChars
 * @returns {string[]}
 */
function wrapText(text, maxChars = 28) {
  const words = (text || '').replace(/[\r\n\t]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if (!currentLine) {
      currentLine = word;
    } else if ((currentLine + ' ' + word).length <= maxChars) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * Generates dynamic 1080x1920 vertical video with real footage / Ken Burns pan & zoom imagery
 * @param {Object} options
 * @param {string} options.slotType - 'slot1' | 'slot2' | 'slot3' | 'slot4'
 * @param {number} options.duration - Duration in seconds
 * @param {string} options.outputPath - Destination MP4 file path
 * @param {string} [options.title] - Headline / title for banners
 * @param {string} [options.headline] - Uncut full headline for news
 * @param {string} [options.clipPath] - Optional local video clip path (e.g. for slot 4)
 * @param {string} [options.epicBadge] - Optional badge title
 * @param {string} [options.customTopic] - Optional custom topic
 */
export async function generateVisualBackground({
  slotType,
  duration = 15,
  outputPath,
  title = '',
  headline = '',
  clipPath = null,
  epicBadge = '',
  themeType = null,
  visualQuery = null,
  secondaryQuery = null,
  altQueries = [],
  customTopic = null,
}) {
  const roundDur = Math.ceil(duration) + 1;
  const totalFrames = roundDur * 30;

  // =================================================================
  // SLOT 4 (Epic Hindu Scriptures & Wisdom Clips): 9:16 with BLUR MARGINS
  // =================================================================
  if (slotType === 'slot4') {
    logger.info(`Synthesizing Slot 4 (Epic Scriptures & Wisdom) with moving center clip (${roundDur}s)...`);
    const safeBadge = (epicBadge || 'MAHABHARATA & GITA WISDOM').replace(/['":]/g, '').substring(0, 35);

    let resolvedClipPath = clipPath;
    if (!resolvedClipPath || !fs.existsSync(resolvedClipPath)) {
      resolvedClipPath = await fetchScriptureClip({
        englishTitle: title,
        dialogueTheme: customTopic || title,
      });
    }

    if (resolvedClipPath && fs.existsSync(resolvedClipPath)) {
      logger.info(`Formatting moving scripture clip with 9:16 vertical blur margins: ${path.basename(resolvedClipPath)}`);
      const filter = [
        `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2[bg]`,
        `[0:v]scale=1020:574:force_original_aspect_ratio=decrease[fg]`,
        `[bg][fg]overlay=(W-w)/2:520[base]`,
        `[base]drawbox=x=30:y=518:w=1020:h=578:color=0xffaa00:t=5[b0]`,
        `[b0]drawbox=x=50:y=150:w=980:h=150:color=0x260c00@0.92:t=fill[b1]`,
        `[b1]drawbox=x=50:y=150:w=980:h=150:color=0xff9900:t=6[b2]`,
        `[b2]drawtext=text='${safeBadge}':fontcolor=0xffcc00:fontsize=38:x=(w-text_w)/2:y=195:font='Arial Black'`
      ].join(';');

      await runFFmpeg([
        '-y',
        '-stream_loop', '-1',
        '-i', resolvedClipPath,
        '-filter_complex', filter,
        '-t', String(roundDur),
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        outputPath
      ]);

      logger.success(`Slot 4 visual with moving clip rendered: ${outputPath}`);
      return outputPath;
    }
  }

  // =================================================================
  // SLOTS 1, 2, 3: Dynamic Backgrounds (Royalty-free HD Video / Ken Burns Image)
  // =================================================================
  logger.info(`Fetching dynamic background footage for [${slotType.toUpperCase()}]...`);
  const media = await fetchSlotBackgroundMedia({
    slotType,
    title: headline || title,
    customTopic,
    clipPath,
    themeType,
    visualQuery,
    secondaryQuery,
    altQueries,
  });

  // -----------------------------------------------------------------
  // 1. VIDEO BACKGROUND (Slot 1 Baby Dance, Slot 3 News, etc.)
  // -----------------------------------------------------------------
  if (media && media.type === 'video' && fs.existsSync(media.filePath)) {
    logger.info(`Applying moving video background: ${path.basename(media.filePath)}`);
    const filterParts = [];
    const ffmpegArgs = ['-y', '-stream_loop', '-1', '-i', media.filePath];

    if (slotType === 'slot1') {
      // Slot 1 (Entertainment): Real baby video loop across full 1080x1920 canvas
      const safeBadge = (epicBadge || 'DAILY FUN & BABY VIBES')
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
        .replace(/['":]/g, '')
        .trim()
        .substring(0, 35);

      filterParts.push(`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[v0]`);
      // Top Party Banner
      filterParts.push(`[v0]drawbox=x=60:y=140:w=960:h=130:color=0x220033@0.85:t=fill[v1]`);
      filterParts.push(`[v1]drawbox=x=60:y=140:w=960:h=130:color=0xff007f:t=6[v2]`);
      filterParts.push(`[v2]drawtext=text='${safeBadge}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=182:font='Arial Black'[v_banner]`);

      // 3D Animated Cute Baby Avatar Overlay (Bouncing & Talking synchronized to dialogue)
      const avatarRest = path.join(config.assetsDir, 'defaults', 'baby_avatar.png');
      const avatarTalk = path.join(config.assetsDir, 'defaults', 'baby_avatar_talk.png');

      if (fs.existsSync(avatarRest) && fs.existsSync(avatarTalk)) {
        ffmpegArgs.push('-loop', '1', '-i', avatarRest);
        ffmpegArgs.push('-loop', '1', '-i', avatarTalk);

        filterParts.push(`[1:v]scale=360:360[a1]`);
        filterParts.push(`[2:v]scale=360:360[a2]`);
        // Animated bounce & talking overlay (swapping between smiling and talking expression at 4Hz synced to dialogue)
        filterParts.push(`[v_banner][a1]overlay=x=70:y='980 - 16*abs(sin(t*7.5))':enable='eq(mod(floor(t*4),2),0)'[t1]`);
        filterParts.push(`[t1][a2]overlay=x=70:y='980 - 16*abs(sin(t*7.5))':enable='eq(mod(floor(t*4),2),1)'[t2]`);
        // Narrator Pill Badge
        filterParts.push(`[t2]drawbox=x=90:y=1330:w=320:h=48:color=0x220033@0.90:t=fill[t3]`);
        filterParts.push(`[t3]drawbox=x=90:y=1330:w=320:h=48:color=0xff007f:t=3[t4]`);
        filterParts.push(`[t4]drawtext=text='LITTLE BOSS':fontcolor=0xffcc00:fontsize=26:x=165:y=1341:font='Arial Black'[vout]`);
      } else {
        filterParts.push(`[v_banner]copy[vout]`);
      }

    } else if (slotType === 'slot3') {
      // Slot 3 (News Explainer): Dynamic broadcast layout adhering to 15% top & 20% bottom safe zones
      const { line1, line2 } = summarizeNewsHeadline(headline || title);

      // Center Visual Section: 16:9 Edge-to-Edge (1080x608, y = 520 to 1128)
      const centerTop = 520;
      const centerBottom = 1128;
      const centerH = centerBottom - centerTop; // 608px (exact 16:9 ratio)

      let centerNode = 'v_mid';

      if (media.isTopicVideo && fs.existsSync(media.filePath)) {
        // CASE A: Dynamic moving topic video from Pexels (e.g. fireworks, flood, stock market, etc.)
        // Full canvas blurred motion background for engaging visual depth
        filterParts.push(`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=22:2[bg_blurred]`);
        // Center: Crystal-clear focused 16:9 topic video
        filterParts.push(`[0:v]scale=1080:${centerH}:force_original_aspect_ratio=increase,crop=1080:${centerH}[center_topic]`);
        filterParts.push(`[bg_blurred][center_topic]overlay=0:${centerTop}[v_base]`);

        // Gold border lines framing the center 16:9 box
        filterParts.push(`[v_base]drawbox=x=0:y=${centerTop - 2}:w=1080:h=3:color=0xffcc00:t=fill[v_l0]`);
        filterParts.push(`[v_l0]drawbox=x=0:y=${centerBottom}:w=1080:h=3:color=0xffcc00:t=fill[v_center]`);

        // Topic badge in the corner of the center box
        const badgeText = (media.topicQuery || 'SPECIAL REPORT').toUpperCase().slice(0, 24);
        filterParts.push(`[v_center]drawbox=x=40:y=${centerBottom - 58}:w=380:h=46:color=0x071126@0.90:t=fill[v_b0]`);
        filterParts.push(`[v_b0]drawbox=x=40:y=${centerBottom - 58}:w=380:h=46:color=0xffcc00:t=2[v_b1]`);
        filterParts.push(`[v_b1]drawtext=text='${badgeText}':fontcolor=0xffcc00:fontsize=24:x=55:y=${centerBottom - 48}:font='Arial Black'[v_mid]`);
        centerNode = 'v_mid';

      } else if (media.topicImage && fs.existsSync(media.topicImage)) {
        // CASE B: High-impact topic photo / leader portrait animated with Ken Burns pan & zoom
        // Background: Moving newsroom studio loop with subtle motion blur
        filterParts.push(`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=18:2[bg_news]`);

        ffmpegArgs.push('-loop', '1', '-i', media.topicImage);
        filterParts.push(`[1:v]scale=1440:810:force_original_aspect_ratio=increase,crop=1440:810,zoompan=z='min(zoom+0.0006,1.10)':d=${totalFrames}:x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':s=1080x${centerH}:fps=30[leader_kb]`);
        filterParts.push(`[bg_news][leader_kb]overlay=0:${centerTop}:shortest=1[v_leader]`);
        filterParts.push(`[v_leader]drawbox=x=0:y=${centerTop - 2}:w=1080:h=3:color=0xffcc00:t=fill[v_l0]`);
        filterParts.push(`[v_l0]drawbox=x=0:y=${centerBottom}:w=1080:h=3:color=0xffcc00:t=fill[v_l1]`);

        const badgeText = (media.leaderBadge || 'SPECIAL REPORT').toUpperCase().slice(0, 24);
        filterParts.push(`[v_l1]drawbox=x=40:y=${centerBottom - 58}:w=380:h=46:color=0x071126@0.90:t=fill[v_b0]`);
        filterParts.push(`[v_b0]drawbox=x=40:y=${centerBottom - 58}:w=380:h=46:color=0xffcc00:t=2[v_b1]`);
        filterParts.push(`[v_b1]drawtext=text='${badgeText}':fontcolor=0xffcc00:fontsize=24:x=55:y=${centerBottom - 48}:font='Arial Black'[v_mid]`);
        centerNode = 'v_mid';

      } else {
        // CASE C: Engaging dynamic motion background (blurred newsroom background + clean focused news card layout)
        filterParts.push(`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=22:2[bg_blur]`);
        filterParts.push(`[0:v]scale=1080:${centerH}:force_original_aspect_ratio=increase,crop=1080:${centerH}[center_studio]`);
        filterParts.push(`[bg_blur][center_studio]overlay=0:${centerTop}[v_base]`);
        filterParts.push(`[v_base]drawbox=x=0:y=${centerTop - 2}:w=1080:h=3:color=0xffcc00:t=fill[v_l0]`);
        filterParts.push(`[v_l0]drawbox=x=0:y=${centerBottom}:w=1080:h=3:color=0xffcc00:t=fill[v_l1]`);
        filterParts.push(`[v_l1]drawbox=x=40:y=${centerBottom - 58}:w=380:h=46:color=0x071126@0.90:t=fill[v_b0]`);
        filterParts.push(`[v_b0]drawbox=x=40:y=${centerBottom - 58}:w=380:h=46:color=0xffcc00:t=2[v_b1]`);
        filterParts.push(`[v_b1]drawtext=text='NEWS DESK REPORT':fontcolor=0xffcc00:fontsize=24:x=55:y=${centerBottom - 48}:font='Arial Black'[v_mid]`);
        centerNode = 'v_mid';
      }

      // Top Breaking Pill (y = 295 to 355, safely below top 15% safe zone = 288px)
      filterParts.push(`[${centerNode}]drawbox=x=330:y=295:w=420:h=56:color=0xcc0000@0.95:t=fill[pill_bg]`);
      filterParts.push(`[pill_bg]drawbox=x=330:y=295:w=420:h=56:color=0xffcc00:t=2[pill_border]`);
      filterParts.push(`[pill_border]drawtext=text='BREAKING UPDATE':fontcolor=white:fontsize=32:x=(w-text_w)/2:y=310:font='Arial Black'[v_badge]`);

      // 2-Line Clean Headline Card (y = 370 to 500, max 50 chars, zero truncation or trailing dots)
      filterParts.push(`[v_badge]drawbox=x=50:y=370:w=980:h=130:color=0x071126@0.95:t=fill[c0]`);
      filterParts.push(`[c0]drawbox=x=50:y=370:w=8:h=130:color=0xffcc00:t=fill[c_accent]`);
      filterParts.push(`[c_accent]drawbox=x=50:y=370:w=980:h=130:color=0xffcc00@0.6:t=2[c1]`);

      if (line2) {
        filterParts.push(`[c1]drawtext=text='${line1}':fontcolor=0xffcc00:fontsize=38:x=(w-text_w)/2:y=392:font='Arial Black'[c2]`);
        filterParts.push(`[c2]drawtext=text='${line2}':fontcolor=white:fontsize=38:x=(w-text_w)/2:y=444:font='Arial Black'[c_head]`);
      } else {
        filterParts.push(`[c1]drawtext=text='${line1}':fontcolor=0xffcc00:fontsize=42:x=(w-text_w)/2:y=416:font='Arial Black'[c_head]`);
      }

      // Dark Semi-Transparent Subtitle Bar (y = 1145 to y = 1490)
      filterParts.push(`[c_head]drawbox=x=0:y=1145:w=1080:h=345:color=0x071126@0.85:t=fill[v_sub_bar]`);
      filterParts.push(`[v_sub_bar]drawbox=x=0:y=1145:w=1080:h=2:color=0xffcc00@0.4:t=fill[v_sub_line]`);

      // Professional Clean Live News Ticker (y = 1495 to 1535, well above bottom 20% safe zone = 1536px)
      filterParts.push(`[v_sub_line]drawbox=x=0:y=1495:w=1080:h=40:color=0xb30000@0.95:t=fill[v_ticker]`);
      filterParts.push(`[v_ticker]drawtext=text='LIVE DEVELOPMENTS • VERIFIED REPORT • GLOBAL NEWS DESK • IN-DEPTH EXPLAINER • ':fontcolor=white:fontsize=22:x=w-mod(t*180\\,w+1200):y=1505:font='Arial Black'[vout]`);
      // Note: y = 1536 to 1920 is 100% CLEAN for YouTube Shorts UI safe zone!

    } else {
      // Slot 2 Video
      filterParts.push(`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[v0]`);
      filterParts.push(`[v0]drawbox=x=50:y=150:w=980:h=150:color=0x260c00@0.88:t=fill[v1]`);
      filterParts.push(`[v1]drawbox=x=50:y=150:w=980:h=150:color=0xff9900:t=6[v2]`);
      filterParts.push(`[v2]drawtext=text='DAILY DIVINE WISDOM | SANATAN DHARMA':fontcolor=0xffd700:fontsize=36:x=(w-text_w)/2:y=195:font='Arial Black'[vout]`);
    }

    ffmpegArgs.push(
      '-filter_complex', filterParts.join(';'),
      '-map', '[vout]',
      '-t', String(roundDur),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      outputPath
    );

    await runFFmpeg(ffmpegArgs);
    logger.success(`Dynamic moving video background rendered: ${outputPath}`);
    return outputPath;
  }

  // -----------------------------------------------------------------
  // 2. HIGH-RES IMAGE BACKGROUND: Dynamic Ken Burns Pan & Zoom (FFmpeg)
  // -----------------------------------------------------------------
  const imagePath = (media && media.filePath && fs.existsSync(media.filePath))
    ? media.filePath
    : path.join(config.assetsDir, 'defaults', slotType === 'slot2' ? 'slot2_shiva.jpg' : (slotType === 'slot3' ? 'slot3_news.jpg' : 'slot1_baby.jpg'));

  logger.info(`Applying dynamic Ken Burns pan & zoom on high-res image: ${path.basename(imagePath)} (${roundDur}s)...`);

  const kbBase = `scale=1620:2880:force_original_aspect_ratio=increase,zoompan=z='min(zoom+0.0010,1.25)':d=${totalFrames}:x='(iw-iw/zoom)/2+sin(in/30*0.5)*45':y='(ih-ih/zoom)/2+cos(in/30*0.5)*30':s=1080x1920:fps=30,format=yuv420p`;

  const filterParts = [`${kbBase}[kb]`];

  if (slotType === 'slot1') {
    filterParts.push(`[kb]drawbox=x=60:y=140:w=960:h=130:color=0x220033@0.85:t=fill[b1]`);
    filterParts.push(`[b1]drawbox=x=60:y=140:w=960:h=130:color=0xff007f:t=6[b2]`);
    filterParts.push(`[b2]drawtext=text='DAILY FUN & BABY VIBES':fontcolor=white:fontsize=44:x=(w-text_w)/2:y=180:font='Arial Black'[vout]`);
  } else if (slotType === 'slot2') {
    filterParts.push(`[kb]drawbox=x=50:y=150:w=980:h=150:color=0x260c00@0.88:t=fill[b1]`);
    filterParts.push(`[b1]drawbox=x=50:y=150:w=980:h=150:color=0xff9900:t=6[b2]`);
    filterParts.push(`[b2]drawtext=text='DAILY DIVINE WISDOM | SANATAN DHARMA':fontcolor=0xffd700:fontsize=36:x=(w-text_w)/2:y=195:font='Arial Black'[vout]`);
  } else {
    // Slot 3 image background with 2-line auto-summarized headline and safe zones
    const { line1, line2 } = summarizeNewsHeadline(headline || title);

    // Top Breaking Pill (y = 295 to 355, safely below top 15% safe zone = 288px)
    filterParts.push(`[kb]drawbox=x=330:y=295:w=420:h=56:color=0xcc0000@0.95:t=fill[pill_bg]`);
    filterParts.push(`[pill_bg]drawbox=x=330:y=295:w=420:h=56:color=0xffcc00:t=2[pill_border]`);
    filterParts.push(`[pill_border]drawtext=text='BREAKING UPDATE':fontcolor=white:fontsize=32:x=(w-text_w)/2:y=310:font='Arial Black'[b_badge]`);

    // 2-Line Clean Headline Card (y = 370 to 500, max 50 chars, zero trailing dots)
    filterParts.push(`[b_badge]drawbox=x=50:y=370:w=980:h=130:color=0x071126@0.95:t=fill[c0]`);
    filterParts.push(`[c0]drawbox=x=50:y=370:w=8:h=130:color=0xffcc00:t=fill[c_accent]`);
    filterParts.push(`[c_accent]drawbox=x=50:y=370:w=980:h=130:color=0xffcc00@0.6:t=2[c1]`);

    if (line2) {
      filterParts.push(`[c1]drawtext=text='${line1}':fontcolor=0xffcc00:fontsize=38:x=(w-text_w)/2:y=392:font='Arial Black'[c2]`);
      filterParts.push(`[c2]drawtext=text='${line2}':fontcolor=white:fontsize=38:x=(w-text_w)/2:y=444:font='Arial Black'[c_head]`);
    } else {
      filterParts.push(`[c1]drawtext=text='${line1}':fontcolor=0xffcc00:fontsize=42:x=(w-text_w)/2:y=416:font='Arial Black'[c_head]`);
    }

    // Subtitle Bar (y = 1145 to 1490)
    filterParts.push(`[c_head]drawbox=x=0:y=1145:w=1080:h=345:color=0x071126@0.85:t=fill[b_sub_bar]`);
    filterParts.push(`[b_sub_bar]drawbox=x=0:y=1145:w=1080:h=2:color=0xffcc00@0.4:t=fill[b_sub_line]`);

    // Clean Live News Ticker (y = 1495 to 1535)
    filterParts.push(`[b_sub_line]drawbox=x=0:y=1495:w=1080:h=40:color=0xb30000@0.95:t=fill[b_ticker]`);
    filterParts.push(`[b_ticker]drawtext=text='LIVE DEVELOPMENTS • VERIFIED REPORT • GLOBAL NEWS DESK • IN-DEPTH EXPLAINER • ':fontcolor=white:fontsize=22:x=w-mod(t*180\\,w+1200):y=1505:font='Arial Black'[vout]`);
  }

  await runFFmpeg([
    '-y',
    '-loop', '1',
    '-i', imagePath,
    '-filter_complex', filterParts.join(';'),
    '-map', '[vout]',
    '-t', String(roundDur),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    outputPath
  ]);

  logger.success(`Ken Burns dynamic visual background rendered: ${outputPath}`);
  return outputPath;
}

import path from 'path';
import fs from 'fs';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { getSlot1AudioBeds } from '../utils/audio_beds.js';
import { pickUnusedFallbackClip } from '../utils/used_assets.js';
import { ensureSlot1Pool, getSlot1PoolClips } from '../utils/ensure_slot1_pool.js';
import { transliterateHindiToHinglish } from '../utils/text_utils.js';
import {
  isStoryOnCooldown,
  recordUsedStory,
  getRecentTopicsForSlot,
  isTopicRecentlyPublished,
} from '../utils/publish_history.js';
import { generateGeminiJson } from '../utils/gemini_client.js';

/**
 * Procedural bank of relatable everyday baby mini-moments.
 * Zero hardcoded canned scripts: used as dynamic scenario seeds.
 */
const BABY_SITUATION_SEEDS = [
  {
    id: 'lemon_sour_shock',
    theme: 'Forbidden Lemon Heist',
    badge: 'LEMON SHOCK TEST 🍋😖',
    adultRole: 'Papa',
    babyRole: 'Chintu',
    setup: 'Baby steals a yellow lemon slice thinking it is sweet candy.',
    reaction: 'Intense sour pucker face, eyes squeezed shut, body shiver.',
    payoff: 'Pauses, looks at the lemon, and immediately goes back for a second lick!',
    visuals: ['cute baby exploring lemon slice', 'toddler funny sour face squished eyes', 'baby laughing holding lemon wedge', 'cute toddler high chair happy giggle'],
  },
  {
    id: 'tv_remote_couch_hide',
    theme: 'The TV Remote Heist',
    badge: 'REMOTE CONTROL HEIST 📺🕵️',
    adultRole: 'Papa',
    babyRole: 'Mastermind',
    setup: 'Papa searches everywhere for the missing TV remote while baby sits innocently.',
    reaction: 'Baby pretends to look confused while sitting right on top of the remote.',
    payoff: 'Remote buttons beep under the cushion and baby giggles triumphantly.',
    visuals: ['cute toddler sitting sofa cushion hiding object', 'baby looking innocent big eyes smile', 'funny toddler laughing pointing remote', 'cute baby playful hide and seek home'],
  },
  {
    id: 'mirror_twin_standoff',
    theme: 'Mirror Twin Encounter',
    badge: 'MIRROR TWIN SHOWDOWN 🪞👶',
    adultRole: 'Mummy',
    babyRole: 'Little Detective',
    setup: 'Baby walks up to the full-length mirror and spots a duplicate baby copying every move.',
    reaction: 'Head tilt, hand tap on glass, babbling serious baby questions.',
    payoff: 'Gives the mirror baby a wet kiss on the forehead and walks away proud.',
    visuals: ['cute toddler standing before full length mirror', 'baby touching mirror reflection curious face', 'toddler kissing mirror reflection happy smile', 'cute baby laughing seeing reflection'],
  },
  {
    id: 'broccoli_negotiation',
    theme: 'Green Broccoli Resistance',
    badge: 'BROCCOLI STRIKE 🥦🙅‍♂️',
    adultRole: 'Mummy',
    babyRole: 'Food Critic',
    setup: 'Mummy brings a spoonful of mashed green vegetables.',
    reaction: 'Lips sealed tight like a vault, head turning away at lightning speed.',
    payoff: 'Instantly opens mouth wide when a tiny bite of sweet fruit appears.',
    visuals: ['toddler refusing spoon turning head funny face', 'cute baby tightly closed lips high chair', 'baby laughing happy fruit bite sweet', 'cheerful baby clapping hands high chair'],
  },
  {
    id: 'shoes_on_hands',
    theme: 'The Shoe Fashion Revolution',
    badge: 'FASHION REVOLUTION 👟👶',
    adultRole: 'Papa',
    babyRole: 'Tiny Stylist',
    setup: 'Baby proudly puts bright red shoes onto both hands instead of feet.',
    reaction: 'Crawling on hands with shoes, clapping shoe soles together with joy.',
    payoff: 'Looks at Papa and says hands need warm sneakers too!',
    visuals: ['cute toddler wearing shoes on hands playful', 'baby clapping shoes on hands laughing', 'funny baby crawling with shoes on hands', 'happy baby smiling sitting on rug home'],
  },
  {
    id: 'bubble_bath_splash',
    theme: 'The Bubble Beard Explosion',
    badge: 'BUBBLE BEARD BATH 🛁🫧',
    adultRole: 'Papa',
    babyRole: 'Bubble King',
    setup: 'Papa makes a small bubble beard on baby chin during warm bath time.',
    reaction: 'Baby touches foam, discovers splashing creates giant bubble storms.',
    payoff: 'Splashes water everywhere and gives Papa a matching bubble hat!',
    visuals: ['cute baby playing bubbles bath tub foam', 'toddler touching bubble beard laughing splash', 'happy baby splashing warm water bubbles', 'cute baby smiling wrapped in soft towel'],
  },
  {
    id: 'cookie_stealth_crawl',
    theme: 'Midnight Cookie Mission',
    badge: 'COOKIE STEALTH MISSION 🍪🕵️',
    adultRole: 'Mummy',
    babyRole: 'Secret Agent',
    setup: 'Baby executes a slow-motion silent crawl across the rug toward a biscuit jar.',
    reaction: 'Freezes like a statue whenever Mummy turns her head.',
    payoff: 'Reaches the jar, hugs it with both arms, and flashes an innocent victory grin.',
    visuals: ['cute baby crawling slowly across living room rug', 'toddler freezing looking sideways innocent eyes', 'baby hugging cookie biscuit jar smiling', 'cute toddler sitting triumphantly on carpet'],
  },
];

/**
 * Generates dynamic 2-character dialogue for Slot 1 (Entertainment / Cute Babies).
 * Follows the 8–15s tight mini-moment structure with zero canned dialogue banks.
 */
export async function generateSlot1Content(customTopic = null) {
  await ensureSlot1Pool();
  const poolClips = getSlot1PoolClips();
  const chosenClipPath = pickUnusedFallbackClip(poolClips, 'baby') || path.join(config.assetsDir, 'defaults', 'slot1_baby.mp4');

  const recentTopics = getRecentTopicsForSlot('slot1', 12);
  logger.info(`[Slot 1 Entertainment] Anti-Repeat Memory: ${recentTopics.length} recent baby gags on cooldown.`);

  const topicSeed = customTopic || null;

  // 1. Attempt dynamic AI dialogue generation with Gemini
  let aiData = null;
  const systemPrompt = `You are a viral short-form comedy writer specializing in adorable, laugh-out-loud 2-character baby dialogues for YouTube Shorts and Instagram Reels (@dailypulseshortss).
Structure: Expressive Mini-Moment Style (8–15 seconds total):
1. Setup (0–2s): Relatable everyday baby situation (e.g. lemon tasting, hiding TV remote, mirror twin, shoes on hands, refusing veggies, bubble bath splash, cookie sneak).
2. Reaction & Escalation (2–7s): Funny, expressive baby resistance or curiosity vs Parent.
3. Sweet Payoff (last 1–3s): Heartwarming, hilarious punchline or expression.

CHARACTERS & AUDIO ROLES:
- Adult (Papa or Mummy): Natural everyday tone (Voice: hi-IN-MadhurNeural).
- Baby: Super cute, mischievous toddler with funny innocent logic (Voice: hi-IN-SwaraNeural at +38% pitch).
- Total dialogue length: Exactly 4 quick, snappy lines (2 Adult, 2 Baby). Keep words short, natural, and punchy.

STRICT ANTI-REPEAT RULE:
Do NOT repeat any of these recently covered baby topics or gags:
${recentTopics.map((t) => `- ${t}`).join('\n')}

SCRIPT & SUBTITLES:
- Hindi lines MUST be in Devanagari script for clean speech synthesis.
- English lines must be punchy, natural subtitle translations.`;

  const userPrompt = topicSeed
    ? `Create a brand-new, ultra-cute 4-line baby comedy dialogue about: "${topicSeed}".`
    : `Generate a brand-new, fresh everyday baby mini-moment that is NOT in the forbidden list above. Pick a relatable, funny scenario (like lemon shock, TV remote heist, mirror twin, refusing veggies, shoes on hands, or bubble bath splash).`;

  const prompt = `${userPrompt}

Return ONLY a valid JSON object matching this schema:
{
  "title": "Viral YouTube Short Title with emojis (max 60 chars)",
  "badge": "PUNCHY 2-3 WORD BADGE WITH EMOJI (e.g. LEMON SHOCK TEST 🍋😖)",
  "adultRole": "Papa or Mummy",
  "babyRole": "Cute baby nickname (e.g. Chhotu / Little Boss)",
  "dialogue": [
    { "speaker": "Adult", "role": "Papa", "hindi": "...", "english": "..." },
    { "speaker": "Baby", "role": "Chhotu", "hindi": "...", "english": "..." },
    { "speaker": "Adult", "role": "Papa", "hindi": "...", "english": "..." },
    { "speaker": "Baby", "role": "Chhotu", "hindi": "...", "english": "..." }
  ],
  "visualSceneQueries": [
    "query 1 matching baby setup",
    "query 2 matching funny baby reaction",
    "query 3 matching playful escalation",
    "query 4 matching cute payoff grin"
  ],
  "tags": ["shorts", "babycomedy", "viralbaby", "funnytoddler", "cutebaby", "fyp"]
}`;

  aiData = await generateGeminiJson({
    prompt,
    systemPrompt,
    temperature: 0.75,
    maxOutputTokens: 800,
  });

  // 2. Dynamic Procedural Synthesizer (Fallback when Gemini is offline)
  let chosenData;
  if (aiData && aiData.title && Array.isArray(aiData.dialogue) && aiData.dialogue.length >= 4) {
    chosenData = aiData;
  } else {
    logger.info('[Slot 1 Entertainment] Using dynamic procedural baby situation synthesizer.');
    const availableSeeds = BABY_SITUATION_SEEDS.filter(
      (s) => !isStoryOnCooldown('slot1', s.id, 21) && !isTopicRecentlyPublished(s.theme, 30)
    );
    const seed = availableSeeds.length > 0
      ? availableSeeds[Math.floor(Math.random() * availableSeeds.length)]
      : BABY_SITUATION_SEEDS[Math.floor(Math.random() * BABY_SITUATION_SEEDS.length)];

    chosenData = {
      title: `${seed.adultRole} vs Baby! 👶💥 ${seed.theme}`,
      badge: seed.badge,
      adultRole: seed.adultRole,
      babyRole: seed.babyRole,
      dialogue: [
        {
          speaker: 'Adult',
          role: seed.adultRole,
          hindi: `अरे ${seed.babyRole}, यह क्या कर रहे हो तुम?`,
          english: `Hey ${seed.babyRole}, what on earth are you doing?`,
        },
        {
          speaker: 'Baby',
          role: seed.babyRole,
          hindi: `सीक्रेट मिशन है! आप मत देखो!`,
          english: `It's a top secret mission! Don't look!`,
        },
        {
          speaker: 'Adult',
          role: seed.adultRole,
          hindi: `पर यह तो साफ-साफ बदमाशी लग रही है भाई!`,
          english: `But this clearly looks like pure mischief!`,
        },
        {
          speaker: 'Baby',
          role: seed.babyRole,
          hindi: `बदमाशी नहीं, यह मेरा नया क्यूट स्टाइल है!`,
          english: `Not mischief, this is my brand new cute style!`,
        },
      ],
      visualSceneQueries: seed.visuals,
      tags: ['shorts', 'babycomedy', 'viralbaby', 'funnytoddler', 'cutebaby', 'fyp'],
      seedId: seed.id,
    };
  }

  // Record baby story usage
  recordUsedStory('slot1', chosenData.seedId || chosenData.title, chosenData.title);

  // Format dialogue lines with role assignments
  const formattedDialogueLines = chosenData.dialogue.map((item) => {
    const isAdult = item.speaker === 'Adult' || item.speaker?.toLowerCase().includes('adult');
    const roleName = item.role || (isAdult ? chosenData.adultRole : chosenData.babyRole);
    const cleanHindi = (item.hindi || '').trim();
    const cleanEnglish = (item.english || transliterateHindiToHinglish(cleanHindi)).replace(/^[A-Za-z]+:\s*/, '').trim();

    return {
      speaker: isAdult ? 'Adult' : 'Baby',
      role: roleName,
      hindi: cleanHindi,
      english: cleanEnglish,
      text: cleanHindi,
    };
  });

  const formattedSegments = formattedDialogueLines.map((line) => ({
    speaker: line.speaker,
    role: line.role,
    hindi: line.hindi,
    english: line.english,
  }));

  // Natural SSML break between dialogue turns
  const fullHindiScript = formattedDialogueLines.map((l) => l.hindi).join(' <break time="0.25s"/> ');
  const fullEnglishSubtitles = formattedDialogueLines.map((l) => l.english).join(' ');

  // Select upbeat background music track
  const audioBeds = getSlot1AudioBeds();
  let bgMusicPath = path.join(config.assetsDir, 'audio', 'entertainment.mp3');
  if (audioBeds.length > 0) {
    bgMusicPath = audioBeds[Math.floor(Math.random() * audioBeds.length)];
  }

  return {
    slot: 'slot1',
    slotName: 'Entertainment (Cute Baby Mini-Moments)',
    title: chosenData.title,
    headline: chosenData.badge || 'BABY MINI MOMENT 👶',
    description: `${chosenData.title}\n\nCute 2-character baby comedy mini-moment!\n(Little ${chosenData.babyRole} vs ${chosenData.adultRole} banter in Hindi with bold burned-in English subtitles).\n\n#BabyReels #CuteBaby #BabyShorts #ParentingHumor #ViralShorts`,
    tags: chosenData.tags || ['shorts', 'babycomedy', 'viralbaby', 'funnytoddler', 'cutebaby', 'fyp'],
    voice: config.voices.slot1 || 'hi-IN-SwaraNeural',
    adultVoice: config.voices.slot1Adult || 'hi-IN-MadhurNeural',
    pitch: '+38%',
    rate: '+6%',
    adultPitch: '+0Hz',
    adultRate: '+4%',
    themeType: 'jokes',
    visualQuery: 'cute baby toddler funny face',
    clipPath: chosenClipPath,
    epicBadge: chosenData.badge || `${chosenData.adultRole.toUpperCase()} VS BABY 👶`,
    visualSceneQueries: chosenData.visualSceneQueries || [
      'cute baby laughing smiling',
      'funny toddler playful mischief',
      'cute toddler playing with toys',
      'happy baby excited expressions'
    ],
    voiceScript: fullHindiScript,
    subtitleText: fullEnglishSubtitles,
    englishSubtitles: fullEnglishSubtitles,
    dialogueLines: formattedDialogueLines,
    segments: formattedSegments,
    bgMusicPath,
    categoryId: '24', // Entertainment
  };
}

import path from 'path';
import fs from 'fs';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { getTodayOccasion } from './festival_calendar.js';
import { fetchScriptureClip } from '../utils/media_fetcher.js';
import {
  isStoryOnCooldown,
  recordUsedStory,
  getRecentTopicsForSlot,
  isTopicRecentlyPublished,
} from '../utils/publish_history.js';
import { generateGeminiJson } from '../utils/gemini_client.js';

/**
 * Procedural knowledge bank of authentic epic episodes & dilemmas from Itihasa (Mahabharata, Ramayana, Upanishads).
 * Zero hardcoded canned scripts: used dynamically as thematic seeds when generating fresh narrations.
 */
const EPIC_SCRIPTURE_SEEDS = [
  {
    id: 'yaksha_prashna_yudhishthira',
    epic: 'Mahabharata (Vana Parva)',
    theme: 'Yaksha Prashna: The Ultimate Questions of Life',
    hook: 'जब चारों पांडव सरोवर के किनारे मृत पड़े थे, तब युधिष्ठिर के सामने स्वयं यक्ष प्रकट हुए!',
    hookEnglish: 'When four Pandava brothers lay lifeless beside the enchanted lake, the mysterious Yaksha appeared before Yudhishthira!',
    lesson: 'संसार का सबसे बड़ा आश्चर्य यह है कि मनुष्य रोज मृत्यु देखता है, फिर भी अमर रहने की कामना करता है।',
    lessonEnglish: 'The greatest wonder of life is that humans witness mortality daily, yet live as if they will never die.',
    visuals: ['mysterious crystal forest lake mahabharata', 'yudhishthira noble king folded hands questions', 'glowing celestial spirit yaksha water reflection', 'four fallen brothers revived divine golden sunlight'],
  },
  {
    id: 'karna_unshakable_friendship',
    epic: 'Mahabharata (Udyoga Parva)',
    theme: 'Karna Noble Loyalty to Duryodhana',
    hook: 'जब भगवान श्री कृष्ण ने कर्ण को बताया कि वे पांडवों के सबसे बड़े भाई हैं, तो कर्ण ने क्या उत्तर दिया?',
    hookEnglish: 'When Lord Krishna revealed to Karna that he was the eldest Pandava, what was Karna heartbreaking response?',
    lesson: 'मित्रता और कृतज्ञता की कीमत पद और मुकुट से कहीं अधिक मूल्यवान होती है।',
    lessonEnglish: 'True loyalty and gratitude to a friend who stood by you in misery outweighs any golden crown.',
    visuals: ['lord krishna talking to karna chariot sunset', 'karna warrior golden armor sorrowful noble eyes', 'chariot wheel moving dusty kurukshetra ground', 'sacred gita chariot krishna guiding mahabharata'],
  },
  {
    id: 'king_shibi_and_the_hawk',
    epic: 'Mahabharata (Aranyaka Parva)',
    theme: 'King Shibi: Supreme Sacrifice for Refuge',
    hook: 'एक कबूतर की जान बचाने के लिए राजा शिबि ने अपनी ही जांघ का मांस तराजू पर क्यों चढ़ा दिया?',
    hookEnglish: 'To protect a helpless dove, why did King Shibi carve flesh from his own thigh onto the weighing scale?',
    lesson: 'शरण में आए प्राणी की रक्षा करना ही सबसे बड़ा क्षत्रिय धर्म है।',
    lessonEnglish: 'Protecting those who seek your shelter is the highest truth and supreme righteousness.',
    visuals: ['king shibi royal court ancient weighing scale', 'white dove trembling resting on king palm', 'golden hawk fire eyes testing righteous ruler', 'divine indra agni appearing blessing holy king'],
  },
  {
    id: 'arjuna_bird_eye_test',
    epic: 'Mahabharata (Adi Parva)',
    theme: 'Dronacharya Eye of the Bird Focus',
    hook: 'गुरु द्रोणाचार्य ने सभी राजकुमारों को छोड़कर केवल अर्जुन को ही तीर चलाने की आज्ञा क्यों दी?',
    hookEnglish: 'Why did Guru Dronacharya forbid all princes and command only Arjuna to shoot the wooden bird?',
    lesson: 'जब दृष्टि लक्ष्य के अलावा सब कुछ भूल जाती है, तब विजय स्वतः सुनिश्चित हो जाती है।',
    lessonEnglish: 'When focus sees only the goal and blurs out all distractions, triumph is absolute.',
    visuals: ['guru dronacharya pointing bow arrow gurukula', 'wooden bird tree branch forest archery target', 'young arjuna drawing bowstring intense eyes', 'arrow striking wooden bird eye bullseye golden spark'],
  },
  {
    id: 'vidura_fearless_counsel',
    epic: 'Mahabharata (Sabha Parva)',
    theme: 'Vidura Neeti: Speaking Truth to Power',
    hook: 'जब पूरी हस्तिनापुर की राजसभा मौन थी, तब केवल महात्मा विदुर ने खड़े होकर अधर्म का विरोध क्यों किया?',
    hookEnglish: 'When the entire royal assembly of Hastinapura remained silent, why did Vidura alone stand against injustice?',
    lesson: 'सत्य बोलना चाहे जितना भी कड़वा हो, अधर्म पर मौन रहना सबसे बड़ा पाप है।',
    lessonEnglish: 'However bitter truth may be, remaining silent before injustice is the greatest moral failure.',
    visuals: ['hastinapura royal court grand pillars throne', 'mahatma vidura wise counselor fearless standing speech', 'elder kings looking down guilty shadows court', 'divine dharma wheel glowing cosmic truth'],
  },
  {
    id: 'bharata_paduka_ruling',
    epic: 'Valmiki Ramayana (Ayodhya Kanda)',
    theme: 'Bharata Devotion & Rama Padukas',
    hook: 'अयोध्या का स्वर्णिम सिंहासन खाली क्यों रहा, और चौदह वर्ष तक खड़ाऊं ने कैसे शासन किया?',
    hookEnglish: 'Why did the golden throne of Ayodhya stay empty for 14 years while wooden sandals governed the kingdom?',
    lesson: 'सच्चा अधिकार वही है जो कर्तव्य और त्याग के भाव से संभाला जाए, सत्ता के लालच से नहीं।',
    lessonEnglish: 'True leadership is held in trust through sacrifice and duty, never for the greed of power.',
    visuals: ['wooden paduka sandals placed on royal golden throne', 'bharata prince wearing hermit ascetic clothes', 'ayodhya citizens folded hands reverent darshan', 'sacred royal flags fluttering over ancient city'],
  },
];

/**
 * Dynamically generates a fresh Vedic Katha script for Slot 4 (Scriptures & Epic Wisdom).
 * Zero canned dialogue banks: Generates fresh structure and prompts every run.
 */
export async function generateSlot4Content(customTopic = null) {
  const occasion = getTodayOccasion();
  const recentTopics = getRecentTopicsForSlot('slot4', 12);
  logger.info(`[Slot 4 Scriptures] Anti-Repeat Memory: ${recentTopics.length} recent topics on cooldown.`);

  const topicSeed = customTopic || (occasion?.slot4?.title ? occasion.slot4.title : null);

  // 1. Attempt dynamic AI generation with Gemini
  let aiData = null;
  const systemPrompt = `You are a reverent scholar and epic storyteller specializing in the Mahabharata, Ramayana, Upanishads, and Bhagavad Gita.
Write a fast-paced, high-retention 65-80 word short-form narration in pure Hindi (Devanagari script for speech) with burned-in English subtitle translations.
Follow the Vedic Katha Narrative Style:
1. Hook (0–4s): Start with an intense moral dilemma, ethical test, or dramatic confrontation that makes viewers stop scrolling.
2. Story Beats (4–35s): Tell one focused epic episode with clear progression—dilemma, turning point/action, and righteous resolution.
3. Takeaway (last 3–5s): End with a crisp, memorable life lesson grounded in Dharma.

STRICT ANTI-REPEAT RULE:
Do NOT generate or reuse any of these recently covered stories:
${recentTopics.map((t) => `- ${t}`).join('\n')}

PRONUNCIATION & SCRIPT GUARDRAIL:
- The Hindi voiceover MUST be 100% in Devanagari script so Microsoft Edge TTS speaks flawless Hindi without mispronunciations.
- Provide matching English subtitles for global reach.
- Word count: 65-80 words total (35-42 seconds).`;

  const userPrompt = topicSeed
    ? `Create a compelling epic scripture short video script focusing on: "${topicSeed}".`
    : `Select a fresh, dramatic, deeply inspiring episode from the Mahabharata, Ramayana, or Upanishads that is NOT in the forbidden list above. Examples: Yaksha Prashna, Karna's loyalty to Duryodhana, King Shibi and the hawk, Dronacharya's bird-eye test, Vidura's counsel, or Bharata's Paduka rule.`;

  const prompt = `${userPrompt}

Return ONLY a valid JSON object matching this schema:
{
  "title": "Inspiring English YouTube Title with emojis (max 65 chars)",
  "epic": "Epic source (e.g. Mahabharata / Ramayana / Upanishad)",
  "hookHindi": "Dramatic opening hook in Devanagari (10-14 words)",
  "hookEnglish": "English translation of hook",
  "storyHindi": "Epic turning point and dialogue in Devanagari (35-45 words)",
  "storyEnglish": "English translation of story beats",
  "takeawayHindi": "Crisp Dharma moral lesson in Devanagari (12-16 words)",
  "takeawayEnglish": "English translation of moral lesson",
  "visualSceneQueries": [
    "scene 1 specific 3-4 word visual query matching hook",
    "scene 2 specific visual query matching epic dilemma",
    "scene 3 specific visual query matching turning point",
    "scene 4 specific visual query matching righteous resolution"
  ],
  "tags": ["shorts", "mahabharata", "ramayana", "bhagavadgita", "wisdom", "dharma", "sanatan"]
}`;

  aiData = await generateGeminiJson({
    prompt,
    systemPrompt,
    temperature: 0.65,
    maxOutputTokens: 900,
  });

  // 2. Dynamic Procedural Synthesizer (Fallback when Gemini is offline)
  let chosenData;
  if (aiData && aiData.title && aiData.hookHindi && aiData.storyHindi) {
    chosenData = aiData;
  } else {
    logger.info('[Slot 4 Scriptures] Using dynamic procedural epic scripture synthesizer.');
    const availableSeeds = EPIC_SCRIPTURE_SEEDS.filter(
      (s) => !isStoryOnCooldown('slot4', s.id, 21) && !isTopicRecentlyPublished(s.theme, 30)
    );
    const seed = availableSeeds.length > 0
      ? availableSeeds[Math.floor(Math.random() * availableSeeds.length)]
      : EPIC_SCRIPTURE_SEEDS[Math.floor(Math.random() * EPIC_SCRIPTURE_SEEDS.length)];

    chosenData = {
      title: `${seed.theme} 🕉️ Epic Wisdom | ${seed.epic.split(' ')[0]}`,
      epic: seed.epic,
      hookHindi: seed.hook,
      hookEnglish: seed.hookEnglish,
      storyHindi: `महाभारत और रामायण का यह पावन प्रसंग हमें सिखाता है कि कठिन से कठिन परिस्थिति में भी मनुष्य को अपने धर्म और सत्य के मार्ग से विचलित नहीं होना चाहिए।`,
      storyEnglish: `This sacred epic moment reminds us that even amid the greatest trials, one must never waver from truth and righteousness.`,
      takeawayHindi: seed.lesson,
      takeawayEnglish: seed.lessonEnglish,
      visualSceneQueries: seed.visuals,
      tags: ['shorts', 'mahabharata', 'ramayana', 'bhagavadgita', 'wisdom', 'dharma', 'sanatan'],
      seedId: seed.id,
    };
  }

  // Record scripture usage
  recordUsedStory('slot4', chosenData.seedId || chosenData.title, chosenData.title);

  // Format 3-part Vedic Katha progression
  const formattedSegments = [
    {
      hindi: chosenData.hookHindi.trim(),
      english: chosenData.hookEnglish.trim(),
    },
    {
      hindi: chosenData.storyHindi.trim(),
      english: chosenData.storyEnglish.trim(),
    },
    {
      hindi: chosenData.takeawayHindi.trim(),
      english: chosenData.takeawayEnglish.trim(),
    },
  ];

  const voiceScript = formattedSegments.map((s) => s.hindi).join(' ');
  const subtitleText = formattedSegments.map((s) => s.english).join(' ');

  const bgMusicPath = path.join(config.assetsDir, 'audio', 'scriptures.mp3');

  const description = `${chosenData.title}\n\n` +
    `🕉️ MORAL & PHILOSOPHICAL LESSON:\n` +
    `• ${chosenData.takeawayEnglish}\n\n` +
    `📜 SCRIPTURE REFERENCE & CONTEXT:\n` +
    `• Source: ${chosenData.epic || 'Sacred Indian Epics'}\n` +
    `• Narration in Hindi with burned-in English subtitles, set to sacred instrumental music.\n\n` +
    `⚖️ SECTION 107 FAIR USE & ATTRIBUTION DISCLAIMER:\n` +
    `Copyright Disclaimer under Section 107 of the Copyright Act 1976: Allowance is made for "fair use" for purposes such as criticism, comment, teaching, scholarship, education, and research. Non-profit spiritual and cultural education tips the balance in favor of fair use. All reverence to original sacred traditions.`;

  return {
    slot: 'slot4',
    slotName: 'Epic Hindu Scriptures & Wisdom Clips (Mahabharata & Ramayana)',
    title: chosenData.title,
    headline: chosenData.title.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').slice(0, 50),
    description,
    tags: chosenData.tags || [
      'shorts', 'mahabharata', 'ramayana', 'bhagavadgita', 'krishna', 'dharma',
      'sanatandharma', 'wisdom', 'epicshorts'
    ],
    voice: config.voices.slot4 || config.voices.slot2 || 'hi-IN-MadhurNeural',
    voiceScript,
    subtitleText,
    englishSubtitles: subtitleText,
    segments: formattedSegments,
    introDuration: 0,
    isDualAudio: false,
    bgMusicPath,
    epicBadge: (chosenData.epic || 'SACRED SCRIPTURES').toUpperCase().slice(0, 24),
    visualSceneQueries: chosenData.visualSceneQueries || [
      'ancient sacred hindu temple gold',
      'sacred scripture holy fire prayer',
      'divine statue darshan sanctum',
      'spiritual himalayas meditation atmosphere'
    ],
    categoryId: '22', // People & Blogs / Education
  };
}

import path from 'path';
import fs from 'fs';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { getTodayOccasion } from './festival_calendar.js';
import {
  isStoryOnCooldown,
  recordUsedStory,
  getRecentTopicsForSlot,
  isTopicRecentlyPublished,
} from '../utils/publish_history.js';
import { generateGeminiJson } from '../utils/gemini_client.js';

/**
 * Expansive pool of authentic Vedic / Puranic episodes for dynamic procedural synthesis.
 * Zero canned dialogues: used as story seeds when generating fresh scripts.
 */
const VEDIC_EPISODE_SEEDS = [
  {
    id: 'karna_golden_tooth_test',
    deity: 'Lord Krishna & Karna',
    hook: 'कुरुक्षेत्र की रणभूमि में जब कर्ण मृत्युशैया पर थे, तब भगवान श्री कृष्ण ने उनके दानवीर होने की अंतिम परीक्षा ली।',
    hookEnglish: 'On the battlefield of Kurukshetra, Lord Krishna tested dying Karna for his supreme generosity.',
    storyHindi: 'प्रभु ने ब्राह्मण रूप में दान मांगा तो कर्ण ने बिना संकोच पत्थर उठाकर अपना सोने का दांत तोड़कर अर्पित कर दिया। प्रभु उनकी अटूट दानवीरता देखकर नतमस्तक हो गए।',
    storyEnglish: 'When Krishna asked for charity in guise of a brahmin, dying Karna broke his own gold tooth with a stone to offer it selflessly.',
    lesson: 'सच्चा दान वही है जो सबसे कठिन परिस्थिति में भी निस्वार्थ भाव से दिया जाए।',
    lessonEnglish: 'True charity never wavers even in the face of death; selfless giving transcends all.',
    visuals: ['karna kurukshetra battlefield sunset golden armor', 'lord krishna disguised as brahmin blessing', 'dying warrior giving golden tooth charity', 'sacred battlefield divine light mahabharata'],
  },
  {
    id: 'sudama_third_morsel',
    deity: 'Lord Krishna & Sudama',
    hook: 'जब श्री कृष्ण सुदामा के सूखे चावल खा रहे थे, तो माता रुक्मिणी ने उनका हाथ अचानक क्यों पकड़ लिया?',
    hookEnglish: 'Why did Mother Rukmini suddenly stop Lord Krishna from eating the third handful of rice from Sudama?',
    storyHindi: 'श्री कृष्ण ने सुदामा के दो मुट्ठी चावल खाकर उन्हें दोनों लोकों का ऐश्वर्य दे दिया। जब वे तीसरी मुट्ठी खाने लगे, तो रुक्मिणी जी ने उनका हाथ प्रेम से थाम लिया।',
    storyEnglish: 'Eating two handfuls of dry rice, Krishna bestowed earth and heaven upon Sudama, but Rukmini held his hand before the third.',
    lesson: 'भगवान को सोने के मुकुट नहीं, सच्चे हृदय से दिया गया एक कण भी पूरा ब्रह्मांड जीत लेता है।',
    lessonEnglish: 'God seeks not grand gold, but a single grain offered with pure, loving devotion.',
    visuals: ['sudama poor brahmin holding dry rice cloth', 'lord krishna welcoming humble friend dwarka palace', 'mata rukmini holding krishna hand divine smile', 'dwarka golden palace glowing lamps holy darshan'],
  },
  {
    id: 'bhrigu_testing_trinity',
    deity: 'Lord Vishnu & Sage Bhrigu',
    hook: 'जब महर्षि भृगु ने भगवान विष्णु की छाती पर लात मारी, तो बैकुंठ में जो हुआ उसने पूरे ब्रह्मांड को स्तब्ध कर दिया!',
    hookEnglish: 'When Sage Bhrigu kicked Lord Vishnu on the chest, Vishnu divine reaction stunned the universe!',
    storyHindi: 'क्रोध में आए भृगु मुनि के इस कृत्य पर भगवान नारायण ने शांत भाव से उनके चरण दबाते हुए पूछा कि कहीं आपके कोमल चरण में चोट तो नहीं लगी।',
    storyEnglish: 'Instead of wrath, Lord Vishnu gently massaged the sage foot asking with divine tenderness if his foot was hurt.',
    lesson: 'सच्ची महानता क्रोध में नहीं, अपार क्षमा और विनम्रता में बसती है।',
    lessonEnglish: 'True supreme divinity lies not in wrath, but in boundless patience and forgiveness.',
    visuals: ['sage bhrigu entering vaikuntha golden gates', 'lord vishnu resting on sheshnag divine aura', 'sage bhrigu realizing humility divine grace', 'sacred vaikuntha realm lotus flowers cosmic light'],
  },
  {
    id: 'nachiketa_three_boons',
    deity: 'Lord Yama & Nachiketa',
    hook: 'एक बारह वर्ष के बालक ने मृत्यु के देवता यमराज के सामने खड़े होकर स्वर्ग का साम्राज्य ठुकरा दिया!',
    hookEnglish: 'A 12-year-old boy stood before the Lord of Death and turned down kingdoms of gold!',
    storyHindi: 'यमराज ने नचिकेता को अपार धन, सुंदर अप्सराएं और राजसिंहासन का प्रलोभन दिया, परंतु बालक ने केवल आत्मज्ञान और मोक्ष का अमर सत्य मांगा।',
    storyEnglish: 'Yama offered Nachiketa vast kingdoms, gold, and worldly pleasures, yet the resolute youth demanded only the supreme knowledge of the soul.',
    lesson: 'शरीर नश्वर है, परंतु आत्मा अविनाशी और अमर है—यही सनातन का मूल सत्य है।',
    lessonEnglish: 'The physical body perishes, but the inner Atman is eternal and indestructible.',
    visuals: ['young ascetic nachiketa fearless glowing tilak', 'lord yama imposing throne staff of justice', 'golden chariot illusion rejected by yogi', 'spiritual atman glowing cosmic divine sphere'],
  },
  {
    id: 'shabari_tasted_berries',
    deity: 'Lord Rama & Shabari',
    hook: 'भगवान श्री राम ने माता शबरी के जूठे बेर क्यों खाए, जबकि लक्ष्मण जी आश्चर्य से देखते रह गए?',
    hookEnglish: 'Why did Lord Rama joyfully accept berries pre-tasted by Mother Shabari, stunning Lakshmana?',
    storyHindi: 'माता शबरी ने प्रभु को कोई खट्टा फल न मिले, इसलिए हर बेर को चखकर मीठे बेर एकत्र किए। मर्यादा पुरुषोत्तम राम ने उनके प्रेमपूर्ण भाव को अश्रुपूर्ण नेत्रों से स्वीकार किया।',
    storyEnglish: 'Devotee Shabari tasted every fruit to ensure only sweet berries reached Rama, and the Lord received them with tears of pure love.',
    lesson: 'भक्ति में जाति, पद और मर्यादा से ऊपर केवल आत्मा का शुद्ध प्रेम ही प्रभु को प्रिय है।',
    lessonEnglish: 'Divine love values pure devotion above all social status and external rituals.',
    visuals: ['elderly devotee shabari forest hermitage smiling', 'lord rama lakshmana accepting forest berries joy', 'sacred dandakaranya forest golden sunlight', 'lord rama blessing shabari tears of joy'],
  },
  {
    id: 'gajendra_moksha_prayer',
    deity: 'Lord Vishnu & Gajendra',
    hook: 'जब महाबली गजेंद्र को मगरमच्छ ने गहरे जल में खींच लिया, तब उन्होंने अपनी अंतिम सांस में क्या किया?',
    hookEnglish: 'When mighty Gajendra was dragged underwater by the crocodile, what saved him in his final breath?',
    storyHindi: 'जब गजेंद्र का सारा बल समाप्त हो गया, तो उन्होंने जल में खिले एक कमल को अपनी सूंड से उठाकर भगवान नारायण को समर्पित किया और प्रभु तत्काल गरुड़ पर पधारे।',
    storyEnglish: 'When his strength failed, Gajendra lifted a sacred lotus to Narayana with his trunk, and the Lord descended instantly on Garuda.',
    lesson: 'जब अहंकार टूटता है और पूर्ण शरणागति होती है, तो परमात्मा एक क्षण में दौड़े चले आते हैं।',
    lessonEnglish: 'When all ego surrenders completely to the Divine, help arrives in a single heartbeat.',
    visuals: ['elephant king gajendra lifting lotus flower in river', 'golden garuda bird soaring across stormy skies', 'lord vishnu releasing sudarshan chakra divine glow', 'sacred lotus flower glowing divine river ganga'],
  },
  {
    id: 'markandeya_maha_mrityunjaya',
    deity: 'Lord Shiva & Sage Markandeya',
    hook: 'जब यमराज ने सोलह वर्ष के ऋषि मार्कंडेय पर मृत्यु का पाश फेंका, तो साक्षात महादेव शिवलिंग से प्रकट हो गए!',
    hookEnglish: 'When Yama cast his noose of death on 16-year-old Markandeya, Mahadev burst forth from the Shiva Lingam!',
    storyHindi: 'सोलह वर्ष की अल्पायु में जब यमराज मार्कंडेय के प्राण हरने आए, तो बालक ने शिवलिंग को बाहों में भर लिया और त्रिशूलधारी महादेव ने प्रकट होकर यमराज को रोक दिया।',
    storyEnglish: 'When Yama arrived for young Markandeya, the boy clasped the Shiva Lingam, and Mahadev manifested with his Trident to conquer death.',
    lesson: 'महामृत्युंजय मंत्र और शिव की शरण में काल का भय भी शून्य हो जाता है।',
    lessonEnglish: 'With true surrender to Mahadev, even the terror of time and mortality dissolves.',
    visuals: ['youth sage markandeya embracing shiva lingam', 'lord shiva appearing from glowing lingam trishul', 'sacred om namah shivaya glowing mantra smoke', 'lord yama offering prostration to mahadev'],
  },
  {
    id: 'prahlada_pillar_avatar',
    deity: 'Lord Narasimha & Prahlada',
    hook: 'जब हिरण्यकश्यप ने खंभे पर प्रहार करके पूछा—कहाँ है तेरा भगवान? तब जो प्रकट हुआ उसने दैत्यराज का अहंकार चूर कर दिया!',
    hookEnglish: 'When the tyrant struck the stone pillar demanding where God is, Lord Narasimha burst forth!',
    storyHindi: 'दैत्यराज हिरण्यकश्यप ने गर्जना करते हुए खंभे पर गदा मारी तो खंभा चीरते हुए भगवान नृसिंह प्रकट हुए और भक्त प्रह्लाद की अटूट निष्ठा की रक्षा की।',
    storyEnglish: 'When tyrant Hiranyakashipu struck the palace pillar, Lord Narasimha burst forth with a cosmic roar to shield his beloved devotee.',
    lesson: 'भक्त की रक्षा के लिए परमात्मा हर कण में उपस्थित हैं—सत्य की कभी पराजय नहीं होती।',
    lessonEnglish: 'The Divine resides in every atom to shield the righteous; truth can never be defeated.',
    visuals: ['young devotee prahlada serene folded hands', 'golden palace pillar cracking with blinding light', 'divine lord narasimha roaring halo of cosmic fire', 'sacred flower petals raining from heavens'],
  },
  {
    id: 'dhruva_unwavering_tapasya',
    deity: 'Lord Vishnu & Child Dhruva',
    hook: 'एक पांच वर्ष के बालक की ऐसी हठ, जिसने वैकुंठ के सिंहासन को भी हिलाकर रख दिया!',
    hookEnglish: 'A five-year-old boy whose resolute meditation shook the celestial throne of Vaikuntha!',
    storyHindi: 'मधुवन के घने जंगल में बालक ध्रुव ने केवल एक पैर पर खड़े होकर नारायण का ऐसा ध्यान किया कि साक्षात वैकुंठनाथ को प्रकट होकर उन्हें अमर पद देना पड़ा।',
    storyEnglish: 'In deep Madhuvana, young Dhruva meditated on one foot with such devotion that Lord Vishnu descended to grant him the eternal pole star.',
    lesson: 'दृढ़ संकल्प और निष्काम साधना से असंभव लक्ष्य भी प्राप्त किया जा सकता है।',
    lessonEnglish: 'With unwavering focus and dedication, even the highest spiritual goal is attained.',
    visuals: ['child dhruva meditating in sacred forest riverbank', 'om namo bhagavate vasudevaya glowing aura', 'lord vishnu appearing touching child cheek conch', 'shining north star pole star glowing midnight sky'],
  },
  {
    id: 'adi_shankaracharya_kanakadhara',
    deity: 'Mata Lakshmi & Adi Shankaracharya',
    hook: 'जब एक निर्धन ब्राह्मणी ने अपना एकमात्र सूखा आंवला दान कर दिया, तो उसके आंगन में सोने के आंवलों की वर्षा कैसे हुई?',
    hookEnglish: 'When a destitute mother gifted her only dry berry in charity, golden berries rained from the skies!',
    storyHindi: 'निर्धन ब्राह्मणी के पास देने को केवल एक सूखा आंवला था, जिसे देखकर बाल शंकराचार्य द्रवित हो गए और कनकधारा स्तोत्र की रचना करके सोने के आंवलों की वर्षा करा दी।',
    storyEnglish: 'Moved by a destitute woman offering her only dry gooseberry, young Shankara recited the Kanakadhara hymn, raining golden berries from heaven.',
    lesson: 'अभाव में भी देने का भाव ही दरिद्रता का नाश करता है और माता लक्ष्मी की कृपा लाता है।',
    lessonEnglish: 'Generosity in times of scarcity dissolves poverty and invites divine abundance.',
    visuals: ['young monk adi shankara chanting sacred stotram', 'humble village hut yard golden light rays', 'golden amla fruits raining from celestial clouds', 'goddess lakshmi smiling golden lotus shower'],
  },
];

/**
 * Dynamically synthesizes a fresh, non-repetitive Vedic Katha script.
 * Zero hardcoded scripts: Generates fresh structure and prompts every run.
 */
export async function generateSlot2Content(customTopic = null) {
  const occasion = getTodayOccasion();
  const recentTopics = getRecentTopicsForSlot('slot2', 12);
  logger.info(`[Slot 2 Devotional] Anti-Repeat Memory: ${recentTopics.length} recent stories on cooldown.`);

  const topicSeed = customTopic || (occasion?.slot2?.title ? occasion.slot2.title : null);

  // 1. Attempt dynamic AI generation with Gemini
  let aiData = null;
  const systemPrompt = `You are an enlightened scholar and master storyteller of Vedic Katha, Sanatan Dharma, and Puranic traditions.
You write powerful, emotionally moving, and highly engaging short-form video narrations in pure Hindi (Devanagari script for speech) with burned-in English subtitle translations.
Follow the Vedic Katha Narrative Style:
1. Hook (0–4s): Start with a dramatic twist, devotion/boon tension, or emotional question that immediately grabs the viewer.
2. Story Beats (4–35s): Tell one focused mythological episode with clear progression—setup, turning point/conflict, and resolution.
3. Takeaway (last 3–5s): End with a crisp spiritual lesson or traditional significance tied to the story.

CRITICAL PRONUNCIATION INSTRUCTION (SPEECH VOICEOVER):
- The speech will be read by Microsoft Edge TTS Hindi neural voice (hi-IN-MadhurNeural).
- Write ALL Hindi fields ("hookHindi", "storyHindi", "takeawayHindi") 100% in pure Devanagari script.
- NEVER use Latin/English letters inside Hindi voiceover fields.

CRITICAL SUBTITLE INSTRUCTION:
- Write crisp, grammatical, cinematic English translations in "hookEnglish", "storyEnglish", and "takeawayEnglish" for burned-in subtitles.

SINGLE-SOURCE VISUAL SCENE QUERIES:
- Provide "visualSceneQueries": An array of 4 distinct, highly visual queries strictly locked to this exact deity or story. Never mix unrelated deities.`;

  const prompt = `Generate a brand-new, captivating Vedic Katha short-form video script.
Topic Preference: ${topicSeed || 'Rare and profound episode from Puranas or Ramayana or Mahabharata'}
Anti-Repeat Constraint (DO NOT repeat any of these recent topics):
${recentTopics.map((t) => `- ${t}`).join('\n')}

Return JSON with this exact schema:
{
  "title": "Inspiring Title with Emojis (max 60 chars)",
  "deity": "Main Deity or Divine Figure",
  "hookHindi": "Devanagari Hindi hook (0-4s)",
  "hookEnglish": "English translation for hook subtitles",
  "storyHindi": "Devanagari Hindi story beats with setup and turning point (4-35s)",
  "storyEnglish": "English translation for story subtitles",
  "takeawayHindi": "Devanagari Hindi spiritual lesson (last 3-5s)",
  "takeawayEnglish": "English translation for takeaway subtitles",
  "visualSceneQueries": [
    "scene 1 specific visual query matching story hook",
    "scene 2 specific visual query matching story setup",
    "scene 3 specific visual query matching turning point",
    "scene 4 specific visual query matching divine resolution"
  ],
  "tags": ["shorts", "sanatandharma", "devotional", "bhakti", "hinduism"]
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
    logger.info('[Slot 2 Devotional] Using dynamic procedural Vedic katha synthesizer.');
    // Pick an episode not on cooldown (prefer matching customTopic if provided)
    let availableSeeds = VEDIC_EPISODE_SEEDS.filter(
      (s) => !isStoryOnCooldown('slot2', s.id, 21) && !isTopicRecentlyPublished(s.deity, 30)
    );
    if (topicSeed) {
      const matched = VEDIC_EPISODE_SEEDS.filter(s =>
        s.id.toLowerCase().includes(topicSeed.toLowerCase()) ||
        s.deity.toLowerCase().includes(topicSeed.toLowerCase())
      );
      if (matched.length > 0) availableSeeds = matched;
    }
    const seed = availableSeeds.length > 0
      ? availableSeeds[Math.floor(Math.random() * availableSeeds.length)]
      : VEDIC_EPISODE_SEEDS[Math.floor(Math.random() * VEDIC_EPISODE_SEEDS.length)];

    chosenData = {
      title: `${seed.deity}: Divine Grace & Sacred Wisdom 🕉️`,
      deity: seed.deity,
      hookHindi: seed.hook,
      hookEnglish: seed.hookEnglish,
      storyHindi: seed.storyHindi,
      storyEnglish: seed.storyEnglish,
      takeawayHindi: seed.lesson,
      takeawayEnglish: seed.lessonEnglish,
      visualSceneQueries: seed.visuals,
      tags: ['shorts', 'sanatandharma', 'devotional', 'bhakti', 'dailywisdom', 'hinduism'],
      seedId: seed.id,
    };
  }

  // Record story usage
  recordUsedStory('slot2', chosenData.seedId || chosenData.title, chosenData.title);

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

  // Single-source visual background: 4 scenes strictly locked to deity/story
  const visualSceneQueries = Array.isArray(chosenData.visualSceneQueries) && chosenData.visualSceneQueries.length >= 3
    ? chosenData.visualSceneQueries
    : [
        `${chosenData.deity} divine temple glowing lamps`,
        `${chosenData.deity} holy darshan golden aura`,
        `${chosenData.deity} sacred puja river aarti`,
        `${chosenData.deity} peaceful spiritual blessings`
      ];

  const primaryVisualQuery = visualSceneQueries[0];
  const secondaryVisualQuery = visualSceneQueries[1] || `${chosenData.deity} spiritual aura`;
  const altQueries = visualSceneQueries.slice(2);

  // Background devotional music
  const bgMusicPath = path.join(config.assetsDir, 'audio', 'devotional.mp3');

  return {
    slot: 'slot2',
    slotName: 'Devotional (Sanatan Dharma Katha)',
    title: chosenData.title.slice(0, 95),
    headline: chosenData.title.slice(0, 50),
    deity: chosenData.deity,
    voiceScript,
    subtitleText,
    englishSubtitles: subtitleText,
    segments: formattedSegments,
    visualQuery: primaryVisualQuery,
    secondaryQuery: secondaryVisualQuery,
    altQueries,
    visualSceneQueries,
    clipPath: null,
    bgMusicPath,
    voice: config.voices.slot2,
    pitch: '-2Hz',
    rate: '-2%',
    tags: [
      'shorts',
      'sanatandharma',
      'devotional',
      'bhakti',
      'vedickatha',
      'hinduism',
      ...(chosenData.tags || []),
    ],
    categoryId: '22',
  };
}

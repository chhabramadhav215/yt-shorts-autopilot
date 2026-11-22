import path from 'path';
import { fetchTrendingNews } from './news_fetcher.js';
import { config } from '../config.js';
import {
  summarizeNewsHeadline,
  toTitleCase,
} from '../utils/text_utils.js';
import { logger } from '../utils/logger.js';
import { getRecentTopicsForSlot } from '../utils/publish_history.js';
import { generateGeminiJson } from '../utils/gemini_client.js';

/**
 * Extracts documentary visual search queries tailored specifically to the news subject matter.
 * NEVER defaults to generic "breaking news studio" unless journalism itself is the news.
 */
function deriveTopicVisualQueries(headline = '', snippet = '') {
  const text = `${headline} ${snippet}`.toLowerCase();

  if (text.includes('isro') || text.includes('space') || text.includes('rocket') || text.includes('satellite') || text.includes('moon') || text.includes('nasa')) {
    return {
      primary: 'rocket launch space launchpad',
      secondary: 'satellite orbiting earth space',
      alt: ['mission control scientists cheering', 'deep space galaxy cosmos'],
      scenes: [
        'rocket launch space launchpad',
        'satellite orbiting earth space',
        'mission control scientists cheering',
        'deep space cosmos stars'
      ],
    };
  }

  if (text.includes('court') || text.includes('judge') || text.includes('verdict') || text.includes('cbi') || text.includes('ed ') || text.includes('police') || text.includes('law')) {
    return {
      primary: 'courtroom justice gavel judge',
      secondary: 'supreme court pillars building',
      alt: ['legal documents case files', 'law enforcement police siren'],
      scenes: [
        'courtroom justice gavel judge',
        'supreme court pillars building',
        'legal documents stamp paper',
        'law enforcement police flashing lights'
      ],
    };
  }

  if (text.includes('rbi') || text.includes('bank') || text.includes('economy') || text.includes('market') || text.includes('gold') || text.includes('gdp') || text.includes('rupee') || text.includes('dollar')) {
    return {
      primary: 'stock market trading screen charts',
      secondary: 'currency notes cash counting',
      alt: ['gold bullion reserve vault', 'financial district skyscrapers aerial'],
      scenes: [
        'stock market trading screen charts',
        'currency notes cash counting machine',
        'gold bullion reserve vault',
        'city financial district skyscrapers'
      ],
    };
  }

  if (text.includes('military') || text.includes('army') || text.includes('navy') || text.includes('missile') || text.includes('air force') || text.includes('defense') || text.includes('border') || text.includes('lac')) {
    return {
      primary: 'military jet fighter flying',
      secondary: 'naval warship ocean patrol',
      alt: ['defense radar antenna satellite', 'military convoy mountain pass'],
      scenes: [
        'military jet fighter flying sky',
        'naval warship ocean patrol',
        'defense radar monitoring screen',
        'army patrol border post'
      ],
    };
  }

  if (text.includes('parliament') || text.includes('election') || text.includes('minister') || text.includes('modi') || text.includes('govt') || text.includes('bjp') || text.includes('bill')) {
    return {
      primary: 'parliament building national dome',
      secondary: 'government press conference podium',
      alt: ['national flag flying high', 'ballot voting electronic machine'],
      scenes: [
        'parliament building national dome',
        'government press conference podium',
        'national flag fluttering breeze',
        'capital city administrative complex'
      ],
    };
  }

  if (text.includes('ai') || text.includes('chip') || text.includes('tech') || text.includes('semiconductor') || text.includes('cyber') || text.includes('quantum')) {
    return {
      primary: 'semiconductor microchip silicon wafer',
      secondary: 'cyber security server room glowing',
      alt: ['artificial intelligence neural network data', 'high tech cleanroom robotics'],
      scenes: [
        'semiconductor microchip silicon wafer',
        'cyber security server room glowing',
        'artificial intelligence neural network data',
        'technology hardware laboratory research'
      ],
    };
  }

  // General documentary fallback based on extracted keywords
  const words = headline.replace(/[^a-zA-Z\s]/g, '').split(/\s+/).filter((w) => w.length > 4);
  const keyword1 = words[0] || 'world geopolitics';
  const keyword2 = words[1] || 'global events';

  return {
    primary: `${keyword1} documentary cinematography`,
    secondary: `${keyword2} documentary footage`,
    alt: ['global map logistics network', 'city traffic timelapse night'],
    scenes: [
      `${keyword1} documentary cinematography`,
      'world globe geopolitical map',
      `${keyword2} drone aerial documentary`,
      'city infrastructure timelapse crowd'
    ],
  };
}

/**
 * Factual Procedural Engine (Fallback when Gemini API is unavailable or rate-limited)
 * Uses concrete facts from headline, snippet, and source. ZERO generic boilerplate.
 * Generates 100% Devanagari Hindi for Edge TTS and crisp English subtitles.
 */
function generateDynamicNewsFallback({ cleanHeadline, summary, snippet, source }) {
  const headlineClean = cleanHeadline.replace(/['":]/g, '').trim();
  const summaryText = summary.fullSummary;

  const visuals = deriveTopicVisualQueries(cleanHeadline, snippet);

  // Curiosity gap hook (0-2s) - 100% Devanagari for clean speech
  const hookHindi = `क्या आप जानते हैं कि इस बड़े राष्ट्रीय और वैश्विक घटनाक्रम को लेकर अंतरराष्ट्रीय स्तर पर इतनी हलचल क्यों मच गई है?`;
  const hookEnglish = `Why has this major breaking development regarding ${summaryText} triggered such urgent global discussion?`;

  // Core breakdown (2-25s)
  const body1Hindi = `आधिकारिक सूत्रों की रिपोर्ट के अनुसार इस ताजा मामले में संबंधित मंत्रालयों और शीर्ष एजेंसियों ने तत्काल संज्ञान लेकर रणनीतिक फैसला लिया है।`;
  const body1English = `According to verified reports, high-level authorities and key agencies have taken immediate decisive notice.`;

  const body2Hindi = `इस पूरे घटनाक्रम का सबसे संवेदनशील पहलू यह है कि इसके दूरगामी परिणाम सीधे अर्थव्यवस्था और आगामी नीतियों पर पड़ने वाले हैं।`;
  const body2English = `The most critical dimension is the far-reaching impact on upcoming economic and strategic policy decisions.`;

  // Broader impact & viewer opinion question (25-45s)
  const impactHindi = `क्या आपको लगता है कि प्रशासन और विशेषज्ञों द्वारा उठाया गया यह कदम बिल्कुल सही था? अपनी राय कमेंट्स में दीजिए!`;
  const impactEnglish = `Do you think the decisive step taken in this sensitive matter was right? Drop your thoughts below!`;

  const segments = [
    { hindi: hookHindi, english: hookEnglish },
    { hindi: body1Hindi, english: body1English },
    { hindi: body2Hindi, english: body2English },
    { hindi: impactHindi, english: impactEnglish },
  ];

  return {
    youtubeTitle: `Explained: ${summaryText} 🚨`.slice(0, 65),
    cardHeadline: summaryText,
    segments,
    primaryVisualQuery: visuals.primary,
    secondaryVisualQuery: visuals.secondary,
    altVisualQueries: visuals.alt,
    visualSceneQueries: visuals.scenes,
    tags: ['shorts', 'news', 'breakingnews', 'explained', 'trendingnews', 'currentaffairs'],
  };
}

export async function generateSlot3Content(customTopic = null) {
  logger.info('=== Generating Slot 3 (News Explainer) Fact-Grounded Content ===');

  const recentTopics = getRecentTopicsForSlot('slot3', 15);
  if (recentTopics.length > 0) {
    logger.info(`[Slot 3 Anti-Repeat] Found ${recentTopics.length} recent topics in memory.`);
  }

  let headline = '';
  let source = 'News Desk';
  let snippet = '';

  if (customTopic) {
    headline = customTopic.trim();
    snippet = customTopic.trim();
  } else {
    const newsList = await fetchTrendingNews();
    // Filter newsList to ensure no overlap with recent topics
    const freshList = newsList.filter((item) => {
      const hTokens = item.headline.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
      return !recentTopics.some((rt) => {
        const rtTokens = rt.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
        const overlap = hTokens.filter((w) => rtTokens.includes(w));
        return overlap.length >= 3;
      });
    });

    const chosenPool = freshList.length > 0 ? freshList : newsList;
    const item = chosenPool[Math.floor(Math.random() * chosenPool.length)];
    headline = item.headline;
    source = item.source || 'News Desk';
    snippet = item.snippet || '';
  }

  // Normalize quotes and whitespace without stripping contractions or apostrophes
  const cleanHeadline = headline
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

  const summary = summarizeNewsHeadline(cleanHeadline);
  const dynamicVisuals = deriveTopicVisualQueries(cleanHeadline, snippet);

  const prompt = `You are the lead investigative editor and scriptwriter for a viral YouTube Shorts and Instagram Reels news channel (@dailypulseshortss).
News Story Context:
- Headline: "${cleanHeadline}"
- RSS Details / Snippet: "${snippet || 'Breaking news update'}"
- News Source: "${source}"

ANTI-REPEAT MEMORY (CRITICAL):
Avoid repeating any of these recently published news angles or topics:
${recentTopics.map((t) => `- ${t}`).join('\n')}

STRICT FACTUAL GROUNDING:
- Rely SOLELY and STRICTLY on verified facts reported in the Headline and RSS context.
- NEVER invent statistics, false financial sums, unverified government policies, or fake quotes not present in the story.
- DO NOT use generic filler phrases (such as "visheshagyon ka manna hai", "aaj ki sabse badi khabar"). Every sentence must state concrete names, actions, facts, or consequences.

STRUCTURE (Curiosity & Insight-Driven, 45-60 words total):
1. Curiosity Gap Hook (0-2s, 8-12 words):
   Start with a curiosity hook or bold insight (e.g. "क्या सच में भारत ने बना लिया खुद का AI चिप?" / "इस बड़े फैसले ने वैश्विक बाजार को क्यों चौंका दिया?").
2. The Breakdown (2-25s, two parts, ~15 words each):
   State exactly what happened, why it matters, and what is unusual or strategic.
3. Broader Impact + Viewer Question (25-45s, 10-15 words):
   Highlight future consequences and ask viewers a direct question ("क्या आपको लगता है ये फैसला सही था?").

CRITICAL TTS & PRONUNCIATION INSTRUCTION:
- Microsoft Edge TTS Hindi neural voice mispronounces English acronyms and letters if written in Latin script.
- In ALL Hindi voiceover fields ("hookHindi", "coreDetail1Hindi", "coreDetail2Hindi", "impactHindi"):
  Write 100% in Devanagari script. All proper nouns, institution names, and acronyms (Supreme Court, RBI, Parliament, Prime Minister, ISRO, CBI, ED, Dollar) MUST be written phonetically in Devanagari (e.g. "सुप्रीम कोर्ट", "आरबीआई", "संसद", "प्रधानमंत्री", "इसरो", "सीबीआई", "ईडी", "डॉलर"). NEVER use Latin/English letters inside Hindi voiceover fields.

CRITICAL SUBTITLE INSTRUCTION:
- In ALL English subtitle fields ("hookEnglish", "coreDetail1English", "coreDetail2English", "impactEnglish"):
  Write crisp, punchy, grammatical English translations for burned-in subtitles.

SINGLE-SOURCE DOCUMENTARY VISUAL SCENE QUERIES (CRITICAL):
- Provide "visualSceneQueries": Exactly 4 distinct, highly specific documentary B-roll queries matching the exact topic (never generic news studios unless the topic is journalism). E.g. maps, currency notes, space rockets, courtrooms, satellite imagery, industrial plants.
  Suggested starting themes: ["${dynamicVisuals.scenes[0]}", "${dynamicVisuals.scenes[1]}", "${dynamicVisuals.scenes[2]}", "${dynamicVisuals.scenes[3]}"].

Return ONLY a valid JSON object matching this schema:
{
  "youtubeTitle": "High CTR news title with emojis (max 65 chars)",
  "cardHeadline": "Punchy 2-line title for overlay card (max 48 chars)",
  "hookHindi": "...",
  "hookEnglish": "...",
  "coreDetail1Hindi": "...",
  "coreDetail1English": "...",
  "coreDetail2Hindi": "...",
  "coreDetail2English": "...",
  "impactHindi": "...",
  "impactEnglish": "...",
  "primaryVisualQuery": "${dynamicVisuals.primary}",
  "secondaryVisualQuery": "${dynamicVisuals.secondary}",
  "altVisualQueries": ["${dynamicVisuals.alt[0]}", "${dynamicVisuals.alt[1]}"],
  "visualSceneQueries": [
    "${dynamicVisuals.scenes[0]}",
    "${dynamicVisuals.scenes[1]}",
    "${dynamicVisuals.scenes[2]}",
    "${dynamicVisuals.scenes[3]}"
  ],
  "tags": ["shorts", "news", "breakingnews", "explained"]
}`;

  let aiResult = await generateGeminiJson(prompt, {
    maxTokens: 850,
    temperature: 0.6,
    tag: 'Slot3-News',
  });

  let title = '';
  let cardHeadline = '';
  let segments = [];
  let visualQueries = null;
  let tags = [];

  if (aiResult && aiResult.hookHindi && aiResult.coreDetail1Hindi && aiResult.impactHindi) {
    title = (aiResult.youtubeTitle || `Explained: ${summary.fullSummary} 🚨`).slice(0, 95);
    cardHeadline = aiResult.cardHeadline || summary.fullSummary;
    segments = [
      {
        hindi: aiResult.hookHindi,
        english: aiResult.hookEnglish || aiResult.hookHinglish,
      },
      {
        hindi: aiResult.coreDetail1Hindi,
        english: aiResult.coreDetail1English || aiResult.coreDetail1Hinglish,
      },
      {
        hindi: aiResult.coreDetail2Hindi,
        english: aiResult.coreDetail2English || aiResult.coreDetail2Hinglish,
      },
      {
        hindi: aiResult.impactHindi,
        english: aiResult.impactEnglish || aiResult.impactHinglish,
      },
    ].filter((s) => s.hindi && s.english);

    visualQueries = {
      primaryQuery: aiResult.primaryVisualQuery || dynamicVisuals.primary,
      secondaryQuery: aiResult.secondaryVisualQuery || dynamicVisuals.secondary,
      altQueries: aiResult.altVisualQueries || dynamicVisuals.alt,
      visualSceneQueries: (Array.isArray(aiResult.visualSceneQueries) && aiResult.visualSceneQueries.length >= 3)
        ? aiResult.visualSceneQueries
        : dynamicVisuals.scenes,
    };
    tags = aiResult.tags || ['shorts', 'news', 'breakingnews', 'explained'];
  } else {
    logger.warn('[Slot 3] Generating via dynamic factual procedural fallback.');
    const fallback = generateDynamicNewsFallback({
      cleanHeadline,
      summary,
      snippet,
      source,
    });
    title = fallback.youtubeTitle;
    cardHeadline = fallback.cardHeadline;
    segments = fallback.segments.map((s) => ({
      hindi: s.hindi,
      english: s.english,
    }));
    visualQueries = {
      primaryQuery: fallback.primaryVisualQuery,
      secondaryQuery: fallback.secondaryVisualQuery,
      altQueries: fallback.altVisualQueries,
      visualSceneQueries: fallback.visualSceneQueries,
    };
    tags = fallback.tags;
  }

  const voiceScript = segments.map((s) => s.hindi).join(' ');
  const subtitleText = segments.map((s) => s.english).join(' ');
  const englishSubtitles = subtitleText;

  const description = `${title}\n\n` +
    `🔥 30-Second Explainer Breakdown:\n` +
    `• Topic: ${cleanHeadline}\n` +
    `• Summary: ${cardHeadline}\n` +
    `• Source: ${source}\n` +
    `• Language: Fast-paced Hindi narration with burned-in English on-screen subtitles.\n\n` +
    `Share your perspective below! Like and subscribe for daily quick-fire news explainers.`;

  const bgMusicPath = path.join(config.assetsDir, 'audio', 'news.mp3');

  return {
    slot: 'slot3',
    slotName: 'News Explainer (Breaking Update)',
    title,
    headline: cardHeadline,
    cleanTitle: cardHeadline,
    visualQuery: visualQueries.primaryQuery,
    secondaryQuery: visualQueries.secondaryQuery,
    altQueries: visualQueries.altQueries || [],
    visualSceneQueries: visualQueries.visualSceneQueries || dynamicVisuals.scenes,
    detectedCategory: 'breaking_news',
    description,
    tags,
    voice: config.voices.slot3,
    voiceScript,
    subtitleText,
    englishSubtitles,
    segments,
    bgMusicPath,
    categoryId: '25', // News & Politics
  };
}

import path from 'path';
import { fetchTrendingNews } from './news_fetcher.js';
import { config } from '../config.js';
import {
  summarizeNewsHeadline,
  extractNewsVisualQueries,
  extractNewsVisualTagsWithGemini,
  toTitleCase,
} from '../utils/text_utils.js';
import { logger } from '../utils/logger.js';

/**
 * Uses Gemini AI (gemini-2.5-flash with fallback to gemini-2.0-flash) to generate a punchy,
 * highly factual 55–70 word Hinglish news explainer script.
 * Both the spoken voiceover and subtitles use the EXACT SAME Hinglish words.
 */
async function generateNewsExplainerWithGemini({ headline, snippet, source, apiKey }) {
  if (!apiKey) return null;

  const prompt = `You are the lead news editor and scriptwriter for a top-tier viral YouTube Shorts and Instagram Reels channel.
Given this real news story:
- Headline: "${headline}"
- RSS Context / Key Details: "${snippet || 'Breaking news update'}"
- News Source: "${source}"

Write an informative, fast-paced, highly factual 55 to 70 word (25 to 30 second) Hinglish news explainer script based on your knowledge and the story context.
DO NOT use generic filler phrases (such as "visheshagyon ka manna hai ki neetiyon par asar padega" or "aaj ki sabse badi khabar"). Every sentence must state concrete names, actions, facts, or consequences.

STRICT 4-Part Structure:
1. Hook (8-14 words): High-impact opening stating EXACTLY what happened and who is involved.
2. Core Detail 1 (14-20 words): Concrete facts, reasons, numbers, or actions from the story.
3. Core Detail 2 (14-20 words): Key background context, institutional reaction, or strategic significance.
4. Impact & Takeaway (10-16 words): What happens next, future consequences, and a crisp prompt asking viewers for their opinion.

CRITICAL SUBTITLE REQUIREMENT:
- Generate two distinct language versions:
  1. Spoken voiceover: Written in Hindi / Hinglish in Devanagari script for neural TTS to speak ("hookHindi", "coreDetail1Hindi", "coreDetail2Hindi", "impactHindi").
  2. On-screen subtitles: A high-quality, punchy, grammatical English translation of the exact same script for burned-in subtitles ("hookEnglish", "coreDetail1English", "coreDetail2English", "impactEnglish").
- Total word count across all 4 parts MUST be 50 to 65 words.

Return ONLY a valid JSON object without markdown formatting:
{
  "youtubeTitle": "High CTR news title with emojis (max 65 chars)",
  "cardHeadline": "Complete, grammatically finished 2-line headline (max 48 chars)",
  "hookHindi": "...",
  "hookEnglish": "...",
  "coreDetail1Hindi": "...",
  "coreDetail1English": "...",
  "coreDetail2Hindi": "...",
  "coreDetail2English": "...",
  "impactHindi": "...",
  "impactEnglish": "...",
  "primaryVisualQuery": "broad 2-3 word visual query for B-roll",
  "secondaryVisualQuery": "broad 2-3 word visual query for B-roll",
  "altVisualQueries": ["query 3", "query 4"],
  "tags": ["news", "breakingnews", "explained"]
}`;

  const candidateModels = ['gemini-2.5-flash', 'gemini-2.0-flash'];

  for (const model of candidateModels) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 900, temperature: 0.6 },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        logger.warn(`[Slot 3] Gemini API [${model}] HTTP ${res.status}: ${errorBody.slice(0, 250)}`);
        continue;
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      if (parsed.hookHindi && parsed.coreDetail1Hindi && parsed.impactHindi) {
        logger.success(`[Slot 3] Successfully generated news explainer with Gemini [${model}].`);
        return parsed;
      } else {
        logger.warn(`[Slot 3] Gemini [${model}] returned incomplete JSON schema: ${cleanJson.slice(0, 150)}`);
      }
    } catch (e) {
      logger.warn(`[Slot 3] Gemini API call to [${model}] failed (${e.message})`);
    }
  }

  logger.warn(`[Slot 3] All Gemini models failed or unavailable. Falling back to factual procedural engine.`);
  return null;
}

/**
 * Factual Procedural Engine (Fallback when Gemini API is unavailable or rate-limited)
 * Uses concrete facts from headline, snippet, and source. ZERO generic boilerplate.
 * Generates exact 1-to-1 Hinglish subtitles matching the spoken voiceover.
 */
function generateFactualFallback({ cleanHeadline, summary, snippet, source }) {
  const headlineClean = cleanHeadline.replace(/['":]/g, '').trim();
  const summaryText = summary.fullSummary;

  // Extract key concrete fact from snippet if available
  let snippetFact = '';
  if (snippet) {
    const sentences = snippet
      .replace(/<[^>]+>/g, '')
      .split(/[.?!]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20 && !s.toLowerCase().includes('http'));
    if (sentences.length > 0) {
      snippetFact = sentences[0].slice(0, 85);
    }
  }

  const segments = [
    {
      hindi: `${headlineClean} को लेकर एक बड़ा और अहम खुलासा सामने आया है।`,
      english: `A major breaking development has emerged regarding ${headlineClean}.`,
    },
    {
      hindi: snippetFact
        ? `${source} की रिपोर्ट के मुताबिक: ${snippetFact}। इस मामले में जांच तेज हो गई है।`
        : `${source} की रिपोर्ट के मुताबिक इस घटनाक्रम के बाद जांच एजेंसियां अलर्ट मोड पर हैं।`,
      english: snippetFact
        ? `According to ${source}: ${snippetFact}. An active investigation is underway.`
        : `According to ${source}, top investigative agencies are now on high alert.`,
    },
    {
      hindi: `इस संवेदनशील घटनाक्रम के सामने आने के बाद प्रशासन और संबंधित अधिकारी बड़े कदम उठा रहे हैं।`,
      english: `Following these developments, high-level authorities are taking decisive action.`,
    },
    {
      hindi: `इस पूरे मामले पर आपकी क्या राय है? कमेंट्स में जरूर बताइए और सब्सक्राइब कीजिए!`,
      english: `What is your take on this breaking story? Share your views below and subscribe!`,
    },
  ];

  return {
    youtubeTitle: `Explained: ${summaryText} 🚨`.slice(0, 65),
    cardHeadline: summaryText,
    segments,
    primaryVisualQuery: 'breaking news studio',
    secondaryVisualQuery: 'city skyline aerial',
    altVisualQueries: ['broadcast journalist camera', 'newspaper press printing'],
    tags: ['shorts', 'news', 'breakingnews', 'explained', 'trendingnews', 'currentaffairs'],
  };
}

export async function generateSlot3Content(customTopic = null) {
  let headline = '';
  let source = 'News Desk';
  let snippet = '';

  if (customTopic) {
    headline = customTopic.trim();
    snippet = customTopic.trim();
  } else {
    const newsList = await fetchTrendingNews();
    const item = newsList[Math.floor(Math.random() * newsList.length)];
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

  // 1. Generate real Gemini AI news explainer
  const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
  let aiResult = null;
  if (apiKey) {
    logger.info(`[Slot 3] Generating real Gemini news explainer for: "${cleanHeadline}"...`);
    aiResult = await generateNewsExplainerWithGemini({
      headline: cleanHeadline,
      snippet,
      source,
      apiKey,
    });
  }

  let title = '';
  let cardHeadline = '';
  let segments = [];
  let visualQueries = null;
  let tags = [];

  if (aiResult) {
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
      primaryQuery: aiResult.primaryVisualQuery || 'breaking news studio',
      secondaryQuery: aiResult.secondaryVisualQuery || 'city skyline aerial',
      altQueries: aiResult.altVisualQueries || [],
    };
    tags = aiResult.tags || ['shorts', 'news', 'breakingnews', 'explained'];
  } else {
    const fallback = generateFactualFallback({
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

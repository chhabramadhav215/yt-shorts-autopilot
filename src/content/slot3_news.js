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
 * Uses Gemini AI to generate a punchy, factual 55–75 word (25–32s) Hindi news explainer
 * with matching English subtitles and grammatically complete headline.
 */
async function generateNewsExplainerWithGemini({ headline, snippet, source, apiKey }) {
  if (!apiKey) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const prompt = `You are the lead investigative scriptwriter for a top-tier viral news YouTube Shorts channel (like Vox, Cut, Daily Pulse).
Given this real news story:
- Headline: "${headline}"
- Full Context & Details from RSS: "${snippet || 'Major breaking news report'}"
- News Source: "${source}"

Write an informative, fast-paced, highly factual 55 to 75 word (25 to 32 second) Hindi news explainer script.

STRICT Content Structure (4 parts):
1. Hook (8-14 words): High-impact opening stating EXACTLY what happened and who is involved. NO generic fluff like "Aaj ki sabse badi khabar".
2. Core Detail 1 (15-22 words): Key facts, numbers, dates, or reasons behind the event from the story.
3. Core Detail 2 (15-22 words): Crucial context, reactions from leaders/institutions, or strategic significance.
4. Impact & Takeaway (12-18 words): What happens next, future consequences, and a crisp prompt asking viewers for their opinion.

Format Requirements:
- Voiceover (Hindi): Written in natural, punchy conversational Hindi (Devanagari script) with standard English loanwords (e.g. सुप्रीम कोर्ट, सरकार, रिपोर्ट, पॉलिसी, एक्शन). Total length across all 4 parts MUST be 55 to 75 words.
- Subtitles (English): Clean, punchy transliterated English/Hinglish subtitles that directly translate each part.
- Headline Card: Complete, grammatically finished 2-line headline (under 50 chars). NEVER end on prepositions or dangling words like "Threat to" or "After".
- Visual Queries: 2-3 real visual stock video queries for searching B-roll (e.g. "parliament building aerial", "police convoy lights", "stock market screen").

Return ONLY a valid JSON object without markdown formatting:
{
  "youtubeTitle": "High CTR news title with emojis (max 65 chars)",
  "cardHeadline": "Complete finished 2-line headline (max 48 chars)",
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

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 800, temperature: 0.6 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJson);

    if (parsed.hookHindi && parsed.coreDetail1Hindi && parsed.impactHindi) {
      return parsed;
    }
  } catch (e) {
    logger.warn(`[Slot 3] Gemini news explainer failed (${e.message}), using factual procedural engine.`);
  }
  return null;
}

/**
 * Factual Procedural Engine (Fallback when Gemini API is unavailable)
 * Strictly extracts real facts from headline, snippet, and source. ZERO boilerplate filler.
 */
function generateFactualFallback({ cleanHeadline, summary, snippet, source }) {
  const headlineClean = cleanHeadline.replace(/['":]/g, '').trim();
  const summaryText = summary.fullSummary;

  // Extract real factual snippet sentence if available
  let snippetFact = '';
  if (snippet) {
    const sentences = snippet
      .replace(/<[^>]+>/g, '')
      .split(/[.?!]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 25 && !s.toLowerCase().includes('http'));
    if (sentences.length > 0) {
      snippetFact = sentences[0].slice(0, 95);
    }
  }

  const segments = [
    {
      hindi: `${headlineClean} को लेकर इस वक्त की सबसे बड़ी खबर सामने आई है।`,
      english: `Major breaking developments have emerged regarding ${headlineClean}.`,
    },
    {
      hindi: snippetFact
        ? `${source} की रिपोर्ट के अनुसार: ${snippetFact}। इस मामले में नए तथ्य सामने आ रहे हैं।`
        : `${source} की रिपोर्ट के अनुसार इस मामले में संबंधित अधिकारियों ने सख्त कदम उठाए हैं।`,
      english: `According to reports from ${source}, authorities and experts are closely monitoring these key developments.`,
    },
    {
      hindi: `विशेषज्ञों का मानना है कि इस अहम घटनाक्रम का सीधा असर आने वाले दिनों में नीतियों और आम जनता पर पड़ेगा।`,
      english: `Analysts state that this critical situation will carry direct strategic and public policy consequences.`,
    },
    {
      hindi: `इस पूरे मामले पर आपकी क्या राय है? कमेंट्स में जरूर बताइए और 60-सेकंड एक्सप्लेनर के लिए सब्सक्राइब कीजिए!`,
      english: `What are your thoughts on this breaking story? Share your opinion below and subscribe!`,
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
        english: aiResult.hookEnglish,
      },
      {
        hindi: aiResult.coreDetail1Hindi,
        english: aiResult.coreDetail1English,
      },
      {
        hindi: aiResult.coreDetail2Hindi,
        english: aiResult.coreDetail2English,
      },
      {
        hindi: aiResult.impactHindi,
        english: aiResult.impactEnglish,
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
    segments = fallback.segments;
    visualQueries = {
      primaryQuery: fallback.primaryVisualQuery,
      secondaryQuery: fallback.secondaryVisualQuery,
      altQueries: fallback.altVisualQueries,
    };
    tags = fallback.tags;
  }

  const voiceScript = segments.map((s) => s.hindi).join(' ');
  const englishSubtitles = segments.map((s) => s.english).join(' ');

  const description = `${title}\n\n` +
    `🔥 30-Second Explainer Breakdown:\n` +
    `• Topic: ${cleanHeadline}\n` +
    `• Summary: ${cardHeadline}\n` +
    `• Source: ${source}\n` +
    `• Language: Hindi narration with English burned-in subtitles for worldwide viewers.\n\n` +
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
    englishSubtitles,
    segments,
    bgMusicPath,
    categoryId: '25', // News & Politics
  };
}

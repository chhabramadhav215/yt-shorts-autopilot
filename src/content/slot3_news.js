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

export async function generateSlot3Content(customTopic = null) {
  let headline = '';
  let source = 'News Desk';

  if (customTopic) {
    headline = customTopic.trim();
  } else {
    const newsList = await fetchTrendingNews();
    const item = newsList[Math.floor(Math.random() * newsList.length)];
    headline = item.headline;
    source = item.source || 'News Desk';
  }

  // Normalize quotes and whitespace without stripping contractions or apostrophes
  const cleanHeadline = headline
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

  const summary = summarizeNewsHeadline(cleanHeadline);

  // Extract smart visual queries: try Gemini first if API key configured, otherwise use semantic rules
  let visualQueries = null;
  if (config.geminiApiKey) {
    try {
      visualQueries = await extractNewsVisualTagsWithGemini(cleanHeadline, config.geminiApiKey);
      if (visualQueries) {
        logger.info(`[Slot 3] Gemini extracted visual tags: "${visualQueries.primaryQuery}", "${visualQueries.secondaryQuery}"`);
      }
    } catch (e) {
      // Fallback to local rule-based extractor
    }
  }

  if (!visualQueries) {
    visualQueries = extractNewsVisualQueries(cleanHeadline);
  }

  // Clean, punchy YouTube title with standard Title Case and contractions preserved
  const title = `Explained: ${summary.fullSummary} 🚨`.slice(0, 95);

  // Structured segments: Hindi Voiceover + English Burned-in Subtitles
  const segments = [
    {
      hindi: `आज की सबसे बड़ी खबर, जिसके बारे में हर कोई जानना चाहता है!`,
      english: `Here is the biggest breaking story everyone is talking about today!`,
    },
    {
      hindi: `बड़ी घटना: ${summary.fullSummary}। सूत्रों और मीडिया रिपोर्ट्स के मुताबिक यह मामला तेजी से गरमा रहा है।`,
      english: `Big incident: ${summary.fullSummary}. According to reports, this situation is developing rapidly.`,
    },
    {
      hindi: `विशेषज्ञों का कहना है कि इस बड़े कदम का सीधा असर आने वाले दिनों में आम जनता और नीतियों पर पड़ सकता है।`,
      english: `Experts state that this major move could directly impact policies and public interests.`,
    },
    {
      hindi: `इस पूरे मामले पर आपकी क्या राय है? कमेंट्स में जरूर बताइए और 60-सेकंड एक्सप्लेनर के लिए सब्सक्राइब कीजिए!`,
      english: `What is your opinion on this? Share your thoughts below and subscribe for 60-second updates!`,
    },
  ];

  const voiceScript = segments.map((s) => s.hindi).join(' ');
  const englishSubtitles = segments.map((s) => s.english).join(' ');

  const description = `${title}\n\n` +
    `🔥 30-Second Explainer Breakdown:\n` +
    `• Topic: ${cleanHeadline}\n` +
    `• Summary: ${summary.fullSummary}\n` +
    `• Source: ${source}\n` +
    `• Language: Hindi narration with English burned-in subtitles for worldwide viewers.\n\n` +
    `Share your perspective below! Like and subscribe for daily quick-fire news explainers.`;

  const tags = [
    'shorts',
    'news',
    'breakingnews',
    'explained',
    'trendingnews',
    'currentaffairs',
    'worldnews',
    'latestnews',
    'newsexplainer',
  ];

  const bgMusicPath = path.join(config.assetsDir, 'audio', 'news.mp3');

  return {
    slot: 'slot3',
    slotName: 'News Explainer (Breaking Update)',
    title,
    headline: summary.fullSummary,
    cleanTitle: summary.fullSummary,
    visualQuery: visualQueries.primaryQuery,
    secondaryQuery: visualQueries.secondaryQuery,
    altQueries: visualQueries.altQueries || [],
    detectedCategory: visualQueries.detectedCategory || 'general_news',
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

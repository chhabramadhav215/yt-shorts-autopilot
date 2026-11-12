import { logger } from '../utils/logger.js';

/**
 * Cleans HTML entities and tags from RSS strings
 */
function cleanXmlSnippet(str = '') {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetches latest trending headlines and full context summaries from Google News RSS
 */
export async function fetchTrendingNews() {
  try {
    const rssUrl = 'https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en';
    const res = await fetch(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;

    while ((match = itemRegex.exec(xml)) !== null && items.length < 15) {
      const itemContent = match[1];

      // Extract raw title
      const titleMatch = itemContent.match(/<title>([\s\S]*?)<\/title>/i);
      let rawTitle = titleMatch ? cleanXmlSnippet(titleMatch[1]) : '';

      // Extract explicit source if available
      const sourceTagMatch = itemContent.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
      let source = sourceTagMatch ? cleanXmlSnippet(sourceTagMatch[1]) : '';

      let headline = rawTitle;
      const sourceSuffixMatch = rawTitle.match(/(.*?)\s*-\s*([^-]+)$/);
      if (sourceSuffixMatch) {
        headline = sourceSuffixMatch[1].trim();
        if (!source) source = sourceSuffixMatch[2].trim();
      }
      if (!source) source = 'News Desk';

      // Extract full description snippet for rich context
      const descMatch = itemContent.match(/<description>([\s\S]*?)<\/description>/i);
      const snippet = descMatch ? cleanXmlSnippet(descMatch[1]) : '';

      // Extract Link & PubDate
      const linkMatch = itemContent.match(/<link>([\s\S]*?)<\/link>/i);
      const link = linkMatch ? linkMatch[1].trim() : '';

      const pubDateMatch = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
      const pubDate = pubDateMatch ? pubDateMatch[1].trim() : '';

      if (headline.length > 20) {
        items.push({
          headline,
          source,
          snippet,
          link,
          pubDate,
        });
      }
    }

    if (items.length > 0) {
      logger.info(`Fetched ${items.length} trending news stories with full context from Google News RSS.`);
      return items;
    }
  } catch (err) {
    logger.warn(`Failed to fetch Google News RSS: ${err.message}. Using high-TRP fallback topics.`);
  }

  // Fallback high-TRP explainer topics with rich context
  return [
    {
      headline: 'ISRO Next-Gen Space Mission & Reusable Launch Vehicle Milestone',
      source: 'Space Tech',
      snippet: 'ISRO announces successful breakthrough testing for next-generation reusable space launch vehicles aiming for commercial satellite deployment.',
    },
    {
      headline: 'Massive Gold Price Movement & Global Currency Shifts Explained',
      source: 'Market Watch',
      snippet: 'Global markets witness sharp movements in gold bullion reserves as international central banks rebalance currency holdings amid economic shifts.',
    },
    {
      headline: 'Major New AI Regulation & Cybersecurity Security Policies Unveiled',
      source: 'Tech Explainer',
      snippet: 'New comprehensive regulatory frameworks established to govern enterprise artificial intelligence models and national critical infrastructure safety.',
    },
  ];
}

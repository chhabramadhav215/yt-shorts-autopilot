import { logger } from '../utils/logger.js';
import { isTopicRecentlyPublished } from '../utils/publish_history.js';

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
 * Validates that an article pubDate is strictly within the last 48 hours
 */
function isWithin48Hours(pubDateStr) {
  if (!pubDateStr) return false;
  const pubTime = new Date(pubDateStr).getTime();
  if (isNaN(pubTime)) return false;
  const ageHours = (Date.now() - pubTime) / (1000 * 60 * 60);
  return ageHours >= 0 && ageHours <= 48;
}

/**
 * Fetches latest trending headlines and full context summaries from Google News RSS
 * with strict 24-48 hours freshness filter and 60-day persistent deduplication.
 */
export async function fetchTrendingNews() {
  const rssEndpoints = [
    'https://news.google.com/rss/search?q=India+breaking+news+when:2d&hl=en-IN&gl=IN&ceid=IN:en',
    'https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en',
  ];

  for (const rssUrl of rssEndpoints) {
    try {
      const res = await fetch(rssUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (!res.ok) continue;
      const xml = await res.text();

      const items = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
      let match;

      while ((match = itemRegex.exec(xml)) !== null && items.length < 25) {
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

        // STRICT FRESHNESS FILTER: Reject any article older than 48 hours
        if (!isWithin48Hours(pubDate)) {
          continue;
        }

        // DEDUPLICATION FILTER: Reject any topic published within the last 60 days
        if (isTopicRecentlyPublished(headline, 60)) {
          logger.info(`[Deduplication] Skipping recently published headline: "${headline.slice(0, 45)}..."`);
          continue;
        }

        if (headline.length > 20) {
          const pubTime = new Date(pubDate).getTime();
          const ageHours = ((Date.now() - pubTime) / (1000 * 60 * 60)).toFixed(1);
          items.push({
            headline,
            source,
            snippet,
            link,
            pubDate,
            pubTime,
            ageHours: `${ageHours}h ago`,
          });
        }
      }

      if (items.length > 0) {
        // Sort strictly by newest first
        items.sort((a, b) => b.pubTime - a.pubTime);
        logger.info(`Fetched ${items.length} verified FRESH (<=48h) news stories from Google News RSS.`);
        return items;
      }
    } catch (err) {
      logger.warn(`Failed fetching RSS endpoint (${rssUrl}): ${err.message}`);
    }
  }

  logger.warn('All RSS feeds returned empty or stale items. Using high-TRP dynamic fallback topics.');
  const currentDate = new Date().toISOString().split('T')[0];

  return [
    {
      headline: `India Strategic Economic & Tech Infrastructure Milestone (${currentDate})`,
      source: 'National Desk',
      snippet: 'India accelerates critical infrastructure and technological developments aiming for high manufacturing output and sustainable logistics growth.',
      pubDate: new Date().toUTCString(),
      ageHours: '0h ago',
    },
    {
      headline: `Global Financial Currency Movements & Gold Bullion Reserves Update (${currentDate})`,
      source: 'Market Watch',
      snippet: 'International central banks realign currency reserves and gold bullion assets amid fluctuating economic indicators and strategic trade agreements.',
      pubDate: new Date().toUTCString(),
      ageHours: '0h ago',
    },
  ];
}

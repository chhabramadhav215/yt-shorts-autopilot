import path from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { summarizeNewsHeadline, toTitleCase } from '../utils/text_utils.js';
import { isTopicRecentlyPublished } from '../utils/publish_history.js';

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
 * Fetches latest trending IPL/Cricket news from Google News RSS with strict 48-hour freshness filter
 */
async function fetchTrendingCricketNews() {
  const rssEndpoints = [
    'https://news.google.com/rss/search?q=IPL+2027+OR+cricket+trade+window+OR+retention+when:2d&hl=en-IN&gl=IN&ceid=IN:en',
    'https://news.google.com/rss/search?q=cricket+auction+OR+Rohit+OR+Kohli+OR+Dhoni+when:2d&hl=en-IN&gl=IN&ceid=IN:en',
    'https://news.google.com/rss/search?q=India+cricket+team+BCCI+when:2d&hl=en-IN&gl=IN&ceid=IN:en',
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
      const itemRegex = /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<link>(.*?)<\/link>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?<\/item>/gi;
      let match;

      while ((match = itemRegex.exec(xml)) !== null && items.length < 15) {
        let title = match[1]
          .replace(/<!\[CDATA\[(.*?)\]\]>/gi, '$1')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .trim();

        const pubDate = match[3]?.trim();
        // Strict freshness filter: Reject articles older than 48 hours
        if (pubDate && !isWithin48Hours(pubDate)) {
          continue;
        }

        const sourceMatch = title.match(/(.*?)\s*-\s*([^-]+)$/);
        let headline = title;
        let source = 'Cricket Desk';
        if (sourceMatch) {
          headline = sourceMatch[1].trim();
          source = sourceMatch[2].trim();
        }

        // 60-day deduplication check
        if (headline.length > 20 && !isTopicRecentlyPublished(headline, 60)) {
          items.push({ headline, source, pubDate });
        }
      }

      if (items.length > 0) {
        logger.info(`Fetched ${items.length} fresh cricket stories (<48h) from Google News RSS.`);
        return items;
      }
    } catch (err) {
      logger.warn(`Failed to fetch Cricket RSS (${rssUrl}): ${err.message}`);
    }
  }

  logger.warn('No fresh cricket stories found under 48h filter. Using high-CTR November 2026 cricket scenarios.');
  return [];
}

/**
 * Procedural viral IPL scenarios for November 2026 (IPL 2027 Trade Window, Retentions & Auctions)
 * Proper nouns written phonetically in Devanagari in Hindi fields for natural Edge TTS pronunciation.
 */
const VIRAL_CRICKET_TEMPLATES = [
  {
    player: 'Rohit Sharma',
    team: 'MI',
    statBadge: '5 IPL TROPHIES • HITMAN',
    headline: "Rohit Sharma IPL 2027 Trade Window Buzz",
    hookHindi: 'क्या रोहित शर्मा आईपीएल 2027 ट्रेड विंडो में मुंबई इंडियंस के साथ रहेंगे या कोई नई टीम उन्हें कप्तान बनाएगी?',
    hookEnglish: "Will Rohit Sharma stay with Mumbai Indians for IPL 2027 or lead a new franchise?",
    bodyPart1Hindi: 'आईपीएल 2027 ट्रेड विंडो खुलते ही तीन बड़ी फ्रैंचाइजी ने हिटमैन पर सबसे बड़ा दांव लगाने की तैयारी शुरू कर दी है।',
    bodyPart1English: "Top franchises are preparing blockbuster trade offers for Rohit Sharma in the IPL 2027 window.",
    bodyPart2Hindi: 'सूत्रों के अनुसार टीम मैनेजमेंट और रोहित शर्मा के बीच अगले सीजन की रणनीति पर अहम बातचीत जारी है।',
    bodyPart2English: "Crucial strategic discussions are underway regarding his captaincy role and team structure.",
    ctaHindi: 'आपकी राय क्या है? क्या रोहित शर्मा को मुंबई इंडियंस में रहना चाहिए? कमेंट्स में बताइए और सब्सक्राइब करें!',
    ctaEnglish: "What do you think? Should Rohit stay with MI or move? Comment your thoughts and subscribe!",
    visualSceneQueries: [
      'cricket stadium floodlights night',
      'cricket batsman hitting boundary shot',
      'stadium crowd cheering passionate',
      'cricket pitch night stadium'
    ],
    tags: ['RohitSharma', 'MumbaiIndians', 'Hitman', 'IPLAuction', 'IPL2027'],
  },
  {
    player: 'Virat Kohli',
    team: 'RCB',
    statBadge: '8000+ RUNS • KING KOHLI',
    headline: "Virat Kohli's Big IPL 2027 Trophy Masterplan",
    hookHindi: 'विराट कोहली और आरसीबी का आईपीएल 2027 ऑक्शन मास्टरप्लान देख बाकी टीमें हैरान क्यों हैं?',
    hookEnglish: "Why is everyone buzzing about Virat Kohli and RCB's big IPL 2027 auction masterplan?",
    bodyPart1Hindi: 'आरसीबी ने इस बार अपने 120 करोड़ के पर्स से मिडिल ऑर्डर और तेज गेंदबाजी यूनिट को मजबूत करने का फैसला किया है।',
    bodyPart1English: "RCB has strategically earmarked their mega purse to build an explosive middle-order and bowling attack.",
    bodyPart2Hindi: 'किंग कोहली के आक्रामक रुख और नए कोच के तालमेल से क्या आरसीबी का 18 साल का सूखा इस बार खत्म होगा?',
    bodyPart2English: "With King Kohli leading the charge, will RCB finally end their championship drought this season?",
    ctaHindi: 'क्या इस बार ई साला कप नाम्दे सच होगा? अपनी राय कमेंट्स में लिखें और वीडियो लाइक करें!',
    ctaEnglish: "Will 'Ee Sala Cup Namde' finally come true? Drop your verdict below and subscribe!",
    visualSceneQueries: [
      'cricket stadium crowd cheering',
      'cricket batsman aggressive shot',
      'stadium lights shining night',
      'cricket match celebration team'
    ],
    tags: ['ViratKohli', 'RCB', 'KingKohli', 'PlayBold', 'IPL2027'],
  },
  {
    player: 'MS Dhoni',
    team: 'CSK',
    statBadge: '5-TIME CHAMPION • THALA',
    headline: "MS Dhoni's Uncapped Rule & CSK Retention Drama",
    hookHindi: 'क्या एमएस धोनी आईपीएल 2027 में चेन्नई सुपर किंग्स के लिए मैदान पर उतरने वाले हैं?',
    hookEnglish: "Is MS Dhoni gearing up for another legendary season with CSK in IPL 2027?",
    bodyPart1Hindi: 'बीसीसीआई के अनकैप्ड नियम के तहत चेन्नई सुपर किंग्स ने थाला धोनी को सिर्फ चार करोड़ में रिटेन कर पर्स में भारी बचत की है।',
    bodyPart1English: "Under BCCI's uncapped player rule, CSK retained Thala Dhoni at 4 Crores, saving vital auction purse.",
    bodyPart2Hindi: 'धोनी के फिनिशर रोल और ऋतुराज गायकवाड़ की कप्तानी के साथ चेन्नई एक बार फिर अपनी छठी ट्रॉफी जीतने की तैयारी में है।',
    bodyPart2English: "With Dhoni anchoring the lower order and Gaikwad captaining, CSK aims for a record 6th title.",
    ctaHindi: 'क्या धोनी इस बार चैंपियन बनकर विदाई लेंगे? येलो आर्मी कमेंट्स में अपनी हाजिरी लगाएं!',
    ctaEnglish: "Will Dhoni lift one more trophy? Yellow Army, make some noise in the comments!",
    visualSceneQueries: [
      'cricket stadium night match',
      'cricket stadium floodlights atmospheric',
      'wicketkeeper fielding cricket',
      'stadium crowd waving flags'
    ],
    tags: ['MSDhoni', 'CSK', 'Thala', 'WhistlePodu', 'IPL2027'],
  },
  {
    player: 'Rishabh Pant',
    team: 'DC',
    statBadge: '₹27 CR RECORD BID • SPIDERMAN',
    headline: "Rishabh Pant's Record Mega Auction Captaincy",
    hookHindi: 'ऋषभ पंत ने सत्ताईस करोड़ की ऐतिहासिक बोली लगवा कर आईपीएल के सारे पुराने रिकॉर्ड कैसे तोड़ दिए?',
    hookEnglish: "How did Rishabh Pant shatter all records with a historic 27 Crore bid in the auction?",
    bodyPart1Hindi: 'ऑक्शन टेबल पर तीन टीमों के बीच बीस मिनट तक चली बिडिंग वॉर ने पंत को आईपीएल इतिहास का सबसे महंगा खिलाड़ी बना दिया।',
    bodyPart1English: "A fierce 20-minute bidding battle between franchises made Pant the highest-paid player in IPL history.",
    bodyPart2Hindi: 'अब कप्तान और विस्फोटक विकेटकीपर बल्लेबाज के रूप में उन पर अपनी टीम को पहली बार चैंपियन बनाने की जिम्मेदारी है।',
    bodyPart2English: "As captain and match-winning wicketkeeper, the massive responsibility is on him to deliver the trophy.",
    ctaHindi: 'क्या सत्ताईस करोड़ की कीमत पर पंत खरा उतर पाएंगे? कमेंट करके अपनी राय बताएं!',
    ctaEnglish: "Can Pant live up to the 27 Crore price tag? Share your opinion below!",
    visualSceneQueries: [
      'cricket ball hitting boundary',
      'cricket batsman celebrating hundred',
      'stadium crowd applauding',
      'floodlights night sports arena'
    ],
    tags: ['RishabhPant', 'IPLAuction', 'RecordBid', 'CricketBuzz', 'IPL2027'],
  },
  {
    player: 'Hardik Pandya',
    team: 'MI',
    statBadge: 'ALL-ROUNDER • REDEMPTION',
    headline: "Hardik Pandya's Redemption Arc in IPL 2027",
    hookHindi: 'क्या हार्दिक पांड्या आईपीएल 2027 में मुंबई इंडियंस के फैंस को अपनी कप्तानी से मना पाएंगे?',
    hookEnglish: "Can Hardik Pandya win over Mumbai Indians fans with his leadership in IPL 2027?",
    bodyPart1Hindi: 'इंटरनेशनल क्रिकेट में शानदार प्रदर्शन के बाद हार्दिक अब पूरी तरह कॉन्फिडेंट हैं और मुंबई की कोर टीम को रीबिल्ड कर रहे हैं।',
    bodyPart1English: "Following international success, a determined Hardik is rebuilding Mumbai Indians' winning core.",
    bodyPart2Hindi: 'जसप्रीत बुमराह, रोहित शर्मा और सूर्यकुमार यादव के साथ मिलकर क्या यह टीम एक बार फिर अपना पुराना दबदबा कायम करेगी?',
    bodyPart2English: "Alongside Jasprit Bumrah, Rohit Sharma, and Surya, will MI restore their dominant legacy?",
    ctaHindi: 'हार्दिक पांड्या या रोहित शर्मा, मुंबई का बेस्ट कप्तान कौन है? अपना वोट कमेंट्स में दें और सब्सक्राइब करें!',
    ctaEnglish: "Hardik or Rohit, who is the better skipper for MI? Cast your vote below!",
    visualSceneQueries: [
      'cricket all rounder bowling fast',
      'cricket stadium floodlights night',
      'batsman hitting six aerial',
      'stadium crowd cheering celebration'
    ],
    tags: ['HardikPandya', 'MumbaiIndians', 'OneFamily', 'Bumrah', 'IPL2027'],
  },
];

/**
 * Generates script using Gemini with fallback chain, current November 2026 date injection,
 * and Devanagari proper nouns requirement for natural Edge TTS pronunciation.
 */
async function generateWithGemini(newsHeadline, apiKey) {
  if (!apiKey) return null;
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
  const currentDate = new Date().toISOString().split('T')[0];

  for (const model of models) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const prompt = `You are the lead content creator for India's #1 viral IPL and Cricket YouTube Shorts and Instagram Reels channel.
Current Date: ${currentDate} (Current Context: November 2026, IPL 2027 Player Trades, Franchise Retentions, Upcoming Auction Buzz, Ongoing International Cricket).

Create a hyper-engaging 30-second Hindi voiceover script with English subtitles based on this cricket topic: "${newsHeadline}".

CRITICAL TTS & PRONUNCIATION INSTRUCTION:
- Edge TTS Hindi neural voice mispronounces English acronyms and letters if written in Latin script.
- Therefore, in ALL Hindi voiceover fields ("hookHindi", "bodyPart1Hindi", "bodyPart2Hindi", "ctaHindi"):
  Write 100% in Devanagari script. All English names, team acronyms, and cricket terms MUST be written phonetically in Devanagari (e.g. write "आईपीएल 2027", "रोहित शर्मा", "विराट कोहली", "मुंबई इंडियंस", "आरसीबी", "सीएसके", "ऋषभ पंत", "एमएस धोनी", "मेगा ऑक्शन", "ट्रेड विंडो", "कप्तान", "बीसीसीआई"). NEVER use Latin/English letters inside Hindi fields.

CRITICAL SUBTITLE INSTRUCTION:
- In ALL English subtitle fields ("hookEnglish", "bodyPart1English", "bodyPart2English", "ctaEnglish"):
  Write crisp, punchy, high-impact English translations for burned-in subtitles.

VISUAL SCENE QUERIES:
- Provide "visualSceneQueries": An array of 4 distinct, highly visual 2-4 word queries for moving B-roll video footage (e.g. stadium floodlights, batsman hitting six, bowler running up, cheering crowd).

Format Requirements:
1. Hook (0-3s): High-curiosity question (Trade rumors, retention buzz, captaincy news).
2. Body (4-28s): Crisp facts, trade figures, stats in 2 sharp parts.
3. CTA (29-35s): High-comment debate question for viewers.

Return ONLY a valid JSON object without markdown fences:
{
  "title": "High CTR title with emojis (max 50 chars)",
  "headline": "Punchy 2-line title for overlay card (max 45 chars)",
  "hookHindi": "...",
  "hookEnglish": "...",
  "bodyPart1Hindi": "...",
  "bodyPart1English": "...",
  "bodyPart2Hindi": "...",
  "bodyPart2English": "...",
  "ctaHindi": "...",
  "ctaEnglish": "...",
  "primaryPlayer": "Virat Kohli / Rohit Sharma / MS Dhoni / Hardik Pandya / Rishabh Pant / Jasprit Bumrah",
  "team": "RCB / CSK / MI / KKR / SRH / DC / RR / GT / LSG / PBKS",
  "statBadge": "Short key stat e.g. ₹27 CR MEGA BID or IPL 2027 BUZZ",
  "visualQuery": "cricket stadium floodlights",
  "visualSceneQueries": [
    "cricket stadium floodlights night",
    "cricket batsman aggressive shot",
    "fast bowler bowling delivery",
    "stadium crowd cheering cricket"
  ],
  "tags": ["IPL2027", "IPLAuction", "CricketShorts"]
}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 750, temperature: 0.7 },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        logger.warn(`Gemini (${model}) returned HTTP ${res.status}`);
        continue;
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      if (parsed.hookHindi && parsed.bodyPart1Hindi && parsed.hookEnglish) {
        logger.success(`Gemini (${model}) successfully generated cricket script with Devanagari pronunciation.`);
        return parsed;
      }
    } catch (e) {
      logger.warn(`Gemini API call to ${model} failed (${e.message})`);
    }
  }
  return null;
}

/**
 * Main Content Generator for Slot 5 (IPL & Cricket Buzz)
 * @param {string} [customTopic]
 */
export async function generateSlot5Content(customTopic = null) {
  logger.info('=== Generating Slot 5 (IPL 2027 & Cricket Buzz) High-CTR Content ===');

  let chosenTopic = customTopic;
  if (!chosenTopic) {
    const trendingList = await fetchTrendingCricketNews();
    if (trendingList.length > 0) {
      chosenTopic = trendingList[Math.floor(Math.random() * trendingList.length)].headline;
    }
  }

  let generated = null;
  if (chosenTopic && config.geminiApiKey) {
    generated = await generateWithGemini(chosenTopic, config.geminiApiKey);
  }

  // Fallback to random procedural viral template
  if (!generated) {
    const template = VIRAL_CRICKET_TEMPLATES[Math.floor(Math.random() * VIRAL_CRICKET_TEMPLATES.length)];
    generated = {
      title: `${template.headline} 🏏🔥`,
      headline: template.headline,
      hookHindi: template.hookHindi,
      hookEnglish: template.hookEnglish,
      bodyPart1Hindi: template.bodyPart1Hindi,
      bodyPart1English: template.bodyPart1English,
      bodyPart2Hindi: template.bodyPart2Hindi,
      bodyPart2English: template.bodyPart2English,
      ctaHindi: template.ctaHindi,
      ctaEnglish: template.ctaEnglish,
      primaryPlayer: template.player,
      team: template.team,
      statBadge: template.statBadge,
      visualQuery: 'cricket stadium floodlights',
      visualSceneQueries: template.visualSceneQueries,
      tags: template.tags,
    };
  }

  const cleanHeadline = (generated.headline || chosenTopic || "IPL 2027 Mega Buzz")
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .trim();

  const summary = summarizeNewsHeadline(cleanHeadline);
  const formattedTitle = generated.title
    ? `${toTitleCase(generated.title.replace(/🚨|🔥|🏏/g, '').trim())} 🏏🔥`
    : `IPL 2027: ${summary.fullSummary} 🏏🔥`;

  // 4 Structured segments: Hook (0-3s), Facts (4-28s), CTA (29-35s)
  const segments = [
    {
      hindi: generated.hookHindi,
      english: generated.hookEnglish,
    },
    {
      hindi: generated.bodyPart1Hindi,
      english: generated.bodyPart1English,
    },
    {
      hindi: generated.bodyPart2Hindi,
      english: generated.bodyPart2English,
    },
    {
      hindi: generated.ctaHindi,
      english: generated.ctaEnglish,
    },
  ];

  const voiceScript = segments.map((s) => s.hindi).join(' ');
  const subtitleText = segments.map((s) => s.english).join(' ');

  const tags = [
    'IPL2027',
    'IPLAuction',
    'CricketShorts',
    'CricketBuzz',
    'Shorts',
    'ViralShorts',
    'BCCI',
    ...(generated.tags || []),
    generated.team || 'IPL',
  ].map((t) => t.replace(/[^a-zA-Z0-9]/g, ''));

  const description = `${formattedTitle}\n\n` +
    `🔥 IPL 2027 Instant Buzz Breakdown:\n` +
    `• Featured Star: ${generated.primaryPlayer || 'Cricket Superstars'}\n` +
    `• Franchise: ${generated.team || 'IPL'}\n` +
    `• Key Stat: ${generated.statBadge || 'Auction Highlights'}\n` +
    `• Language: High-energy Hindi commentary with English captions.\n\n` +
    `Who is your favorite team for IPL 2027? Drop your verdict below!\n` +
    `Like, share & subscribe for daily rapid-fire cricket updates.`;

  const bgMusicPath = path.join(config.assetsDir, 'audio', 'cricket.mp3');
  const sfxAudioPath = path.join(config.assetsDir, 'audio', 'whoosh.mp3');

  const visualSceneQueries = Array.isArray(generated.visualSceneQueries) && generated.visualSceneQueries.length >= 3
    ? generated.visualSceneQueries
    : [
        'cricket stadium floodlights night',
        'cricket batsman aggressive shot',
        'bowler delivering cricket ball',
        'stadium crowd cheering'
      ];

  return {
    slot: 'slot5',
    slotName: 'IPL & Cricket Buzz (Prime Viral)',
    title: formattedTitle.slice(0, 95),
    headline: summary.fullSummary,
    cleanTitle: summary.fullSummary,
    primaryPlayer: generated.primaryPlayer || 'Virat Kohli',
    team: (generated.team || 'RCB').toUpperCase(),
    statBadge: generated.statBadge || 'IPL 2027 BUZZ',
    visualQuery: generated.visualQuery || 'cricket ground',
    secondaryQuery: 'sports stadium lights',
    altQueries: ['cricket pitch', 'cricket stadium floodlights', 'stadium crowd cheering'],
    visualSceneQueries,
    description,
    tags,
    voice: config.voices.slot5,
    pitch: '+0Hz',
    rate: '+10%', // Fast-paced high-energy sports commentary
    voiceScript,
    subtitleText,
    englishSubtitles: subtitleText,
    segments,
    bgMusicPath,
    sfxAudioPath,
    categoryId: '17', // YouTube category: Sports
  };
}

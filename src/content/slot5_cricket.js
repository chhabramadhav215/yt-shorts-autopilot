import path from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { summarizeNewsHeadline, toTitleCase } from '../utils/text_utils.js';

/**
 * Fetches latest trending IPL/Cricket news from Google News RSS
 */
async function fetchTrendingCricketNews() {
  try {
    const rssUrl = 'https://news.google.com/rss/search?q=IPL+cricket+auction+trade+OR+Rohit+OR+Kohli+OR+Dhoni&hl=en-IN&gl=IN&ceid=IN:en';
    const res = await fetch(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<link>(.*?)<\/link>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?<\/item>/gi;
    let match;

    while ((match = itemRegex.exec(xml)) !== null && items.length < 8) {
      let title = match[1]
        .replace(/<!\[CDATA\[(.*?)\]\]>/gi, '$1')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();

      const sourceMatch = title.match(/(.*?)\s*-\s*([^-]+)$/);
      let headline = title;
      let source = 'Cricket Desk';
      if (sourceMatch) {
        headline = sourceMatch[1].trim();
        source = sourceMatch[2].trim();
      }

      if (headline.length > 20) {
        items.push({ headline, source });
      }
    }

    if (items.length > 0) {
      logger.info(`Fetched ${items.length} trending cricket stories from Google News RSS.`);
      return items;
    }
  } catch (err) {
    logger.warn(`Failed to fetch Cricket RSS: ${err.message}. Using high-CTR cricket scenarios.`);
  }

  return [];
}

/**
 * Procedural viral IPL scenarios when Gemini API or RSS is offline
 */
const VIRAL_CRICKET_TEMPLATES = [
  {
    player: 'Rohit Sharma',
    team: 'MI',
    statBadge: '5 IPL TROPHIES • HITMAN',
    headline: "Rohit Sharma's Trade Rumors & Captaincy Buzz",
    hookHindi: 'क्या रोहित शर्मा आईपीएल 2026 में मुंबई इंडियंस का साथ छोड़ने वाले हैं या फिर से कप्तानी संभालेंगे?',
    hookEnglish: "Is Rohit Sharma leaving Mumbai Indians for IPL 2026 or reclaiming captaincy?",
    bodyPart1Hindi: 'मेगा ऑक्शन और ट्रेड विंडो में रोहित शर्मा के नाम पर टीमों में जबरदस्त होड़ मची है। सूत्रों के मुताबिक तीन बड़ी फ्रैंचाइजी उन पर बड़ा दांव लगाने को तैयार हैं।',
    bodyPart1English: "Huge bidding battle underway for Rohit Sharma across top franchises in the trade window.",
    bodyPart2Hindi: 'अगर ट्रेड फाइनल हुआ तो यह आईपीएल इतिहास का सबसे बड़ा ट्रांसफर हो सकता है, जिससे टीम का पूरा पर्स और समीकरण बदल जाएगा।',
    bodyPart2English: "If finalized, this could be the biggest blockbuster trade in IPL history, shaking team dynamics.",
    ctaHindi: 'आपकी राय क्या है? क्या रोहित को मुंबई छोड़नी चाहिए या नहीं? कमेंट्स में बताइए और सब्सक्राइब करें!',
    ctaEnglish: "What do you think? Should Rohit leave MI or stay? Drop your pick below and subscribe!",
    tags: ['RohitSharma', 'MumbaiIndians', 'Hitman', 'IPLAuction', 'IPL2026'],
  },
  {
    player: 'Virat Kohli',
    team: 'RCB',
    statBadge: '8000+ RUNS • KING KOHLI',
    headline: "Virat Kohli's Big IPL 2026 Trophy Masterplan",
    hookHindi: 'विराट कोहली और आरसीबी का इस बार का ऑक्शन मास्टरप्लान देख हर कोई हैरान क्यों है?',
    hookEnglish: "Why is everyone stunned by Virat Kohli and RCB's new IPL 2026 masterplan?",
    bodyPart1Hindi: 'आरसीबी ने इस बार अपने 120 करोड़ के पर्स में से मिडल ऑर्डर और फास्ट बोलिंग यूनिट को मजबूत करने के लिए इंटरनेशनल सुपरस्टार्स को टारगेट किया है।',
    bodyPart1English: "RCB has allocated their massive auction purse to target destructive middle-order and fast bowling stars.",
    bodyPart2Hindi: 'किंग कोहली की कप्तानी वापसी और नए कोच के तालमेल से क्या आरसीबी का 18 साल का सूखा इस बार खत्म होगा?',
    bodyPart2English: "With King Kohli's relentless energy, will RCB finally lift their maiden IPL trophy this season?",
    ctaHindi: 'क्या इस साल ई साला कप नाम्दे सच होगा? अपनी राय कमेंट्स में लिखें और वीडियो लाइक करें!',
    ctaEnglish: "Will 'Ee Sala Cup Namde' finally come true? Comment your verdict below and subscribe!",
    tags: ['ViratKohli', 'RCB', 'KingKohli', 'PlayBold', 'IPL2026'],
  },
  {
    player: 'MS Dhoni',
    team: 'CSK',
    statBadge: '5-TIME CHAMPION • THALA',
    headline: "MS Dhoni's Uncapped Rule & CSK Retention Drama",
    hookHindi: 'क्या एमएस धोनी आईपीएल 2026 में चेन्नई सुपर किंग्स के लिए अपना आखिरी सीजन खेलने वाले हैं?',
    hookEnglish: "Is MS Dhoni gearing up for his final fairytale season with CSK in IPL 2026?",
    bodyPart1Hindi: 'बीसीसीआई के 5 साल पुराने अनकैप्ड नियम के तहत सीएसके ने थाला धोनी को सिर्फ 4 करोड़ में रिटेन कर बाकी पर्स में भारी बचत की है।',
    bodyPart1English: "Under the uncapped player rule, CSK retained Thala Dhoni at 4 Crores, saving huge purse funds.",
    bodyPart2Hindi: 'धोनी के फिनिशर रोल और ऋतुराज गायकवाड़ की कप्तानी के साथ चेन्नई एक बार फिर अपनी छठी ट्रॉफी जीतने के लिए तैयार है।',
    bodyPart2English: "With Dhoni in the finisher role and Gaikwad leading, CSK aims for a record 6th IPL title.",
    ctaHindi: 'क्या धोनी इस बार चैंपियन बनकर विदाई लेंगे? येलो आर्मी कमेंट्स में अपनी हाजिरी लगाएं!',
    ctaEnglish: "Will Dhoni sign off with another championship? Yellow Army, shout out in the comments!",
    tags: ['MSDhoni', 'CSK', 'Thala', 'WhistlePodu', 'IPL2026'],
  },
  {
    player: 'Rishabh Pant',
    team: 'DC',
    statBadge: '₹27 CR RECORD BID • SPIDERMAN',
    headline: "Rishabh Pant's Historic Record Mega Auction Bid",
    hookHindi: 'ऋषभ पंत ने 27 करोड़ की ऐतिहासिक बोली लगवा कर आईपीएल के सारे पुराने रिकॉर्ड कैसे तोड़ दिए?',
    hookEnglish: "How did Rishabh Pant shatter every record in IPL history with a 27 Crore bid?",
    bodyPart1Hindi: 'ऑक्शन टेबल पर तीन टीमों के बीच 20 मिनट तक चली बिडिंग वॉर ने पंत को आईपीएल इतिहास का सबसे महंगा खिलाड़ी बना दिया।',
    bodyPart1English: "A fierce 20-minute bidding war between top franchises crowned Pant as the costliest player ever.",
    bodyPart2Hindi: 'अब नए कप्तान और धमाकेदार विकेटकीपर बल्लेबाज के रूप में उन पर अपनी नई टीम को पहली बार चैंपियन बनाने की सबसे बड़ी जिम्मेदारी है।',
    bodyPart2English: "Now as captain and match-winning keeper, the immense pressure is on Pant to deliver the maiden title.",
    ctaHindi: 'क्या 27 करोड़ की कीमत पर पंत खरा उतर पाएंगे? कमेंट करके अपनी राय बताएं!',
    ctaEnglish: "Can Pant justify the 27 Crore record price tag? Drop your thoughts below!",
    tags: ['RishabhPant', 'IPLAuction', 'RecordBid', 'CricketBuzz', 'IPL2026'],
  },
  {
    player: 'Hardik Pandya',
    team: 'MI',
    statBadge: 'ALL-ROUNDER • REDEMPTION',
    headline: "Hardik Pandya's Redemption Arc in IPL 2026",
    hookHindi: 'क्या हार्दिक पांड्या इस बार मुंबई इंडियंस के फैंस को अपनी कप्तानी से मना पाएंगे?',
    hookEnglish: "Can Hardik Pandya win over Mumbai Indians fans with his leadership in IPL 2026?",
    bodyPart1Hindi: 'टी20 वर्ल्ड कप में शानदार जीत दिलाने के बाद हार्दिक अब पूरी तरह कॉन्फिडेंट हैं और मुंबई इंडियंस की कोर टीम को रीबिल्ड कर रहे हैं।',
    bodyPart1English: "Following World Cup glory, a rejuvenated Hardik is reshaping Mumbai Indians' winning core.",
    bodyPart2Hindi: 'बुमराह, रोहित और सूर्यकुमार यादव के साथ मिलकर क्या यह टीम एक बार फिर आईपीएल में अपना पुराना दबदबा कायम करेगी?',
    bodyPart2English: "Alongside Bumrah, Rohit, and Surya, will MI restore their legendary dominance in the league?",
    ctaHindi: 'हार्दिक या रोहित, मुंबई का बेस्ट कप्तान कौन है? अपना वोट कमेंट्स में दें और सब्सक्राइब करें!',
    ctaEnglish: "Hardik or Rohit, who is the better MI skipper? Cast your vote below!",
    tags: ['HardikPandya', 'MumbaiIndians', 'OneFamily', 'Bumrah', 'IPL2026'],
  },
];

/**
 * Generates script using Gemini with fallback chain
 */
async function generateWithGemini(newsHeadline, apiKey) {
  if (!apiKey) return null;
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
  for (const model of models) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const prompt = `You are the lead content creator for India's #1 viral IPL and Cricket YouTube Shorts and Instagram Reels channel.
Create a hyper-engaging 30-second Hindi voiceover script with English subtitles based on this cricket topic: "${newsHeadline}".

Format Requirements:
1. Hook (0-3s): High-curiosity question (e.g. Trade rumors, record bids, captaincy shakeups).
2. Body (4-28s): Crisp facts, purse comparisons, and stats in 2 sharp parts.
3. CTA (29-35s): Polarization/comment-bait question to trigger furious debate in YouTube comments.
4. Dual-Language Requirement:
   - "hookHindi", "bodyPart1Hindi", "bodyPart2Hindi", "ctaHindi": Natural, punchy spoken Hindi (written in Devanagari script) for voiceover.
   - "hookEnglish", "bodyPart1English", "bodyPart2English", "ctaEnglish": High-quality, punchy English translations for burned-in on-screen subtitles.

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
  "primaryPlayer": "Virat Kohli / Rohit Sharma / MS Dhoni / Hardik Pandya / Rishabh Pant",
  "team": "RCB / CSK / MI / KKR / SRH / DC / RR / GT / LSG / PBKS",
  "statBadge": "Short key stat e.g. ₹27 CR MEGA BID or 5 TROPHIES",
  "visualQuery": "cricket stadium floodlights",
  "tags": ["IPL2026", "IPLAuction", "CricketShorts"]
}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 600, temperature: 0.7 },
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
        logger.success(`Gemini (${model}) successfully generated cricket script.`);
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
  logger.info('=== Generating Slot 5 (IPL & Cricket Buzz) High-CTR Content ===');

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
      tags: template.tags,
    };
  }

  const cleanHeadline = (generated.headline || chosenTopic || "IPL 2026 Mega Buzz")
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .trim();

  const summary = summarizeNewsHeadline(cleanHeadline);
  const formattedTitle = generated.title
    ? `${toTitleCase(generated.title.replace(/🚨|🔥|🏏/g, '').trim())} 🏏🔥`
    : `IPL 2026: ${summary.fullSummary} 🏏🔥`;

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
    'IPL2026',
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
    `🔥 IPL 2026 Instant Buzz Breakdown:\n` +
    `• Featured Star: ${generated.primaryPlayer || 'Cricket Superstars'}\n` +
    `• Franchise: ${generated.team || 'IPL'}\n` +
    `• Key Stat: ${generated.statBadge || 'Auction Highlights'}\n` +
    `• Language: High-energy Hindi commentary with English captions.\n\n` +
    `Who is your favorite team for IPL 2026? Drop your verdict below!\n` +
    `Like, share & subscribe for daily rapid-fire cricket updates.`;

  const bgMusicPath = path.join(config.assetsDir, 'audio', 'cricket.mp3');
  const sfxAudioPath = path.join(config.assetsDir, 'audio', 'whoosh.mp3');

  return {
    slot: 'slot5',
    slotName: 'IPL & Cricket Buzz (Prime Viral)',
    title: formattedTitle.slice(0, 95),
    headline: summary.fullSummary,
    cleanTitle: summary.fullSummary,
    primaryPlayer: generated.primaryPlayer || 'Virat Kohli',
    team: (generated.team || 'RCB').toUpperCase(),
    statBadge: generated.statBadge || 'IPL 2026 BUZZ',
    visualQuery: generated.visualQuery || 'cricket ground',
    secondaryQuery: 'sports stadium lights',
    altQueries: ['cricket pitch', 'cricket stadium floodlights', 'stadium crowd cheering'],
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

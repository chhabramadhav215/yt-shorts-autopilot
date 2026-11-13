/**
 * Wraps text into multiple lines without cutting off words mid-way
 * @param {string} text
 * @param {number} maxChars
 * @returns {string[]}
 */
export function wrapText(text, maxChars = 28) {
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length <= maxChars) {
      currentLine = (currentLine + ' ' + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * Converts a string to standard, clean Title Case.
 * Preserves contractions (e.g., "Didn't", "Hegseth's", "We're", "Won't")
 * and keeps common news acronyms uppercase (e.g., US, UK, UN, BJP, AI, RBI).
 * Leaves minor words lowercase in the middle of titles.
 * @param {string} str
 * @returns {string}
 */
export function toTitleCase(str) {
  if (!str) return '';
  const minorWords = new Set([
    'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in',
    'into', 'nor', 'of', 'on', 'or', 'so', 'the', 'to', 'up', 'with', 'vs', 'via'
  ]);
  const acronyms = new Set([
    'US', 'USA', 'UK', 'UN', 'EU', 'NATO', 'PM', 'CEO', 'CFO', 'AI', 'IPL',
    'BCCI', 'ISRO', 'NASA', 'RBI', 'BJP', 'AAP', 'CBI', 'ED', 'FIR', 'LOC',
    'LAC', 'GDP', 'TRP', 'IMF', 'WHO', 'UAE'
  ]);

  const words = str.trim().split(/\s+/);
  return words
    .map((word, idx) => {
      // Isolate leading/trailing punctuation (quotes, brackets, colons)
      const match = word.match(/^([^a-zA-Z0-9]*)([a-zA-Z0-9'’\-]+)([^a-zA-Z0-9]*)$/);
      if (!match) return word;
      const [_, leading, core, trailing] = match;
      if (!core) return word;

      const upperCore = core.toUpperCase();
      if (acronyms.has(upperCore)) {
        return `${leading}${upperCore}${trailing}`;
      }

      const lowerCore = core.toLowerCase();
      // Keep minor words lowercase in middle of title
      if (
        idx > 0 &&
        idx < words.length - 1 &&
        minorWords.has(lowerCore) &&
        !leading.includes(':') &&
        !leading.includes('"') &&
        !leading.includes("'")
      ) {
        return `${leading}${lowerCore}${trailing}`;
      }

      // Title case word while preserving contractions (e.g. didn't -> Didn't, hegseth's -> Hegseth's)
      const titleCased = lowerCore.replace(/(^[a-zA-Z]|[-][a-zA-Z])/g, (c) => c.toUpperCase());
      return `${leading}${titleCased}${trailing}`;
    })
    .join(' ');
}

/**
 * Auto-summarizes news headlines into a clean, punchy 2-line title (max 50 chars).
 * Preserves proper apostrophes and contractions (e.g. "We Didn't Start", "Pete Hegseth's").
 * Uses standard Title Case instead of flat unpunctuated all-caps.
 * Strips leading tags like "EXPLAINED:", "WATCH:", "BREAKING UPDATE:".
 * @param {string} rawHeadline
 * @returns {{ line1: string, line2: string, fullSummary: string }}
 */
export function summarizeNewsHeadline(rawHeadline) {
  if (!rawHeadline) {
    return { line1: 'Breaking News', line2: 'Latest Update', fullSummary: 'Breaking News Update' };
  }

  // 1. Strip leading news tags and broadcast markers
  let text = rawHeadline
    .replace(/^(EXPLAINED|BREAKING UPDATE|BREAKING NEWS|BREAKING|WATCH|JUST IN|ALERT|REPORT|VIRAL):\s*/i, '')
    .replace(/🚨/g, '')
    .replace(/[\u2018\u2019\u201B]/g, "'") // Normalize single curly quotes
    .replace(/[\u201C\u201D\u201F]/g, '"') // Normalize double curly quotes
    .replace(/\s+[-|]\s+[A-Za-z0-9\s.]{2,30}$/, '') // Clean publication like " - The Hindu"
    .replace(/\s*\.\.\.\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Convert to standard Title Case
  text = toTitleCase(text);

  // 2. If text exceeds 56 chars, split at clean clause, colon, or word boundary
  if (text.length > 56) {
    // Check if there is an explicit colon or dash separating main topic
    const colonMatch = text.match(/^(.*?)(?::|—|–|-)\s*(.*)$/);
    if (colonMatch && colonMatch[1].length >= 20 && colonMatch[1].length <= 54) {
      text = colonMatch[1].trim();
    } else {
      const clauseRegex = /\s+(?:after|as|amid|following|ahead of|over|says|warns)\s+/i;
      const match = text.match(clauseRegex);
      if (match && match.index && match.index >= 20 && match.index <= 54) {
        text = text.substring(0, match.index).trim();
      } else {
        const sub = text.substring(0, 54);
        const lastSpace = sub.lastIndexOf(' ');
        if (lastSpace > 24) {
          text = sub.substring(0, lastSpace).trim();
        } else {
          text = sub.trim();
        }
      }
    }
  }

  // Strip any dangling prepositions, conjunctions, or incomplete connectors
  // Never end abruptly on words like "to", "threat to", "for", "with", "in", "after"
  const danglingConnectors = /\s+(?:to|of|in|for|on|with|at|by|from|and|or|as|that|is|are|after|amid|over|into|about|under|than|the|a|an)\s*$/i;
  while (danglingConnectors.test(text)) {
    text = text.replace(danglingConnectors, '').trim();
  }

  // Remove trailing punctuation except quotes
  text = text.replace(/[,;\-.\s]+$/, '').trim();

  const words = text.split(' ').filter(Boolean);
  if (words.length <= 1) {
    return { line1: text, line2: '', fullSummary: text };
  }

  // Find optimal split point closest to center character count
  const targetLen = text.length / 2;
  let bestIdx = 1;
  let bestDiff = 999;
  let currentLen = 0;

  for (let i = 0; i < words.length - 1; i++) {
    currentLen += words[i].length + 1;
    const diff = Math.abs(currentLen - targetLen);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i + 1;
    }
  }

  const line1 = words.slice(0, bestIdx).join(' ');
  const line2 = words.slice(bestIdx).join(' ');

  return {
    line1,
    line2,
    fullSummary: `${line1} ${line2}`.trim(),
  };
}

/**
 * Uses Gemini API to parse 2-3 broad visual stock video tags from a news headline
 * @param {string} cleanHeadline
 * @param {string} apiKey
 * @returns {Promise<{ primaryQuery: string, secondaryQuery: string, altQueries: string[], source: string } | null>}
 */
export async function extractNewsVisualTagsWithGemini(cleanHeadline, apiKey) {
  if (!apiKey) return null;
  const prompt = `You are a video stock footage researcher for news YouTube Shorts.
Given this news headline: "${cleanHeadline}"
Extract exactly 2 or 3 short, broad stock video search queries (each 2-3 words, describing REAL visual scenes suitable for searching Pexels stock video, e.g. "military press conference", "breaking news reporter", "geopolitics world map", "courtroom gavel justice", "stock market trading", "rocket launch space").
Rules:
- NEVER output names of individual people or obscure locations.
- NEVER output abstract slogans or quotes.
- Only output real visual scenery / stock video terms.
- Return ONLY the queries separated by commas.`;

  const candidateModels = ['gemini-2.5-flash', 'gemini-2.0-flash'];
  for (const model of candidateModels) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 60, temperature: 0.2 },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const tags = text
        .split(/[,;\n]/)
        .map((t) => t.replace(/["'*`.\-]/g, '').trim())
        .filter((t) => t.length > 2 && t.split(/\s+/).length <= 4);

      if (tags.length >= 2) {
        return {
          primaryQuery: tags[0].toLowerCase(),
          secondaryQuery: tags[1].toLowerCase(),
          altQueries: tags.slice(2).map((t) => t.toLowerCase()),
          source: `gemini-${model}`,
        };
      }
    } catch (_) {}
  }
  return null;
}

function matchesTrigger(text, trig) {
  if (trig.includes(' ')) {
    return text.includes(trig);
  }
  const regex = new RegExp(`\\b${trig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return regex.test(text);
}

/**
 * Extracts 2-3 broad visual stock video search queries from a news headline using rule-based semantic categorization.
 * NEVER passes raw headlines or person names to Pexels; always maps to real visual stock footage tags.
 * @param {string} headline
 * @returns {{ primaryQuery: string, secondaryQuery: string, altQueries: string[], detectedCategory: string }}
 */
export function extractNewsVisualQueries(headline = '') {
  // Strip leading broadcast tags before parsing
  const stripped = (headline || '')
    .replace(/^(EXPLAINED|BREAKING UPDATE|BREAKING NEWS|BREAKING|WATCH|JUST IN|ALERT|REPORT|VIRAL):\s*/i, '')
    .replace(/🚨/g, '')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .replace(/\s+[-|]\s+[A-Za-z0-9\s.]{2,30}$/, '')
    .trim();

  const text = stripped.toLowerCase().replace(/['":;!?,.\-]/g, ' ');

  // 1. Semantic category rules for news topics
  const categories = [
    {
      name: 'environment_pollution',
      triggers: [
        'cpcb', 'pollution', 'smog', 'aqi', 'air quality', 'delhi smog', 'stubble',
        'emission', 'emissions', 'clean air', 'greenhouse', 'toxic air', 'mask', 'haze',
        'delhi pollution', 'delhi aqi', 'delhi air'
      ],
      primary: 'air pollution smog city',
      secondary: 'city skyline aerial',
      alts: ['breaking news studio', 'traffic city haze', 'industrial smoke pollution'],
    },
    {
      name: 'politics_government',
      triggers: [
        'parliament', 'lok sabha', 'rajya sabha', 'election', 'elections', 'voting',
        'minister', 'cabinet', 'bjp', 'congress', 'opposition', 'government',
        'prime minister', 'modi', 'chief minister', 'rahul gandhi', 'policy', 'bill', 'session'
      ],
      primary: 'indian parliament building',
      secondary: 'government press briefing',
      alts: ['breaking news studio', 'breaking news reporter', 'press conference microphones'],
    },
    {
      name: 'economy_markets',
      triggers: [
        'sensex', 'nifty', 'market', 'stocks', 'stock', 'share market', 'rupee', 'dollar',
        'inflation', 'gdp', 'economy', 'investors', 'banking', 'rbi', 'budget', 'tariff',
        'tariffs', 'trade', 'finance', 'tax', 'prices', 'gold', 'cryptocurrency', 'bitcoin'
      ],
      primary: 'stock market trading screen',
      secondary: 'financial district city skyline',
      alts: ['money finance investment', 'breaking news studio'],
    },
    {
      name: 'military_defence',
      triggers: [
        'defence', 'defense', 'military', 'army', 'soldier', 'soldiers', 'missile',
        'fighter jet', 'navy', 'air force', 'hegseth', 'pentagon', 'senate', 'general',
        'border', 'warfare', 'combat', 'rajnath', 'weapons', 'nato', 'missiles', 'war'
      ],
      primary: 'military press conference',
      secondary: 'breaking news reporter',
      alts: ['geopolitics world map', 'military army soldiers', 'press conference microphones'],
    },
    {
      name: 'geopolitics_diplomacy',
      triggers: [
        'summit', 'treaty', 'diplomat', 'foreign minister', 'un', 'united nations',
        'sanctions', 'ambassador', 'bilateral', 'geopolitics', 'white house', 'kremlin',
        'zelensky', 'putin', 'biden', 'trump', 'foreign policy'
      ],
      primary: 'geopolitics world map',
      secondary: 'geopolitics briefing',
      alts: ['breaking news reporter', 'press conference microphones', 'world politics summit'],
    },
    {
      name: 'court_crime',
      triggers: [
        'court', 'supreme court', 'high court', 'judge', 'verdict', 'bail', 'cbi',
        'police', 'arrest', 'crime', 'justice', 'gavel', 'lawsuit', 'trial', 'hearing',
        'prosecutor', 'jail', 'custody', 'investigation'
      ],
      primary: 'courtroom law gavel justice',
      secondary: 'police siren emergency flashing lights',
      alts: ['breaking news reporter', 'press conference microphones'],
    },
    {
      name: 'fireworks_festivals',
      triggers: ['firecracker', 'firecrackers', 'cracker', 'crackers', 'firework', 'fireworks', 'diwali', 'deepavali', 'patakhe'],
      primary: 'fireworks night celebration',
      secondary: 'city smoke pollution',
      alts: ['diwali festival lights', 'fireworks display night'],
    },
    {
      name: 'disaster_weather',
      triggers: [
        'rain', 'rainfall', 'flood', 'floods', 'monsoon', 'cyclone', 'storm',
        'waterlogging', 'earthquake', 'heatwave', 'heavy rains', 'landslide', 'tsunami'
      ],
      primary: 'storm heavy rain clouds',
      secondary: 'flood water disaster city',
      alts: ['cyclone storm wind waves', 'breaking news reporter'],
    },
    {
      name: 'space_science',
      triggers: [
        'isro', 'nasa', 'rocket', 'satellite', 'spacecraft', 'moon', 'mars',
        'chandrayaan', 'gaganyaan', 'orbit', 'astronaut', 'space mission'
      ],
      primary: 'rocket launch space',
      secondary: 'satellite orbit earth',
      alts: ['outer space earth astronomy', 'breaking news studio'],
    },
    {
      name: 'sports_cricket',
      triggers: [
        'cricket', 'bcci', 'ipl', 'match', 'stadium', 'kohli', 'rohit', 'world cup',
        'wicket', 'century', 'icc', 'football', 'olympics', 'fifa'
      ],
      primary: 'cricket stadium floodlights',
      secondary: 'sports stadium crowd cheering',
      alts: ['sports action match stadium', 'breaking news reporter'],
    },
    {
      name: 'transport_aviation',
      triggers: [
        'train', 'railway', 'vande bharat', 'metro', 'expressway', 'highway',
        'traffic', 'airport', 'flight', 'airline', 'aviation', 'crash'
      ],
      primary: 'city traffic night highway',
      secondary: 'train railway transportation',
      alts: ['highway traffic cars night', 'breaking news reporter'],
    },
    {
      name: 'technology_ai',
      triggers: [
        'ai', 'artificial intelligence', 'tech', 'technology', 'cyber', 'robot',
        'hacker', 'software', 'chip', 'semiconductor', 'data center', 'google', 'meta', 'apple'
      ],
      primary: 'technology digital network futuristic',
      secondary: 'data center server room',
      alts: ['cyber security code', 'breaking news studio'],
    },
    {
      name: 'health_medical',
      triggers: [
        'health', 'hospital', 'medical', 'doctor', 'vaccine', 'virus', 'disease',
        'surgery', 'patient', 'medicine', 'cancer', 'pandemic'
      ],
      primary: 'hospital doctor medical healthcare',
      secondary: 'laboratory science research medicine',
      alts: ['breaking news reporter', 'ambulance emergency hospital'],
    },
  ];

  for (const cat of categories) {
    if (cat.triggers.some((trig) => matchesTrigger(text, trig))) {
      return {
        primaryQuery: cat.primary,
        secondaryQuery: cat.secondary,
        altQueries: cat.alts,
        detectedCategory: cat.name,
      };
    }
  }

  // 2. Safe guaranteed generic fallback (broad broadcast terms)
  return {
    primaryQuery: 'breaking news studio',
    secondaryQuery: 'city skyline aerial',
    altQueries: ['breaking news reporter', 'world news broadcast', 'press conference microphones'],
    detectedCategory: 'general_news',
  };
}

const HINDI_WORD_DICT = {
  'है': 'hai', 'हैं': 'hain', 'हो': 'ho', 'हूँ': 'hoon', 'था': 'tha', 'थी': 'thi', 'थे': 'the',
  'का': 'ka', 'के': 'ke', 'की': 'ki', 'को': 'ko', 'में': 'mein', 'से': 'se', 'ने': 'ne', 'पर': 'par',
  'और': 'aur', 'या': 'ya', 'तो': 'toh', 'भी': 'bhi', 'ही': 'hi', 'ना': 'na', 'नहीं': 'nahi',
  'यह': 'yeh', 'वह': 'woh', 'ये': 'ye', 'वे': 've', 'इस': 'is', 'उस': 'us', 'इन': 'in', 'उन': 'un',
  'क्या': 'kya', 'क्यों': 'kyun', 'कैसे': 'kaise', 'कब': 'kab', 'कहाँ': 'kahan', 'कहा': 'kaha',
  'बोले': 'bole', 'बोला': 'bola', 'बोली': 'boli',
  'आप': 'aap', 'तुम': 'tum', 'तू': 'tu', 'हम': 'hum', 'मैं': 'main', 'मुझे': 'mujhe', 'तुम्हें': 'tumhein',
  'उनका': 'unka', 'उनकी': 'unki', 'उनके': 'unke', 'इसका': 'iska', 'इसकी': 'iski', 'इसके': 'iske',
  'अपना': 'apna', 'अपनी': 'apni', 'अपने': 'apne', 'हमारा': 'hamara', 'हमारी': 'hamari', 'हमारे': 'hamare',
  'कर': 'kar', 'करना': 'karna', 'किया': 'kiya', 'किए': 'kiye', 'कीजिए': 'kijiye', 'करो': 'karo',
  'रहा': 'raha', 'रही': 'rahi', 'रहे': 'rahe',
  'गया': 'gaya', 'गई': 'gayi', 'गए': 'gaye', 'जा': 'ja', 'जाना': 'jaana', 'जाता': 'jaata', 'जाती': 'jaati',
  'जब': 'jab', 'तब': 'tab', 'अब': 'ab', 'सब': 'sab', 'उन्हें': 'unhein',
  'एक': 'ek', 'दो': 'do', 'तीन': 'teen', 'चार': 'chaar', 'पांच': 'paanch',
  'भगवान': 'Bhagwan', 'प्रभु': 'Prabhu', 'श्री': 'Shri', 'कृष्ण': 'Krishna', 'अर्जुन': 'Arjun',
  'राम': 'Ram', 'सीता': 'Sita', 'लक्ष्मण': 'Lakshman', 'हनुमान': 'Hanuman', 'रावण': 'Ravana',
  'भीष्म': 'Bhishma', 'कर्ण': 'Karna', 'शांतनु': 'Shantanu', 'देवव्रत': 'Devavrata',
  'कुरुक्षेत्र': 'Kurukshetra', 'हस्तिनापुर': 'Hastinapur', 'द्वारका': 'Dwarka',
  'महाभारत': 'Mahabharata', 'रामायण': 'Ramayana', 'गीता': 'Gita', 'धर्म': 'Dharma',
  'कर्म': 'Karma', 'सत्य': 'Satya', 'न्याय': 'Nyaay', 'शान्ति': 'Shaanti', 'शांति': 'Shaanti',
  'सुदामा': 'Sudama', 'शिव': 'Shiva', 'महादेव': 'Mahadev', 'नीलकंठ': 'Neelkanth',
  'गणेश': 'Ganesh', 'पार्वती': 'Parvati', 'कार्तिकेय': 'Kartikeya', 'ब्रह्मांड': 'Brahmaand',
  'जय': 'Jai', 'हर': 'Har', 'राधे': 'Radhe', 'ॐ': 'Om',
  'छोटे': 'chhote', 'छोटा': 'chhota', 'छोटी': 'chhoti', 'बच्चा': 'bachha', 'बच्चे': 'bachhe',
  'पापा': 'Papa', 'मम्मी': 'Mummy', 'दादी': 'Dadi', 'दादा': 'Dada', 'अंकल': 'Uncle',
  'गाड़ी': 'gaadi', 'कार': 'car', 'चालान': 'chalan', 'लाइसेंस': 'license', 'हेलमेट': 'helmet',
  'लॉलीपॉप': 'lollipop', 'चॉकलेट': 'chocolate', 'फ्रिज': 'fridge', 'दूध': 'doodh',
  'डॉक्टर': 'Doctor', 'चींटी': 'cheenti', 'सुई': 'sui', 'इंजेक्शन': 'injection',
  'पुशअप्स': 'pushups', 'जंप्स': 'jumps', 'सोफे': 'sofa', 'स्प्रिंग': 'spring',
  'पहलवान': 'pehlwaan', 'ट्रेनर': 'trainer', 'खीर': 'kheer', 'बैटरी': 'battery',
  'शीशे': 'sheeshe', 'चेहरा': 'chehra', 'मुंह': 'muh', 'हंसी': 'hansi', 'चुटकुला': 'chutkula',
  'इंजीनियर': 'engineer', 'मीनार': 'minaar', 'बिल्डिंग': 'building', 'ट्रेन': 'train',
  'टिकट': 'ticket', 'पैसेंजर': 'passenger', 'जेल': 'jail', 'मैच': 'match',
  'गोल्ड': 'gold', 'मेडल': 'medal', 'आइसक्रीम': 'ice cream', 'स्कूप': 'scoop',
  'टीचर': 'Teacher', 'होमवर्क': 'homework', 'स्कूल': 'school', 'क्लास': 'class',
  'दुकानदार': 'Shopkeeper', 'पैसे': 'paise', 'रुपये': 'rupaye',
  'धन': 'dhan', 'दौलत': 'daulat', 'केवल': 'keval', 'प्रेम': 'prem', 'सच्ची': 'sachhi', 'भावना': 'bhavana',
};

const DEV_DIGITS = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};

const DEV_VOWELS = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri',
  'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au',
};

const DEV_MATRAS = {
  'ा': 'a', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
};

const DEV_CONSONANTS = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  'क्ष': 'ksh', 'त्र': 'tr', 'ज्ञ': 'gya', 'श्र': 'shr',
  'क़': 'q', 'ख़': 'kh', 'ग़': 'gh', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f',
};

/**
 * Transliterates Hindi Devanagari text into natural, readable Hinglish (Latin alphabet).
 * Guarantees exact 1-to-1 audio-subtitle matching when voiceover is in Hindi.
 * @param {string} text
 * @returns {string}
 */
export function transliterateHindiToHinglish(text) {
  if (!text) return '';
  const devanagariCount = (text.match(/[\u0900-\u097F]/g) || []).length;
  if (devanagariCount === 0) return text;

  // 1. Pre-normalize unicode and decomposed characters (Nuktas, Purna Virams)
  let normalized = text
    .normalize('NFC')
    .replace(/क[\u093c]/g, 'क़')
    .replace(/ख[\u093c]/g, 'ख़')
    .replace(/ग[\u093c]/g, 'ग़')
    .replace(/ज[\u093c]/g, 'ज़')
    .replace(/ड[\u093c]/g, 'ड़')
    .replace(/ढ[\u093c]/g, 'ढ़')
    .replace(/फ[\u093c]/g, 'फ़')
    .replace(/॥/g, '.')
    .replace(/।/g, '.')
    .replace(/[\u093c]/g, ''); // strip any dangling nuktas

  // 2. Transliterate all contiguous Devanagari blocks, preserving punctuation, spaces, and Latin words
  return normalized.replace(/[\u0900-\u097F]+/g, (word) => {
    // Check dictionary first (exact and lowercase)
    if (HINDI_WORD_DICT[word]) {
      return HINDI_WORD_DICT[word];
    }
    if (HINDI_WORD_DICT[word.toLowerCase()]) {
      return HINDI_WORD_DICT[word.toLowerCase()];
    }

    // Character-by-character phonetic transliteration
    let transliterated = '';
    const len = word.length;

    for (let i = 0; i < len; i++) {
      const c = word[i];
      const next = word[i + 1] || '';

      if (DEV_DIGITS[c]) {
        transliterated += DEV_DIGITS[c];
      } else if (DEV_VOWELS[c]) {
        transliterated += DEV_VOWELS[c];
      } else if (DEV_CONSONANTS[c]) {
        transliterated += DEV_CONSONANTS[c];
        // Inherent 'a' unless next is a matra, halant, or end of word (schwa deletion)
        if (!DEV_MATRAS[next] && next !== '्' && i < len - 1) {
          transliterated += 'a';
        }
      } else if (DEV_MATRAS[c]) {
        transliterated += DEV_MATRAS[c];
      } else if (c === 'ं' || c === 'ँ') {
        transliterated += 'n';
      } else if (c === 'ः') {
        transliterated += 'h';
      } else if (c === 'ॐ') {
        transliterated += 'Om';
      } else if (c === '्') {
        // Halant suppresses inherent 'a', outputs nothing
      }
      // Any unmapped characters within \u0900-\u097F are safely omitted
    }

    return transliterated;
  });
}

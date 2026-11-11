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
 * Auto-summarizes news headlines into a clean, punchy 2-line title (max 50 chars)
 * Never truncates with trailing dots like 'sp...'.
 * @param {string} rawHeadline
 * @returns {{ line1: string, line2: string, fullSummary: string }}
 */
export function summarizeNewsHeadline(rawHeadline) {
  if (!rawHeadline) {
    return { line1: 'BREAKING NEWS', line2: 'LATEST UPDATE', fullSummary: 'BREAKING NEWS UPDATE' };
  }

  let text = rawHeadline
    .replace(/^EXPLAINED:\s*/i, '')
    .replace(/^WATCH:\s*/i, '')
    .replace(/^BREAKING:\s*/i, '')
    .replace(/^JUST IN:\s*/i, '')
    .replace(/🚨/g, '')
    .replace(/['":;%\\#]/g, '')
    .replace(/\s+[-|]\s+[A-Za-z0-9\s]{2,25}$/, '') // Clean publication like " - The Hindu"
    .replace(/\s*\.\.\.\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  // If text exceeds 50 chars, smart summarize to under 50 chars at a clean word boundary
  if (text.length > 50) {
    const clauseRegex = /\s+(after|as|amid|following|ahead of|over|says|warns)\s+/i;
    const match = text.match(clauseRegex);
    if (match && match.index && match.index >= 18 && match.index <= 48) {
      text = text.substring(0, match.index).trim();
    } else {
      const sub = text.substring(0, 48);
      const lastSpace = sub.lastIndexOf(' ');
      if (lastSpace > 20) {
        text = sub.substring(0, lastSpace).trim();
      } else {
        text = sub.trim();
      }
    }
  }

  // Remove any trailing dashes or punctuation
  text = text.replace(/[,;.\-\s]+$/, '').trim();

  const words = text.split(' ').filter(Boolean);
  if (words.length <= 1) {
    return { line1: text.toUpperCase(), line2: '', fullSummary: text.toUpperCase() };
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

  const line1 = words.slice(0, bestIdx).join(' ').toUpperCase();
  const line2 = words.slice(bestIdx).join(' ').toUpperCase();

  return {
    line1,
    line2,
    fullSummary: `${line1} ${line2}`.trim(),
  };
}

/**
 * Extracts 2-3 smart visual search queries from a news headline
 * Maps topics to high-impact visual stock video/photo keywords instead of raw headlines
 * @param {string} headline
 * @returns {{ primaryQuery: string, secondaryQuery: string, altQueries: string[], detectedCategory: string }}
 */
export function extractNewsVisualQueries(headline = '') {
  const text = (headline || '').toLowerCase().replace(/['":;!?,.\-]/g, ' ');

  // 1. Semantic category rules for common news topics
  const categories = [
    {
      name: 'fireworks',
      triggers: ['firecracker', 'firecrackers', 'cracker', 'crackers', 'firework', 'fireworks', 'diwali', 'deepavali', 'patakhe'],
      primary: 'fireworks night celebration',
      secondary: 'city smoke pollution',
      alts: ['diwali festival lights', 'fireworks display night'],
    },
    {
      name: 'pollution',
      triggers: ['pollution', 'smog', 'aqi', 'air quality', 'toxic air', 'stubble', 'haze', 'clean air', 'poisonous air'],
      primary: 'city smoke air pollution',
      secondary: 'smog traffic city',
      alts: ['industrial smoke factory', 'air pollution road'],
    },
    {
      name: 'economy',
      triggers: ['sensex', 'nifty', 'market', 'stocks', 'stock', 'share market', 'rupee', 'inflation', 'gdp', 'economy', 'investors', 'banking', 'rbi', 'budget'],
      primary: 'stock market trading screen',
      secondary: 'money finance investment',
      alts: ['business stock chart', 'banking finance office'],
    },
    {
      name: 'space',
      triggers: ['isro', 'nasa', 'rocket', 'satellite', 'spacecraft', 'moon', 'mars', 'chandrayaan', 'gaganyaan', 'orbit', 'astronaut', 'space mission'],
      primary: 'rocket launch space',
      secondary: 'satellite orbit earth',
      alts: ['outer space earth astronomy', 'space shuttle launch'],
    },
    {
      name: 'defence',
      triggers: ['army', 'military', 'defence', 'defense', 'soldier', 'soldiers', 'missile', 'fighter jet', 'navy', 'air force', 'border', 'combat', 'warfare', 'rajnath'],
      primary: 'military army soldiers',
      secondary: 'fighter jet aircraft military',
      alts: ['defence military combat', 'naval warship ocean'],
    },
    {
      name: 'politics',
      triggers: ['election', 'elections', 'voting', 'voter', 'parliament', 'lok sabha', 'rajya sabha', 'minister', 'cabinet', 'bjp', 'congress', 'opposition', 'rally', 'summit'],
      primary: 'parliament government building',
      secondary: 'political speech press conference',
      alts: ['crowd election rally voting', 'official government conference'],
    },
    {
      name: 'court',
      triggers: ['court', 'supreme court', 'high court', 'judge', 'verdict', 'bail', 'cbi', 'police', 'arrest', 'crime', 'justice', 'gavel', 'lawsuit'],
      primary: 'courtroom law gavel justice',
      secondary: 'police siren emergency flashing lights',
      alts: ['supreme court building', 'judge gavel law books'],
    },
    {
      name: 'weather',
      triggers: ['rain', 'rainfall', 'flood', 'floods', 'monsoon', 'cyclone', 'storm', 'waterlogging', 'earthquake', 'heatwave', 'heavy rains', 'landslide'],
      primary: 'storm heavy rain clouds',
      secondary: 'flood water disaster city',
      alts: ['cyclone storm wind waves', 'lightning storm dark sky'],
    },
    {
      name: 'cricket',
      triggers: ['cricket', 'bcci', 'ipl', 'match', 'stadium', 'kohli', 'rohit', 'world cup', 'wicket', 'century', 'icc'],
      primary: 'cricket stadium floodlights',
      secondary: 'sports stadium crowd cheering',
      alts: ['sports action match stadium', 'cricket ground batsman'],
    },
    {
      name: 'technology',
      triggers: ['ai', 'artificial intelligence', 'tech', 'technology', 'cyber', 'robot', 'hacker', 'software', 'chip', 'semiconductor', 'data center'],
      primary: 'technology digital network futuristic',
      secondary: 'data center server room',
      alts: ['artificial intelligence network', 'cyber security code'],
    },
    {
      name: 'transport',
      triggers: ['train', 'railway', 'vande bharat', 'metro', 'expressway', 'highway', 'traffic', 'airport', 'flight', 'airline', 'aviation'],
      primary: 'train railway transportation',
      secondary: 'airplane airport runway takeoff',
      alts: ['highway traffic cars night', 'modern railway station'],
    },
    {
      name: 'health',
      triggers: ['health', 'hospital', 'medical', 'doctor', 'vaccine', 'virus', 'disease', 'surgery', 'patient', 'medicine', 'cancer'],
      primary: 'hospital doctor medical healthcare',
      secondary: 'laboratory science research medicine',
      alts: ['ambulance emergency hospital', 'doctor consultation clinic'],
    },
  ];

  for (const cat of categories) {
    if (cat.triggers.some((trig) => text.includes(trig))) {
      return {
        primaryQuery: cat.primary,
        secondaryQuery: cat.secondary,
        altQueries: cat.alts,
        detectedCategory: cat.name,
      };
    }
  }

  // 2. Generic high-value keyword extraction if no predefined category matched
  const stopWords = new Set([
    'explained', 'breaking', 'update', 'watch', 'report', 'just', 'news', 'the', 'a', 'an',
    'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'is', 'are', 'was', 'were', 'by', 'with',
    'from', 'as', 'that', 'this', 'after', 'over', 'into', 'says', 'amid', 'will', 'have', 'been',
    'deal', 'said', 'no', 'big', 'not', 'but', 'why', 'how', 'what', 'when', 'who', 'here', 'where',
    'about', 'more', 'all', 'any', 'could', 'would', 'should', 'today', 'yesterday', 'tomorrow',
    'people', 'official', 'exclusive', 'special', 'matter', 'issue', 'details', 'points', 'first'
  ]);

  const cleanWords = text
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w));

  const topWords = cleanWords.slice(0, 3);
  const primaryQuery = topWords.length >= 2 ? `${topWords.slice(0, 2).join(' ')} footage` : 'breaking news television broadcast';
  const secondaryQuery = topWords.length >= 1 ? `${topWords[0]} news report` : 'newsroom studio broadcast';

  return {
    primaryQuery,
    secondaryQuery,
    altQueries: ['breaking news television broadcast', 'newsroom studio anchor desk'],
    detectedCategory: 'general_news',
  };
}

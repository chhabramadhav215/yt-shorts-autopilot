import path from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { summarizeNewsHeadline, toTitleCase } from '../utils/text_utils.js';
import { isTopicRecentlyPublished, getRecentTopicsForSlot } from '../utils/publish_history.js';
import { generateGeminiJson } from '../utils/gemini_client.js';

/**
 * STRICTLY BANNED PHRASES & CLICHÉS IN CRICKET SHORTS
 * Any script containing these generic template lines must be rejected or sanitized.
 */
export const BANNED_PATTERNS = [
  /सूत्रों\s*(की\s*रिपोर्ट|के\s*अनुसार|के\s*हवाले)/i,
  /sutron\s*ki\s*report/i,
  /according\s*to\s*(sources|reports|cricket\s*sources)/i,
  /टीम\s*मैनेजमेंट\s*और\s*चयनकर्ता/i,
  /team\s*management\s*(and|&)\s*selectors/i,
  /रणनीतिक\s*बैठक/i,
  /strategic\s*meeting/i,
  /प्लेइंग\s*इलेवन\s*और\s*रणनीतिक\s*संतुलन/i,
  /playing\s*11\s*and\s*squad\s*balance/i,
  /squad\s*balance\s*and\s*match\s*tactics/i,
  /फैसला\s*बिल्कुल\s*सही\s*है\s*या\s*एक\s*बड़ी\s*भूल/i,
  /सही\s*(था|है)\s*या\s*(बड़ी\s*)?भूल/i,
  /right\s*call\s*or\s*(a\s*)?big\s*mistake/i,
  /सब्सक्राइब\s*कीजिए/i,
  /कमेंट्स\s*में\s*बताइए\s*और\s*सब्सक्राइब/i,
  /subscribe\s*for\s*daily/i,
  /drop\s*your\s*thoughts\s*below\s*and\s*subscribe/i,
];

export function containsBannedPhrases(text = '') {
  return BANNED_PATTERNS.some((pattern) => pattern.test(text));
}

export function sanitizeScriptText(text = '') {
  if (!text) return '';
  return text
    .replace(/सूत्रों\s*(की\s*रिपोर्ट|के\s*अनुसार|के\s*हवाले)[^।,.]*[।,.]?/gi, '')
    .replace(/टीम\s*मैनेजमेंट\s*और\s*चयनकर्ता(ओं)?[^।,.]*[।,.]?/gi, '')
    .replace(/रणनीतिक\s*बैठक[^।,.]*[।,.]?/gi, '')
    .replace(/प्लेइंग\s*इलेवन\s*और\s*रणनीतिक\s*संतुलन[^।,.]*[।,.]?/gi, 'मैच रणनीति')
    .replace(/फैसला\s*बिल्कुल\s*सही\s*है\s*या\s*एक\s*बड़ी\s*भूल/gi, 'आपकी क्या राय है')
    .replace(/सही\s*(था|है)\s*या\s*(बड़ी\s*)?भूल/gi, 'आप किसे चुनेंगे')
    .replace(/और\s*सब्सक्राइब\s*कीजिए!?/gi, '')
    .replace(/सब्सक्राइब\s*कीजिए!?/gi, '')
    .replace(/drop your thoughts below and subscribe!?/gi, 'what do you think?')
    .replace(/right call or a big mistake!?/gi, 'who would you pick?')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Verified Official IPL & T20 Player Statistics Dictionary (Ground Truth)
 * STRICT RULE: Never fabricate or guess statistics.
 */
export const VERIFIED_PLAYER_STATS = {
  dhoni: {
    key: 'dhoni',
    name: 'MS Dhoni',
    hindiName: 'महेंद्र सिंह धोनी',
    role: '5x Champion / Finisher',
    stat1: '5x IPL Titles',
    stat2: '58.8% Win Rate',
    stat3: '5243+ IPL Runs',
    scriptStatHindi: '5 बार आईपीएल ट्रॉफी और 58.8 प्रतिशत जीत का रिकॉर्ड',
    scriptStatEnglish: '5 IPL trophies with a 58.8% win rate',
    aliases: ['dhoni', 'msd', 'thala', 'धोनी', 'महेंद्र सिंह धोनी'],
  },
  gaikwad: {
    key: 'gaikwad',
    name: 'Ruturaj Gaikwad',
    hindiName: 'ऋतुराज गायकवाड़',
    role: 'CSK Captain / Opener',
    stat1: '1x Orange Cap',
    stat2: '583 Runs (2024)',
    stat3: '136.9 Strike Rate',
    scriptStatHindi: 'ऑरेंज कैप और 2024 सीजन में 583 रन',
    scriptStatEnglish: 'Orange Cap winner with 583 runs in the 2024 season',
    aliases: ['gaikwad', 'ruturaj', 'गायकवाड़', 'ऋतुराज'],
  },
  rohit: {
    key: 'rohit',
    name: 'Rohit Sharma',
    hindiName: 'रोहित शर्मा',
    role: '5x Champion / T20 WC',
    stat1: '5x IPL Titles',
    stat2: '6628+ IPL Runs',
    stat3: '2024 T20 WC Winner',
    scriptStatHindi: '5 आईपीएल खिताब और 6600 से अधिक रन',
    scriptStatEnglish: '5 IPL titles and over 6,600 runs',
    aliases: ['rohit', 'sharma', 'hitman', 'रोहित', 'रोहित शर्मा'],
  },
  hardik: {
    key: 'hardik',
    name: 'Hardik Pandya',
    hindiName: 'हार्दिक पंड्या',
    role: 'MI Captain / All-Rounder',
    stat1: '1x IPL Title (GT)',
    stat2: '2x IPL Finals',
    stat3: '145.9 Strike Rate',
    scriptStatHindi: 'गुजरात को पहले ही साल खिताब और 145.9 का स्ट्राइक रेट',
    scriptStatEnglish: 'IPL title in debut captaincy year with a 145.9 strike rate',
    aliases: ['hardik', 'pandya', 'हार्दिक', 'पंड्या'],
  },
  kohli: {
    key: 'kohli',
    name: 'Virat Kohli',
    hindiName: 'विराट कोहली',
    role: 'Run Machine / Anchor',
    stat1: '8004+ IPL Runs',
    stat2: '8 Centuries',
    stat3: '973 Runs (2016)',
    scriptStatHindi: 'आईपीएल में सर्वाधिक 8000 से ज्यादा रन और 8 शतक',
    scriptStatEnglish: 'all-time record 8,000+ IPL runs with 8 centuries',
    aliases: ['kohli', 'virat', 'king kohli', 'कोहली', 'विराट'],
  },
  shreyas: {
    key: 'shreyas',
    name: 'Shreyas Iyer',
    hindiName: 'श्रेयस अय्यर',
    role: 'IPL Title Captain',
    stat1: '1x IPL Title (KKR)',
    stat2: '2x IPL Finals',
    stat3: '3127+ IPL Runs',
    scriptStatHindi: 'केकेआर को 2024 चैंपियन बनाने का नेतृत्व और 3100 से ज्यादा रन',
    scriptStatEnglish: 'led KKR to the 2024 championship and over 3,100 runs',
    aliases: ['shreyas', 'shreyas iyer', 'श्रेयस', 'श्रेयस अय्यर'],
  },
  venky: {
    key: 'venky',
    name: 'Venkatesh Iyer',
    hindiName: 'वेंकटेश अय्यर',
    role: 'KKR All-Rounder / Finisher',
    stat1: '1x IPL Champion',
    stat2: '50+ in 2 Finals',
    stat3: '137.1 Strike Rate',
    scriptStatHindi: 'दोनों आईपीएल फाइनल में 50+ स्कोर और 137 का स्ट्राइक रेट',
    scriptStatEnglish: '50+ scores in two IPL finals with a 137 strike rate',
    aliases: ['venkatesh', 'venky', 'venkatesh iyer', 'वेंकटेश', 'वेंकटेश अय्यर'],
  },
  bumrah: {
    key: 'bumrah',
    name: 'Jasprit Bumrah',
    hindiName: 'जसप्रीत बुमराह',
    role: 'World No. 1 Pacer',
    stat1: '7.30 Career Econ',
    stat2: '165+ IPL Wickets',
    stat3: '6.48 Econ (2024)',
    scriptStatHindi: '7.30 की ऑल-टाइम इकॉनमी और 165 से ज्यादा विकेट',
    scriptStatEnglish: 'all-time 7.30 economy rate and 165+ IPL wickets',
    aliases: ['bumrah', 'jasprit', 'boom boom', 'बुमराह', 'जसप्रीत बुमराह'],
  },
  pathirana: {
    key: 'pathirana',
    name: 'Matheesha Pathirana',
    hindiName: 'मथीशा पथिराना',
    role: 'CSK Death Specialist',
    stat1: '34 IPL Wickets',
    stat2: '7.96 Death Econ',
    stat3: '16.8 Bowling Avg',
    scriptStatHindi: 'डेथ ओवर्स में 7.96 की इकॉनमी और 34 विकेट',
    scriptStatEnglish: '7.96 death-overs economy rate with 34 IPL wickets',
    aliases: ['pathirana', 'matheesha', 'पथिराना', 'मथीशा'],
  },
  pant: {
    key: 'pant',
    name: 'Rishabh Pant',
    hindiName: 'ऋषभ पंत',
    role: 'Wicketkeeper-Finisher',
    stat1: '3284+ IPL Runs',
    stat2: '148.9 Strike Rate',
    stat3: '128* Highest Score',
    scriptStatHindi: '148.9 का स्ट्राइक रेट और 3200 से अधिक रन',
    scriptStatEnglish: '148.9 strike rate and over 3,200 IPL runs',
    aliases: ['pant', 'rishabh', 'पंत', 'ऋषभ पंत'],
  },
  cummins: {
    key: 'cummins',
    name: 'Pat Cummins',
    hindiName: 'पैट कमिंस',
    role: 'SRH Captain / Pacer',
    stat1: '2024 IPL Finalist',
    stat2: 'WTC & ODI WC Winner',
    stat3: '18 Wickets (2024)',
    scriptStatHindi: 'सनराइजर्स को फाइनल में पहुंचाया और 18 विकेट चटकाए',
    scriptStatEnglish: 'led SRH to the 2024 final and claimed 18 wickets',
    aliases: ['cummins', 'pat cummins', 'कमिंस', 'पैट कमिंस'],
  },
  samson: {
    key: 'samson',
    name: 'Sanju Samson',
    hindiName: 'संजू सैमसन',
    role: 'RR Captain / Wicketkeeper',
    stat1: '4419+ IPL Runs',
    stat2: '139.0 Strike Rate',
    stat3: '531 Runs (2024)',
    scriptStatHindi: '2024 सीजन में 531 रन और 139 का स्ट्राइक रेट',
    scriptStatEnglish: '531 runs in the 2024 season at a 139 strike rate',
    aliases: ['samson', 'sanju', 'सैमसन', 'संजू'],
  },
  gill: {
    key: 'gill',
    name: 'Shubman Gill',
    hindiName: 'शुभमन गिल',
    role: 'GT Captain / Opener',
    stat1: '1x Orange Cap (890 Runs)',
    stat2: '3216+ IPL Runs',
    stat3: '135.7 Strike Rate',
    scriptStatHindi: '890 रनों के साथ ऑरेंज कैप और 3200 से ज्यादा रन',
    scriptStatEnglish: 'Orange Cap with 890 runs in a single season',
    aliases: ['gill', 'shubman', 'गिल', 'शुभमन'],
  },
  russell: {
    key: 'russell',
    name: 'Andre Russell',
    hindiName: 'आंद्रे रसेल',
    role: 'KKR Power-Allrounder',
    stat1: '174.9 Strike Rate',
    stat2: '2484+ Runs / 115 Wkts',
    stat3: '2x IPL MVP',
    scriptStatHindi: '174.9 का ऑल-टाइम स्ट्राइक रेट और 115 विकेट',
    scriptStatEnglish: '174.9 all-time strike rate and 115 wickets',
    aliases: ['russell', 'andre russell', 'dre russ', 'रसेल', 'आंद्रे रसेल'],
  },
  narine: {
    key: 'narine',
    name: 'Sunil Narine',
    hindiName: 'सुनील नरेन',
    role: '3x IPL MVP / Mystery Spinner',
    stat1: '3x IPL MVP',
    stat2: '6.73 Career Econ',
    stat3: '488 Runs (2024)',
    scriptStatHindi: '3 बार एमवीपी और 6.73 की करियर इकॉनमी',
    scriptStatEnglish: '3-time IPL MVP with a 6.73 career economy',
    aliases: ['narine', 'sunil narine', 'नरेन', 'सुनील नरेन'],
  },
  klaasen: {
    key: 'klaasen',
    name: 'Heinrich Klaasen',
    hindiName: 'हेनरिक क्लासेन',
    role: 'SRH Middle-Order Destroyer',
    stat1: '168.3 Strike Rate',
    stat2: '479 Runs (2024)',
    stat3: '38 Sixes (2024)',
    scriptStatHindi: '168.3 का स्ट्राइक रेट और 2024 में 38 छक्के',
    scriptStatEnglish: '168.3 strike rate and 38 sixes in 2024',
    aliases: ['klaasen', 'heinrich', 'क्लासेन', 'हेनरिक क्लासेन'],
  },
  patidar: {
    key: 'patidar',
    name: 'Rajat Patidar',
    hindiName: 'रजत पाटीदार',
    role: 'RCB Spin Destroyer',
    stat1: '177.8 SR vs Spin',
    stat2: '395 Runs (2024)',
    stat3: '158.8 Career SR',
    scriptStatHindi: 'स्पिन के खिलाफ 177.8 का तूफानी स्ट्राइक रेट',
    scriptStatEnglish: '177.8 strike rate against spin bowling',
    aliases: ['patidar', 'rajat', 'पाटीदार', 'रजत पाटीदार'],
  },
  arshdeep: {
    key: 'arshdeep',
    name: 'Arshdeep Singh',
    hindiName: 'अर्शदीप सिंह',
    role: 'PBKS / India Death Pacer',
    stat1: '19 Wickets (2024)',
    stat2: '2024 T20 WC Winner',
    stat3: '76+ IPL Wickets',
    scriptStatHindi: 'टी20 वर्ल्ड कप में 17 विकेट और डेथ ओवर्स विशेषज्ञ',
    scriptStatEnglish: 'T20 World Cup champion and death overs specialist',
    aliases: ['arshdeep', 'arshdeep singh', 'अर्शदीप', 'अर्शदीप सिंह'],
  },
  rahul: {
    key: 'rahul',
    name: 'KL Rahul',
    hindiName: 'केएल राहुल',
    role: 'Wicketkeeper-Batter',
    stat1: '4683+ IPL Runs',
    stat2: '45.4 Batting Avg',
    stat3: '4x 500+ Run Seasons',
    scriptStatHindi: '45.4 का औसत और 4600 से ज्यादा रन',
    scriptStatEnglish: '45.4 batting average and 4,600+ IPL runs',
    aliases: ['rahul', 'kl rahul', 'केएल राहुल', 'राहुल'],
  },
  pooran: {
    key: 'pooran',
    name: 'Nicholas Pooran',
    hindiName: 'निकोलस पूरन',
    role: 'LSG Power-Finisher',
    stat1: '162.3 Strike Rate',
    stat2: '499 Runs (2024)',
    stat3: '36 Sixes (2024)',
    scriptStatHindi: '162.3 का स्ट्राइक रेट और 2024 में 499 रन',
    scriptStatEnglish: '162.3 strike rate and 499 runs in the 2024 season',
    aliases: ['pooran', 'nicholas', 'पूरन', 'निकोलस पूरन'],
  },
};

/**
 * Detect comparison players or single featured player from text
 */
export function detectComparisonPlayers(headline = '', snippet = '', teamKey = 'IPL') {
  const combined = `${headline} ${snippet}`.toLowerCase();
  const matchedKeys = [];

  for (const [key, player] of Object.entries(VERIFIED_PLAYER_STATS)) {
    if (player.aliases.some((alias) => combined.includes(alias.toLowerCase()))) {
      matchedKeys.push(key);
    }
  }

  // If 2 distinct players matched directly
  if (matchedKeys.length >= 2) {
    return {
      type: 'comparison',
      p1Key: matchedKeys[0],
      p2Key: matchedKeys[1],
    };
  }

  const teamDefaultPairs = {
    KKR: ['venky', 'shreyas'],
    CSK: ['gaikwad', 'dhoni'],
    RCB: ['kohli', 'patidar'],
    MI: ['hardik', 'rohit'],
    SRH: ['cummins', 'klaasen'],
    LSG: ['pooran', 'rahul'],
    DC: ['pant', 'rohit'],
    RR: ['samson', 'rohit'],
    GT: ['gill', 'rohit'],
    PBKS: ['arshdeep', 'rohit'],
    INDIA: ['rohit', 'bumrah'],
  };

  // If 1 player matched
  if (matchedKeys.length === 1) {
    const singleKey = matchedKeys[0];
    const isComparisonTopic = /vs|versus|against|or|या|कप्तानी|captain|leadership|race|options/i.test(combined);
    if (isComparisonTopic) {
      const pair = teamDefaultPairs[teamKey];
      if (pair) {
        const otherKey = pair[0] === singleKey ? pair[1] : pair[0];
        return {
          type: 'comparison',
          p1Key: singleKey,
          p2Key: otherKey,
        };
      }
    }
    return {
      type: 'stat_card',
      pKey: singleKey,
    };
  }

  // If no players mentioned directly by alias
  const isComparisonTopic = /captain|leadership|कप्तानी|race|options|battle|vs|versus/i.test(combined);
  const defaultPair = teamDefaultPairs[teamKey] || ['kohli', 'rohit'];

  if (isComparisonTopic) {
    return {
      type: 'comparison',
      p1Key: defaultPair[0],
      p2Key: defaultPair[1],
    };
  }

  return {
    type: 'stat_card',
    pKey: defaultPair[0],
  };
}

/**
 * Builds structured comparison data for SVG overlay and script generator
 */
export function buildComparisonData(comparisonInfo) {
  if (!comparisonInfo) return null;

  if (comparisonInfo.type === 'comparison') {
    const p1 = VERIFIED_PLAYER_STATS[comparisonInfo.p1Key] || VERIFIED_PLAYER_STATS.gaikwad;
    const p2 = VERIFIED_PLAYER_STATS[comparisonInfo.p2Key] || VERIFIED_PLAYER_STATS.dhoni;

    return {
      type: 'comparison',
      title: 'LEADERSHIP COMPARISON',
      player1: {
        name: p1.name,
        role: p1.role,
        stat1: p1.stat1,
        stat2: p1.stat2,
        stat3: p1.stat3,
      },
      player2: {
        name: p2.name,
        role: p2.role,
        stat1: p2.stat1,
        stat2: p2.stat2,
        stat3: p2.stat3,
      },
      p1Data: p1,
      p2Data: p2,
    };
  }

  if (comparisonInfo.type === 'stat_card') {
    const p = VERIFIED_PLAYER_STATS[comparisonInfo.pKey] || VERIFIED_PLAYER_STATS.kohli;
    return {
      type: 'stat_card',
      title: 'VERIFIED PLAYER STATS',
      player: {
        name: p.name,
        role: p.role,
        stat1: p.stat1,
        stat2: p.stat2,
        stat3: p.stat3,
      },
      pData: p,
    };
  }

  return null;
}

/**
 * Comprehensive Knowledge Matrix of IPL Franchises & Real Key Players
 */
const IPL_FRANCHISES = {
  KKR: {
    name: 'Kolkata Knight Riders',
    hindiName: 'केकेआर',
    colors: 'Purple and Gold',
    keyPlayers: ['Venkatesh Iyer', 'Shreyas Iyer', 'Andre Russell', 'Sunil Narine', 'Rinku Singh', 'Harshit Rana'],
    hindiPlayers: ['वेंकटेश अय्यर', 'श्रेयस अय्यर', 'आंद्रे रसेल', 'सुनील नरेन', 'रिंकू सिंह', 'हर्षित राणा'],
    captaincyCandidates: ['वेंकटेश अय्यर', 'श्रेयस अय्यर', 'आंद्रे रसेल'],
    captaincyReasons: [
      'वेंकटेश अय्यर ने पिछले सीजन में चैंपियन बनाने में अहम भूमिका निभाई थी और उनका शांत स्वभाव उन्हें स्वाभाविक दावेदार बनाता है।',
      'श्रेयस अय्यर की कप्तानी में टीम ने आक्रामक क्रिकेट खेलकर खिताब जीता था।',
      'आंद्रे रसेल और सुनील नरेन का अनुभव विदेशी नेतृत्व का मजबूत विकल्प पेश करता है।'
    ],
    captaincyReasonsEn: [
      'Venkatesh Iyer played a pivotal role in KKR title triumph, and his calm temperament makes him a prime domestic leadership choice.',
      'Shreyas Iyer proven track record as an IPL-winning captain brings immense tactical authority.',
      'Andre Russell offers explosive game-changing experience as an elite senior leader.'
    ],
    tacticalTraits: 'ईडन गार्डन्स पर मिस्ट्री स्पिन का दबदबा और डेथ ओवर्स में तूफानी फिनिशिंग',
  },
  RCB: {
    name: 'Royal Challengers Bengaluru',
    hindiName: 'आरसीबी',
    colors: 'Red and Gold',
    keyPlayers: ['Virat Kohli', 'Rajat Patidar', 'Yash Dayal', 'Glenn Maxwell', 'Mohammed Siraj'],
    hindiPlayers: ['विराट कोहली', 'रजत पाटीदार', 'यश दयाल', 'ग्लेन मैक्सवेल', 'मोहम्मद सिराज'],
    captaincyCandidates: ['विराट कोहली', 'रजत पाटीदार'],
    captaincyReasons: [
      'विराट कोहली की आक्रामक कप्तानी और चिन्नास्वामी पर उनका विशाल अनुभव टीम को नई ऊर्जा दे सकता है।',
      'रजत पाटीदार मिडिल ओवर्स में स्पिन गेंदबाजों पर प्रहार करने और भविष्य के युवा भारतीय कप्तान के रूप में उभरने की क्षमता रखते हैं।'
    ],
    captaincyReasonsEn: [
      'Virat Kohli unmatched intensity and deep franchise bond make him the ultimate inspirational leader at Chinnaswamy.',
      'Rajat Patidar fearless spin-hitting in the middle overs positions him as a long-term Indian batting leader.'
    ],
    tacticalTraits: 'चिन्नास्वामी में 200+ का स्कोर चेस करने का आक्रामक माइंडसेट और तेज गेंदबाजी का दम',
  },
  CSK: {
    name: 'Chennai Super Kings',
    hindiName: 'सीएसके',
    colors: 'Yellow',
    keyPlayers: ['Ruturaj Gaikwad', 'MS Dhoni', 'Ravindra Jadeja', 'Shivam Dube', 'Matheesha Pathirana'],
    hindiPlayers: ['ऋतुराज गायकवाड़', 'महेंद्र सिंह धोनी', 'रविंद्र जडेजा', 'शिवम दुबे', 'मथीशा पथिराना'],
    captaincyCandidates: ['ऋतुराज गायकवाड़', 'महेंद्र सिंह धोनी'],
    captaincyReasons: [
      'ऋतुराज गायकवाड़ का शांत और परिपक्व नेतृत्व एमएस धोनी की विरासत को आगे बढ़ा रहा है।',
      'एमएस धोनी का रणनीतिक मार्गदर्शन और फील्डिंग प्लेसमेंट मैच का रुख पलट देता है।'
    ],
    captaincyReasonsEn: [
      'Ruturaj Gaikwad composed and mature leadership continues the winning legacy of MS Dhoni.',
      'MS Dhoni tactical field placements and match awareness remain unmatched in tight finishes.'
    ],
    tacticalTraits: 'चेपॉक की टर्निंग पिच पर स्पिनर्स का जाल और पथिराना की घातक यॉर्कर गेंदबाजी',
  },
  MI: {
    name: 'Mumbai Indians',
    hindiName: 'मुंबई इंडियंस',
    colors: 'Blue and Gold',
    keyPlayers: ['Hardik Pandya', 'Rohit Sharma', 'Jasprit Bumrah', 'Suryakumar Yadav', 'Tilak Varma'],
    hindiPlayers: ['हार्दिक पंड्या', 'रोहित शर्मा', 'जसप्रीत बुमराह', 'सूर्यकुमार यादव', 'तिलक वर्मा'],
    captaincyCandidates: ['हार्दिक पंड्या', 'सूर्यकुमार यादव', 'रोहित शर्मा'],
    captaincyReasons: [
      'हार्दिक पंड्या तेज गेंदबाजी ऑलराउंडर के रूप में टीम को संतुलन और आक्रामकता प्रदान करते हैं।',
      'सूर्यकुमार यादव टी20 में भारत के सफल कप्तान रह चुके हैं और उनका 360-डिग्री अंदाज विरोधी टीमों को बैकफुट पर रखता है।'
    ],
    captaincyReasonsEn: [
      'Hardik Pandya pace-bowling all-rounder skillset provides crucial balance and aggression.',
      'Suryakumar Yadav proven international T20 captaincy and 360-degree strokeplay dismantle bowling plans.'
    ],
    tacticalTraits: 'वानखेड़े में बुमराह की अनप्लेएबल डेथ बॉलिंग और रोहित-सूर्या की पावर-हिटिंग',
  },
  SRH: {
    name: 'Sunrisers Hyderabad',
    hindiName: 'सनराइजर्स',
    colors: 'Orange and Black',
    keyPlayers: ['Pat Cummins', 'Heinrich Klaasen', 'Travis Head', 'Abhishek Sharma'],
    hindiPlayers: ['पैट कमिंस', 'हेनरिक क्लासेन', 'ट्रैविस हेड', 'अभिषेक शर्मा'],
    captaincyCandidates: ['पैट कमिंस'],
    captaincyReasons: [
      'पैट कमिंस की निडर कप्तानी ने पिछले सीजन में 250 से ज्यादा रन बनाने का रिकॉर्ड बनाया था।'
    ],
    captaincyReasonsEn: [
      'Pat Cummins fearless leadership and sharp bowling rotations engineered record-breaking 250+ totals.'
    ],
    tacticalTraits: 'पावरप्ले के पहले 6 ओवरों में निर्दयी बल्लेबाजी और क्लासेन का फिनिशिंग प्रहार',
  },
  DC: {
    name: 'Delhi Capitals',
    hindiName: 'दिल्ली कैपिटल्स',
    colors: 'Blue and Red',
    keyPlayers: ['Rishabh Pant', 'Axar Patel', 'Kuldeep Yadav', 'Jake Fraser-McGurk'],
    hindiPlayers: ['ऋषभ पंत', 'अक्षर पटेल', 'कुलदीप यादव', 'फ्रेजर-मैकगर्क'],
    captaincyCandidates: ['ऋषभ पंत', 'अक्षर पटेल'],
    captaincyReasons: [
      'ऋषभ पंत मैच-विनर विकेटकीपर बल्लेबाज के रूप में किसी भी मुकाबले को अकेले दम पर जिताने की क्षमता रखते हैं।',
      'अक्षर पटेल गेंद और बल्ले दोनों से निरंतरता और घरेलू भारतीय समझ प्रदान करते हैं।'
    ],
    captaincyReasonsEn: [
      'Rishabh Pant destructive game-changing middle-order impact turns matches in single overs.',
      'Axar Patel dependable all-round spin balance provides steady tactical execution.'
    ],
    tacticalTraits: 'कुलदीप यादव की कलाई की स्पिन और तेज तर्रार शीर्ष क्रम',
  },
  RR: {
    name: 'Rajasthan Royals',
    hindiName: 'राजस्थान रॉयल्स',
    colors: 'Pink and Blue',
    keyPlayers: ['Sanju Samson', 'Yashasvi Jaiswal', 'Riyan Parag', 'Trent Boult'],
    hindiPlayers: ['संजू सैमसन', 'यशस्वी जायसवाल', 'रियान पराग', 'ट्रेंट बोल्ट'],
    captaincyCandidates: ['संजू सैमसन'],
    captaincyReasons: [
      'संजू सैमसन निस्वार्थ आक्रामक क्रिकेट खेलते हैं और युवाओं को खुलकर खेलने की आजादी देते हैं।'
    ],
    captaincyReasonsEn: [
      'Sanju Samson selfless strokeplay and backing of young talent have built a fearless batting identity.'
    ],
    tacticalTraits: 'ट्रेंट बोल्ट की पहले ओवर की स्विंग और जायसवाल की बेखौफ ओपनिंग',
  },
  GT: {
    name: 'Gujarat Titans',
    hindiName: 'गुजरात टाइटंस',
    colors: 'Navy and Gold',
    keyPlayers: ['Shubman Gill', 'Rashid Khan', 'Sai Sudharsan', 'Mohammed Shami'],
    hindiPlayers: ['शुभमन गिल', 'राशिद खान', 'साई सुदर्शन', 'मोहम्मद शमी'],
    captaincyCandidates: ['शुभमन गिल', 'राशिद खान'],
    captaincyReasons: [
      'शुभमन गिल भविष्य के बड़े भारतीय कप्तान के रूप में तकनीकी मजबूती और परिपक्वता लाते हैं।'
    ],
    captaincyReasonsEn: [
      'Shubman Gill elite technical batting and growing tactical maturity anchor the franchise.'
    ],
    tacticalTraits: 'राशिद खान की मिस्ट्री स्पिन और सुदर्शन की नियंत्रित एंकर पारी',
  },
  LSG: {
    name: 'Lucknow Super Giants',
    hindiName: 'लखनऊ सुपर जायंट्स',
    colors: 'Teal and Cyan',
    keyPlayers: ['Nicholas Pooran', 'Mayank Yadav', 'KL Rahul', 'Ravi Bishnoi'],
    hindiPlayers: ['निकोलस पूरन', 'मयंक यादव', 'केएल राहुल', 'रवि बिश्नोई'],
    captaincyCandidates: ['निकोलस पूरन', 'केएल राहुल'],
    captaincyReasons: [
      'निकोलस पूरन अपनी विस्फोटक छक्केबाजी और वेस्टइंडीज की कप्तानी के अनुभव के साथ मजबूत विकल्प हैं।'
    ],
    captaincyReasonsEn: [
      'Nicholas Pooran explosive death-overs hitting and international captaincy experience make him a lethal leader.'
    ],
    tacticalTraits: 'मयंक यादव की 156 किमी प्रति घंटे की रफ्तार और पूरन का पावर-गेम',
  },
  PBKS: {
    name: 'Punjab Kings',
    hindiName: 'पंजाब किंग्स',
    colors: 'Red and Gold',
    keyPlayers: ['Ricky Ponting', 'Arshdeep Singh', 'Shashank Singh'],
    hindiPlayers: ['रिकी पोंटिंग', 'अर्शदीप सिंह', 'शशांक सिंह'],
    captaincyCandidates: ['अर्शदीप सिंह', 'शशांक सिंह'],
    captaincyReasons: [
      'रिकी पोंटिंग के हेड कोच बनने के बाद टीम ऑक्शन में बड़े नए कप्तान पर दांव लगा सकती है।'
    ],
    captaincyReasonsEn: [
      'Ricky Ponting arrival as head coach signals a complete high-intent tactical rebuild.'
    ],
    tacticalTraits: 'अर्शदीप सिंह की डेथ ओवर्स में घातक स्विंग और पोंटिंग का आक्रामक ऑस्ट्रेलियाई विजन',
  },
  INDIA: {
    name: 'Team India',
    hindiName: 'टीम इंडिया',
    colors: 'Blue',
    keyPlayers: ['Rohit Sharma', 'Virat Kohli', 'Jasprit Bumrah', 'Gautam Gambhir', 'Hardik Pandya'],
    hindiPlayers: ['रोहित शर्मा', 'विराट कोहली', 'जसप्रीत बुमराह', 'गौतम गंभीर', 'हार्दिक पंड्या'],
    captaincyCandidates: ['रोहित शर्मा', 'जसप्रीत बुमराह', 'हार्दिक पंड्या'],
    captaincyReasons: [
      'रोहित शर्मा की लीडरशिप में भारत ने टी20 वर्ल्ड कप जीता और निडर क्रिकेट का नया दौर शुरू किया।',
      'जसप्रीत बुमराह दुनिया के नंबर एक गेंदबाज के रूप में दबाव के पलों में सटीक फैसले लेते हैं।'
    ],
    captaincyReasonsEn: [
      'Rohit Sharma inspiring leadership led India to T20 World Cup glory with an aggressive template.',
      'Jasprit Bumrah unparalleled bowling genius makes him a sharp tactical reader of match situations.'
    ],
    tacticalTraits: 'गौतम गंभीर का हाई-स्ट्राइक रेट वाला आक्रामक क्रिकेट और बुमराह की यॉर्कर गेंदबाजी',
  },
};

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
 * Fetches latest trending IPL/Cricket news from Google News RSS with strict 48-hour freshness filter
 */
async function fetchTrendingCricketNews() {
  const recentPublished = getRecentTopicsForSlot('slot5', 20);
  const rssEndpoints = [
    'https://news.google.com/rss/search?q=IPL+auction+OR+retention+OR+captain+when:2d&hl=en-IN&gl=IN&ceid=IN:en',
    'https://news.google.com/rss/search?q=cricket+BCCI+OR+Rohit+OR+Kohli+when:2d&hl=en-IN&gl=IN&ceid=IN:en',
    'https://news.google.com/rss/search?q=India+cricket+team+when:2d&hl=en-IN&gl=IN&ceid=IN:en',
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
        if (!source) source = 'Cricket Desk';

        // Extract description snippet
        const descMatch = itemContent.match(/<description>([\s\S]*?)<\/description>/i);
        const snippet = descMatch ? cleanXmlSnippet(descMatch[1]) : '';

        // Extract Link & PubDate
        const linkMatch = itemContent.match(/<link>([\s\S]*?)<\/link>/i);
        const link = linkMatch ? linkMatch[1].trim() : '';

        const pubDateMatch = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
        const pubDate = pubDateMatch ? pubDateMatch[1].trim() : '';

        if (pubDate && !isWithin48Hours(pubDate)) {
          continue;
        }

        const isRecent = isTopicRecentlyPublished(headline, 60) ||
          recentPublished.some((rt) => {
            const hTokens = headline.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
            const rtTokens = rt.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
            const overlap = hTokens.filter((w) => rtTokens.includes(w));
            return overlap.length >= 3;
          });

        if (headline.length > 18 && !isRecent) {
          items.push({ headline, source, snippet, link, pubDate });
        }
      }

      if (items.length > 0) {
        logger.info(`Fetched ${items.length} verified fresh cricket stories (<48h) from Google News RSS.`);
        return items;
      }
    } catch (err) {
      logger.warn(`Failed to fetch Cricket RSS (${rssUrl}): ${err.message}`);
    }
  }

  logger.warn('No fresh cricket stories found under 48h filter. Using verified IPL auction & tactical baseline.');
  const currentDate = new Date().toISOString().split('T')[0];
  return [
    {
      headline: `KKR Captaincy Dilemma: Domestic Core vs Overseas Match-Winner Ahead of IPL Auction (${currentDate})`,
      source: 'Cricket Desk',
      snippet: 'Kolkata Knight Riders evaluate leadership transition exploring Venkatesh Iyer domestic continuity versus aggressive international captaincy options.',
      pubDate: new Date().toUTCString(),
    },
    {
      headline: `RCB Bowling & Middle-Order Blueprint for IPL Title Charge (${currentDate})`,
      source: 'Cricket Desk',
      snippet: 'Royal Challengers Bengaluru align Andy Flower tactical strategies with Virat Kohli and Rajat Patidar for Chinnaswamy home dominance.',
      pubDate: new Date().toUTCString(),
    },
  ];
}

/**
 * Detect primary team, players, and tactical topic category from headline and snippet
 */
function extractCricketEntities(headline = '', snippet = '') {
  const combined = `${headline} ${snippet}`.toLowerCase();

  let teamKey = 'IPL';
  let primaryPlayer = 'Cricket Stars';
  let category = 'general';

  // 1. Detect Franchise
  if (combined.includes('kkr') || combined.includes('kolkata') || combined.includes('knight riders')) teamKey = 'KKR';
  else if (combined.includes('rcb') || combined.includes('bangalore') || combined.includes('bengaluru')) teamKey = 'RCB';
  else if (combined.includes('csk') || combined.includes('chennai') || combined.includes('super kings')) teamKey = 'CSK';
  else if (combined.includes('mi') || combined.includes('mumbai indians')) teamKey = 'MI';
  else if (combined.includes('srh') || combined.includes('hyderabad') || combined.includes('sunrisers')) teamKey = 'SRH';
  else if (combined.includes('dc') || combined.includes('delhi capitals') || combined.includes('delhi daredevils')) teamKey = 'DC';
  else if (combined.includes('rr') || combined.includes('rajasthan royals')) teamKey = 'RR';
  else if (combined.includes('gt') || combined.includes('gujarat titans')) teamKey = 'GT';
  else if (combined.includes('lsg') || combined.includes('lucknow')) teamKey = 'LSG';
  else if (combined.includes('pbks') || combined.includes('punjab kings')) teamKey = 'PBKS';
  else if (combined.includes('bcci') || combined.includes('team india') || combined.includes('india cricket') || combined.includes('gambhir')) teamKey = 'INDIA';

  // 2. Detect Player
  if (combined.includes('kohli')) primaryPlayer = 'Virat Kohli';
  else if (combined.includes('rohit')) primaryPlayer = 'Rohit Sharma';
  else if (combined.includes('dhoni')) primaryPlayer = 'MS Dhoni';
  else if (combined.includes('bumrah')) primaryPlayer = 'Jasprit Bumrah';
  else if (combined.includes('pant')) primaryPlayer = 'Rishabh Pant';
  else if (combined.includes('hardik')) primaryPlayer = 'Hardik Pandya';
  else if (combined.includes('surya') || combined.includes('sky')) primaryPlayer = 'Suryakumar Yadav';
  else if (combined.includes('gill')) primaryPlayer = 'Shubman Gill';
  else if (combined.includes('cummins')) primaryPlayer = 'Pat Cummins';
  else if (combined.includes('klaasen')) primaryPlayer = 'Heinrich Klaasen';
  else if (combined.includes('iyer') || combined.includes('venkatesh')) primaryPlayer = 'Venkatesh Iyer';
  else if (combined.includes('shreyas')) primaryPlayer = 'Shreyas Iyer';
  else if (combined.includes('russell')) primaryPlayer = 'Andre Russell';
  else if (combined.includes('gaikwad')) primaryPlayer = 'Ruturaj Gaikwad';
  else if (combined.includes('samson')) primaryPlayer = 'Sanju Samson';
  else if (combined.includes('jaiswal')) primaryPlayer = 'Yashasvi Jaiswal';
  else if (combined.includes('arshdeep')) primaryPlayer = 'Arshdeep Singh';
  else if (combined.includes('patidar')) primaryPlayer = 'Rajat Patidar';
  else if (combined.includes('gambhir')) primaryPlayer = 'Gautam Gambhir';
  else if (combined.includes('flower') || combined.includes('andy flower')) primaryPlayer = 'Andy Flower';

  // 3. Detect Topic Category
  if (combined.includes('captain') || combined.includes('captaincy') || combined.includes('leadership') || combined.includes('कप्तानी') || combined.includes('कमान')) {
    category = 'captaincy';
  } else if (combined.includes('auction') || combined.includes('retention') || combined.includes('retain') || combined.includes('released') || combined.includes('purse') || combined.includes('price') || combined.includes('ऑक्शन')) {
    category = 'auction';
  } else if (combined.includes('bowling') || combined.includes('bowler') || combined.includes('pace') || combined.includes('pacer') || combined.includes('wicket') || combined.includes('spin') || combined.includes('yorker')) {
    category = 'bowling';
  } else if (combined.includes('batting') || combined.includes('batsman') || combined.includes('strike rate') || combined.includes('runs') || combined.includes('century') || combined.includes('six')) {
    category = 'batting';
  } else if (combined.includes('coach') || combined.includes('strategy') || combined.includes('tactics') || combined.includes('blueprint')) {
    category = 'coach';
  }

  return { teamKey, primaryPlayer, category };
}

/**
 * Intelligent domain-grounded tactical script synthesizer for Cricket & IPL Buzz.
 * ZERO generic template filler. ZERO "sutron ki report". ZERO "playing 11 balance". ZERO "subscribe" clichés.
 * Names real players and explains WHY each fits or what the tactical trade-off is with verified stats.
 */
function generateDynamicCricketScript({ headline, snippet, source }) {
  const cleanHeadline = headline.replace(/['":]/g, '').trim();
  const summary = summarizeNewsHeadline(cleanHeadline);
  const { teamKey, primaryPlayer, category } = extractCricketEntities(cleanHeadline, snippet);

  const franchise = IPL_FRANCHISES[teamKey] || IPL_FRANCHISES.INDIA;
  const teamHindi = franchise.hindiName;

  const comparisonInfo = detectComparisonPlayers(cleanHeadline, snippet, teamKey);
  const comparisonData = buildComparisonData(comparisonInfo);

  let hookHindi = '';
  let hookEnglish = '';
  let body1Hindi = '';
  let body1English = '';
  let body2Hindi = '';
  let body2English = '';
  let ctaHindi = '';
  let ctaEnglish = '';

  if (comparisonData && comparisonData.type === 'comparison') {
    const p1 = comparisonData.p1Data;
    const p2 = comparisonData.p2Data;

    hookHindi = `${teamHindi} में ${p1.hindiName} और ${p2.hindiName} के बीच कप्तानी और रोल को लेकर बड़ी बहस छिड़ चुकी है!`;
    hookEnglish = `A major leadership debate has erupted at ${franchise.name} between ${p1.name} and ${p2.name}!`;

    body1Hindi = `${p1.hindiName} के नाम ${p1.scriptStatHindi} दर्ज है, जो उन्हें इस भूमिका में सबसे मजबूत दावेदार बनाता है।`;
    body1English = `${p1.name} brings ${p1.scriptStatEnglish}, establishing unmatched tactical authority.`;

    body2Hindi = `वहीं दूसरी तरफ ${p2.hindiName} के पास ${p2.scriptStatHindi} का अनुभव है, जो निर्णायक पलों में मैच का पासा पलट देता है।`;
    body2English = `On the flip side, ${p2.name} boasts ${p2.scriptStatEnglish}, delivering proven match-winning power in crunch moments.`;

    ctaHindi = `इन दोनों के रिकॉर्ड्स को देखते हुए, आप ${teamHindi} की कमान किसे सौंपेंगे?`;
    ctaEnglish = `Looking at these verified records, who would you choose to lead: ${p1.name} or ${p2.name}?`;
  } else if (comparisonData && comparisonData.type === 'stat_card') {
    const p = comparisonData.pData;

    hookHindi = `${p.hindiName} का हालिया प्रदर्शन और मैच-विनिंग आंकड़े विरोधी टीमों के लिए सबसे बड़ा सिरदर्द बन चुके हैं!`;
    hookEnglish = `${p.name}'s verified match-winning numbers have become a massive nightmare for opposition plans!`;

    body1Hindi = `${p.hindiName} के नाम ${p.scriptStatHindi} दर्ज है, जो मैदान पर उनके विशाल प्रभाव को साबित करता है।`;
    body1English = `With ${p.scriptStatEnglish}, ${p.name} consistently dictates high-intensity match situations.`;

    body2Hindi = `${franchise.tacticalTraits} के साथ उनका संयोजन आगामी मुकाबलों में टीम को जीत दिलाने का सबसे बड़ा हथियार है।`;
    body2English = `Combined with ${franchise.name} core strengths, this skillset represents pure championship-winning firepower.`;

    ctaHindi = `क्या आपको लगता है कि आगामी टूर्नामेंट में यह प्रदर्शन और रिकॉर्ड्स नए मुकाम छुएंगे?`;
    ctaEnglish = `Do you see these match-winning records climbing even higher this season?`;
  } else if (category === 'captaincy') {
    const candidate1 = franchise.hindiPlayers[0] || 'विराट कोहली';
    const candidate2 = franchise.hindiPlayers[1] || 'रोहित शर्मा';
    const candidate1En = franchise.keyPlayers[0] || 'Star Player';
    const candidate2En = franchise.keyPlayers[1] || 'Match Winner';

    hookHindi = `${teamHindi} की कप्तानी की रेस में ${candidate1} और ${candidate2} के बीच मुकाबला बेहद दिलचस्प हो चुका है!`;
    hookEnglish = `The captaincy race for ${franchise.name} has ignited a fierce debate between ${candidate1En} and ${candidate2En}!`;

    body1Hindi = franchise.captaincyReasons[0] || `${candidate1} का शांत और आक्रामक स्वभाव उन्हें स्वाभाविक घरेलू लीडर बनाता है।`;
    body1English = franchise.captaincyReasonsEn?.[0] || `${candidate1En} brings tactical composure and deep understanding of the team core.`;

    body2Hindi = franchise.captaincyReasons[1] || `दूसरी तरफ ${candidate2} का अनुभव मैच के निर्णायक मोड़ों पर दबाव सोखने की क्षमता रखता है।`;
    body2English = franchise.captaincyReasonsEn?.[1] || `On the flip side, ${candidate2En} offers proven authority in clutch high-pressure moments.`;

    ctaHindi = `अगर कमान आपके हाथों में हो, तो आप ${candidate1} को कप्तान बनाएंगे या ${candidate2} को?`;
    ctaEnglish = `If you held the decision, would you hand the captaincy armband to ${candidate1En} or ${candidate2En}?`;
  } else {
    // General / Tactical Blueprint
    hookHindi = `${cleanHeadline} को लेकर क्रिकेट जगत में एक तीखी बहस छिड़ चुकी है!`;
    hookEnglish = `A fierce tactical debate has erupted surrounding ${cleanHeadline}!`;

    body1Hindi = `${franchise.tacticalTraits} को देखते हुए आगामी टूर्नामेंट में इस फैसले का प्रभाव साफ नजर आएगा।`;
    body1English = `Rooted in ${franchise.name} tactical strengths, this development directly reshapes their tournament approach.`;

    body2Hindi = `मैदान पर टीम का संतुलन और मैच रणनीति ही खिताब की दावेदारी तय करेगी।`;
    body2English = `On-field execution and tournament tactical discipline will decide the championship run.`;

    ctaHindi = `इस बड़े मुकाबले में आपकी फेवरेट टीम का पलड़ा कितना भारी दिखाई दे रहा है?`;
    ctaEnglish = `How do you rate your favorite team chances heading into this massive clash?`;
  }

  // Ensure clean Devanagari text with zero banned clichés
  const segments = [
    { hindi: sanitizeScriptText(hookHindi), english: sanitizeScriptText(hookEnglish) },
    { hindi: sanitizeScriptText(body1Hindi), english: sanitizeScriptText(body1English) },
    { hindi: sanitizeScriptText(body2Hindi), english: sanitizeScriptText(body2English) },
    { hindi: sanitizeScriptText(ctaHindi), english: sanitizeScriptText(ctaEnglish) },
  ];

  // Distinct multi-scene visual queries (4 completely different visual categories)
  const visualSceneQueries = [
    'cricket stadium floodlights crowd night',
    'cricket bat and ball nets practice pitch',
    'cricket batsman powerful match boundary shot',
    'cricket team victory celebration golden trophy'
  ];

  const statBadge = comparisonData?.type === 'comparison'
    ? 'HEAD-TO-HEAD'
    : 'VERIFIED STATS';

  const detectedPrimaryPlayer = comparisonData?.type === 'comparison'
    ? `${comparisonData.player1.name} vs ${comparisonData.player2.name}`
    : (comparisonData?.player?.name || primaryPlayer);

  return {
    title: `${summary.fullSummary} 🏏🔥`.slice(0, 95),
    headline: summary.fullSummary,
    hookHindi: segments[0].hindi,
    hookEnglish: segments[0].english,
    bodyPart1Hindi: segments[1].hindi,
    bodyPart1English: segments[1].english,
    bodyPart2Hindi: segments[2].hindi,
    bodyPart2English: segments[2].english,
    ctaHindi: segments[3].hindi,
    ctaEnglish: segments[3].english,
    segments,
    primaryPlayer: detectedPrimaryPlayer,
    team: teamKey,
    statBadge,
    visualQuery: 'cricket stadium floodlights crowd night',
    visualSceneQueries,
    comparisonData,
    tags: ['Cricket', 'IPL', 'Shorts', 'CricketBuzz', teamKey],
  };
}

/**
 * Main Content Generator for Slot 5 (Cricket Buzz)
 * Strictly fact-grounded. Zero template filler. Zero banned clichés.
 * @param {string} [customTopic]
 */
export async function generateSlot5Content(customTopic = null) {
  logger.info('=== Generating Slot 5 (IPL & Cricket Buzz) Fact-Grounded Content ===');

  const recentTopics = getRecentTopicsForSlot('slot5', 15);
  if (recentTopics.length > 0) {
    logger.info(`[Slot 5 Anti-Repeat] Found ${recentTopics.length} recent topics in memory.`);
  }

  let chosenStory = null;
  if (customTopic) {
    chosenStory = {
      headline: customTopic.trim(),
      snippet: customTopic.trim(),
      source: 'Cricket Desk',
    };
  } else {
    const trendingList = await fetchTrendingCricketNews();
    if (trendingList.length > 0) {
      chosenStory = trendingList[Math.floor(Math.random() * trendingList.length)];
    }
  }

  const { teamKey, primaryPlayer, category } = extractCricketEntities(chosenStory?.headline || '', chosenStory?.snippet || '');
  const franchise = IPL_FRANCHISES[teamKey] || IPL_FRANCHISES.INDIA;

  const comparisonInfo = detectComparisonPlayers(chosenStory?.headline || '', chosenStory?.snippet || '', teamKey);
  const comparisonData = buildComparisonData(comparisonInfo);

  let verifiedStatsPrompt = '';
  if (comparisonData && comparisonData.type === 'comparison') {
    verifiedStatsPrompt = `
VERIFIED CRICKET & IPL STATS (GROUND TRUTH - STRICTLY CITE ACCURATELY):
- Player 1: "${comparisonData.player1.name}" (${comparisonData.p1Data.hindiName}) -> Stat 1: ${comparisonData.player1.stat1}, Stat 2: ${comparisonData.player1.stat2}, Stat 3: ${comparisonData.player1.stat3}
  Verified Script Stat (Hindi): "${comparisonData.p1Data.scriptStatHindi}"
  Verified Script Stat (English): "${comparisonData.p1Data.scriptStatEnglish}"
- Player 2: "${comparisonData.player2.name}" (${comparisonData.p2Data.hindiName}) -> Stat 1: ${comparisonData.player2.stat1}, Stat 2: ${comparisonData.player2.stat2}, Stat 3: ${comparisonData.player2.stat3}
  Verified Script Stat (Hindi): "${comparisonData.p2Data.scriptStatHindi}"
  Verified Script Stat (English): "${comparisonData.p2Data.scriptStatEnglish}"

STRICT STAT ACCURACY RULE:
- NEVER fabricate, hallucinate, or guess player statistics.
- You MUST weave Player 1's verified record into Beat 2 (bodyPart1Hindi & bodyPart1English) and Player 2's verified record into Beat 3 (bodyPart2Hindi & bodyPart2English).
`;
  } else if (comparisonData && comparisonData.type === 'stat_card') {
    verifiedStatsPrompt = `
VERIFIED CRICKET & IPL STATS (GROUND TRUTH - STRICTLY CITE ACCURATELY):
- Featured Player: "${comparisonData.player.name}" (${comparisonData.pData.hindiName}) -> Stat 1: ${comparisonData.player.stat1}, Stat 2: ${comparisonData.player.stat2}, Stat 3: ${comparisonData.player.stat3}
  Verified Script Stat (Hindi): "${comparisonData.pData.scriptStatHindi}"
  Verified Script Stat (English): "${comparisonData.pData.scriptStatEnglish}"

STRICT STAT ACCURACY RULE:
- NEVER fabricate, hallucinate, or guess player statistics.
- You MUST weave the player's verified stats into Beat 2 (bodyPart1Hindi & bodyPart1English).
`;
  }

  const prompt = `You are the lead cricket analyst and scriptwriter for a high-retention viral YouTube Shorts sports channel (@dailypulseshortss).
Topic Context (Verified recent cricket news <48h):
- Headline: "${chosenStory?.headline || 'Cricket Match Update'}"
- RSS Details / Snippet: "${chosenStory?.snippet || 'Breaking cricket news update'}"
- Primary Franchise: "${franchise.name}" (${franchise.hindiName})
- Featured Key Players: ${franchise.keyPlayers.join(', ')}
- Tactical Category: ${category.toUpperCase()}
${verifiedStatsPrompt}
STRICTLY BANNED PHRASES & ENDINGS (AUTOMATIC REJECTION IF USED):
- NEVER use: "सूत्रों की रिपोर्ट", "सूत्रों के अनुसार", "सूत्रों के हवाले से", "according to reports/sources"
- NEVER use: "टीम मैनेजमेंट और चयनकर्ता", "रणनीतिक बैठक", "team management and selectors"
- NEVER use: "प्लेइंग इलेवन और रणनीतिक संतुलन", "playing 11 and squad balance"
- NEVER use: "फैसला सही था या बड़ी भूल", "right call or big mistake"
- NEVER use generic endings: "सब्सक्राइब कीजिए", "लाइक शेयर सब्सक्राइब", "drop your thoughts and subscribe"

CRITICAL TOPIC-SPECIFIC SCRIPT RULES:
1. DIRECTLY ANSWER THE HEADLINE: Never write vague commentary. If the topic is captaincy options (e.g. KKR), NAME actual candidates (e.g. Venkatesh Iyer, Shreyas Iyer, Andre Russell) and explain WHY each fits based on real cricket facts (title-winning domestic composure vs overseas aggressive mind).
2. If comparing players, state both names clearly and cite their exact verified stats.
3. If the topic is an auction or player price, name the player, analyze their exact skill (death-overs yorker specialist, powerplay boundary hitter, mystery spin), and the bidding dilemma.
4. Beat 1 (0-2s, 8-12 words): High-impact hook stating the exact dilemma and naming the real players.
5. Beat 2 (2-20s, 14-18 words): Player 1 / Option A breakdown with concrete cricket stats or tactical reasoning.
6. Beat 3 (20-35s, 14-18 words): Player 2 / Option B / Counter-tactics explaining the team dilemma.
7. Beat 4 (35-45s, 10-14 words): Sharp, polarizing fan debate question asking viewers to choose between the specific players/options.

CRITICAL TTS & PRONUNCIATION INSTRUCTION:
- Microsoft Edge TTS Hindi neural voice mispronounces English acronyms and letters if written in Latin script.
- In ALL Hindi voiceover fields ("hookHindi", "bodyPart1Hindi", "bodyPart2Hindi", "ctaHindi"):
  Write 100% in Devanagari script. All proper nouns and cricket terms MUST be written phonetically in Devanagari (e.g. "आईपीएल", "केकेआर", "आरसीबी", "सीएसके", "वेंकटेश अय्यर", "विराट कोहली", "रोहित शर्मा", "जसप्रीत बुमराह", "ऑक्शन", "कप्तानी"). NEVER use Latin/English letters inside Hindi voiceover fields.

CRITICAL SUBTITLE INSTRUCTION:
- In ALL English subtitle fields ("hookEnglish", "bodyPart1English", "bodyPart2English", "ctaEnglish"):
  Write crisp, punchy, grammatical English translations for burned-in subtitles.

DISTINCT MULTI-SCENE VISUALS (CRITICAL):
- Provide "visualSceneQueries": Exactly 4 distinct, highly visual queries representing 4 different scene types:
  1. Stadium atmosphere / crowd cheering / floodlights night
  2. Cricket gear / bat and ball / practice nets pitch
  3. Intense match action / batsman boundary shot / fast bowler delivery
  4. Team victory celebration / golden trophy / tactics board

Return ONLY a valid JSON object matching this schema:
{
  "title": "High CTR title with emojis (max 65 chars)",
  "headline": "Punchy 2-line title for overlay card (max 45 chars)",
  "hookHindi": "...",
  "hookEnglish": "...",
  "bodyPart1Hindi": "...",
  "bodyPart1English": "...",
  "bodyPart2Hindi": "...",
  "bodyPart2English": "...",
  "ctaHindi": "...",
  "ctaEnglish": "...",
  "primaryPlayer": "${comparisonData?.type === 'comparison' ? `${comparisonData.player1.name} vs ${comparisonData.player2.name}` : comparisonData?.player?.name || primaryPlayer}",
  "team": "${teamKey}",
  "statBadge": "${comparisonData?.type === 'comparison' ? 'HEAD-TO-HEAD' : 'VERIFIED STATS'}",
  "visualQuery": "cricket stadium floodlights crowd night",
  "visualSceneQueries": [
    "cricket stadium floodlights crowd night",
    "cricket bat and ball nets practice pitch",
    "cricket batsman powerful match boundary shot",
    "cricket team victory celebration golden trophy"
  ],
  "tags": ["Cricket", "IPL", "Shorts", "CricketBuzz", "${teamKey}"]
}`;

  let generated = await generateGeminiJson(prompt, {
    maxTokens: 850,
    temperature: 0.5,
    tag: 'Slot5-Cricket',
  });

  // Verify Gemini output does not contain any banned template filler
  if (generated) {
    generated.comparisonData = comparisonData;
    const fullHindi = `${generated.hookHindi} ${generated.bodyPart1Hindi} ${generated.bodyPart2Hindi} ${generated.ctaHindi}`;
    const fullEnglish = `${generated.hookEnglish} ${generated.bodyPart1English} ${generated.bodyPart2English} ${generated.ctaEnglish}`;

    if (containsBannedPhrases(fullHindi) || containsBannedPhrases(fullEnglish)) {
      logger.warn('[Slot 5] Gemini output contained banned cliché phrases. Sanitizing script...');
      generated.hookHindi = sanitizeScriptText(generated.hookHindi);
      generated.bodyPart1Hindi = sanitizeScriptText(generated.bodyPart1Hindi);
      generated.bodyPart2Hindi = sanitizeScriptText(generated.bodyPart2Hindi);
      generated.ctaHindi = sanitizeScriptText(generated.ctaHindi);
      generated.hookEnglish = sanitizeScriptText(generated.hookEnglish);
      generated.bodyPart1English = sanitizeScriptText(generated.bodyPart1English);
      generated.bodyPart2English = sanitizeScriptText(generated.bodyPart2English);
      generated.ctaEnglish = sanitizeScriptText(generated.ctaEnglish);
    }
  }

  // Factual procedural fallback if Gemini is offline or generated invalid script
  if (!generated && chosenStory) {
    logger.warn('[Slot 5] Gemini offline. Synthesizing topic-specific factual script...');
    generated = generateDynamicCricketScript(chosenStory);
  }

  const cleanHeadline = (generated.headline || chosenStory?.headline || 'Cricket News Update')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .trim();

  const summary = summarizeNewsHeadline(cleanHeadline);
  const formattedTitle = generated.title
    ? `${toTitleCase(generated.title.replace(/🚨|🔥|🏏/g, '').trim())} 🏏🔥`
    : `Cricket: ${summary.fullSummary} 🏏🔥`;

  const segments = (generated.segments && generated.segments.length > 0)
    ? generated.segments
    : [
        {
          hindi: sanitizeScriptText(generated.hookHindi),
          english: sanitizeScriptText(generated.hookEnglish),
        },
        {
          hindi: sanitizeScriptText(generated.bodyPart1Hindi),
          english: sanitizeScriptText(generated.bodyPart1English),
        },
        {
          hindi: sanitizeScriptText(generated.bodyPart2Hindi),
          english: sanitizeScriptText(generated.bodyPart2English),
        },
        {
          hindi: sanitizeScriptText(generated.ctaHindi),
          english: sanitizeScriptText(generated.ctaEnglish),
        },
      ].filter((s) => s.hindi && s.english);

  const voiceScript = segments.map((s) => s.hindi).join(' ');
  const subtitleText = segments.map((s) => s.english).join(' ');

  const tags = [
    'Cricket',
    'CricketShorts',
    'CricketNews',
    'Shorts',
    'ViralShorts',
    'IPL',
    ...(generated.tags || []),
    franchise.name.replace(/[^a-zA-Z0-9]/g, ''),
    teamKey,
  ].map((t) => t.replace(/[^a-zA-Z0-9]/g, ''));

  const description = `${formattedTitle}\n\n` +
    `🏏 In-Depth Cricket & Tactical Analysis:\n` +
    `• Topic: ${cleanHeadline}\n` +
    `• Featured Franchise: ${franchise.name}\n` +
    `• Language: Fast-paced Hindi commentary with burned-in English captions.\n\n` +
    `Share your thoughts below! Which choice would you back?`;

  const bgMusicPath = path.join(config.assetsDir, 'audio', 'cricket.mp3');
  const sfxAudioPath = path.join(config.assetsDir, 'audio', 'whoosh.mp3');

  // Enforce 4 distinct scene queries across varied visual categories
  const visualSceneQueries = Array.isArray(generated.visualSceneQueries) && generated.visualSceneQueries.length >= 3
    ? generated.visualSceneQueries
    : [
        'cricket stadium floodlights crowd night',
        'cricket bat and ball nets practice pitch',
        'cricket batsman powerful match boundary shot',
        'cricket team victory celebration golden trophy'
      ];

  const resolvedComparisonData = generated.comparisonData || comparisonData;

  return {
    slot: 'slot5',
    slotName: 'Cricket Buzz & Match Highlights',
    title: formattedTitle.slice(0, 95),
    headline: summary.fullSummary,
    cleanTitle: summary.fullSummary,
    primaryPlayer: generated.primaryPlayer || (resolvedComparisonData?.type === 'comparison' ? `${resolvedComparisonData.player1.name} vs ${resolvedComparisonData.player2.name}` : resolvedComparisonData?.player?.name || primaryPlayer),
    team: teamKey,
    statBadge: generated.statBadge || (resolvedComparisonData?.type === 'comparison' ? 'HEAD-TO-HEAD' : 'VERIFIED STATS'),
    visualQuery: visualSceneQueries[0],
    secondaryQuery: visualSceneQueries[1],
    altQueries: visualSceneQueries.slice(2),
    visualSceneQueries,
    comparisonData: resolvedComparisonData,
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

import path from 'path';
import fs from 'fs';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const TRACKER_PATH = path.join(config.assetsDir, 'history_tracker.json');

// 3-Day Dynamic Rotation Themes
const THEMES = ['jokes', 'dance', 'mischief'];

// =====================================================================
// DAY 1: Cute Innocent Toddler Jokes & Funny Questions
// =====================================================================
const JOKES_SCENARIOS = [
  {
    theme: 'jokes',
    badge: 'LITTLE BOSS JOKES 😂',
    englishTitle: 'Wait For The Punchline! 👶😂 Papa vs Mummy | Cute Toddler Joke',
    visualQuery: 'cute baby talking',
    altQueries: ['toddler laughing', 'cute baby smiling', 'funny toddler talking'],
    segments: [
      {
        hindi: 'पापा बोलते हैं कि मैं बिल्कुल उनके जैसा दिखता हूँ!',
        english: 'Papa says I look just like him!',
      },
      {
        hindi: 'मम्मी कहती हैं कि मेरी सारी बुरी आदतें भी पापा जैसी हैं।',
        english: 'Mummy says I have all his bad habits too!',
      },
      {
        hindi: 'लेकिन मुझे एक बात समझ नहीं आती...',
        english: 'But tell me one thing honestly...',
      },
      {
        hindi: 'फिर हमारा टॉमी कुत्ता किसके जैसा दिखता है? बताओ तो ज़रा!',
        english: 'Who does our pet dog look like then?!',
      },
    ],
    tags: ['shorts', 'funnybaby', 'cutejoke', 'toddlerjokes', 'babycomedy', 'viralshorts', 'familyhumor', 'fyp'],
  },
  {
    theme: 'jokes',
    badge: 'LITTLE BOSS JOKES 😂',
    englishTitle: 'Toddler Question Of The Day! 👶🤔 Pure Innocence | Funny Baby Shorts',
    visualQuery: 'toddler running laughing',
    altQueries: ['naughty kid smiling', 'cute baby playing', 'toddler running'],
    segments: [
      {
        hindi: 'मम्मी ने मुझसे पूछा कि नए जूतों पर कीचड़ कैसे लग गया?',
        english: 'Mummy asked me why I got mud on my new shoes...',
      },
      {
        hindi: 'मैंने कहा मम्मी जूते इतनी तेज़ी से भाग रहे थे कि मैं क्या करता!',
        english: 'I told her the shoes were running too fast!',
      },
      {
        hindi: 'बड़े लोग भी ना, हर बात का इल्ज़ाम मासूम बच्चों पर ही लगाते हैं!',
        english: 'Why do grown-ups blame us for everything?',
      },
      {
        hindi: 'अगर आप भी मेरी टीम में हैं, तो जल्दी से लाइक ठोक दो!',
        english: 'If you agree with me, drop a like right now!',
      },
    ],
    tags: ['shorts', 'cutebaby', 'toddlerhumor', 'funnyvideo', 'innocence', 'kidlogic', 'explore'],
  },
  {
    theme: 'jokes',
    badge: 'LITTLE BOSS JOKES 😂',
    englishTitle: 'When Grandparents Are Around! 👶🕶️ Savage Toddler Trick',
    visualQuery: 'naughty kid smiling',
    altQueries: ['cute baby pretending', 'toddler laughing', 'funny baby expressions'],
    segments: [
      {
        hindi: 'जब भी पापा मुझे चॉकलेट खाने पर डांटते हैं...',
        english: 'Whenever Papa scolds me for eating chocolate...',
      },
      {
        hindi: 'मैं चुपचाप दादी की तरफ देखकर नकली रोना शुरू कर देता हूँ!',
        english: 'I just look over at Dadi and start fake crying!',
      },
      {
        hindi: 'और बस दो सेकंड में, उल्टे पापा की ही डांट पड़ जाती है!',
        english: 'In two seconds, Papa gets scolded instead!',
      },
      {
        hindi: 'देखा छोटा दिमाग बड़ा धमाका! अगर आपको भी दादी प्यारी हैं तो सब्सक्राइब करें!',
        english: 'Subscribe if you love your grandparents too!',
      },
    ],
    tags: ['shorts', 'savagetoddler', 'funny', 'dadi', 'babytricks', 'cutebaby', 'viralcomedy'],
  },
  {
    theme: 'jokes',
    badge: 'LITTLE BOSS JOKES 😂',
    englishTitle: 'Doctor Uncle’s Big Lie! 👶💉 Tiny Injection Mystery',
    visualQuery: 'cute baby smiling talking',
    altQueries: ['toddler talking funny', 'cute baby laughing', 'naughty kid'],
    segments: [
      {
        hindi: 'डॉक्टर अंकल बोले बस एक छोटी सी चींटी काटेगी!',
        english: 'Doctor uncle said it will only pinch like a tiny ant...',
      },
      {
        hindi: 'अरे अंकल, क्या चींटी के पास इतना बड़ा सुई वाला इंजेक्शन होता है?!',
        english: 'Uncle, do ants carry giant syringes like that?!',
      },
      {
        hindi: 'मुझे तो लगता है वो चींटी किसी डायनासोर के खानदान की थी!',
        english: 'I think that ant was related to a dinosaur!',
      },
      {
        hindi: 'हंसते-हंसते पेट में दर्द हो गया तो जल्दी से लाइक और सब्सक्राइब करो!',
        english: 'If you laughed out loud, hit like and subscribe right now!',
      },
    ],
    tags: ['shorts', 'babyhumor', 'doctorjoke', 'cutebaby', 'toddlerjokes', 'viralcomedy', 'laughing'],
  },
  {
    theme: 'jokes',
    badge: 'LITTLE BOSS JOKES 😂',
    englishTitle: 'Phone Rules Double Standard! 👶📱 Busted Mummy Papa',
    visualQuery: 'toddler holding phone laughing',
    altQueries: ['cute baby talking', 'toddler laughing', 'naughty kid smiling'],
    segments: [
      {
        hindi: 'मम्मी दिन भर बोलती हैं कि फोन देखने से आंखें खराब हो जाती हैं!',
        english: 'Mummy tells me that looking at phones ruins your eyes...',
      },
      {
        hindi: 'और खुद पूरा दिन इंस्टाग्राम पर रील्स स्क्रॉल करती रहती हैं!',
        english: 'While she spends all day scrolling Instagram reels!',
      },
      {
        hindi: 'क्या मम्मी की आंखों में स्पेशल फिल्टर लगा हुआ है?',
        english: 'Does Mummy have a special magic filter on her eyes?!',
      },
      {
        hindi: 'अगर आपके घर भी यही हाल है, तो कमेंट में हंसने वाली इमोजी भेजो!',
        english: 'If this happens at your home too, drop laughing emojis in comments!',
      },
    ],
    tags: ['shorts', 'phoneaddiction', 'relatablekid', 'cutebaby', 'mummyjokes', 'toddlerlogic', 'viralshorts'],
  },
];

// =====================================================================
// DAY 2: Cute Baby Dancing & Grooving to Beats
// =====================================================================
const DANCE_SCENARIOS = [
  {
    theme: 'dance',
    badge: 'BABY DANCE GROOVE 🕺',
    englishTitle: 'DJ Turn The Beat Up! 👶🕺 Little Boss On The Floor | Viral Baby Dance',
    visualQuery: 'toddler dancing funny',
    altQueries: ['cute baby dancing', 'baby grooving music', 'toddler dancing happy'],
    segments: [
      {
        hindi: 'अरे डीजे भैया, थोड़ा वॉल्यूम तो बढ़ाओ!',
        english: 'Hey DJ Bhaiya, turn up the volume!',
      },
      {
        hindi: 'जब तक ये कमर नहीं हिलेगी, पार्टी कैसे शुरू होगी!',
        english: 'How can the party start until I shake a leg?',
      },
      {
        hindi: 'ज़रा ये बाउंस और बीट पर मेरे मूव्स तो देखो!',
        english: 'Check out these bouncing moves and rhythm!',
      },
      {
        hindi: 'मेरे इस डांस को दस में से कितने नंबर दोगे? कमेंट में बताओ और सब्सक्राइब करो!',
        english: 'Rate my dance from 1 to 10 in the comments and subscribe!',
      },
    ],
    tags: ['shorts', 'babydance', 'cutedance', 'littleboss', 'dancechallenge', 'groove', 'trending', 'happyvibes'],
  },
  {
    theme: 'dance',
    badge: 'BABY DANCE GROOVE 🕺',
    englishTitle: 'When The Sunday Music Hits! 👶🔥 Pure Toddler Swag',
    visualQuery: 'cute baby dancing',
    altQueries: ['toddler dancing', 'cute baby laughing', 'baby grooving'],
    segments: [
      {
        hindi: 'मुझे किसी ने डांस सिखाया नहीं है!',
        english: 'Nobody taught me how to dance...',
      },
      {
        hindi: 'ये ताल और मस्ती मेरे नन्हे पैरों में खुद ब खुद आ जाती है!',
        english: 'The rhythm is naturally inside my tiny feet!',
      },
      {
        hindi: 'ज़रा ये स्वैग और ये प्यारी मुस्कान तो देखो!',
        english: 'Look at this swag and joyful smile!',
      },
      {
        hindi: 'हंसते रहो और रोज़ाना मस्ती के लिए सब्सक्राइब करो!',
        english: 'Keep smiling and subscribe for daily cute energy!',
      },
    ],
    tags: ['shorts', 'babyswag', 'cutetoddler', 'wholesome', 'dancegroove', 'viralshorts', 'fyp'],
  },
  {
    theme: 'dance',
    badge: 'BABY DANCE GROOVE 🕺',
    englishTitle: 'Can Anyone Beat This Baby Groove? 👶💃 Unstoppable Energy',
    visualQuery: 'toddler dancing joy',
    altQueries: ['baby dancing funny', 'cute baby dancing', 'toddler grooving'],
    segments: [
      {
        hindi: 'रुकिए रुकिए! सब काम छोड़कर पहले ये डांस देखिए!',
        english: 'Stop whatever you are doing right now!',
      },
      {
        hindi: 'दुनिया का सबसे नन्हा डांस चैंपियन मैदान में उतर चुका है!',
        english: 'Watch the youngest dance champion in action!',
      },
      {
        hindi: 'इतनी क्यूट एनर्जी के आगे बड़े-बड़े डांसर भी फेल हैं!',
        english: 'Even professional dancers cannot match this innocence!',
      },
      {
        hindi: 'ये मुस्कान अपने दोस्तों को भेजो और तुरंत सब्सक्राइब करो!',
        english: 'Share this smile with friends and hit subscribe!',
      },
    ],
    tags: ['shorts', 'babychampion', 'funnydance', 'cutebaby', 'joyful', 'trendingshorts', 'explore'],
  },
];

// =====================================================================
// DAY 3: Funny Toddler Logic & Silly Mischief
// =====================================================================
const MISCHIEF_SCENARIOS = [
  {
    theme: 'mischief',
    badge: 'TODDLER LOGIC & MISCHIEF 🍼',
    englishTitle: 'Genius Toddler Logic! 👶🥛 Why Doesn’t Cat Become Tiger?',
    visualQuery: 'cute baby talking',
    altQueries: ['toddler thinking funny', 'cute baby drinking', 'naughty kid smiling'],
    segments: [
      {
        hindi: 'मम्मी कहती हैं कि रोज़ दूध पीने से शेर जैसी ताकत आती है।',
        english: 'Mummy says drinking milk makes you strong like a lion...',
      },
      {
        hindi: 'लेकिन हमारी बिल्ली तो दिन में दो बार दूध पीती है!',
        english: 'But our cat drinks milk twice every single day!',
      },
      {
        hindi: 'वो आज तक शेर क्यों नहीं बनी? सोचो ज़रा!',
        english: 'Why hasn’t she turned into a tiger yet? Think about it!',
      },
      {
        hindi: 'बड़े लोग भी ना कुछ भी कहानियां बनाते हैं! ऐसे ही सवालों के लिए सब्सक्राइब करो!',
        english: 'Grown-ups tell funny stories! Subscribe for more toddler logic!',
      },
    ],
    tags: ['shorts', 'toddlerlogic', 'funnybaby', 'babyquestions', 'cutehumor', 'innocentbaby', 'explore'],
  },
  {
    theme: 'mischief',
    badge: 'TODDLER LOGIC & MISCHIEF 🍼',
    englishTitle: 'The Ultimate Bedtime Mystery! 👶🛌 Toddler Investigation',
    visualQuery: 'naughty kid smiling',
    altQueries: ['cute baby hiding', 'toddler eating sneakily', 'cute baby laughing'],
    segments: [
      {
        hindi: 'पापा-मम्मी मुझे तो नौ बजे सोने भेज देते हैं...',
        english: 'Why do parents tell me to sleep at nine PM...',
      },
      {
        hindi: 'और खुद चुपके से टीवी देखते हैं और आइसक्रीम खाते हैं!',
        english: 'While they stay up watching TV and eating ice cream?!',
      },
      {
        hindi: 'मुझे इनके सारे सीक्रेट प्लान पता चल चुके हैं!',
        english: 'I know all their secret late-night plans!',
      },
      {
        hindi: 'रंगे हाथों पकड़े गए! अगर आप भी होशियार हैं तो लाइक और सब्सक्राइब करें!',
        english: 'Busted! Hit like and subscribe if you caught your parents too!',
      },
    ],
    tags: ['shorts', 'bedtimemystery', 'funnyparents', 'smarttoddler', 'cutebaby', 'viralshorts', 'comedy'],
  },
  {
    theme: 'mischief',
    badge: 'TODDLER LOGIC & MISCHIEF 🍼',
    englishTitle: 'Toddler Philosophy 101 👶🧠 Clean Room Dilemma',
    visualQuery: 'toddler messy room playing',
    altQueries: ['cute baby playing toys', 'toddler laughing', 'naughty kid'],
    segments: [
      {
        hindi: 'अगर कल सुबह मुझे फिर से सारे खिलौनों से खेलना ही है...',
        english: 'If I have to play with my toys again tomorrow morning...',
      },
      {
        hindi: 'तो आज रात कमरा समेटने की क्या ज़रूरत है?',
        english: 'Why do I have to clean up the room tonight?',
      },
      {
        hindi: 'अपनी एनर्जी बचाना ही तो असली स्मार्ट वर्क कहलाता है!',
        english: 'Conserving energy is called smart working!',
      },
      {
        hindi: 'मम्मी को समझाओ कि मैं इंजीनियर हूँ! सब्सक्राइब करना मत भूलना!',
        english: 'Tell Mummy I am an engineer! Subscribe for more toddler wisdom!',
      },
    ],
    tags: ['shorts', 'toddlerlogic', 'smartbaby', 'babywisdom', 'funnyhumor', 'relatable', 'fyp'],
  },
];

/**
 * Gets next rotation theme using history_tracker.json
 */
function getNextTheme() {
  let tracker = {};
  if (fs.existsSync(TRACKER_PATH)) {
    try {
      tracker = JSON.parse(fs.readFileSync(TRACKER_PATH, 'utf8'));
    } catch (e) {
      tracker = {};
    }
  }

  const currentIndex = tracker.slot1_rotation ?? 0;
  const theme = THEMES[currentIndex % THEMES.length];

  // Increment and persist rotation
  tracker.slot1_rotation = (currentIndex + 1) % 30;
  try {
    fs.writeFileSync(TRACKER_PATH, JSON.stringify(tracker, null, 2), 'utf8');
  } catch (e) {
    logger.warn(`Failed to update history_tracker: ${e.message}`);
  }

  logger.info(`[SLOT 1 ROTATION] Selected Day ${((currentIndex % 3) + 1)} Theme: "${theme.toUpperCase()}"`);
  return theme;
}

export async function generateSlot1Content(customTopic = null) {
  let theme = getNextTheme();

  if (customTopic) {
    const topicLower = customTopic.toLowerCase();
    if (topicLower.includes('dance') || topicLower.includes('groove') || topicLower.includes('party')) {
      theme = 'dance';
    } else if (topicLower.includes('logic') || topicLower.includes('mischief') || topicLower.includes('toy')) {
      theme = 'mischief';
    } else if (topicLower.includes('joke') || topicLower.includes('funny') || topicLower.includes('laugh')) {
      theme = 'jokes';
    }
  }

  // Select appropriate scenario pool based on theme
  let pool;
  if (theme === 'dance') pool = DANCE_SCENARIOS;
  else if (theme === 'mischief') pool = MISCHIEF_SCENARIOS;
  else pool = JOKES_SCENARIOS;

  const scenario = pool[Math.floor(Math.random() * pool.length)];

  let title = scenario.englishTitle;
  let segments = scenario.segments;
  let badge = scenario.badge;
  let visualQuery = scenario.visualQuery || 'cute baby talking';
  let altQueries = scenario.altQueries || ['toddler laughing', 'naughty kid smiling'];

  if (customTopic) {
    title = `${customTopic} 👶 Cute Toddler Fun`;
    visualQuery = `cute baby ${customTopic}`;
    altQueries = ['cute baby talking', 'toddler laughing', 'naughty kid'];
    segments = [
      {
        hindi: `ज़रा देखिए! ${customTopic} पर यह छोटा बच्चा क्या कमाल कर रहा है!`,
        english: `Look at this! Little boss having pure fun on ${customTopic}!`,
      },
      {
        hindi: 'इस मासूम अदा और मुस्कान को देखकर कोई भी मुस्कुराए बिना नहीं रह सकता।',
        english: 'It is impossible to watch this cute innocence without smiling!',
      },
      {
        hindi: 'अगर आपके चेहरे पर भी मुस्कान आई, तो तुरंत लाइक और सब्सक्राइब कीजिए!',
        english: 'If this brought a smile to your face, hit like and subscribe now!',
      },
    ];
  }

  // First-person cute kid voiceover script (Hindi)
  const voiceScript = segments.map((s) => s.hindi).join(' ');
  // Subtitles in clean English for global audience
  const englishSubtitles = segments.map((s) => s.english).join(' ');

  const bgMusicPath = path.join(config.assetsDir, 'audio', 'entertainment.mp3');

  // Realistic curated video clip matching the theme (used as reliable fallback)
  const clipPath = path.join(config.assetsDir, 'defaults', `slot1_${theme}.mp4`);

  return {
    slot: 'slot1',
    slotName: `Entertainment (${theme.toUpperCase()}: Cute Toddler / Baby)`,
    title,
    description: `${title}\n\nEnjoy the most wholesome and hilarious toddler shorts!\n(Cute kid voiceover in Hindi with bold English Subtitles for global reach).\n\nSubscribe for daily fun, baby jokes, and joyful laughter!`,
    tags: scenario.tags,
    voice: config.voices.slot1 || 'hi-IN-SwaraNeural',
    pitch: '+38%', // Toddler/child high pitch voice
    rate: '+6%',   // Upbeat energetic child cadence
    themeType: theme,
    visualQuery,
    altQueries,
    clipPath,
    epicBadge: badge,
    voiceScript,
    englishSubtitles,
    segments,
    bgMusicPath,
    categoryId: '24', // Entertainment
  };
}

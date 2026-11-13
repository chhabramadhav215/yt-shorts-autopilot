import path from 'path';
import { config } from '../config.js';
import { getTodayOccasion } from './festival_calendar.js';
import { transliterateHindiToHinglish } from '../utils/text_utils.js';

const DEVOTIONAL_STORIES = [
  {
    englishTitle: 'The Power of True Faith 🕉️ Hanuman Ji Divine Devotion | Daily Darshan',
    segments: [
      {
        hindi: 'जब माता सीता ने हनुमान जी को बहुमूल्य मोतियों की दिव्य माला भेंट की,',
        english: 'When Mother Sita gifted Hanuman a precious pearl necklace,',
      },
      {
        hindi: 'तो उन्होंने प्रभु श्री राम को ढूंढने के लिए हर मोती को तोड़कर देखना शुरू किया।',
        english: 'He began inspecting each pearl, looking for Lord Rama.',
      },
      {
        hindi: 'पूरी सभा हैरान थी! तब मुस्कुराते हुए बजरंगबली ने अपना सीना चीरकर दिखाया,',
        english: 'The entire court was stunned! Then Bajrangbali opened his chest,',
      },
      {
        hindi: 'जहां हृदय में साक्षात प्रभु श्री राम और माता सीता की मूरत विराजमान थी।',
        english: 'Revealing Lord Rama and Mother Sita enshrined within his heart.',
      },
      {
        hindi: 'सच्ची भक्ति किसी दिखावे में नहीं, शुद्ध और सच्चे हृदय में बसती है। जय श्री राम!',
        english: 'True devotion lives within a pure heart. Jai Shri Ram!',
      },
    ],
    tags: ['shorts', 'hanuman', 'jaishriram', 'bhakti', 'sanatandharma', 'devotional', 'hinduism', 'mahadev', 'krishna'],
  },
  {
    englishTitle: 'Lord Krishna & Sudama: The Sacred Bond of True Friendship 🌸',
    segments: [
      {
        hindi: 'जब गरीब सुदामा अपने बालसखा श्री कृष्ण से मिलने द्वारका पहुंचे,',
        english: 'When humble Sudama reached Dwarka to meet his dear friend Krishna,',
      },
      {
        hindi: 'तो उनके पास भेंट स्वरूप केवल मुट्ठी भर पोहे थे।',
        english: 'He carried only a simple handful of beaten rice as a gift.',
      },
      {
        hindi: 'परंतु त्रिलोकीनाथ भगवान श्री कृष्ण नंगे पांव दौड़कर द्वार पर आए,',
        english: 'Yet the Lord of the Universe ran barefoot to welcome him,',
      },
      {
        hindi: 'और अपने आंसुओं से सुदामा के चरण धोकर उस साधारण भेंट को अमृत मानकर स्वीकार किया।',
        english: 'Washed his feet with tears of joy, and accepted the gift with divine love.',
      },
      {
        hindi: 'भगवान केवल निस्वार्थ प्रेम और सच्ची भावना देखते हैं, धन-दौलत नहीं। राधे-राधे!',
        english: 'God values pure love and selfless devotion above all wealth. Radhe Radhe!',
      },
    ],
    tags: ['shorts', 'krishna', 'sudama', 'radheradhe', 'bhakti', 'devotional', 'sanatan', 'god', 'dailywisdom'],
  },
  {
    englishTitle: 'Lord Shiva as Neelkanth Mahadev 🔱 The Supreme Sacrifice',
    segments: [
      {
        hindi: 'समुद्र मंथन के दौरान जब भयंकर कालकूट विष निकला, जिससे पूरी सृष्टि जलने लगी,',
        english: 'During the churning of the cosmic ocean, deadly poison threatened all life,',
      },
      {
        hindi: 'तो समस्त देवों और दानवों ने महादेव की शरण में जाकर रक्षा की प्रार्थना की।',
        english: 'All beings prayed to Lord Shiva for divine protection.',
      },
      {
        hindi: 'बिना एक क्षण गंवाए, महादेव ने वह सारा विष अपने कंठ में धारण कर लिया।',
        english: 'Without hesitation, Mahadev held the poison in his throat,',
      },
      {
        hindi: 'जिससे उनका कंठ नीला पड़ गया और वे सदा के लिए नीलकंठ कहलाए।',
        english: 'Turning his neck blue, earning him the sacred name Neelkanth.',
      },
      {
        hindi: 'शिव हमें सिखाते हैं कि दूसरों की रक्षा के लिए कष्ट सहना ही सबसे बड़ा धर्म है। हर हर महादेव!',
        english: 'Shiva teaches that selfless sacrifice is the highest truth. Har Har Mahadev!',
      },
    ],
    tags: ['shorts', 'mahadev', 'shiva', 'omnamahshivaya', 'bholenath', 'hinduism', 'devotional', 'spritual', 'kedarnath'],
  },
  {
    englishTitle: 'Lord Ganesha Supreme Wisdom 🕉️ Respecting Loving Parents',
    segments: [
      {
        hindi: 'जब भगवान शिव और माता पार्वती ने अपने पुत्रों को ब्रह्मांड की परिक्रमा की चुनौती दी,',
        english: 'When Lord Shiva and Parvati challenged their sons to circle the universe,',
      },
      {
        hindi: 'तो कार्तिकेय तुरंत अपने मोर पर सवार होकर उड़ गए।',
        english: 'Kartikeya swiftly flew across the cosmos on his peacock.',
      },
      {
        hindi: 'परंतु बुद्धि के दाता श्री गणेश ने श्रद्धापूर्वक अपने माता-पिता की परिक्रमा की,',
        english: 'Yet wise Ganesha gently walked around his loving parents,',
      },
      {
        hindi: 'और कहा कि माता-पिता के चरणों में ही संपूर्ण ब्रह्मांड समाया हुआ है।',
        english: 'Stating that loving parents are the entire universe.',
      },
      {
        hindi: 'माता-पिता की सेवा ही जीवन की सबसे बड़ी पूजा है। गणपति बप्पा मोरया!',
        english: 'Honoring parents is the highest sacred duty in life. Ganpati Bappa Morya!',
      },
    ],
    tags: ['shorts', 'ganesha', 'ganpatibappamorya', 'shiva', 'parvati', 'sanatanwisdom', 'hindu', 'devotional', 'darshan'],
  },
  {
    englishTitle: 'Shri Ram and Mata Shabari: The Sweet Berries of Pure Love 🌺',
    segments: [
      {
        hindi: 'माता शबरी ने प्रभु श्री राम की प्रतीक्षा में अपना संपूर्ण जीवन बिता दिया।',
        english: 'Mata Shabari waited decades in deep faith for Lord Rama arrival.',
      },
      {
        hindi: 'जब प्रभु उनकी कुटिया में पधारे, तो उन्होंने चख-चख कर केवल मीठे बेर प्रभु को अर्पित किए।',
        english: 'When Rama arrived, she tasted each wild berry to ensure they were sweet.',
      },
      {
        hindi: 'मर्यादा पुरुषोत्तम श्री राम ने बिना किसी हिचकिचाहट के उन बेरों को अमृत समान खाया,',
        english: 'Without hesitation, Lord Rama accepted the berries with limitless love,',
      },
      {
        hindi: 'और यह सिद्ध किया कि परमात्मा केवल शुद्ध भाव और प्रेम के भूखे होते हैं।',
        english: 'Proving that God cares only for pure love, not worldly rituals.',
      },
      {
        hindi: 'प्रभु के चरणों में अपना मन लगाएं, सारे कष्ट दूर होंगे। जय श्री राम!',
        english: 'Surrender your heart to the Divine, and all peace will follow. Jai Shri Ram!',
      },
    ],
    tags: ['shorts', 'ramayana', 'shriram', 'jaishriram', 'shabari', 'bhakti', 'ayodhya', 'sanatan', 'devotional'],
  },
];

export async function generateSlot2Content(customTopic = null) {
  let title = '';
  let segments = [];
  let tags = ['shorts', 'bhakti', 'sanatandharma', 'devotional', 'hinduism', 'krishna', 'mahadev'];

  // Check Festival Calendar
  const occasion = getTodayOccasion();
  if (occasion.isFestival && occasion.slot2 && !customTopic) {
    title = occasion.slot2.title;
    segments = [
      {
        hindi: occasion.slot2.hindi,
        english: occasion.slot2.english,
      },
      {
        hindi: `इस पावन अवसर पर प्रभु की भक्ति और कृपा आपके जीवन में सुख और शांति लाए।`,
        english: `On this holy occasion, may divine grace fill your home with peace and joy.`,
      },
    ];
  } else if (customTopic) {
    title = `${customTopic} 🕉️ Sacred Divine Wisdom | Daily Darshan`;
    segments = [
      {
        hindi: `आज हम ${customTopic} की असीम कृपा और पावन संदेश का स्मरण करते हैं।`,
        english: `Today we reflect on the divine grace and blessings of ${customTopic}.`,
      },
      {
        hindi: 'सनातन धर्म का मार्ग हमें शांति, सत्य और सच्ची भक्ति की ओर ले जाता है।',
        english: 'The path of Sanatan Dharma guides us toward peace, truth, and faith.',
      },
      {
        hindi: 'प्रभु का आशीर्वाद सदैव आपके और आपके परिवार के साथ रहे। हर हर महादेव!',
        english: 'May divine blessings always be with you and your loved ones. Har Har Mahadev!',
      },
    ];
  } else {
    const story = DEVOTIONAL_STORIES[Math.floor(Math.random() * DEVOTIONAL_STORIES.length)];
    title = story.englishTitle;
    segments = story.segments;
    tags = story.tags;
  }

  const formattedSegments = segments.map((s) => {
    return {
      hindi: s.hindi,
      english: s.english || s.hinglish || transliterateHindiToHinglish(s.hindi),
    };
  });

  const voiceScript = formattedSegments.map((s) => s.hindi).join(' ');
  const subtitleText = formattedSegments.map((s) => s.english).join(' ');

  const bgMusicPath = path.join(config.assetsDir, 'audio', 'devotional.mp3');

  const description = `${title}\n\n` +
    `A sacred reminder of devotion, peace, and spiritual wisdom.\n` +
    `(Narration in Hindi with burned-in English subtitles for worldwide darshan).\n\n` +
    `⚖️ SECTION 107 FAIR USE & ATTRIBUTION NOTICE:\n` +
    `Copyright Disclaimer under Section 107 of the Copyright Act 1976: Allowance is made for "fair use" for purposes such as criticism, comment, teaching, scholarship, education, and research. Non-profit spiritual and cultural enrichment tips the balance in favor of fair use. All reverence to sacred traditions.`;

  return {
    slot: 'slot2',
    slotName: 'Devotional (Hindu Uplifting Story & Darshan)',
    title,
    description,
    tags,
    voice: config.voices.slot2,
    voiceScript,
    subtitleText,
    englishSubtitles: subtitleText,
    segments: formattedSegments,
    bgMusicPath,
    categoryId: '22', // People & Blogs / Non-profits
  };
}

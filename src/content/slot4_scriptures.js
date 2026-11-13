import path from 'path';
import fs from 'fs';
import { config } from '../config.js';
import { getTodayOccasion, getRotationIndex } from './festival_calendar.js';
import { fetchScriptureClip } from '../utils/media_fetcher.js';

export const SCRIPTURES_EPICS = [
  {
    id: 'geeta_saar',
    clipFilename: 'geeta_saar.mp4',
    englishTitle: "Krishna's Supreme Lesson To Arjuna 🕉️ Bhagavad Gita Wisdom | Mahabharata",
    epic: 'Bhagavad Gita / Mahabharata',
    dialogueTheme: 'Krishna-Arjun Samvaad (Karma Yoga / Geeta Saar)',
    shlokSanskrit: 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन।\nमा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि॥',
    shlokEnglish: 'Karmanye Vadhikaraste Ma Phaleshu Kadachana...',
    introDuration: 0,
    moralSummary: 'Focus on your prescribed duty without anxiety over outcomes; duty is supreme.',
    attribution: 'Shrimad Bhagavad Gita Chapter 2, Verse 47 | Sage Ved Vyasa',
    segments: [
      {
        hindi: 'कुरुक्षेत्र के भीषण मैदान में जब अर्जुन मोह और शोक में डूब गए, तब भगवान श्री कृष्ण ने उन्हें कर्म का अमर संदेश दिया।',
        english: 'When Arjuna fell into despair on the battlefield of Kurukshetra, Lord Krishna revealed eternal truth.',
      },
      {
        hindi: 'श्री कृष्ण ने कहा कि तुम्हारा अधिकार केवल निष्ठापूर्वक कर्म करने पर है, उसके फलों पर कभी नहीं।',
        english: 'Krishna declared that your right is to perform your duties, never to obsess over results.',
      },
      {
        hindi: 'परिणाम की चिंता छोड़कर अपने कर्तव्य को पूरी शक्ति से निभाएं, सच्ची विजय स्वतः आपकी होगी।',
        english: 'Release anxiety over outcomes, perform your duty with pure intent, and righteous victory will follow.',
      },
    ],
    tags: ['shorts', 'bhagavadgita', 'krishna', 'arjuna', 'mahabharata', 'geetasaar', 'karmayoga', 'hinduism', 'wisdom'],
  },
  {
    id: 'bhishma_pratigya',
    clipFilename: 'bhishma_pratigya.mp4',
    englishTitle: 'The Supreme Sacrifice: Bhishma Pratigya 🔱 Mahabharata Epic Wisdom',
    epic: 'Mahabharata (Adi Parva)',
    dialogueTheme: 'Devavrata The Terrible Vow (Bhishma Pratigya)',
    shlokSanskrit: 'अद्यप्रभृति मे दाश ब्रह्मचर्यं भविष्यति।\nअपुत्रस्यापि मे लोका भविष्यन्त्यक्षया दिवि॥',
    shlokEnglish: 'From this day forth, I embrace lifelong celibacy for my father happiness...',
    introDuration: 0,
    moralSummary: 'Honoring parents and upholding a righteous vow transcends all worldly desires.',
    attribution: 'Mahabharata by Sage Ved Vyasa | Respectful Transformative Educational Commentary',
    segments: [
      {
        hindi: 'महाभारत का इतिहास गवाह है देवव्रत की उस कठोर प्रतिज्ञा का, जिसने उन्हें पितामह भीष्म बना दिया।',
        english: 'History stands witness to Devavrata sacred vow that transformed him into Grandfather Bhishma.',
      },
      {
        hindi: 'अपने पिता महाराज शांतनु के सुख के लिए उन्होंने आजीवन ब्रह्मचर्य और हस्तिनापुर के सिंहासन का त्याग कर दिया।',
        english: 'For his father happiness, he renounced the golden throne and took a lifelong vow of celibacy.',
      },
      {
        hindi: 'यह दृश्य हमें सिखाता है कि माता-पिता के सम्मान और सत्य के लिए दिया गया बलिदान सदा अमर रहता है।',
        english: 'This epic moment teaches that sacrifice for parents and upholding honor echoes through eternity.',
      },
    ],
    tags: ['shorts', 'mahabharata', 'bhishma', 'bhishmapratigya', 'epicwisdom', 'dharma', 'sanatan', 'sacrifice'],
  },
  {
    id: 'karna_daan',
    clipFilename: 'karna_daan.mp4',
    englishTitle: "The Greatest Giver: Karna's Divine Sacrifice 🏹 Mahabharata Wisdom",
    epic: 'Mahabharata (Vana Parva)',
    dialogueTheme: 'Daanveer Karna (Kavach Kundal Daan)',
    shlokSanskrit: 'न मे भीतिः कुतश्चास्ति न मया विरतो यशः।\nकवचं कुण्डले चैव प्रयच्छामि सुरेश्वर॥',
    shlokEnglish: 'I have no fear of death, nor shall my glory ever fade; take my divine armor...',
    introDuration: 0,
    moralSummary: 'True generosity never wavers, even when one own survival is on the line.',
    attribution: 'Mahabharata Epic Tradition | Philosophical Analysis & Moral Study',
    segments: [
      {
        hindi: 'दानवीर कर्ण जानते थे कि उनके दिव्य कवच और कुंडल ही उनकी जीवन रक्षा का एकमात्र साधन थे।',
        english: 'Daanveer Karna knew his divine armor and earrings were the only shield safeguarding his mortal life.',
      },
      {
        hindi: 'फिर भी जब देवराज इंद्र भिक्षुक बनकर आए, तो कर्ण ने मुस्कुराते हुए अपने अमर कवच को दान कर दिया।',
        english: 'Yet when Lord Indra came disguised as a beggar, Karna smilingly surrendered his invincible armor.',
      },
      {
        hindi: 'सच्ची उदारता वही है जो संकट के समय भी दूसरों की सहायता से पीछे न हटे। कर्ण का नाम आज भी अमर है।',
        english: 'True nobility never refuses an earnest seeker even in the face of death; Karna name lives on forever.',
      },
    ],
    tags: ['shorts', 'karna', 'daanveerkarna', 'mahabharata', 'epicdialogue', 'generosity', 'karma', 'dharma'],
  },
  {
    id: 'hanuman_ravana',
    clipFilename: 'hanuman_ravana.mp4',
    englishTitle: 'Hanuman Fearless Dialogue Before Ravana 🕉️ Ramayana Wisdom',
    epic: 'Valmiki Ramayana (Sundara Kanda)',
    dialogueTheme: 'Hanuman Ji in the Court of Lanka',
    shlokSanskrit: 'रामनामांकितं चापि इदं पश्य मया कृतम्।\nकुरु धर्मं समासाद्य मा गा रावण संक्षयम्॥',
    shlokEnglish: 'Heed the sacred message of Shri Rama, turn to Dharma before total destruction arrives...',
    introDuration: 0,
    moralSummary: 'Righteousness fears no tyrant; arrogance always leads to self-destruction.',
    attribution: 'Valmiki Ramayana | Reverent Cultural & Moral Commentary under Fair Use',
    segments: [
      {
        hindi: 'जब लंका के स्वर्ण दरबार में रावण ने अपने अहंकार का प्रदर्शन किया, तब वीर हनुमान निर्भय होकर बोले।',
        english: 'When Ravana boasted in his golden court of Lanka, fearless Hanuman stood tall with unshakable courage.',
      },
      {
        hindi: 'हनुमान जी ने रावण को चेतावनी दी कि अधर्म और पराई स्त्री के हरण का परिणाम निश्चित विनाश ही होता है।',
        english: 'Hanuman warned that arrogance, greed, and abducting another wife leads only to absolute ruin.',
      },
      {
        hindi: 'सत्य और धर्म के मार्ग पर चलने वाले को किसी शक्ति का भय नहीं होता। जय श्री राम!',
        english: 'One who walks the righteous path of truth fears no earthly tyrant. Jai Shri Ram!',
      },
    ],
    tags: ['shorts', 'ramayana', 'hanuman', 'jaishriram', 'ravana', 'sundarkand', 'fearless', 'dharma'],
  },
  {
    id: 'ram_rajya',
    clipFilename: 'ramayana_rama.mp4',
    englishTitle: 'The Eternal Ideal of Ram Rajya 🏹 Valmiki Ramayana Wisdom',
    epic: 'Valmiki Ramayana (Yuddha Kanda)',
    dialogueTheme: 'Shri Ram Coronation & Ideal Governance (Ram Rajya)',
    shlokSanskrit: 'रामो विग्रहवान् धर्मः साधुः सत्यपराक्रमः।\nराजा सर्वस्य लोकस्य देवानामिव वासवः॥',
    shlokEnglish: 'Rama is the very embodiment of Dharma, righteous and truthful in valor...',
    introDuration: 0,
    moralSummary: 'True leadership serves all with justice, compassion, and unwavering adherence to truth.',
    attribution: 'Valmiki Ramayana | Reverent Cultural & Moral Commentary under Fair Use',
    segments: [
      {
        hindi: 'श्री राम का संपूर्ण जीवन हमें सिखाता है कि एक आदर्श राजा और मनुष्य का कर्तव्य क्या होता है।',
        english: 'The noble life of Shri Rama teaches humanity the supreme ideal of righteousness and duty.',
      },
      {
        hindi: 'रामराज्य का अर्थ है ऐसा समाज जहाँ न्याय, करुणा और सत्य की विजय हो, और किसी के साथ अन्याय न हो।',
        english: 'Ram Rajya represents a society where justice, compassion, and divine truth reign supreme for all.',
      },
      {
        hindi: 'जब नेतृत्व निस्वार्थ सेवा बन जाता है, तभी समाज में शांति और समृद्धि का वास होता है। जय श्री राम!',
        english: 'When governance becomes pure selfless service, enduring peace and divine harmony flourish. Jai Shri Ram!',
      },
    ],
    tags: ['shorts', 'ramayana', 'shriram', 'ramrajya', 'dharma', 'jaishriram', 'sanatandharma', 'wisdom'],
  },
  {
    id: 'vishwaroop_darshan',
    clipFilename: 'vishwaroop_darshan.mp4',
    englishTitle: 'The Cosmic Vision of Krishna 🕉️ Vishwaroop Darshan | Bhagavad Gita',
    epic: 'Bhagavad Gita Chapter 11',
    dialogueTheme: 'Lord Krishna Universal Cosmic Manifestation',
    shlokSanskrit: 'कालोऽस्मि लोकक्षयकृत्प्रवृद्धो लोकान्समाहर्तुमिह प्रवृत्ततः।',
    shlokEnglish: 'I am mighty Time, the source of destruction and renewal of all cosmic worlds...',
    introDuration: 0,
    moralSummary: 'Time conquers all mortal pride; surrender ego and fulfill your cosmic destiny.',
    attribution: 'Shrimad Bhagavad Gita | Spiritual & Philosophical Darshan Analysis',
    segments: [
      {
        hindi: 'जब भगवान श्री कृष्ण ने अर्जुन को अपना विराट विश्वरूप दिखाया, तो संपूर्ण ब्रह्मांड उनके भीतर समाया दिखा।',
        english: 'When Lord Krishna unveiled His infinite cosmic form to Arjuna, the entire universe was revealed within Him.',
      },
      {
        hindi: 'प्रभु ने कहा: कालोऽस्मि लोकक्षयकृत्प्रवृद्धो। मैं संपूर्ण लोकों का संहार करने वाला महाकाल हूँ।',
        english: 'The Lord proclaimed: I am mighty all-consuming Time, the mover and transformer of every world.',
      },
      {
        hindi: 'यह दृश्य हमें याद दिलाता है कि समय सबसे बलवान है। विनम्र रहें और ईश्वर की इच्छा को पहचानें।',
        english: 'This revelation teaches that Time reigns supreme. Cultivate humility and align with Dharma.',
      },
    ],
    tags: ['shorts', 'krishna', 'vishwaroop', 'bhagavadgita', 'cosmicvision', 'hinduism', 'spiritual', 'god'],
  },
];

export async function generateSlot4Content(customTopic = null) {
  let title = '';
  let segments = [];
  let moral = '';
  let attribution = '';
  let shlokSanskrit = '';
  let shlokEnglish = '';
  let introDuration = 0;
  let clipPath = null;
  let epicBadge = 'MAHABHARATA & GITA WISDOM';

  // 1. Check Festival Calendar First
  const occasion = getTodayOccasion();
  if (occasion.isFestival && occasion.slot4 && !customTopic) {
    const fest = occasion.slot4;
    title = fest.title;
    moral = fest.moral;
    attribution = fest.epic;
    shlokSanskrit = fest.shlokSanskrit;
    shlokEnglish = fest.shlokEnglish;
    epicBadge = occasion.name.toUpperCase();
    segments = [
      {
        hindi: fest.hindi,
        english: fest.english,
      },
      {
        hindi: `इस पावन पर्व पर यह संदेश हमें धर्म और सच्चाई के मार्ग पर अडिग रहने की प्रेरणा देता है।`,
        english: `On this auspicious occasion, this sacred message inspires us to stand firm in Dharma.`,
      },
    ];
  } else if (customTopic) {
    title = `${customTopic} 🕉️ Epic Scripture Wisdom | Mahabharata & Ramayana`;
    moral = `Reflecting on the timeless moral teaching of ${customTopic}.`;
    attribution = `Sacred Indian Epics | Transformative Commentary`;
    shlokSanskrit = `ॐ धर्मो रक्षति रक्षितः। सत्यमेव जयते नानृतम्॥`;
    shlokEnglish = `Dharma protects those who protect Dharma. Truth alone triumphs...`;
    segments = [
      {
        hindi: `आज हम ${customTopic} के उस ऐतिहासिक और प्रेरक प्रसंग को याद करते हैं जो हमें जीवन की दिशा दिखाता है।`,
        english: `Today we examine the historic and inspirational scene of ${customTopic} that illuminates our life path.`,
      },
      {
        hindi: `सनातन शास्त्रों का प्रत्येक संवाद हमें धर्म, सत्य और निष्ठा की सबसे ऊंची सीख देता है।`,
        english: `Every scripture dialogue offers profound guidance on righteousness, truth, and duty.`,
      },
      {
        hindi: `इस पावन संदेश को अपने जीवन में उतारें और धर्म के मार्ग पर अडिग रहें। हर हर महादेव! जय श्री राम!`,
        english: `Embrace this sacred wisdom in daily life and stand firm in Dharma. Har Har Mahadev! Jai Shri Ram!`,
      },
    ];
  } else {
    // Normal day: Rotate sequentially with zero repeats
    const index = getRotationIndex(SCRIPTURES_EPICS.length, 'slot4');
    const item = SCRIPTURES_EPICS[index];
    title = item.englishTitle;
    segments = item.segments;
    moral = item.moralSummary;
    attribution = item.attribution;
    shlokSanskrit = item.shlokSanskrit;
    shlokEnglish = item.shlokEnglish;
    introDuration = item.introDuration || 0;
    epicBadge = item.epic.toUpperCase();

    // Automatically resolve or slice high-quality scripture video clip
    clipPath = await fetchScriptureClip(item);
  }

  // Ensure clip exists for festival or customTopic
  if (!clipPath) {
    clipPath = await fetchScriptureClip({
      dialogueTheme: customTopic || title,
      englishTitle: title,
      epic: epicBadge,
      clipFilename: `${(customTopic || title).toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 20)}.mp4`,
    });
  }

  const voiceScript = segments.map((s) => s.hindi).join(' ');
  const subtitleText = segments.map((s) => s.english).join(' ');

  // Comprehensive Transformative Fair Use, Moral Takeaway, and Section 107 Disclaimer
  const description = `${title}\n\n` +
    `🕉️ MORAL & PHILOSOPHICAL LESSON:\n` +
    `• ${moral}\n\n` +
    `📜 SCRIPTURE REFERENCE & CONTEXT:\n` +
    `• Source: ${attribution}\n` +
    `• Audio: Transformative Hindi philosophical commentary with English burned-in subtitles, set to sacred devotional instrumental music.\n\n` +
    `⚖️ SECTION 107 FAIR USE & ATTRIBUTION DISCLAIMER:\n` +
    `Copyright Disclaimer under Section 107 of the Copyright Act 1976: Allowance is made for "fair use" for purposes such as criticism, comment, news reporting, teaching, scholarship, education, and research. Fair use is a use permitted by copyright statute that might otherwise be infringing. Non-profit, educational, or personal spiritual use tips the balance in favor of fair use. All reverent attribution belongs to original literary epics and copyright holders.`;

  const bgMusicPath = path.join(config.assetsDir, 'audio', 'scriptures.mp3');

  return {
    slot: 'slot4',
    slotName: 'Epic Hindu Scriptures & Wisdom Clips (Mahabharata & Ramayana)',
    title,
    description,
    tags: [
      'shorts', 'mahabharata', 'ramayana', 'bhagavadgita', 'krishna', 'dharma',
      'sanatandharma', 'geetasaar', 'wisdom', 'dailywisdom', 'epicshorts'
    ],
    voice: config.voices.slot4 || config.voices.slot2,
    voiceScript,
    subtitleText,
    englishSubtitles: subtitleText,
    segments,
    shlokSanskrit,
    shlokEnglish,
    introDuration: 0,
    isDualAudio: false,
    bgMusicPath,
    clipPath,
    epicBadge,
    categoryId: '22', // People & Blogs / Education
  };
}

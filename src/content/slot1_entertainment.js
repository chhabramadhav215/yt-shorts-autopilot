import path from 'path';
import fs from 'fs';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { getSlot1AudioBeds } from '../utils/audio_beds.js';

const TRACKER_PATH = path.join(config.assetsDir, 'history_tracker.json');

// Diverse, creative concepts list to prompt Gemini or cycle procedurally
const DIVERSE_CONCEPTS = [
  'baby tasting lemon sour face reaction',
  'cute baby dancing to funky beats',
  'toddler playing with cute puppy and teaching tricks',
  'baby having serious babbling conversation with reflection in mirror',
  'toddler caught eating chocolate cake with red hands',
  'cute baby laughing hysterically at peek-a-boo',
  'toddler wearing dad giant shoes walking funny',
  'baby tasting ice cream brain-freeze surprise',
  'toddler explaining why toys belong on the floor',
  'baby trying to feed french fry to stuffed teddy bear',
  'toddler negotiating bedtime like a master CEO',
  'baby playing with floating soap bubbles in bathtub',
  'toddler trying to sing baby shark with gibberish words',
  'baby discovering own toes and being utterly amazed',
  'toddler convinced pet cat speaks hindi',
  'baby hearing loud sneeze and dramatic jump reaction',
  'toddler pretending to sleep when mum walks in',
  'doctor uncle tiny injection and dinosaur ant mystery',
  'mummy instagram scrolling vs baby phone screen time rules',
  'baby tasting watermelon and loving the sweet juice',
];

// Rich library of 18+ distinct procedural scenarios for non-repeating fallback
const EXPANDED_SCENARIOS = [
  {
    concept: 'lemon_taste',
    badge: 'LEMON TASTE TEST 🍋',
    englishTitle: 'Baby Tastes Lemon For The First Time! 👶🍋 Funny Reaction',
    visualQuery: 'baby tasting lemon funny',
    altQueries: ['cute baby sour face', 'funny baby tasting', 'toddler laughing'],
    segments: [
      {
        hindi: 'मम्मी ने बोला कि ये मीठी पीली कैंडी है!',
        english: 'Mummy said this is a sweet yellow candy...',
      },
      {
        hindi: 'जैसे ही मैंने जीभ लगाई, मेरी पूरी बत्तीसी हिल गई!',
        english: 'The moment I licked it, my whole face got twisted!',
      },
      {
        hindi: 'अरे बाप रे! क्या इसमें बिजली का झटका लगा हुआ था?!',
        english: 'Oh my goodness! Was this wired with electric shock?!',
      },
      {
        hindi: 'मेरा खट्टा चेहरा देखकर हंसी आई तो तुरंत लाइक और सब्सक्राइब करो!',
        english: 'If my sour face made you laugh, hit like and subscribe now!',
      },
    ],
    tags: ['shorts', 'babytastinglemon', 'sourface', 'funnybaby', 'cutebaby', 'toddlerreaction', 'viralcomedy', 'fyp'],
  },
  {
    concept: 'puppy_buddy',
    badge: 'TODDLER & PUPPY BUDDY 🐶',
    englishTitle: 'Toddler Trying To Train Pet Puppy! 👶🐶 Boss In Action',
    visualQuery: 'toddler playing with dog',
    altQueries: ['cute baby puppy playing', 'toddler with dog laughing', 'cute baby playing'],
    segments: [
      {
        hindi: 'आज मैं हमारे टॉमी को स्पेशल कमांड सिखा रहा हूँ!',
        english: 'Today I am training our puppy Tommy with special commands!',
      },
      {
        hindi: 'मैंने कहा सिट! लेकिन वो उल्टा मेरे बिस्किट पर ही झपट पड़ा!',
        english: 'I said SIT! But he jumped right at my biscuit instead!',
      },
      {
        hindi: 'लगता है इस घर में ट्रेनिंग की ज़रूरत टॉमी को नहीं, मुझे ही है!',
        english: 'Looks like in this house, I am the one getting trained!',
      },
      {
        hindi: 'अगर आपको भी पपीज़ प्यारे लगते हैं तो कमेंट में रेड हार्ट भेजो!',
        english: 'Drop red hearts in the comments if you love cute puppies too!',
      },
    ],
    tags: ['shorts', 'babyandpuppy', 'cutepet', 'toddlerhumor', 'funnyanimals', 'innocence', 'cutebaby'],
  },
  {
    concept: 'dance_groove',
    badge: 'BABY DANCE GROOVE 🕺',
    englishTitle: 'DJ Turn The Beat Up! 👶🕺 Little Boss On The Floor | Viral Baby Dance',
    visualQuery: 'toddler dancing funny',
    altQueries: ['cute baby dancing', 'baby grooving music', 'toddler dancing happy'],
    segments: [
      {
        hindi: 'अरे डीजे भैया, थोड़ा वॉल्यूम तो बढ़ाओ!',
        english: 'Hey DJ Bhaiya, turn up the volume right now!',
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
    concept: 'mirror_convo',
    badge: 'MIRROR BABY MYSTERY 🪞',
    englishTitle: 'Baby Discovers Reflection In Mirror! 👶🪞 Serious Conversation',
    visualQuery: 'baby looking in mirror laughing',
    altQueries: ['cute baby reflection', 'toddler mirror funny', 'baby talking mirror'],
    segments: [
      {
        hindi: 'शीशे में एक बहुत ही स्मार्ट बच्चा मुझे लगातार घूर रहा है!',
        english: 'There is an extremely smart baby staring right at me in the mirror!',
      },
      {
        hindi: 'जब मैं हंसता हूँ तो वो भी हंसता है, जब मैं चिढ़ाता हूँ तो वो भी चिढ़ाता है!',
        english: 'When I laugh he laughs, when I make faces he copies me!',
      },
      {
        hindi: 'अरे भाई, क्या तू मेरी ही ज़ेरॉक्स कॉपी है? कुछ तो बोल!',
        english: 'Hey buddy, are you my xerox copy or what? Say something!',
      },
      {
        hindi: 'देखा छोटा जासूस! रोज़ाना ऐसी मस्ती के लिए सब्सक्राइब करो!',
        english: 'Look at the little detective! Subscribe for daily toddler fun!',
      },
    ],
    tags: ['shorts', 'babyinmirror', 'cutebaby', 'toddlercuriosity', 'funnyreaction', 'wholesome', 'fyp'],
  },
  {
    concept: 'chocolate_busted',
    badge: 'CHOCOLATE HEIST 🍫',
    englishTitle: 'Caught Red Handed With Chocolate! 👶🍫 Toddler Logic',
    visualQuery: 'baby eating chocolate messy face',
    altQueries: ['naughty kid smiling chocolate', 'cute baby messy eating', 'toddler laughing sneakily'],
    segments: [
      {
        hindi: 'मम्मी ने पूछा फ्रिज की चॉकलेट किसने खत्म की?',
        english: 'Mummy asked who finished the chocolate in the fridge...',
      },
      {
        hindi: 'मैंने मासूम चेहरा बनाकर कहा मुझे तो कुछ भी नहीं पता!',
        english: 'I made an innocent face and said I know nothing about it!',
      },
      {
        hindi: 'वो तो बाद में पता चला कि पूरा मुंह चॉकलेट से रंगा हुआ था!',
        english: 'Only later did I realize my whole face was covered in chocolate!',
      },
      {
        hindi: 'चोरी पकड़ी गई! अगर आप भी चॉकलेट लवर हैं तो लाइक ठोक दो!',
        english: 'Busted! Hit like if you are a certified chocolate lover too!',
      },
    ],
    tags: ['shorts', 'chocolatelovers', 'bustedbaby', 'toddlerheist', 'cutecomedy', 'funnybaby', 'explore'],
  },
  {
    concept: 'peekaboo_laugh',
    badge: 'PEEK-A-BOO LAUGHTER 😂',
    englishTitle: 'Baby Can’t Stop Laughing At Peek-a-Boo! 👶😂 Pure Happiness',
    visualQuery: 'baby laughing hysterically',
    altQueries: ['cute baby giggling', 'toddler laughing uncontrollably', 'happy baby smiling'],
    segments: [
      {
        hindi: 'पापा ने अपना चेहरा हाथों से छुपाया और बोले पीकाबू!',
        english: 'Papa hid his face behind his hands and shouted PEEK-A-BOO!',
      },
      {
        hindi: 'मुझे इतनी हंसी आ रही है कि हंसते-हंसते लोटपोट हो गया!',
        english: 'I am laughing so hard I cannot even sit straight!',
      },
      {
        hindi: 'पापा को लगता है वो जादूगर हैं, पर मुझे तो उनकी शक्ल पर हंसी आ रही है!',
        english: 'Papa thinks he did magic, but I am just laughing at his funny face!',
      },
      {
        hindi: 'ये प्यारी मुस्कान अपने दोस्तों को शेयर करो और सब्सक्राइब करो!',
        english: 'Share this innocent smile with your friends and hit subscribe!',
      },
    ],
    tags: ['shorts', 'babylaughing', 'peekaboo', 'purehappiness', 'cutebaby', 'joyful', 'wholesome'],
  },
  {
    concept: 'dad_big_shoes',
    badge: 'BIG DAD SHOES 👟',
    englishTitle: 'Toddler Wearing Dad’s Giant Shoes! 👶👟 Big Boss Walk',
    visualQuery: 'toddler wearing big shoes funny',
    altQueries: ['cute baby big shoes walking', 'toddler walking funny', 'naughty kid smiling'],
    segments: [
      {
        hindi: 'आज मैंने पापा के दस नंबर वाले जूते पहन लिए हैं!',
        english: 'Today I put on Papa’s giant size ten shoes!',
      },
      {
        hindi: 'अब मैं घर का असली मालिक हूँ, सब मेरी बात सुनेंगे!',
        english: 'Now I am the real boss of the house, everyone must listen to me!',
      },
      {
        hindi: 'बस एक दिक्कत है... दो कदम चलते ही मैं ज़मीन पर धड़ाम गिर जाता हूँ!',
        english: 'Only one problem... I take two steps and crash straight to the floor!',
      },
      {
        hindi: 'बड़े जूते छोटा बॉस! अगर वॉक पसंद आई तो सब्सक्राइब करना मत भूलना!',
        english: 'Big shoes little boss! Do not forget to subscribe!',
      },
    ],
    tags: ['shorts', 'bigshoes', 'toddlerwalk', 'littleboss', 'cutecomedy', 'funnybaby', 'viralshorts'],
  },
  {
    concept: 'icecream_brainfreeze',
    badge: 'BRAIN FREEZE MOMENT 🍦',
    englishTitle: 'Baby Experiences Brain Freeze! 👶🍦 Hilarious Ice Cream Face',
    visualQuery: 'baby eating ice cream funny face',
    altQueries: ['cute baby tasting ice cream', 'toddler funny expression', 'baby laughing eating'],
    segments: [
      {
        hindi: 'गर्मियों में ठंडी-ठंडी स्ट्रॉबेरी आइसक्रीम खाने का मज़ा ही कुछ और है!',
        english: 'Eating cold strawberry ice cream in summer is pure bliss!',
      },
      {
        hindi: 'लेकिन जैसे ही मैंने बड़ा बाइट लिया, सिर में अलार्म बजने लगा!',
        english: 'But the moment I took a giant bite, alarm bells rang in my head!',
      },
      {
        hindi: 'आंखें चौड़ी, मुंह खुला का खुला! ये आइसक्रीम है या बर्फ का तूफान?!',
        english: 'Eyes wide open, jaw dropped! Is this ice cream or a snow storm?!',
      },
      {
        hindi: 'इस सुपर फनी चेहरे पर एक लाइक तो बनता है! जल्दी सब्सक्राइब करें!',
        english: 'This hilarious reaction deserves a like! Subscribe right now!',
      },
    ],
    tags: ['shorts', 'brainfreeze', 'icecreamlover', 'cutebaby', 'funnyfaces', 'toddlerreaction', 'fyp'],
  },
  {
    concept: 'messy_room_logic',
    badge: 'TODDLER LOGIC 101 🧸',
    englishTitle: 'Toddler Philosophy: Clean Room Dilemma! 👶🧠 Smart Kid Wisdom',
    visualQuery: 'toddler messy room playing toys',
    altQueries: ['cute baby playing toys', 'toddler laughing messy room', 'naughty kid'],
    segments: [
      {
        hindi: 'अगर कल सुबह मुझे फिर से सारे खिलौनों से खेलना ही है...',
        english: 'If I have to play with all my toys again tomorrow morning...',
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
  {
    concept: 'teddy_bear_feast',
    badge: 'TEDDY BEAR FEAST 🧸🍟',
    englishTitle: 'Generous Toddler Sharing Food With Teddy! 👶🍟 Wholesome Moment',
    visualQuery: 'baby feeding teddy bear toy',
    altQueries: ['cute baby playing with teddy', 'toddler sharing food', 'cute baby smiling'],
    segments: [
      {
        hindi: 'मेरा प्यारा टेडी दिन भर भूखा बैठा रहता है!',
        english: 'My sweet teddy bear sits hungry the entire day...',
      },
      {
        hindi: 'इसलिए आज मैं उसे अपनी सबसे पसंदीदा चिप्स खिला रहा हूँ!',
        english: 'So today I am sharing my favorite chips with him!',
      },
      {
        hindi: 'अरे टेडी, मुंह तो खोलो! सारी चिप्स तो मेरी टी-शर्ट पर ही गिर गई!',
        english: 'Hey teddy, open your mouth! All the chips spilled on my shirt!',
      },
      {
        hindi: 'अगर आपको भी अपने बचपन का खिलौना याद है तो लाइक करो!',
        english: 'Hit like if you also remember your childhood favorite toy!',
      },
    ],
    tags: ['shorts', 'teddybear', 'sharingiscaring', 'wholesomebaby', 'cutechildhood', 'explore'],
  },
  {
    concept: 'bedtime_negotiation',
    badge: 'BEDTIME NEGOTIATION 🛌',
    englishTitle: 'The Ultimate Bedtime Mystery! 👶🛌 Toddler Investigation',
    visualQuery: 'naughty kid smiling bed',
    altQueries: ['cute baby hiding blanket', 'toddler laughing in bed', 'cute baby laughing'],
    segments: [
      {
        hindi: 'पापा-मम्मी मुझे तो नौ बजे सोने भेज देते हैं...',
        english: 'Why do parents tell me to sleep at nine PM sharp...',
      },
      {
        hindi: 'और खुद चुपके से टीवी देखते हैं और आइसक्रीम खाते हैं!',
        english: 'While they stay up watching movies and eating ice cream?!',
      },
      {
        hindi: 'मुझे इनके सारे सीक्रेट प्लान पता चल चुके हैं!',
        english: 'I have unlocked all their secret late-night plans!',
      },
      {
        hindi: 'रंगे हाथों पकड़े गए! अगर आप भी होशियार हैं तो लाइक और सब्सक्राइब करें!',
        english: 'Busted! Hit like and subscribe if you caught your parents too!',
      },
    ],
    tags: ['shorts', 'bedtimemystery', 'funnyparents', 'smarttoddler', 'cutebaby', 'viralshorts', 'comedy'],
  },
  {
    concept: 'soap_bubbles_bath',
    badge: 'BUBBLE POP PARTY 🫧',
    englishTitle: 'Baby Bath Time Soap Bubble Party! 👶🫧 Pure Joy & Magic',
    visualQuery: 'baby playing soap bubbles bath',
    altQueries: ['cute baby bubbles', 'toddler laughing water bubbles', 'baby smiling bath'],
    segments: [
      {
        hindi: 'देखो हवा में उड़ते हुए जादुई पानी के गुब्बारे!',
        english: 'Look at the magical water balloons floating in the air!',
      },
      {
        hindi: 'मैं जिसे भी छूने की कोशिश करता हूँ, वो फुस्स हो जाता है!',
        english: 'Every single one I try to touch just pops into thin air!',
      },
      {
        hindi: 'ये बबल्स पक्का किसी निंजा स्कूल से ट्रेनिंग लेकर आए हैं!',
        english: 'These bubbles must have trained at a secret ninja academy!',
      },
      {
        hindi: 'हंसते रहो और रोज़ाना ऐसी क्यूट मस्ती के लिए सब्सक्राइब करो!',
        english: 'Keep smiling and subscribe for daily adorable fun!',
      },
    ],
    tags: ['shorts', 'soapbubbles', 'bathtimefun', 'cutebaby', 'innocence', 'happyvibes', 'fyp'],
  },
  {
    concept: 'grandparents_trick',
    badge: 'DADI KA LAADLA 🕶️',
    englishTitle: 'When Grandparents Are Around! 👶🕶️ Savage Toddler Trick',
    visualQuery: 'naughty kid smiling talking',
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
    concept: 'doctor_injection',
    badge: 'DOCTOR UNCLE LIE 💉',
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
        english: 'I think that ant was related to a dinosaur family!',
      },
      {
        hindi: 'हंसते-हंसते पेट में दर्द हो गया तो जल्दी से लाइक और सब्सक्राइब करो!',
        english: 'If you laughed out loud, hit like and subscribe right now!',
      },
    ],
    tags: ['shorts', 'babyhumor', 'doctorjoke', 'cutebaby', 'toddlerjokes', 'viralcomedy', 'laughing'],
  },
  {
    concept: 'phone_screen_time',
    badge: 'MUMMY PHONE BUSTED 📱',
    englishTitle: 'Phone Rules Double Standard! 👶📱 Busted Mummy Papa',
    visualQuery: 'toddler holding phone laughing',
    altQueries: ['cute baby talking phone', 'toddler laughing', 'naughty kid smiling'],
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
  {
    concept: 'sneeze_jump_scare',
    badge: 'SNEEZE JUMP SCARE 🤧',
    englishTitle: 'When Dad Sneezes At 100 Decibels! 👶😱 Baby Dramatic Shock',
    visualQuery: 'baby surprised funny face',
    altQueries: ['cute baby shocked face', 'toddler funny reaction', 'baby laughing'],
    segments: [
      {
        hindi: 'घर में सब कुछ बिल्कुल शांत और प्यारा चल रहा था...',
        english: 'Everything at home was completely peaceful and calm...',
      },
      {
        hindi: 'तभी अचानक पापा ने 100 की स्पीड में छींक मार दी: आक्छीं!',
        english: 'Then suddenly Papa sneezed at top volume: ACHOO!',
      },
      {
        hindi: 'अरे बाप रे! मुझे लगा जैसे घर की छत ही उड़ गई हो!',
        english: 'Goodness me! I thought the roof just blew away!',
      },
      {
        hindi: 'अगर आपके पापा भी ऐसे ही डराते हैं तो कमेंट में बताओ और सब्सक्राइब करो!',
        english: 'Tell in comments if your dad sneezes like a bomb too, and subscribe!',
      },
    ],
    tags: ['shorts', 'dadsneeze', 'babyshock', 'funnyreactions', 'cutebaby', 'wholesomecomedy', 'fyp'],
  },
  {
    concept: 'baby_discovers_toes',
    badge: 'TOES DISCOVERY 🦶',
    englishTitle: 'Baby Discovers Feet Attached To Body! 👶🦶 Shocking Discovery',
    visualQuery: 'baby holding feet laughing',
    altQueries: ['cute baby playing toes', 'toddler laughing', 'baby giggling happy'],
    segments: [
      {
        hindi: 'ब्रेकिंग न्यूज़! आज मैंने अपने बिस्तर पर दो नए दोस्त ढूंढे हैं!',
        english: 'Breaking news! Today I found two brand new friends on my bed!',
      },
      {
        hindi: 'ये दस नन्हीं उंगलियां दिन भर मेरे साथ ही घूमती रहती हैं!',
        english: 'These ten tiny toes follow me everywhere I go!',
      },
      {
        hindi: 'मैंने इन्हें मुंह में डालने की कोशिश की, पर स्वाद तो कुछ खास नहीं था!',
        english: 'I tried tasting them, but honestly the flavor was nothing special!',
      },
      {
        hindi: 'देखा नन्हा वैज्ञानिक! रोज़ाना ऐसी प्यारी हरकतों के लिए सब्सक्राइब करो!',
        english: 'Look at the tiny scientist! Subscribe for daily cute toddler moments!',
      },
    ],
    tags: ['shorts', 'babydiscoversfeet', 'cutenessoverload', 'toddlerlife', 'funnybaby', 'wholesome'],
  },
  {
    concept: 'cat_convo',
    badge: 'CAT & TODDLER CONVO 🐱',
    englishTitle: 'Toddler Trying To Speak Cat Language! 👶🐱 Hilarious Meow Debate',
    visualQuery: 'toddler playing with cat',
    altQueries: ['cute baby cat playing', 'toddler laughing with pet', 'cute baby laughing'],
    segments: [
      {
        hindi: 'मैंने अपनी बिल्ली से बहुत प्यार से पूछा: म्याऊँ म्याऊँ?',
        english: 'I politely asked our pet cat: Meow Meow?',
      },
      {
        hindi: 'उसने मुझे ऐसे देखा जैसे मैंने उसकी कोई पुरानी प्रॉपर्टी मांग ली हो!',
        english: 'She looked at me like I asked for her family inheritance!',
      },
      {
        hindi: 'लगता है मेरी कैट लैंग्वेज में कुछ भारी व्याकरण की गलती हो गई!',
        english: 'I guess there was a huge grammar mistake in my cat dialect!',
      },
      {
        hindi: 'अगर आपको बिल्लियां पसंद हैं तो लाइक ठोक दो और सब्सक्राइब करो!',
        english: 'Hit like if you love cats too and don’t forget to subscribe!',
      },
    ],
    tags: ['shorts', 'babyandcat', 'cutepets', 'meow', 'toddlerhumor', 'funnyanimals', 'viralshorts'],
  },
];

/**
 * Gets next rotation index using history_tracker.json
 * Guarantees zero repetition across runs
 */
function getNextScenarioIndex() {
  let tracker = {};
  if (fs.existsSync(TRACKER_PATH)) {
    try {
      tracker = JSON.parse(fs.readFileSync(TRACKER_PATH, 'utf8'));
    } catch (e) {
      tracker = {};
    }
  }

  const currentIndex = tracker.slot1_scenario_index ?? 0;
  const nextIndex = (currentIndex + 1) % EXPANDED_SCENARIOS.length;

  tracker.slot1_scenario_index = nextIndex;
  try {
    fs.writeFileSync(TRACKER_PATH, JSON.stringify(tracker, null, 2), 'utf8');
  } catch (e) {
    logger.warn(`Failed to update history_tracker: ${e.message}`);
  }

  return currentIndex % EXPANDED_SCENARIOS.length;
}

/**
 * Calls Gemini 1.5 Flash to generate fresh, unique baby script
 */
async function generateWithGemini(concept, apiKey) {
  if (!apiKey) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const prompt = `You are the lead content creator for India's #1 viral Cute Baby and Toddler Comedy YouTube Shorts channel ("Little Boss").
Generate a hilarious, heart-melting 25-30s Hindi voiceover script from a cute baby/toddler perspective with crisp English subtitles based on this theme/concept: "${concept}".

Format Requirements:
1. Hook (0-3s): Super cute or curious baby question/observation.
2. Body (4-20s): Innocent toddler logic, hilarious reaction, or funny mishap in 2 parts.
3. Punchline (21-26s): Laugh-out-loud funny toddler punchline.
4. CTA (27-30s): Sweet or cheeky comment/subscribe prompt.
5. Language: Spoken toddler Hindi (Devanagari script) for voiceover, paired with clean English translations for burned-in subtitles.
6. Visual queries: 1 primary and 3 alternative specific visual queries for vertical B-roll video search on Pexels (e.g. "baby tasting lemon funny", "toddler laughing", "baby puppy playing").

Return ONLY valid JSON without markdown fences:
{
  "title": "Click-worthy English title with emojis (max 50 chars)",
  "badge": "2-4 word theme badge in caps (e.g. LEMON TEST 🍋)",
  "visualQuery": "baby tasting lemon funny",
  "altQueries": ["cute baby sour face", "funny baby tasting", "toddler laughing"],
  "segments": [
    { "hindi": "...", "english": "..." },
    { "hindi": "...", "english": "..." },
    { "hindi": "...", "english": "..." },
    { "hindi": "...", "english": "..." }
  ],
  "tags": ["cutebaby", "funnytoddler", "shorts", "babycomedy", "viralshorts"]
}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 600, temperature: 0.8 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJson);

    if (parsed.title && Array.isArray(parsed.segments) && parsed.segments.length >= 3) {
      return parsed;
    }
  } catch (e) {
    logger.warn(`Gemini Slot 1 dynamic script generation failed: ${e.message}. Using procedural rotation engine.`);
  }
  return null;
}

/**
 * Main Content Generator for Slot 1 (Cute Baby / Toddler Comedy & Dance)
 * @param {string} [customTopic]
 */
export async function generateSlot1Content(customTopic = null) {
  logger.info('=== Generating Slot 1 (Cute Toddler / Baby Reels) High-CTR Content ===');

  let chosenConcept = customTopic;
  if (!chosenConcept) {
    // Pick concept from rotating list
    const conceptIdx = Math.floor(Math.random() * DIVERSE_CONCEPTS.length);
    chosenConcept = DIVERSE_CONCEPTS[conceptIdx];
  }

  let generated = null;
  if (config.geminiApiKey) {
    logger.info(`Invoking Gemini 1.5 Flash for dynamic Slot 1 concept: "${chosenConcept}"...`);
    generated = await generateWithGemini(chosenConcept, config.geminiApiKey);
  }

  // Fallback to rotating procedural scenario library
  if (!generated) {
    const scenarioIdx = getNextScenarioIndex();
    const scenario = EXPANDED_SCENARIOS[scenarioIdx];
    logger.info(`[Slot 1 Rotation] Selected non-repeating scenario #${scenarioIdx + 1}: "${scenario.badge}"`);
    generated = {
      title: scenario.englishTitle,
      badge: scenario.badge,
      visualQuery: scenario.visualQuery,
      altQueries: scenario.altQueries,
      segments: scenario.segments,
      tags: scenario.tags,
    };
  }

  // Handle custom topic override if specified
  if (customTopic) {
    generated.title = `${customTopic} 👶 Cute Toddler Fun`;
    generated.visualQuery = `cute baby ${customTopic}`;
    generated.badge = `${customTopic.toUpperCase().slice(0, 24)} 👶`;
  }

  // Pick random upbeat audio bed from available tracks
  const audioBeds = getSlot1AudioBeds();
  let bgMusicPath = path.join(config.assetsDir, 'audio', 'entertainment.mp3');
  if (audioBeds.length > 0) {
    bgMusicPath = audioBeds[Math.floor(Math.random() * audioBeds.length)];
  }
  logger.info(`[Slot 1 Audio Bed]: Selected upbeat background music: ${path.basename(bgMusicPath)}`);

  // First-person cute kid voiceover script (Hindi)
  const voiceScript = generated.segments.map((s) => s.hindi).join(' ');
  // Subtitles in clean English for global audience
  const englishSubtitles = generated.segments.map((s) => s.english).join(' ');

  // Reliable fallback clip path
  const clipPath = path.join(config.assetsDir, 'defaults', 'slot1_baby.mp4');

  return {
    slot: 'slot1',
    slotName: 'Entertainment (Cute Baby & Toddler Reels)',
    title: generated.title,
    description: `${generated.title}\n\nEnjoy the most wholesome and hilarious toddler shorts!\n(Cute kid voiceover in Hindi with bold English Subtitles for global reach).\n\nSubscribe for daily fun, baby jokes, and joyful laughter!`,
    tags: generated.tags || ['shorts', 'cutebaby', 'funnytoddler', 'viralcomedy', 'fyp'],
    voice: config.voices.slot1 || 'hi-IN-SwaraNeural',
    pitch: '+38%', // Toddler/child high pitch voice
    rate: '+6%',   // Upbeat energetic child cadence
    themeType: 'jokes',
    visualQuery: generated.visualQuery || 'cute baby talking',
    altQueries: generated.altQueries || ['toddler laughing', 'naughty kid smiling'],
    clipPath,
    epicBadge: generated.badge || 'LITTLE BOSS JOKES 😂',
    voiceScript,
    englishSubtitles,
    segments: generated.segments,
    bgMusicPath,
    categoryId: '24', // Entertainment
  };
}

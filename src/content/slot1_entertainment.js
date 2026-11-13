import path from 'path';
import fs from 'fs';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { getSlot1AudioBeds } from '../utils/audio_beds.js';
import { fetchSlotBackgroundMedia, getCategoryVideoPool } from '../utils/media_fetcher.js';
import { pickUnusedFallbackClip } from '../utils/used_assets.js';
import { ensureSlot1Pool, getSlot1PoolClips } from '../utils/ensure_slot1_pool.js';
import { transliterateHindiToHinglish } from '../utils/text_utils.js';

const TRACKER_PATH = path.join(config.assetsDir, 'history_tracker.json');

/**
 * Rich library of visual theme contexts mapped directly to video clips in assets/clips/baby/
 * Guarantees that the generated 2-character comedy dialogue 100% matches what is visible on screen.
 */
const CLIP_THEME_REGISTRY = {
  '01_baby_classic.mp4': {
    context: 'A cute toddler strutting around the room like a tiny CEO / Little Boss inspecting the house with serious swagger.',
    roles: { adult: 'Papa', baby: 'Little Boss' },
    badge: 'LITTLE BOSS CEO 👶💼',
    scenarios: [
      {
        title: 'Work From Home Little Boss! 👶💼 Salary Tax Busted | Viral Baby Comedy',
        badge: 'LITTLE BOSS CEO 👶💼',
        dialogue: [
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'अरे छोटे बॉस, आज इतना सीरियस मुंह बनाकर पूरे घर में क्यों घूम रहे हो?',
            hinglish: 'Oye chhote boss, aaj itna serious muh banakar pure ghar mein kyu ghum rahe ho?'
          },
          {
            speaker: 'Baby',
            role: 'Little Boss',
            hindi: 'पापा सीरियस इसलिए हूँ क्योंकि आज मैंने आपकी सैलरी से चॉकलेट का टैक्स काट लिया है!',
            hinglish: 'Papa serious isliye hoon kyunki maine aapki salary se chocolate ka tax kaat liya!'
          },
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'क्या?! पर कंपनी तो मेरी है, टैक्स तू कैसे काटेगा भाई?',
            hinglish: 'Kya?! Par company toh meri hai, tax tu kaise katega bhai?'
          },
          {
            speaker: 'Baby',
            role: 'Little Boss',
            hindi: 'कंपनी आपकी होगी पापा, पर इस घर का असली मैनेजिंग डायरेक्टर तो मैं ही हूँ!',
            hinglish: 'Company aapki hogi papa, par is ghar ka asli managing director toh main hi hoon!'
          }
        ]
      },
      {
        title: 'Baby Demands Salary Increment! 👶🍼 Milk Allowance Meeting',
        badge: 'SALARY HIKE MEETING 👶📈',
        dialogue: [
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'हां भाई छोटे, आज तुम्हारी छह महीने की परफॉर्मेंस रिव्यू मीटिंग है!',
            hinglish: 'Haan bhai chhote, aaj tumhari 6 mahine ki performance review meeting hai!'
          },
          {
            speaker: 'Baby',
            role: 'Little Boss',
            hindi: 'रिव्यू छोड़ो पापा, पहले ये बताओ मेरी दूध की बोतल में मलाई का इंसेंटिव कब बढ़ाओगे?',
            hinglish: 'Review chhodo papa, pehle ye batao doodh ki bottle mein malai ka incentive kab badhaoge?'
          },
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'इंसेंटिव तब मिलेगा जब रात को बिना रोए चुपचाप सोओगे!',
            hinglish: 'Incentive tab milega jab raat ko bina roye chupchaap sooge!'
          },
          {
            speaker: 'Baby',
            role: 'Little Boss',
            hindi: 'अगर मैं रात को सो गया तो आपकी रील्स कौन देखेगा? इंक्रीमेंट पक्का समझो!',
            hinglish: 'Agar main raat ko so gaya toh aapki reels kaun dekhega? Increment pakka samjho!'
          }
        ]
      }
    ]
  },
  '02_baby_dance.mp4': {
    context: 'An energetic toddler grooving, jumping, and bouncing on beat with funny baby dance moves.',
    roles: { adult: 'DJ Bhaiya', baby: 'Rockstar Baby' },
    badge: 'BABY DANCE BATTLE 🕺🎶',
    scenarios: [
      {
        title: 'DJ Bhaiya vs Rockstar Baby! 👶🕺 Diaper Hip-Hop Challenge',
        badge: 'BABY DANCE BATTLE 🕺🎶',
        dialogue: [
          {
            speaker: 'Adult',
            role: 'DJ Bhaiya',
            hindi: 'अरे डीजे भैया का चेला! ये कौन सा नया डांस स्टेप ईजाद कर दिया तुमने?',
            hinglish: 'Oye DJ bhaiya ke chele! Ye kaun sa naya dance step ijaad kar diya tumne?'
          },
          {
            speaker: 'Baby',
            role: 'Rockstar',
            hindi: 'अरे डीजे अंकल, इसे कहते हैं डायपर हिप-हॉप स्टाइल, बड़े-बड़े डांसर्स भी फेल हैं!',
            hinglish: 'Arre DJ uncle, ise kehte hain diaper hip-hop style, bade-bade dancers bhi fail hain!'
          },
          {
            speaker: 'Adult',
            role: 'DJ Bhaiya',
            hindi: 'पर बेटा, कमर तो हिल रही है, हाथ क्यों ऊपर-नीचे फेंक रहे हो?',
            hinglish: 'Par beta, kamar toh hil rahi hai, haath kyu upar neeche phenk rahe ho?'
          },
          {
            speaker: 'Baby',
            role: 'Rockstar',
            hindi: 'क्योंकि जब जेब में दूध का सिक्का खनकता है, तो हाथ अपने आप हवा में उड़ते हैं!',
            hinglish: 'Kyunki jab jeb mein doodh ka sikka khanakta hai, toh haath hawa mein udte hain!'
          }
        ]
      },
      {
        title: 'Wedding Baraat Baby Dance! 👶🕺 Naagin Dance Revealed',
        badge: 'BARAAT NAAGIN DANCE 👶🐍',
        dialogue: [
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'ओए रॉकस्टार! बारात में ऐसे नागिन डांस करोगे तो रिश्तेदार क्या कहेंगे?',
            hinglish: 'Oye rockstar! Baraat mein aise naagin dance karoge toh rishtedaar kya kahenge?'
          },
          {
            speaker: 'Baby',
            role: 'Rockstar',
            hindi: 'रिश्तेदार कुछ भी कहें पापा, दूल्हे से ज़्यादा शगुन के लिफाफे मुझे ही मिलने वाले हैं!',
            hinglish: 'Rishtedaar kuch bhi kahein papa, dulhe se zyada shagun ke lifafe mujhe hi milenge!'
          },
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'अच्छा? पर डांस का ऑफिशियल लाइसेंस कहाँ है तुम्हारा?',
            hinglish: 'Achha? Par dance ka official license kahan hai tumhara?'
          },
          {
            speaker: 'Baby',
            role: 'Rockstar',
            hindi: 'लाइसेंस छोड़ो पापा, डीजे वाले को बोलो गाना बदलो, अब बेबी का राज चलेगा!',
            hinglish: 'License chhodo papa, DJ wale ko bolo gaana badlo, ab baby ka raaj chalega!'
          }
        ]
      }
    ]
  },
  '03_baby_mischief.mp4': {
    context: 'A naughty toddler caught red-handed sneaking snacks/chocolate, grinning guiltily with messy hands.',
    roles: { adult: 'Papa', baby: 'Chocolate Heist Baby' },
    badge: 'CHOCOLATE HEIST 🍫👶',
    scenarios: [
      {
        title: 'Caught Red Handed With Chocolate! 👶🍫 Busted Baby Logic',
        badge: 'CHOCOLATE HEIST 🍫👶',
        dialogue: [
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'ओए जासूस! फ्रिज का दरवाजा खुला है और तुम्हारा पूरा मुंह चॉकलेट से लाल क्यों है?',
            hinglish: 'Oye jasoos! Fridge ka darwaza khula hai aur tumhara pura muh chocolate se laal kyu hai?'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'पापा कसम से मैंने चॉकलेट नहीं खाई, वो तो खुद फिसलकर मेरे मुंह में आ गई!',
            hinglish: 'Papa kasam se maine chocolate nahi khai, woh khud phisalkar mere muh mein aa gayi!'
          },
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'अच्छा? और ये जो हाथों पर सबूत चिपके हैं, इनका क्या करूँ?',
            hinglish: 'Achha? Aur ye jo haathon par saboot chipke hain, inka kya karun?'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'सबूत मिटाने के लिए मुझे एक और किटकैट दो, वरना मम्मी को बता दूंगा आपने कोल्ड ड्रिंक पी थी!',
            hinglish: 'Saboot mitane ke liye ek aur KitKat do, warna mummy ko bata dunga aapne cold drink pee thi!'
          }
        ]
      },
      {
        title: 'Modern Art Wall Drawing! 👶🎨 Toddler Picasso Caught',
        badge: 'TODDLER PICASSO 👶🎨',
        dialogue: [
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'ओए नटखट! लिविंग रूम की सफेद दीवार पर ये लाल-पीली पेंटिंग किसने बनाई है?',
            hinglish: 'Oye natkhat! Living room ki white deewar par ye laal-peeli painting kisne banayi hai?'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'पापा डांटने से पहले कद्र करो, ये पांच करोड़ की मॉडर्न आर्ट है, म्यूजियम में बिकेगी!',
            hinglish: 'Papa daantne se pehle kadar karo, ye 5 crore ki modern art hai, museum mein bikegi!'
          },
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'मॉडर्न आर्ट?! पर लाल क्रियॉन तो तुम्हारे ही हाथ में रंगे हाथ पकड़ा गया है!',
            hinglish: 'Modern art?! Par laal crayon toh tumhare hi haath mein range haath pakda gaya hai!'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'हाथ में क्रियॉन होना गुनाह नहीं पापा, असली महान कलाकार को कोई नहीं समझता!',
            hinglish: 'Haath mein crayon hona gunaah nahi papa, asli mahaan kalakaar ko koi nahi samajhta!'
          }
        ]
      }
    ]
  },
  '04_baby_laughing.mp4': {
    context: 'A cute baby laughing uncontrollably, giggling hysterically and rolling over with pure joy.',
    roles: { adult: 'Standup Papa', baby: 'Baby Judge' },
    badge: 'LAUGHING CONTEST 😂👶',
    scenarios: [
      {
        title: 'Baby Laughs At Dad Joke! 👶😂 Pure Comedy Reaction',
        badge: 'DAD JOKE FAIL 😂👶',
        dialogue: [
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'बेटा एक नया चुटकुला सुनाऊं? एक बार एक आलू प्याज से मिलने गया...',
            hinglish: 'Beta ek naya chutkula sunau? Ek baar ek aaloo pyaaz se milne gaya...'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'हाहाहा! पापा आपका चुटकुला तो बहुत बेकार था, पर आपकी शक्ल देखकर हंसी आ गई!',
            hinglish: 'Hahaha! Papa aapka chutkula toh bekaar tha, par aapki shakal dekhkar hansi aa gayi!'
          },
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'अरे! मेरी शक्ल में ऐसा क्या मज़ाकिया है भाई?',
            hinglish: 'Arre! Meri shakal mein aisa kya mazakiya hai bhai?'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'जब आप सीरियस होते हो ना पापा, तो बिल्कुल गुस्सा वाले लाल टमाटर जैसे लगते हो!',
            hinglish: 'Jab aap serious hote ho na papa, toh bilkul gusse wale laal tamatar jaise lagte ho!'
          }
        ]
      },
      {
        title: 'Laughing Champion Baby! 👶😂 Crooked Mustache Prank',
        badge: 'LAUGHING CHAMPION 😂👶',
        dialogue: [
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'अरे भाई इतनी ज़ोर-ज़ोर से क्यों हंस रहे हो, कोई गड़ा हुआ खज़ाना मिल गया क्या?',
            hinglish: 'Arre bhai itni zor-zor se kyu hans rahe ho, koi khazana mil gaya kya?'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'पापा खज़ाना तो नहीं मिला, पर आपकी नकली मूंछ टेढ़ी हो गई है, ज़रा शीशे में देखो!',
            hinglish: 'Papa khazana toh nahi mila, par aapki nakli moochh tedhi ho gayi hai, sheeshe mein dekho!'
          },
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'अरे बाप रे! मेरी मूंछ कब से उल्टी लटकी हुई है?',
            hinglish: 'Arre baap re! Meri moochh kab se ulti latki hui hai?'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'दस मिनट से पापा! और पूरे मोहल्ले ने देख भी लिया, हाहाहा!',
            hinglish: 'Das minute se papa! Aur poore mohalle ne dekh bhi liya, hahaha!'
          }
        ]
      }
    ]
  },
  '05_toddler_wobble.mp4': {
    context: 'A toddler driving a toy car / wobble scooter across the room like a reckless speed racer.',
    roles: { adult: 'Traffic Cop', baby: 'Toddler Driver' },
    badge: 'TRAFFIC COP VS BABY 👮‍♂️🚗',
    scenarios: [
      {
        title: 'Oye License Dikha! 👶🚗 Toddler vs Traffic Police | Viral Comedy Short',
        badge: 'TRAFFIC COP VS BABY 👮‍♂️🚗',
        dialogue: [
          {
            speaker: 'Adult',
            role: 'Cop',
            hindi: 'ओए छोटे ड्राइवर! गाड़ी ज़रा साइड में लगाओ, ओवरस्पीडिंग का चालान कटेगा!',
            hinglish: 'Oye chhote driver! Gaadi zara side mein lagao, overspeeding ka chalan katega!'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'अंकल चालान बाद में काटना, पहले ये बताओ मेरी गाड़ी में रिवर्स गियर कहाँ है?',
            hinglish: 'Uncle chalan baad mein kaatna, pehle ye batao meri gaadi mein reverse gear kahan hai?'
          },
          {
            speaker: 'Adult',
            role: 'Cop',
            hindi: 'ड्राइविंग आती नहीं और हाईवे पर कार दौड़ा रहे हो? लाइसेंस कहाँ है तुम्हारा?',
            hinglish: 'Driving aati nahi aur highway par car dauda rahe ho? License kahan hai tumhara?'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'लाइसेंस तो नहीं है अंकल, पर ये लाल वाली लॉलीपॉप ले लो और मामला यहीं रफा-दफा करो!',
            hinglish: 'License toh nahi hai uncle, par ye laal lollipop le lo aur mamla yahin rafa-dafa karo!'
          }
        ]
      },
      {
        title: 'No Helmet Fine On Sofa Expressway! 👶🏎️ Speed Racer Baby',
        badge: 'NO HELMET FINE 👮‍♂️🏎️',
        dialogue: [
          {
            speaker: 'Adult',
            role: 'Cop',
            hindi: 'ओए नन्हे बाइकर! बिना हेलमेट के इतनी तेज़ गाड़ी क्यों भगा रहे हो?',
            hinglish: 'Oye nanhe biker! Bina helmet ke itni tez gaadi kyu bhaga rahe ho?'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'अंकल अगर हेलमेट पहन लूंगा तो मेरा नया हेयरस्टाइल दुनिया को कैसे दिखेगा?',
            hinglish: 'Uncle agar helmet pehan lunga toh mera naya hairstyle duniya ko kaise dikhega?'
          },
          {
            speaker: 'Adult',
            role: 'Cop',
            hindi: 'हेयरस्टाइल के चक्कर में पांच सौ का भारी चालान कट जाएगा तुम्हारा!',
            hinglish: 'Hairstyle ke chakkar mein paanch sau ka bhari chalan kat jayega tumhara!'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'चालान पापा के नाम भेज देना अंकल, आज उनकी सैलरी आई है, हाहाहा!',
            hinglish: 'Chalan papa ke naam bhej dena uncle, aaj unki salary aayi hai, hahaha!'
          }
        ]
      }
    ]
  },
  '06_baby_curiosity.mp4': {
    context: 'A curious baby staring with wide open eyes, investigating doctor tools, a mirror reflection, or strange objects.',
    roles: { adult: 'Doctor Uncle', baby: 'Tiny Detective' },
    badge: 'DOCTOR UNCLE LIE 💉👶',
    scenarios: [
      {
        title: 'Doctor Uncle’s Big Lie! 👶💉 Tiny Injection Mystery',
        badge: 'DOCTOR UNCLE LIE 💉👶',
        dialogue: [
          {
            speaker: 'Adult',
            role: 'Doctor',
            hindi: 'बेटा बिल्कुल मत डरना, बस एक छोटी सी नन्हीं चींटी प्यार से काटेगी!',
            hinglish: 'Beta bilkul mat darna, bas ek chhoti si nanhi cheenti pyaar se kaategi!'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'अरे डॉक्टर अंकल, अगर चींटी के पास इतना बड़ा सुई वाला इंजेक्शन होता तो हाथी भी बेहोश हो जाता!',
            hinglish: 'Doctor uncle, agar cheenti ke paas itna bada injection hota toh haathi bhi behosh ho jata!'
          },
          {
            speaker: 'Adult',
            role: 'Doctor',
            hindi: 'अरे वाह, बड़ा समझदार बच्चा है! ज़रा मुंह खोलकर जीभ बाहर निकालो?',
            hinglish: 'Arre wah, bada samajhdaar bachha hai! Zara muh kholkar jeebh bahar nikalo?'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'जीभ तो निकाल दूंगा अंकल, पर पहले सुई जेब में रखो, वरना मैं आपकी कुर्सी का पहिया निकाल दूंगा!',
            hinglish: 'Jeebh toh nikaal dunga uncle, par pehle sui jeb mein rakho, warna kursi ka pahiya nikaal dunga!'
          }
        ]
      },
      {
        title: 'Baby Meets Mirror Twin! 👶🪞 Serious Bodyguard Debate',
        badge: 'MIRROR TWIN DEBATE 👶🪞',
        dialogue: [
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'अरे बेटा, शीशे के सामने खड़े होकर इतनी देर से किससे बातें कर रहे हो?',
            hinglish: 'Arre beta, sheeshe ke samne khade hokar itni der se kisse baatein kar rahe ho?'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'पापा शीशे के अंदर एक बहुत ही हैंडसम बच्चा मुझे लगातार घूर रहा है!',
            hinglish: 'Papa sheeshe ke andar ek bohot hi handsome bachha mujhe lagataar ghur raha hai!'
          },
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'बेटा वो तुम्हारा ही चेहरा है, कोई दूसरा बच्चा नहीं है वो!',
            hinglish: 'Beta woh tumhara hi chehra hai, koi doosra bachha nahi hai woh!'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'अगर वो मैं हूँ पापा, तो वो मेरी चॉकलेट मांगने पर मना क्यों नहीं करता? ज़ेरॉक्स कॉपी है वो!',
            hinglish: 'Agar woh main hoon papa, toh meri chocolate maangne par mana kyu nahi karta? Xerox copy hai woh!'
          }
        ]
      }
    ]
  },
  '07_happy_bounce.mp4': {
    context: 'A toddler bouncing with crazy unlimited energy, jumping up and down non-stop on couch or floor.',
    roles: { adult: 'Gym Trainer', baby: 'Fitness Boss Baby' },
    badge: 'BABY WORKOUT CHALLENGE 🏋️‍♂️👶',
    scenarios: [
      {
        title: 'Gym Trainer vs Bouncing Baby! 👶🏋️‍♂️ Sofa Workout Challenge',
        badge: 'BABY WORKOUT 🏋️‍♂️👶',
        dialogue: [
          {
            speaker: 'Adult',
            role: 'Trainer',
            hindi: 'चलो छोटे पहलवान! आज दस पुशअप्स और बीस जंप्स लगाने हैं तुम्हें!',
            hinglish: 'Chalo chhote pehlwaan! Aaj 10 pushups aur 20 jumps lagane hain tumhe!'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'ट्रेनर अंकल पुशअप्स का तो पता नहीं, पर उछल-उछल कर सोफे के स्प्रिंग ज़रूर तोड़ दूंगा!',
            hinglish: 'Trainer uncle pushups ka toh pata nahi, par uchhal-uchhal kar sofa ke spring tod dunga!'
          },
          {
            speaker: 'Adult',
            role: 'Trainer',
            hindi: 'सोफे पर नहीं ज़मीन पर वर्कआउट करो! सिक्स पैक एब्स बनाने हैं कि नहीं?',
            hinglish: 'Sofa par nahi zameen par workout karo! Six pack abs banane hain ki nahi?'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'एब्स का क्या करूँ अंकल? मम्मी कहती हैं कि गोल-मटोल पेट वाले बच्चे ही ज़्यादा क्यूट होते हैं!',
            hinglish: 'Abs ka kya karun uncle? Mummy kehti hain gol-matol pet wale bachhe zyada cute hote hain!'
          }
        ]
      },
      {
        title: 'High Voltage Bouncing Baby! 👶⚡ Secret Energy Source',
        badge: 'ENERGY SECRET 👶⚡',
        dialogue: [
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'ओए तूफानी बच्चे! सुबह से नॉन-स्टॉप उछल रहे हो, क्या इनवर्टर की बैटरी पर चलते हो?',
            hinglish: 'Oye toofani bachhe! Subah se non-stop uchhal rahe ho, kya inverter battery par chalte ho?'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'पापा बैटरी पर तो आपके खिलौने चलते हैं, मेरा पावर सोर्स तो मम्मी की बनाई मीठी खीर है!',
            hinglish: 'Papa battery par toh khilaune chalte hain, mera power source mummy ki banayi kheer hai!'
          },
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'तो थोड़ी खीर मुझे भी दे दो, ऑफिस से आकर मेरी बैटरी बिल्कुल लो हो गई है!',
            hinglish: 'Toh thodi kheer mujhe bhi de do, office se aakar meri battery bilkul low ho gayi hai!'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'खीर खत्म हो गई पापा! अब सिर्फ मेरा डांस देखो और चुपचाप वीडियो को सब्सक्राइब करो!',
            hinglish: 'Kheer khatam ho gayi papa! Ab sirf mera dance dekho aur video ko subscribe karo!'
          }
        ]
      }
    ]
  },
  '08_naughty_smile.mp4': {
    context: 'A toddler with a cheeky, savage side-eye smile planning a mischievous trick or prank.',
    roles: { adult: 'Papa', baby: 'Savage Toddler' },
    badge: 'DADI KA LAADLA 🕶️👶',
    scenarios: [
      {
        title: 'Grandma’s Defense Shield! 👶🕶️ Savage Toddler Trick',
        badge: 'DADI KA LAADLA 🕶️👶',
        dialogue: [
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'आज तुमने फिर से दूध का गिलास फर्श पर गिरा दिया? आज तुम्हारी भारी डांट पक्की है!',
            hinglish: 'Aaj tumne fir se doodh ka glass farsh par gira diya? Aaj tumhari daant pakki hai!'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'पापा मुझे डांटने से पहले ज़रा पीछे मुड़कर देखो, दादी बेलन लेकर खड़ी हैं!',
            hinglish: 'Papa mujhe daantne se pehle peeche mudkar dekho, Dadi belan lekar khadi hain!'
          },
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'अरे मम्मी आप?! नहीं-नहीं मैं तो बस बच्चे को बहुत प्यार से समझा रहा था!',
            hinglish: 'Arre mummy aap?! Nahi-nahi main toh bas bachhe ko bohot pyaar se samjha raha tha!'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'देखा छोटा दिमाग बड़ा धमाका! एक नकली आंसू में पापा का पूरा गेम उल्टा कर दिया!',
            hinglish: 'Dekha chhota dimaag bada dhamaka! Ek nakli aansu mein papa ka game ulta kar diya!'
          }
        ]
      },
      {
        title: 'Phone Password Busted! 👶📱 Smart Toddler Hack',
        badge: 'PHONE HACKER BABY 👶📱',
        dialogue: [
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'ओए नटखट! मेरा फोन अनलॉक करके तुमने ऑनलाइन नई टॉय कार कैसे ऑर्डर कर दी?',
            hinglish: 'Oye natkhat! Mera phone unlock karke tumne online nayi toy car kaise order kar di?'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'पापा जब आप सो रहे थे, मैंने आपकी ही उंगली लगाकर फिंगरप्रिंट लॉक खोल लिया!',
            hinglish: 'Papa jab aap so rahe the, maine aapki hi ungli lagakar fingerprint lock khol liya!'
          },
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'क्या?! पर मेरे फोन का छह अंकों वाला पिन तो तुम्हें कभी नहीं पता था!',
            hinglish: 'Kya?! Par mere phone ka 6 digit pin toh tumhe kabhi nahi pata tha!'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'पापा आपका पिन वन-टू-थ्री-फोर-फाइव-सिक्स है, ये तो हमारे टॉमी कुत्ते को भी पता है!',
            hinglish: 'Papa aapka pin 1-2-3-4-5-6 hai, ye toh hamare Tommy kutte ko bhi pata hai!'
          }
        ]
      }
    ]
  },
  '09_toy_adventure.mp4': {
    context: 'A baby playing intently with blocks, building a skyscraper tower or crashing toy cars on the carpet.',
    roles: { adult: 'Architect Papa', baby: 'Master Builder' },
    badge: 'TOY TOWER COLLAPSE 🏗️👶',
    scenarios: [
      {
        title: 'Architect Papa vs Baby Builder! 👶🏗️ Controlled Demolition',
        badge: 'TOY TOWER COLLAPSE 🏗️👶',
        dialogue: [
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'अरे नन्हे इंजीनियर! ये जो खिलौनों की इतनी ऊंची मीनार बनाई है, ये गिरेगी तो नहीं?',
            hinglish: 'Arre nanhe engineer! Ye jo khilaunon ki itni unchi minaar banayi hai, ye giregi toh nahi?'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'पापा गिरना ही तो इस पूरे प्रोजेक्ट का असली क्लाइमेक्स है, ज़रा एक सेकंड रुको!',
            hinglish: 'Papa girna hi toh is poore project ka asli climax hai, zara ek second ruko!'
          },
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'अरे-अरे लात मत मारना! पूरा कमरा बिखर जाएगा भाई!',
            hinglish: 'Arre-arre laat mat maarna! Poora kamra bikhar jayega bhai!'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'धड़ाम! इसे कहते हैं कंट्रोल्ड डिमोलिशन पापा, अगली बिल्डिंग इससे भी ऊंची बनाऊंगा!',
            hinglish: 'Dhadhaam! Ise kehte hain controlled demolition papa, agli building isse bhi unchi banaunga!'
          }
        ]
      },
      {
        title: 'Toy Train Ticket Inspector! 👶🚂 VIP Baby Passenger',
        badge: 'TOY TRAIN TICKETS 👶🚂',
        dialogue: [
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'टिकट चेकर बाबू आ गए! इस टॉय ट्रेन में बिना टिकट यात्रा करने की सख्त मनाही है!',
            hinglish: 'Ticket checker babu aa gaye! Is toy train mein bina ticket yatra ki sakht manahi hai!'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'पापा इस ट्रेन का ड्राइवर, गार्ड और रेलवे मिनिस्टर सब मैं ही हूँ, टिकट कैसा?',
            hinglish: 'Papa is train ka driver, guard aur railway minister sab main hi hoon, ticket kaisa?'
          },
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'बिना टिकट के पकड़े जाने पर नन्हे मुसाफिर को जेल भी हो सकती है!',
            hinglish: 'Bina ticket ke pakde jaane par nanhe musaafir ko jail bhi ho sakti hai!'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'जेल में अगर कार्टून और चॉकलेट चिप्स मिलेंगे तो मैं अभी चलने को तैयार हूँ!',
            hinglish: 'Jail mein agar cartoon aur chocolate chips milenge toh main abhi chalne ko taiyaar hoon!'
          }
        ]
      }
    ]
  },
  '10_playful_celebration.mp4': {
    context: 'A baby clapping hands excitedly, cheering victory, and giggling with big joyful smiles.',
    roles: { adult: 'Papa', baby: 'Champion Toddler' },
    badge: 'VICTORY CELEBRATION 🏆👶',
    scenarios: [
      {
        title: 'Bedtime Match Victory! 👶🏆 Baby Defeats Sleep Routine',
        badge: 'VICTORY CELEBRATION 🏆👶',
        dialogue: [
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'घड़ी में रात के दस बज गए हैं, अब चुपचाप सो जाओ, आज का मैच खत्म!',
            hinglish: 'Ghadi mein raat ke 10 baj gaye hain, ab chupchaap so jao, aaj ka match khatam!'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'मैच खत्म नहीं हुआ पापा, बेबी टीम ने मम्मी-पापा को थकाकर वर्ल्ड कप जीत लिया है!',
            hinglish: 'Match khatam nahi hua papa, baby team ne mummy-papa ko thakakar World Cup jeet liya!'
          },
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'बेटा सुबह स्कूल भी जाना है तुम्हें, ज़रा अपनी आंखें बंद करो!',
            hinglish: 'Beta subah school bhi jaana hai tumhe, zara apni aankhein band karo!'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'आंखें बंद तो कल करेंगे पापा, अभी तो आधी रात की जीत की पार्टी शुरू हुई है!',
            hinglish: 'Aankhein band toh kal karenge papa, abhi toh aadhi raat ki party shuru hui hai!'
          }
        ]
      },
      {
        title: 'Gold Medal Walking Baby! 👶🥇 Ice Cream Demand',
        badge: 'GOLD MEDAL BABY 👶🥇',
        dialogue: [
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'वाह भाई वाह! आज तुमने बिना गिरे पूरे दस कदम चल लिए, बहुत शानदार!',
            hinglish: 'Wah bhai wah! Aaj tumne bina gire poore 10 kadam chal liye, bohot shandar!'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'दस कदम तो वार्मअप था पापा, अब जल्दी से गोल्ड मेडल और दो स्कूप आइसक्रीम लाओ!',
            hinglish: 'Das kadam toh warmup tha papa, ab jaldi se gold medal aur 2 scoop ice cream lao!'
          },
          {
            speaker: 'Adult',
            role: 'Papa',
            hindi: 'आइसक्रीम कल मिलेगी बेटा, आज सिर्फ शाबाशी से काम चलाओ!',
            hinglish: 'Ice cream kal milegi beta, aaj sirf shabaashi se kaam chalao!'
          },
          {
            speaker: 'Baby',
            role: 'Baby',
            hindi: 'शाबाशी से पेट नहीं भरता पापा, आइसक्रीम नहीं दी तो रात भर रोने का सायरन बजाऊंगा!',
            hinglish: 'Shabaashi se pet nahi bharta papa, ice cream nahi di toh raat bhar rone ka siren bajaunga!'
          }
        ]
      }
    ]
  }
};

/**
 * Resolves context for arbitrary clip names or Pexels downloads
 */
function resolveClipContext(clipPath, customTopic = null) {
  const filename = path.basename(clipPath || '').toLowerCase();

  // 1. Direct registry lookup
  for (const [key, value] of Object.entries(CLIP_THEME_REGISTRY)) {
    if (filename.includes(key.replace('.mp4', ''))) {
      return { ...value, clipFilename: filename };
    }
  }

  // 2. Keyword-based visual inference
  if (filename.includes('dance') || filename.includes('groove')) {
    return { ...CLIP_THEME_REGISTRY['02_baby_dance.mp4'], clipFilename: filename };
  }
  if (filename.includes('mischief') || filename.includes('naughty') || filename.includes('chocolate')) {
    return { ...CLIP_THEME_REGISTRY['03_baby_mischief.mp4'], clipFilename: filename };
  }
  if (filename.includes('laugh') || filename.includes('giggle') || filename.includes('smile')) {
    return { ...CLIP_THEME_REGISTRY['04_baby_laughing.mp4'], clipFilename: filename };
  }
  if (filename.includes('wobble') || filename.includes('car') || filename.includes('scooter') || filename.includes('drive')) {
    return { ...CLIP_THEME_REGISTRY['05_toddler_wobble.mp4'], clipFilename: filename };
  }
  if (filename.includes('curiosity') || filename.includes('mirror') || filename.includes('doctor')) {
    return { ...CLIP_THEME_REGISTRY['06_baby_curiosity.mp4'], clipFilename: filename };
  }
  if (filename.includes('bounce') || filename.includes('jump') || filename.includes('happy')) {
    return { ...CLIP_THEME_REGISTRY['07_happy_bounce.mp4'], clipFilename: filename };
  }
  if (filename.includes('toy') || filename.includes('adventure') || filename.includes('blocks')) {
    return { ...CLIP_THEME_REGISTRY['09_toy_adventure.mp4'], clipFilename: filename };
  }
  if (filename.includes('celebration') || filename.includes('playful') || filename.includes('clapping')) {
    return { ...CLIP_THEME_REGISTRY['10_playful_celebration.mp4'], clipFilename: filename };
  }

  // Default to 05_toddler_wobble (Traffic Cop vs Baby) or 01_baby_classic
  return {
    context: `A funny cute toddler getting up to adorable mischief in the house: ${customTopic || 'everyday toddler adventure'}`,
    roles: { adult: 'Papa', baby: 'Little Boss' },
    badge: 'LITTLE BOSS COMEDY 😂👶',
    scenarios: CLIP_THEME_REGISTRY['05_toddler_wobble.mp4'].scenarios,
    clipFilename: filename,
  };
}

/**
 * Tracks rotation index to guarantee zero repeating dialogues across runs
 */
function getNextSubThemeIndex(clipKey, numScenarios) {
  let tracker = {};
  if (fs.existsSync(TRACKER_PATH)) {
    try {
      tracker = JSON.parse(fs.readFileSync(TRACKER_PATH, 'utf8'));
    } catch (_) {
      tracker = {};
    }
  }

  if (!tracker.slot1_clip_subthemes) tracker.slot1_clip_subthemes = {};
  const currentIdx = tracker.slot1_clip_subthemes[clipKey] ?? 0;
  tracker.slot1_clip_subthemes[clipKey] = (currentIdx + 1) % numScenarios;

  try {
    fs.writeFileSync(TRACKER_PATH, JSON.stringify(tracker, null, 2), 'utf8');
  } catch (e) {
    logger.warn(`Failed to update history_tracker: ${e.message}`);
  }

  return currentIdx % numScenarios;
}

/**
 * Prompts Gemini (gemini-2.5-flash with fallback to gemini-2.0-flash) to write a 2-character comedy dialogue
 * strictly matched to the selected video footage
 */
async function generate2CharacterDialogueWithGemini({ clipName, visualContext, roles, apiKey }) {
  if (!apiKey) return null;

  const twistSeeds = [
    'Baby acts like a seasoned corporate CEO laying off parents from bedtime duty',
    'Baby treats traffic police cop like a drive-thru lollipop customer',
    'Baby defends messy eating as high-fashion modern art',
    'Baby uses Grandma as an invincible shield against Papa scolding',
    'Baby refuses to sleep because late-night cartoons have better ratings',
    'Baby negotiates chocolate allowance like a Wall Street broker'
  ];
  const randomTwist = twistSeeds[Math.floor(Math.random() * twistSeeds.length)];

  const prompt = `You are India's #1 viral YouTube Shorts comedy writer specializing in rapid-fire 2-character funny banter between an Adult and a cheeky witty Baby/Toddler ("Little Boss").

CURRENT VIDEO CLIP CONTEXT (MUST 100% MATCH WHAT IS ON SCREEN):
- Video Clip File: ${clipName}
- What is visible in the video: ${visualContext}
- Characters: Adult (${roles.adult}) vs Baby (${roles.baby})
- Comedic Angle: ${randomTwist}

STRICT CONTENT RULES:
1. Two-Character Comedy Dialogue: 100% MATCH what is happening in the video footage! ABSOLUTELY NO MONOLOGUES! NO SINGLE-CHARACTER SPEECHES! The script MUST be a rapid, back-and-forth funny conversation between Character 1 (Adult: e.g. Cop, Teacher, Dad, Doctor) and Character 2 (Kid: Little Boss).
2. Banter Structure (4 lines total, ~20-25 seconds total speech):
   - Line 1 (${roles.adult}): Catches, questions, or confronts the kid based directly on what the kid is doing in the video clip.
   - Line 2 (${roles.baby}): Sassy toddler comeback with innocent hilarious logic.
   - Line 3 (${roles.adult}): Exasperated, shocked counter-question.
   - Line 4 (${roles.baby}): Laugh-out-loud funny punchline that leaves viewers laughing!
3. Speech duration: 4 lines, total ~45-55 Hindi words.
4. Each dialogue line must include:
   - "speaker": "Adult" or "Baby"
   - "role": "${roles.adult}" or "${roles.baby}"
   - "hindi": Natural spoken Hindi in Devanagari script for neural TTS.
   - "hinglish": Clean Latin transliteration matching the exact spoken Hindi words for subtitles.

Return ONLY a valid JSON object without markdown fences:
{
  "title": "Click-worthy viral title with emojis (e.g. 'Oye License Dikha! 👶🚗 Baby Traffic Cop Funny Banter')",
  "badge": "2-4 word theme badge in caps (e.g. 'TRAFFIC COP VS BABY 👮‍♂️')",
  "characterAdult": "${roles.adult}",
  "characterBaby": "${roles.baby}",
  "dialogue": [
    {
      "speaker": "Adult",
      "role": "${roles.adult}",
      "hindi": "...",
      "hinglish": "..."
    },
    {
      "speaker": "Baby",
      "role": "${roles.baby}",
      "hindi": "...",
      "hinglish": "..."
    },
    {
      "speaker": "Adult",
      "role": "${roles.adult}",
      "hindi": "...",
      "hinglish": "..."
    },
    {
      "speaker": "Baby",
      "role": "${roles.baby}",
      "hindi": "...",
      "hinglish": "..."
    }
  ],
  "tags": ["shorts", "babycomedy", "viralshorts", "funnybaby", "toddlerhumor", "comedyreels", "fyp"]
}`;

  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];

  for (const model of models) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

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

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        logger.warn(`Gemini (${model}) returned HTTP ${res.status}: ${errText.slice(0, 100)}`);
        continue;
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      if (parsed.title && Array.isArray(parsed.dialogue) && parsed.dialogue.length >= 3) {
        logger.success(`Gemini (${model}) successfully generated clip-matched 2-character dialogue: "${parsed.title}"`);
        return parsed;
      }
    } catch (err) {
      logger.warn(`Gemini (${model}) dialogue generation attempt failed: ${err.message}`);
    }
  }

  return null;
}

/**
 * Main Content Generator for Slot 1: Baby & Toddler Reels
 * REVERSED FLOW: Video clip is selected FIRST, dialogue is generated SECOND to 100% match the footage!
 * @param {string} [customTopic]
 */
export async function generateSlot1Content(customTopic = null) {
  logger.info('=== Generating Slot 1 (Cute Baby Reels): Video-First 2-Character Dialogue Revamp ===');

  // Step 1: Ensure local video pools exist
  await ensureSlot1Pool();

  // Step 2: Select the unused moving video clip FIRST
  let chosenClipPath = null;
  const babyDir = path.join(config.assetsDir, 'clips', 'baby');
  const poolClips = [
    ...getCategoryVideoPool(babyDir),
    ...getSlot1PoolClips(),
  ].filter((v, idx, arr) => arr.indexOf(v) === idx);

  // If customTopic is specified, attempt dynamic Pexels search first
  if (customTopic) {
    try {
      const pexelsRes = await fetchSlotBackgroundMedia({ slotType: 'slot1', customTopic });
      if (pexelsRes?.filePath && fs.existsSync(pexelsRes.filePath)) {
        chosenClipPath = pexelsRes.filePath;
      }
    } catch (_) {}
  }

  // If not chosen via customTopic, pick non-repeating video clip from local pool
  if (!chosenClipPath) {
    chosenClipPath = pickUnusedFallbackClip(poolClips, 'baby');
  }

  // Fallback to default clip if needed
  if (!chosenClipPath || !fs.existsSync(chosenClipPath)) {
    const defaultBaby = path.join(config.assetsDir, 'defaults', 'slot1_baby.mp4');
    chosenClipPath = fs.existsSync(defaultBaby) ? defaultBaby : poolClips[0];
  }

  const clipFilename = path.basename(chosenClipPath);
  logger.success(`[Slot 1 Video-First] Selected background video: ${clipFilename}`);

  // Step 3: Extract visual context & character roles for the chosen video clip
  const clipContextInfo = resolveClipContext(chosenClipPath, customTopic);
  logger.info(`[Slot 1 Context]: Visual Setting: "${clipContextInfo.context}" | Characters: ${clipContextInfo.roles.adult} vs ${clipContextInfo.roles.baby}`);

  // Step 4: Generate 2-Character Dialogue with Gemini (or procedural fallback)
  let generated = null;
  if (config.geminiApiKey) {
    logger.info(`Prompting Gemini 2.5 Flash for 2-character comedy dialogue strictly matched to ${clipFilename}...`);
    generated = await generate2CharacterDialogueWithGemini({
      clipName: clipFilename,
      visualContext: clipContextInfo.context,
      roles: clipContextInfo.roles,
      apiKey: config.geminiApiKey,
    });
  }

  // Fallback: Pick rotating procedural 2-character dialogue mapped to this specific clip
  if (!generated) {
    const scenarios = clipContextInfo.scenarios || CLIP_THEME_REGISTRY['05_toddler_wobble.mp4'].scenarios;
    const scenarioIdx = getNextSubThemeIndex(clipFilename, scenarios.length);
    const chosenScenario = scenarios[scenarioIdx];
    logger.info(`[Slot 1 Procedural Rotation] Selected scenario #${scenarioIdx + 1} for ${clipFilename}: "${chosenScenario.badge}"`);

    generated = {
      title: chosenScenario.title,
      badge: chosenScenario.badge,
      characterAdult: clipContextInfo.roles.adult,
      characterBaby: clipContextInfo.roles.baby,
      dialogue: chosenScenario.dialogue,
      tags: ['shorts', 'babycomedy', 'viralshorts', 'funnybaby', 'toddlerhumor', 'fyp'],
    };
  }

  // Step 5: Format dialogue lines and segment data
  const formattedDialogueLines = generated.dialogue.map((item) => {
    const isAdult = item.speaker === 'Adult' || item.speaker?.toLowerCase().includes('adult');
    const roleName = item.role || (isAdult ? clipContextInfo.roles.adult : clipContextInfo.roles.baby);
    const cleanHindi = (item.hindi || '').trim();
    const rawHinglish = item.hinglish || transliterateHindiToHinglish(cleanHindi) || cleanHindi;
    const cleanHinglish = rawHinglish.trim().replace(/^[A-Za-z]+:\s*/, '');

    return {
      speaker: isAdult ? 'Adult' : 'Baby',
      role: roleName,
      hindi: cleanHindi,
      hinglish: cleanHinglish,
      text: cleanHindi,
    };
  });

  const formattedSegments = formattedDialogueLines.map((line) => ({
    speaker: line.speaker,
    role: line.role,
    hindi: line.hindi,
    hinglish: line.hinglish,
    english: line.hinglish,
  }));

  // Injected SSML breaks between character dialogue lines for natural conversational cadence
  const fullHindiScript = formattedDialogueLines.map((l) => l.hindi).join(' <break time="0.3s"/> ');
  const fullHinglishSubtitles = formattedDialogueLines.map((l) => l.hinglish).join(' ');

  // Select upbeat background music track
  const audioBeds = getSlot1AudioBeds();
  let bgMusicPath = path.join(config.assetsDir, 'audio', 'entertainment.mp3');
  if (audioBeds.length > 0) {
    bgMusicPath = audioBeds[Math.floor(Math.random() * audioBeds.length)];
  }
  logger.info(`[Slot 1 Audio Bed]: Selected background music: ${path.basename(bgMusicPath)}`);

  return {
    slot: 'slot1',
    slotName: 'Entertainment (Cute Baby & Toddler Reels)',
    title: generated.title,
    description: `${generated.title}\n\nEnjoy the most hilarious 2-character baby comedy dialogues!\n(Little Boss vs ${clipContextInfo.roles.adult} comedy banter with bold burned-in subtitles).\n\nSubscribe for daily toddler fun, baby jokes, and joyful laughter!`,
    tags: generated.tags || ['shorts', 'babycomedy', 'viralshorts', 'funnybaby', 'toddlerhumor', 'fyp'],
    voice: config.voices.slot1 || 'hi-IN-SwaraNeural',
    adultVoice: config.voices.slot1Adult || 'hi-IN-MadhurNeural',
    pitch: '+38%',     // Baby voice prosody
    rate: '+6%',      // Baby voice upbeat cadence
    adultPitch: '+0Hz', // Adult male voice natural prosody
    adultRate: '+4%',  // Adult clear cadence
    themeType: 'jokes',
    visualQuery: clipContextInfo.roles.adult ? `toddler ${clipContextInfo.roles.adult.toLowerCase()}` : 'cute baby talking',
    clipPath: chosenClipPath,
    epicBadge: generated.badge || `${clipContextInfo.roles.adult.toUpperCase()} VS BABY 👶`,
    voiceScript: fullHindiScript,
    subtitleText: fullHinglishSubtitles,
    englishSubtitles: fullHinglishSubtitles,
    dialogueLines: formattedDialogueLines,
    segments: formattedSegments,
    bgMusicPath,
    categoryId: '24', // Entertainment
  };
}

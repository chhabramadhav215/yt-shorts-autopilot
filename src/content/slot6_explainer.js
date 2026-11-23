import path from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { summarizeNewsHeadline, toTitleCase } from '../utils/text_utils.js';
import { isTopicRecentlyPublished, getRecentTopicsForSlot } from '../utils/publish_history.js';
import { generateGeminiJson } from '../utils/gemini_client.js';

/**
 * STRICTLY BANNED PHRASES & CLICHÉS
 * Zero generic filler allowed in tactical explainers.
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
    .replace(/प्लेइंग\s*इलेवन\s*और\s*रणनीतिक\s*संतुलन[^।,.]*[।,.]?/gi, 'सटीक मैच रणनीति')
    .replace(/फैसला\s*बिल्कुल\s*सही\s*है\s*या\s*एक\s*बड़ी\s*भूल/gi, 'आपकी राय क्या है')
    .replace(/सही\s*(था|है)\s*या\s*(बड़ी\s*)?भूल/gi, 'आप किसे चुनेंगे')
    .replace(/और\s*सब्सक्राइब\s*कीजिए!?/gi, '')
    .replace(/सब्सक्राइब\s*कीजिए!?/gi, '')
    .replace(/drop your thoughts below and subscribe!?/gi, 'what do you think?')
    .replace(/right call or a big mistake!?/gi, 'who would you pick?')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Current 2026-2027 Season & Tactical Realities
 * Grounded in current franchise blueprints, venue dynamics, and tactical balance.
 * Zero outdated mega-auction narratives presented as current news.
 */
export const TACTICAL_SCENARIOS = [
  {
    id: 'kkr_tactical_2027',
    team: 'KKR',
    franchiseName: 'Kolkata Knight Riders',
    topicKey: 'KKR Title Defense & 2027 Blueprint',
    title: 'KKR Tactical Blueprint: 220+ Run-Highway Era & Pace Depth Puzzle',
    headline: 'KKR TACTICAL BLUEPRINT • 2027 PREP',
    beats: [
      {
        beatIndex: 0,
        visualMode: 'big_stat',
        headlineTag: 'KKR 2027 BLUEPRINT',
        bigStat: '220+ RUN ERA',
        subStat: 'EDEN GARDENS SQUAD AUDIT • 2027',
        cardData: {
          bigStat: '220+ RUN ERA',
          subStat: 'EDEN GARDENS SQUAD AUDIT • 2027',
          label: 'TACTICAL REALITY',
          highlight: 'HIGH-SCORING DECK PRESSURE',
          context1: 'True bounce at Eden requires minimum 6 genuine bowling options',
          context2: 'Narine and Varun spin mystery remains premier defensive weapon',
        },
        narration: 'दो सौ बीस रन का नया टी-20 दौर! क्या ईडन गार्डन्स पर केकेआर का नया ब्लूप्रिंट तैयार है?',
        captionText: 'IN THE MODERN 220+ RUN-RATE ERA, KKR FACE A MAJOR TACTICAL TEST TO BALANCE THEIR SQUAD!',
      },
      {
        beatIndex: 1,
        visualMode: 'squad_grid',
        headlineTag: 'CURRENT CORE VS NEEDS',
        cardData: {
          gridTitle: 'CORE PILLARS VS PACE NEEDS',
          gridItems: [
            { slot: 'SPIN TWINS', player: 'Narine & Varun', status: 'LOCKED', tag: 'MATCH-WINNERS' },
            { slot: 'FINISHER FIREPOWER', player: 'Rinku & Russell', status: 'LOCKED', tag: 'EXPLOSIVE' },
            { slot: 'PACE SPEARHEAD', player: 'Harshit Rana', status: 'LOCKED', tag: 'ATTACK' },
            { slot: 'INDIAN SEAM DEPTH', player: 'Frontline Seam Partner', status: 'VACANT', tag: 'CRITICAL' },
          ],
        },
        narration: 'नरेन, वरुण, रसेल और रिंकू—चार फौलादी मैच-विनर्स! लेकिन पावरप्ले में विकेट कौन चटकाएगा?',
        captionText: 'NARINE, VARUN, RINKU AND RUSSELL ANCHOR THE TEAM, BUT A SECOND STRIKE PACER IS ESSENTIAL!',
      },
      {
        beatIndex: 2,
        visualMode: 'departure_replacement',
        headlineTag: 'SEAM COMPOSITION',
        cardData: {
          title: 'POWERPLAY SEAM BALANCE',
          outPlayer: { name: 'Impact Player Over-Reliance', price: 'T20 Trend', role: 'Batting-Heavy Lineup', status: 'GAP' },
          inTarget: { name: 'Frontline Indian Seamer', price: 'Strike Pacer', role: 'Powerplay Wickets & Swing', status: 'PRIORITY' },
          takeaway: 'Eden Gardens powerplays now dictate results far more than middle-overs spin.',
        },
        narration: 'फ्लैट ट्रैक पर सिर्फ स्पिन काफी नहीं। 145 की गति वाला फ्रंटलाइन भारतीय पेसर बेहद जरूरी है!',
        captionText: 'WITH 200+ SCORES COMMONPLACE, EARLY POWERPLAY WICKETS DICTATE RESULTS AT EDEN GARDENS!',
      },
      {
        beatIndex: 3,
        visualMode: 'tactical_twist',
        headlineTag: 'THE 220-RUN DEFENSE TEST',
        cardData: {
          twistTitle: 'THE FLAT DECK PARADOX',
          point1: 'Eden flat tracks nullify pure spin; bowlers need high-pace yorkers and cutters.',
          point2: 'Rinku and Russell must face minimum 35 balls collectively to ensure 220+ totals.',
        },
        narration: 'दो सौ बीस डिफेंड करने के लिए रसेल के सटीक यॉर्कर और रिंकू की फिनिशिंग निर्णायक होगी!',
        captionText: 'DEFENDING 220+ ON TRUE TRACKS REQUIRES RUTHLESS DEATH OVERS EXECUTION AND FLUID BATTING!',
      },
      {
        beatIndex: 4,
        visualMode: 'question_hook',
        headlineTag: 'THE KKR VERDICT',
        cardData: {
          questionTitle: 'THE KKR 2027 VERDICT',
          optionA: 'Load the Playing 11 with 7 Genuine Bowling Options',
          optionB: 'Back Top-Order Pure Power to Out-Bat Any Opponent',
          callToAction: 'Which tactical formula guarantees KKR championship dominance?',
        },
        narration: 'सात बॉलिंग ऑप्शंस या ऑल-आउट बैटिंग अटैक? कमेंट्स में अपना वर्डिक्ट बताइए!',
        captionText: 'SHOULD KKR LOAD UP ON ALL-ROUND DEPTH OR GO ALL-OUT ATTACK? DROP YOUR VERDICT BELOW!',
      },
    ],
  },
  {
    id: 'csk_ruturaj_era',
    team: 'CSK',
    franchiseName: 'Chennai Super Kings',
    topicKey: 'CSK Ruturaj Leadership Era',
    title: 'CSK Tactical Blueprint: Ruturaj Leadership Era & Chepauk Pace Fortress',
    headline: 'CSK SQUAD BLUEPRINT • RUTURAJ ERA',
    beats: [
      {
        beatIndex: 0,
        visualMode: 'big_stat',
        headlineTag: 'CSK 2027 BLUEPRINT',
        bigStat: '5x IPL TITLES',
        subStat: 'RUTURAJ TACTICAL LEADERSHIP • CHEPAUK 2027',
        cardData: {
          bigStat: '5x IPL TITLES',
          subStat: 'RUTURAJ TACTICAL LEADERSHIP • CHEPAUK 2027',
          label: 'CAPTAINCY EVOLUTION',
          highlight: 'RUTURAJ ERA CEMENTED',
          context1: 'Ruturaj Gaikwad establishing his calm tactical leadership style',
          context2: 'Matheesha Pathirana yorkers and MS Dhoni finishing provide anchors',
        },
        narration: 'ऋतुराज के नेतृत्व में सीएसके चेपॉक पर नए फॉर्मूले के साथ तैयार है!',
        captionText: 'UNDER RUTURAJ GAIKWAD, CSK ARE EVOLVING THEIR CHEPAUK FORTRESS BLUEPRINT FOR UPCOMING BATTLES!',
      },
      {
        beatIndex: 1,
        visualMode: 'squad_grid',
        headlineTag: 'ROSTER PILLARS',
        cardData: {
          gridTitle: 'CORE PILLARS VS SEAM BALANCE',
          gridItems: [
            { slot: 'CAPTAIN & ANCHOR', player: 'Ruturaj Gaikwad', status: 'LOCKED', tag: 'STABLE' },
            { slot: 'SPIN ALL-ROUNDER', player: 'Ravindra Jadeja', status: 'LOCKED', tag: 'VETERAN' },
            { slot: 'MIDDLE DESTROYER', player: 'Shivam Dube', status: 'LOCKED', tag: 'SPIN HITTER' },
            { slot: 'DEATH SPEARHEAD', player: 'Matheesha Pathirana', status: 'LOCKED', tag: 'YORKER KING' },
          ],
        },
        narration: 'ऋतुराज, जडेजा, शिवम दुबे और पथिराना—चेन्नई की सबसे बड़ी ताकत हैं!',
        captionText: 'GAIKWAD, JADEJA, DUBE AND PATHIRANA FORM THE CORE, GIVING CSK MATCH-WINNING VERSATILITY!',
      },
      {
        beatIndex: 2,
        visualMode: 'departure_replacement',
        headlineTag: 'CHEPAUK TACTICAL SHIFT',
        cardData: {
          title: 'POWERPLAY SEAM EVOLUTION',
          outPlayer: { name: 'Old Slow Deck Reliance', price: 'Past Template', role: 'Sub-170 Sluggish Tracks', status: 'OUTDATED' },
          inTarget: { name: 'High-Pace Hit-The-Deck Quicks', price: 'Modern Blueprint', role: 'Early Powerplay Wickets', status: 'FOCUS' },
          takeaway: 'Modern Chepauk pitches produce true bounce; seamers must strike early.',
        },
        narration: 'चेपॉक अब धीमा नहीं रहा; शुरुआती छह ओवरों में तेज गति से विकेट चाहिए!',
        captionText: 'CHEPAUK HAS EVOLVED INTO A HARDER DECK; HIT-THE-DECK PACE IS NOW ESSENTIAL!',
      },
      {
        beatIndex: 3,
        visualMode: 'tactical_twist',
        headlineTag: 'THE 200+ CHEPAUK DILEMMA',
        cardData: {
          twistTitle: 'THE MODERN CHEPAUK REALITY',
          point1: 'Oppositions target boundary sizes; early powerplay breakthroughs are non-negotiable.',
          point2: 'Dhoni late-innings strike rate and field placements remain tactical masterstroke.',
        },
        narration: 'धोनी के फील्ड प्लेसमेंट्स और पथिराना के सटीक यॉर्कर ही मैच का रुख पलटते हैं!',
        captionText: 'WITHOUT EARLY BREAKTHROUGHS, 200 BECOMES GETTABLE; PATHIRANA AND DHONI REMAIN CRUCIAL!',
      },
      {
        beatIndex: 4,
        visualMode: 'question_hook',
        headlineTag: 'CSK TITLE VERDICT',
        cardData: {
          questionTitle: 'THE CSK 2027 TITLE TEST',
          optionA: 'Trust Ruturaj Methodical Core to Win Trophy 6',
          optionB: 'Need More High-Velocity Fast Bowling Reinforcements',
          callToAction: 'Can Ruturaj Gaikwad deliver Chennai Super Kings their record 6th title?',
        },
        narration: 'क्या ऋतुराज सीएसके को रिकॉर्ड छठा खिताब जिता पाएंगे? कमेंट्स में बताइए!',
        captionText: 'CAN RUTURAJ GAIKWAD LEAD CHENNAI SUPER KINGS TO TITLE NUMBER 6? VOTE NOW!',
      },
    ],
  },
  {
    id: 'mi_tactical_puzzle',
    team: 'MI',
    franchiseName: 'Mumbai Indians',
    topicKey: 'MI Tactical Balance & Bumrah Axis',
    title: 'MI Tactical Balance: Bumrah Lone Masterclass & Wankhede Defense',
    headline: 'MI TACTICAL PUZZLE • BUMRAH & CO.',
    beats: [
      {
        beatIndex: 0,
        visualMode: 'big_stat',
        headlineTag: 'MI 2027 BLUEPRINT',
        bigStat: '6.54 ECONOMY',
        subStat: 'JASPRIT BUMRAH IMMORTALITY • MI 2027',
        cardData: {
          bigStat: '6.54 ECONOMY',
          subStat: 'JASPRIT BUMRAH IMMORTALITY • MI 2027',
          label: 'MATCH WINNER AXIS',
          highlight: 'UNPLAYABLE ACCURACY',
          context1: 'Bumrah delivers world-class 4 overs under 25 runs consistently',
          context2: 'The challenge: defending the remaining 16 overs on flat Wankhede tracks',
        },
        narration: 'जसप्रीत बुमराह सबसे घातक गेंदबाज हैं, लेकिन वानखेड़े पर बाकी सोलह ओवर ही असली परीक्षा हैं!',
        captionText: 'JASPRIT BUMRAH DELIVERS UNMATCHED ECONOMY, BUT MI MUST TIGHTEN THE REMAINING 16 OVERS!',
      },
      {
        beatIndex: 1,
        visualMode: 'squad_grid',
        headlineTag: 'SUPERSTAR SPINE',
        cardData: {
          gridTitle: 'WORLD-CLASS BATTING VS SEAM DEPTH',
          gridItems: [
            { slot: 'TOP ORDER HITMAN', player: 'Rohit Sharma', status: 'LOCKED', tag: '5x CHAMPION' },
            { slot: 'T20 NO.1 BATTER', player: 'Suryakumar Yadav', status: 'LOCKED', tag: '360 DEGREE' },
            { slot: 'LEADER ALL-ROUND', player: 'Hardik Pandya', status: 'LOCKED', tag: 'MATCH WINNER' },
            { slot: 'MIDDLE ORDER STAR', player: 'Tilak Varma', status: 'LOCKED', tag: 'CONSISTENT' },
          ],
        },
        narration: 'रोहित, सूर्या, हार्दिक और तिलक—मुंबई की बैटिंग में आग है, पर बॉलिंग बैकअप चाहिए!',
        captionText: 'ROHIT, SURYA, HARDIK AND TILAK SUPPLY FIREPOWER, BUT COMPLEMENTARY BOWLING IS VITAL!',
      },
      {
        beatIndex: 2,
        visualMode: 'departure_replacement',
        headlineTag: 'WANKHEDE BOWLING AXIS',
        cardData: {
          title: 'CONTAINMENT STRATEGY',
          outPlayer: { name: 'Leaking Runs in Middle Overs', price: 'Econ > 10.5', role: 'Pressure Release', status: 'PROBLEM' },
          inTarget: { name: 'Disciplined Line-and-Length Quicks', price: 'Holding Roles', role: 'Supporting Bumrah', status: 'SOLUTION' },
          takeaway: 'Bumrah creates extreme pressure; the other end must build wickets rather than leak runs.',
        },
        narration: 'बुमराह के छोर पर रन रुकते हैं, तो दूसरे छोर से कसी हुई गेंदबाजी जरूरी है!',
        captionText: 'OPPOSITIONS TARGET THE NON-BUMRAH OVERS; DISCIPLINED SUPPORT SEEDING WICKETS IS MANDATORY!',
      },
      {
        beatIndex: 3,
        visualMode: 'tactical_twist',
        headlineTag: 'THE 230-RUN WANKHEDE REALITY',
        cardData: {
          twistTitle: 'THE WANKHEDE DEW FACTOR',
          point1: 'Wankhede red soil deck and dew make defending any total below 225 dangerous.',
          point2: 'Surya and Rohit powerplay strike rate must maintain 11+ runs per over.',
        },
        narration: 'वानखेड़े की लाल मिट्टी पर सवा दो सौ का स्कोर भी सुरक्षित नहीं होता!',
        captionText: 'DEW AND RED-SOIL DECKS DEMAND 11+ RUN RATES; 225 IS NO LONGER A SAFE TOTAL AT WANKHEDE!',
      },
      {
        beatIndex: 4,
        visualMode: 'question_hook',
        headlineTag: 'MI TITLE VERDICT',
        cardData: {
          questionTitle: 'THE MI TITLE VERDICT',
          optionA: 'Back Hardik Pandya Aggressive All-Round Strategy',
          optionB: 'Rely on Rohit & Surya Pure Batting Destruction',
          callToAction: 'Which tactical combination brings Mumbai Indians back to the IPL trophy?',
        },
        narration: 'क्या हार्दिक और बुमराह मुंबई को फिर चैंपियन बनाएंगे? कमेंट्स में बताइए!',
        captionText: 'CAN HARDIK PANDYA AND JASPRIT BUMRAH RETURN MUMBAI INDIANS TO TROPHY GLORY? VOTE BELOW!',
      },
    ],
  },
  {
    id: 'rcb_chinnaswamy_blueprint',
    team: 'RCB',
    franchiseName: 'Royal Challengers Bengaluru',
    topicKey: 'RCB Chinnaswamy 65m Reality',
    title: 'RCB Tactical Blueprint: Chinnaswamy 65m Boundaries & Pace Arsenal',
    headline: 'RCB BLUEPRINT • CHINNASWAMY 2027',
    beats: [
      {
        beatIndex: 0,
        visualMode: 'big_stat',
        headlineTag: 'RCB 2027 BLUEPRINT',
        bigStat: '65-METER BOUNDARY',
        subStat: 'CHINNASWAMY RUN-HIGHWAY • SQUAD STRATEGY',
        cardData: {
          bigStat: '65-METER BOUNDARY',
          subStat: 'CHINNASWAMY RUN-HIGHWAY • SQUAD STRATEGY',
          label: 'STADIUM GEOMETRY',
          highlight: 'HIGH-ALTITUDE CARNAGE',
          context1: 'Small boundaries and altitude turn mistimed edges into 85m sixes',
          context2: 'Virat Kohli and Rajat Patidar lead the run-scoring engine',
        },
        narration: 'चिन्नास्वामी की पैंसठ मीटर बाउंड्री पर मिसटाइम शॉट भी छक्का हो जाता है!',
        captionText: 'CHINNASWAMY 65-METER BOUNDARIES AND ALTITUDE DEMAND A SPECIALIZED TACTICAL BLUEPRINT!',
      },
      {
        beatIndex: 1,
        visualMode: 'squad_grid',
        headlineTag: 'BATTING VS PACE',
        cardData: {
          gridTitle: 'CORE RUNS VS PACE ARSENAL',
          gridItems: [
            { slot: 'GOAT RUN MACHINE', player: 'Virat Kohli', status: 'LOCKED', tag: '8000+ RUNS' },
            { slot: 'SPIN SMASHER', player: 'Rajat Patidar', status: 'LOCKED', tag: 'SR 165+' },
            { slot: 'LEFT-ARM SEAM', player: 'Yash Dayal', status: 'LOCKED', tag: 'CLUTCH PACER' },
            { slot: 'DEATH WEAPON', player: '145+ Hit-The-Deck Pacer', status: 'VACANT', tag: 'MANDATORY' },
          ],
        },
        narration: 'विराट कोहली और रजत पाटीदार के साथ 145 की रफ्तार वाले विकेट-टेकर चाहिए!',
        captionText: 'KOHLI AND PATIDAR PROVIDE ELITE RUNS, BUT 145+ PACE WICKET-TAKERS ARE MANDATORY!',
      },
      {
        beatIndex: 2,
        visualMode: 'departure_replacement',
        headlineTag: 'DEATH BOWLING TEMPLATE',
        cardData: {
          title: 'VARIATION DISCIPLINE',
          outPlayer: { name: 'Predictable Full Lengths at Death', price: 'High Economy', role: 'Slots into Arc', status: 'FAILURE' },
          inTarget: { name: 'Hard Lengths & Wide Cutters', price: 'Modern Variations', role: 'Unpredictable Pace', status: 'BLUEPRINT' },
          takeaway: 'Bowlers must take pace off or hit the pitch hard into the deck.',
        },
        narration: 'चिन्नास्वामी में यॉर्कर चूकी तो छक्का; हार्ड लेंथ और गति में बदलाव ही बचाएगा!',
        captionText: 'OVER-PITCHING IS FATAL AT CHINNASWAMY; SLOWER-BALL VARIATIONS AND HARD LENGTHS DECIDE GAMES!',
      },
      {
        beatIndex: 3,
        visualMode: 'tactical_twist',
        headlineTag: 'THE 240-RUN SHOOTOUT',
        cardData: {
          twistTitle: 'THE 12-DOT-BALL EQUATION',
          point1: 'Chinnaswamy produces high-scoring shootouts where 12 dots decide the contest.',
          point2: 'Patidar strike rate against spin neutralizes opposition fielding restrictions.',
        },
        narration: 'हाई-स्कोरिंग मैच में सिर्फ बारह डॉट गेंदें ही जीत का अंतर तय करती हैं!',
        captionText: 'IN 240-RUN SHOOTOUTS, JUST 12 DOT BALLS WIN MATCHES; PATIDAR SPIN SMASHING IS CRUCIAL!',
      },
      {
        beatIndex: 4,
        visualMode: 'question_hook',
        headlineTag: 'RCB TITLE VERDICT',
        cardData: {
          questionTitle: 'THE RCB VERDICT',
          optionA: 'Build Express 145+ Pace Battery to Attack Batsmen',
          optionB: 'Focus on Deceptive Slower Cutters and Mystery Spin',
          callToAction: 'Which bowling philosophy can finally break RCB championship drought?',
        },
        narration: 'एक्सप्रेस पेस या स्लोअर कटर्स—आरसीबी को क्या खिताब दिलाएगा? कमेंट्स में बताइए!',
        captionText: 'WHAT BOWLING STRATEGY CAN FINALLY DELIVER RCB MAIDEN TITLE? CAST YOUR VOTE!',
      },
    ],
  },
  {
    id: 'srh_explosive_blueprint',
    team: 'SRH',
    franchiseName: 'Sunrisers Hyderabad',
    topicKey: 'SRH 250+ Destruction Blueprint',
    title: 'SRH 250+ Destruction Formula: Cummins Leadership & Turning Pitch Balance',
    headline: 'SRH 250+ BLUEPRINT • CUMMINS TACTICS',
    beats: [
      {
        beatIndex: 0,
        visualMode: 'big_stat',
        headlineTag: 'SRH 2027 BLUEPRINT',
        bigStat: '287 ALL-TIME HIGH',
        subStat: 'HIGHEST IPL TOTAL EVER • HEAD & KLAASEN ENGINE',
        cardData: {
          bigStat: '287 ALL-TIME HIGH',
          subStat: 'HIGHEST IPL TOTAL EVER • HEAD & KLAASEN ENGINE',
          label: 'HYPER AGGRESSION',
          highlight: 'UNPRECEDENTED BATTING FORMULA',
          context1: 'SRH shattered all records reaching 287 and 266 with fearless intent',
          context2: 'Pat Cummins tactical leadership unlocked modern hyper-aggressive T20',
        },
        narration: 'दो सौ सत्तासी रन का ऑल-टाइम रिकॉर्ड! कमिंस का आक्रामक माइंडसेट ही हैदराबाद की ताकत है!',
        captionText: 'SRH REDEFINED T20 BATTING WITH THEIR RECORD 287; CUMMINS AGGRESSIVE MENTORSHIP IS UNSTOPPABLE!',
      },
      {
        beatIndex: 1,
        visualMode: 'squad_grid',
        headlineTag: 'EXPLOSIVE FIREPOWER',
        cardData: {
          gridTitle: 'FEARLESS BATTING POWERHOUSE',
          gridItems: [
            { slot: 'POWERPLAY HURRICANE', player: 'Travis Head', status: 'LOCKED', tag: 'SR 190+' },
            { slot: 'INDIAN AGGRESSOR', player: 'Abhishek Sharma', status: 'LOCKED', tag: 'FEARLESS' },
            { slot: 'MIDDLE ORDER BEAST', player: 'Heinrich Klaasen', status: 'LOCKED', tag: 'SPIN DESTROYER' },
            { slot: 'CAPTAIN & PACER', player: 'Pat Cummins', status: 'LOCKED', tag: 'TACTICAL BRAIN' },
          ],
        },
        narration: 'ट्रेविस हेड, अभिषेक और क्लासेन की तिकड़ी पहले छह ओवर में मैच छीन लेती है!',
        captionText: 'HEAD, ABHISHEK AND KLAASEN DEMOLISH ATTACKS IN THE POWERPLAY, SEIZING EARLY MOMENTUM!',
      },
      {
        beatIndex: 2,
        visualMode: 'departure_replacement',
        headlineTag: 'TURNING PITCH ADAPTATION',
        cardData: {
          title: 'SURFACE VERSATILITY',
          outPlayer: { name: 'All-Out Reckless Attack on Grip Tracks', price: 'High Risk', role: 'Early Collapses', status: 'RISK' },
          inTarget: { name: 'Calculated Strike Rotation & Spin Choke', price: 'Grip Plan', role: '175 Defendable Games', status: 'ADAPTATION' },
          takeaway: 'A champion team must win when the pitch slows down to a 170-run contest.',
        },
        narration: 'धीमी पिचों पर अंधाधुंध हिटिंग नहीं, स्ट्राइक रोटेट करके एक सौ अस्सी डिफेंड करना होगा!',
        captionText: 'ON GRIPPING, SLOW SURFACES, AGGRESSION MUST BE BALANCED WITH TACTICAL RUN ACCUMULATION!',
      },
      {
        beatIndex: 3,
        visualMode: 'tactical_twist',
        headlineTag: 'DEFENSIVE CONTROL',
        cardData: {
          twistTitle: 'THE DEFENSIVE EQUATION',
          point1: 'Scoring 250 is electric, but defending 180 on away pitches decides championships.',
          point2: 'Cummins clever middle-overs variations give SRH control in tight run chases.',
        },
        narration: 'ढाई सौ बनाना शानदार है, पर मुश्किल ट्रैक पर 180 डिफेंड करना ही ट्रॉफी दिलाता है!',
        captionText: 'CHAMPIONSHIPS ARE WON DEFENDING 180 ON TRICKY TRACKS; CUMMINS MUST MASTER BOTH TEMPLATES!',
      },
      {
        beatIndex: 4,
        visualMode: 'question_hook',
        headlineTag: 'SRH TITLE VERDICT',
        cardData: {
          questionTitle: 'THE HYDERABAD VERDICT',
          optionA: 'Never Stop Attacking: Target 270 Every Single Game',
          optionB: 'Build Defensive Bowling Control for Knockout Finals',
          callToAction: 'Can Pat Cummins take SRH all the way to trophy glory this season?',
        },
        narration: 'क्या हैदराबाद की 250+ बैटिंग उन्हें फिर चैंपियन बनाएगी? कमेंट्स में बताइए!',
        captionText: 'CAN PAT CUMMINS AND SRH 250+ FORMULA CLINCH THE TROPHY THIS SEASON? VOTE BELOW!',
      },
    ],
  },
  {
    id: 'pbks_ponting_culture',
    team: 'PBKS',
    franchiseName: 'Punjab Kings',
    topicKey: 'PBKS Ricky Ponting Culture Overhaul',
    title: 'PBKS Culture Overhaul: Ricky Ponting Winning Mindset & Squad Spine',
    headline: 'PBKS CULTURE SHIFT • PONTING ERA',
    beats: [
      {
        beatIndex: 0,
        visualMode: 'big_stat',
        headlineTag: 'PBKS 2027 OVERHAUL',
        bigStat: 'PONTING REVOLUTION',
        subStat: 'RUTHLESS WINNING CULTURE • PBKS 2027',
        cardData: {
          bigStat: 'PONTING REVOLUTION',
          subStat: 'RUTHLESS WINNING CULTURE • PBKS 2027',
          label: 'CULTURAL OVERHAUL',
          highlight: 'DISMANTLING LOSING HABITS',
          context1: 'Ricky Ponting taking complete charge to instill ruthless winning belief',
          context2: 'Arshdeep Singh and Shashank Singh spearhead the resilient core',
        },
        narration: 'रिकी पोंटिंग के आते ही पंजाब किंग्स में जीत की नई भूख जाग चुकी है!',
        captionText: 'RICKY PONTING HAS BROUGHT A RUTHLESS WINNING MINDSET TO OVERHAUL PBKS SQUAD CULTURE!',
      },
      {
        beatIndex: 1,
        visualMode: 'squad_grid',
        headlineTag: 'NEW TACTICAL IDENTITY',
        cardData: {
          gridTitle: 'CORE SQUAD IDENTITY',
          gridItems: [
            { slot: 'DEATH SPEARHEAD', player: 'Arshdeep Singh', status: 'LOCKED', tag: 'YORKER SPECIALIST' },
            { slot: 'CLUTCH FINISHER', player: 'Shashank Singh', status: 'LOCKED', tag: 'IMPACT HERO' },
            { slot: 'BLITZ OPENER', player: 'Prabhsimran Singh', status: 'LOCKED', tag: 'FEARLESS' },
            { slot: 'HEAD COACH', player: 'Ricky Ponting', status: 'LOCKED', tag: 'SERIAL WINNER' },
          ],
        },
        narration: 'अर्शदीप के डेथ यॉर्कर्स और शशांक की फिनिशिंग पंजाब के मुख्य हथियार हैं!',
        captionText: 'ARSHDEEP DEATH OVERS COMBINED WITH SHASHANK FINISHING PROVIDE RESILIENT MOMENTUM!',
      },
      {
        beatIndex: 2,
        visualMode: 'departure_replacement',
        headlineTag: 'DRESSING ROOM BELIEF',
        cardData: {
          title: 'PRESSURE RESILIENCE',
          outPlayer: { name: 'Panic in Close Finishes', price: 'Historical Trap', role: 'Last-Over Heartbreaks', status: 'ERADICATED' },
          inTarget: { name: 'Ruthless Self-Belief', price: 'Ponting Standard', role: 'Clinical Match Winning', status: 'CULTURE' },
          takeaway: 'Punjab Kings lost tight games in the final over; mindset is everything.',
        },
        narration: 'दबाव में मैच गंवाने की पुरानी आदत को खत्म करना ही पोंटिंग का पहला मिशन है!',
        captionText: 'CONVERTING LAST-OVER THRILLERS INTO CLINICAL WINS IS PONTING PRIMARY MANDATE!',
      },
      {
        beatIndex: 3,
        visualMode: 'tactical_twist',
        headlineTag: 'THE COHESION BLUEPRINT',
        cardData: {
          twistTitle: 'TEAM CHEMISTRY PRIORITY',
          point1: 'Individual star power fails without clear tactical roles for domestic talents.',
          point2: 'Arshdeep taking 2 powerplay wickets unlocks defensive pressure on opposition.',
        },
        narration: 'घरेलू खिलाड़ियों का प्रदर्शन और अर्शदीप का पावरप्ले स्विंग गेम-चेंजर साबित होगा!',
        captionText: 'DOMESTIC PLAYERS MUST DELIVER IN KEY MOMENTS; ARSHDEEP POWERPLAY SWING IS CRUCIAL!',
      },
      {
        beatIndex: 4,
        visualMode: 'question_hook',
        headlineTag: 'PBKS TITLE VERDICT',
        cardData: {
          questionTitle: 'THE PUNJAB VERDICT',
          optionA: 'Ricky Ponting Guides PBKS to Their Maiden IPL Trophy',
          optionB: 'Middle-Order Instability Once Again Derails the Campaign',
          callToAction: 'Will the Ricky Ponting revolution finally deliver a championship to Punjab?',
        },
        narration: 'क्या रिकी पोंटिंग पंजाब को पहला आईपीएल खिताब दिला पाएंगे? कमेंट्स में बताइए!',
        captionText: 'CAN RICKY PONTING BREAK THE DROUGHT AND DELIVER A TITLE TO PUNJAB KINGS? VOTE NOW!',
      },
    ],
  },
  {
    id: 'india_t20_sky_era',
    team: 'DEFAULT',
    franchiseName: 'Team India',
    topicKey: 'Team India T20 Revolution',
    title: 'Team India T20 Revolution: Suryakumar Leadership & Fearless 200+ Template',
    headline: 'TEAM INDIA T20 • SURYAKUMAR ERA',
    beats: [
      {
        beatIndex: 0,
        visualMode: 'big_stat',
        headlineTag: 'INDIA T20 REVOLUTION',
        bigStat: '168+ STRIKE RATE',
        subStat: 'FEARLESS T20 BLUEPRINT • 2026-27',
        cardData: {
          bigStat: '168+ STRIKE RATE',
          subStat: 'FEARLESS T20 BLUEPRINT • 2026-27',
          label: 'HYPER AGGRESSION',
          highlight: 'NO BACKWARD STEPS',
          context1: 'Suryakumar Yadav leading an ultra-aggressive Indian T20 powerhouse',
          context2: 'Targeting boundaries from ball one with batting depth down to number 8',
        },
        narration: 'सूर्यकुमार यादव की कप्तानी में टीम इंडिया का टी-20 अंदाज पूरी तरह बदल चुका है!',
        captionText: 'UNDER SURYAKUMAR YADAV, TEAM INDIA HAVE UNLOCKED A FEARLESS 200+ T20 TEMPLATE!',
      },
      {
        beatIndex: 1,
        visualMode: 'squad_grid',
        headlineTag: 'MODERN T20 DESTROYERS',
        cardData: {
          gridTitle: 'T20 CHAMPIONSHIP ENGINE',
          gridItems: [
            { slot: 'LEADERSHIP 360', player: 'Suryakumar Yadav', status: 'LOCKED', tag: 'T20 PHENOM' },
            { slot: 'ALL-ROUND SPINE', player: 'Hardik Pandya', status: 'LOCKED', tag: 'MATCH WINNER' },
            { slot: 'DEATH SHIELD', player: 'Arshdeep Singh', status: 'LOCKED', tag: 'YORKER MASTER' },
            { slot: 'BLITZ OPENERS', player: 'Abhishek & Samson', status: 'LOCKED', tag: 'SR 180+' },
          ],
        },
        narration: 'सूर्या और हार्दिक की जोड़ी मैच पलटती है, और अर्शदीप डेथ ओवर्स संभालते हैं!',
        captionText: 'SKY AND HARDIK FORM A BULLETPROOF AXIS, BACKED BY ARSHDEEP CLINICAL DEATH BOWLING!',
      },
      {
        beatIndex: 2,
        visualMode: 'departure_replacement',
        headlineTag: 'OBSOLETE ANCHOR',
        cardData: {
          title: 'DEATH OF THE ANCHOR ROLE',
          outPlayer: { name: 'Traditional 50-Ball Anchor', price: 'Past Mindset', role: 'Run-a-Ball Starts', status: 'OBSOLETE' },
          inTarget: { name: 'Relentless Boundary Intent', price: 'Modern Era', role: 'Depth Down to No. 8', status: 'NEW ERA' },
          takeaway: 'Modern international T20 demands every batsman attack at 160+ strike rate.',
        },
        narration: 'टी-20 में एंकर का जमाना गया; हर बल्लेबाज को पहली गेंद से अटैक का लाइसेंस है!',
        captionText: 'THE GENTLE T20 ANCHOR IS OBSOLETE; EVERY BATSMAN MUST ATTACK WITH 160+ INTENT!',
      },
      {
        beatIndex: 3,
        visualMode: 'tactical_twist',
        headlineTag: 'THE 220 DEFENSE TEST',
        cardData: {
          twistTitle: 'THE BOWLING BALANCE',
          point1: 'Even 220 is under threat against top teams; death overs yorkers decide the series.',
          point2: 'Hardik Pandya 4 overs with the ball restore perfect balance to the playing 11.',
        },
        narration: 'सवा दो सौ का स्कोर भी सुरक्षित नहीं; हार्दिक के चार ओवर संतुलन देते हैं!',
        captionText: 'DEFENDING 220 REQUIRES HARDIK PANDYA 4 OVERS TO UNLOCK A BALANCED BOWLING ATTACK!',
      },
      {
        beatIndex: 4,
        visualMode: 'question_hook',
        headlineTag: 'TEAM INDIA VERDICT',
        cardData: {
          questionTitle: 'THE TEAM INDIA VERDICT',
          optionA: 'Back This Fearless Hyper-Aggressive Template for All Tournaments',
          optionB: 'Need One Classical Anchor When Top Order Collapses Inside Powerplay',
          callToAction: 'Is India ultra-aggressive T20 approach the most dangerous in world cricket?',
        },
        narration: 'क्या भारत का यह बेखौफ टी-20 अंदाज दुनिया में सबसे घातक है? कमेंट्स में बताइए!',
        captionText: 'IS INDIA FEARLESS T20 TEMPLATE THE MOST DOMINANT IN WORLD CRICKET? VOTE NOW!',
      },
    ],
  },
  {
    id: 'india_champions_trophy_pace',
    team: 'DEFAULT',
    franchiseName: 'Team India',
    topicKey: 'ICC Champions Trophy Pace Blueprint',
    title: 'Team India Champions Trophy Blueprint: Bumrah & Shami Pace Tandem',
    headline: 'CHAMPIONS TROPHY • BUMRAH & SHAMI',
    beats: [
      {
        beatIndex: 0,
        visualMode: 'big_stat',
        headlineTag: 'PACE TANDEM RETURN',
        bigStat: 'PACE TANDEM RETURN',
        subStat: 'ICC CHAMPIONS TROPHY BLUEPRINT • 2026-27',
        cardData: {
          bigStat: 'PACE TANDEM RETURN',
          subStat: 'ICC CHAMPIONS TROPHY BLUEPRINT • 2026-27',
          label: 'ODI DOMINANCE',
          highlight: 'UNPLAYABLE SEAM PRESENTATION',
          context1: 'Jasprit Bumrah and Mohammed Shami reuniting to spearhead India bowling',
          context2: 'Rohit Sharma powerplay aggression and Virat Kohli masterclass anchoring',
        },
        narration: 'चैंपियंस ट्रॉफी के लिए बुमराह और शमी की जोड़ी फिर तूफान मचाने को तैयार है!',
        captionText: 'BUMRAH AND SHAMI REUNITE TO LEAD INDIA BOWLING CHARGE AT THE ICC CHAMPIONS TROPHY!',
      },
      {
        beatIndex: 1,
        visualMode: 'squad_grid',
        headlineTag: 'ODI PILLARS',
        cardData: {
          gridTitle: 'ODI CHAMPIONSHIP PILLARS',
          gridItems: [
            { slot: 'POWERPLAY SEAM', player: 'Mohammed Shami', status: 'LOCKED', tag: 'SEAM MASTER' },
            { slot: 'WORLD NO.1 PACER', player: 'Jasprit Bumrah', status: 'LOCKED', tag: 'UNPLAYABLE' },
            { slot: 'CHASE MASTER', player: 'Virat Kohli', status: 'LOCKED', tag: '14,000+ RUNS' },
            { slot: 'POWERPLAY CAPTAIN', player: 'Rohit Sharma', status: 'LOCKED', tag: 'AGGRESSIVE LEAD' },
          ],
        },
        narration: 'रोहित का अटैक, विराट का चेस मास्टर अंदाज और बुमराह-शमी का पेस अटैक सबसे मजबूत है!',
        captionText: 'ROHIT AGGRESSION, KOHLI CHASE MASTERY, AND BUMRAH-SHAMI SEAM MAKE INDIA UNSTOPPABLE!',
      },
      {
        beatIndex: 2,
        visualMode: 'departure_replacement',
        headlineTag: '50-OVER DISCIPLINE',
        cardData: {
          title: '300-BALL PATIENCE',
          outPlayer: { name: 'Impatient T20 Slog Mindset', price: 'High Risk', role: 'Giving Away Wickets', status: 'DISASTER' },
          inTarget: { name: 'Middle-Overs Spin & Seam Control', price: 'Discipline', role: 'Building Stifling Pressure', status: 'KEY' },
          takeaway: '50-over cricket requires building pressure across 300 deliveries.',
        },
        narration: 'पचास ओवर में धैर्य चाहिए; कुलदीप और जडेजा का मिडिल ओवर्स दबाव मैच जिताता है!',
        captionText: '50-OVER CRICKET DEMANDS 300 DELIVERIES OF DISCIPLINE; KULDEEP AND JADEJA OWN MIDDLE OVERS!',
      },
      {
        beatIndex: 3,
        visualMode: 'tactical_twist',
        headlineTag: 'POWERPLAY WICKETS',
        cardData: {
          twistTitle: 'THE KNOCKOUT EQUATION',
          point1: 'Taking 3 wickets in the first 10 overs breaks the back of any ODI batting lineup.',
          point2: 'Bumrah and Shami seam presentation exploits early morning atmospheric moisture.',
        },
        narration: 'शुरुआती दस ओवरों में तीन विकेट चटकाना ही नॉकआउट का फैसला कर देता है!',
        captionText: '3 POWERPLAY WICKETS WIN KNOCKOUTS; BUMRAH AND SHAMI SEAM ANGLE IS UNPLAYABLE!',
      },
      {
        beatIndex: 4,
        visualMode: 'question_hook',
        headlineTag: 'CHAMPIONS TROPHY VERDICT',
        cardData: {
          questionTitle: 'THE CHAMPIONS TROPHY VERDICT',
          optionA: 'Bumrah and Shami Will Bowl India to the Champions Trophy Title',
          optionB: 'Spin in Subcontinent Conditions Will Be the Real Deciding Factor',
          callToAction: 'Is the Bumrah-Shami pace attack the greatest bowling unit in ODI history?',
        },
        narration: 'क्या बुमराह और शमी भारत को चैंपियंस ट्रॉफी जिता पाएंगे? कमेंट्स में बताइए!',
        captionText: 'CAN BUMRAH AND SHAMI BOWL INDIA TO ICC CHAMPIONS TROPHY GLORY? DROP YOUR VERDICT!',
      },
    ],
  },
];

/**
 * Procedural Synthesizer for Slot 6 (Cricket Tactical / Squad & Auction Explainer)
 */
export async function generateSlot6Content(customTopic = null) {
  logger.info('[Slot 6 Tactical Explainer] Initiating beat-by-beat cricket tactical generation...');

  const recentTopics = getRecentTopicsForSlot('slot6', 15);
  logger.info(`Recent Slot 6 published topics count: ${recentTopics.length}`);

  let chosenScenario = null;
  const topicSeed = (customTopic || '').trim().toLowerCase();

  // 1. Try AI Generation via Gemini if API key is present
  const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
  let aiGenerated = null;

  if (apiKey) {
    try {
      logger.info('[Slot 6 Explainer] Querying Gemini for structured 5-beat tactical explainer...');
      const systemPrompt = `You are a premier cricket tactical analyst & IPL strategist for viral vertical Shorts (@dailypulseshortss).
Your task is to generate an energetic, fast-paced Hindi commentary script structured into exactly 5 timed beats (~50-60 seconds total), accompanied by punchy English subtitles and structured visual card metadata.

STRICT GLOBAL RULES:
1. ZERO GENERIC FILLER: Absolutely NO "सूत्रों की रिपोर्ट", "टीम मैनेजमेंट और चयनकर्ता", "रणनीतिक बैठक", "प्लेइंग 11 और रणनीतिक संतुलन", "फैसला सही है या भूल", or generic subscribe calls.
2. 100% REAL ACCURATE CRICKET DATA: Mention real IPL franchises, actual player names, verified tournament milestones, and genuine tactical friction points (e.g., pitch dimensions, 220+ run rates, death bowling holes).
3. CURRENT 2026-2027 TIMELINE AWARENESS:
   - Current calendar year is 2026, heading into the upcoming 2027 season and international tournaments.
   - NEVER present the old 2024 mega-auction or past 2024/2025 seasons as breaking news today.
   - Focus on current form, squad balance, upcoming IPL 2027 preparation, trades, pitch dynamics, and recent bilateral/tournament context.
4. 5-BEAT STRUCTURE:
   - Beat 0: Hook & Big Numbers (visualMode: 'big_stat') -> Headline stat, venue challenge, curiosity hook.
   - Beat 1: Squad Balance & Vacancies (visualMode: 'squad_grid') -> 3-4 structured grid slots (Pillars vs Open Holes).
   - Beat 2: Tactical Shift & Replacement (visualMode: 'departure_replacement') -> Old weakness/trend vs new solution target.
   - Beat 3: Tactical Twist / Paradox (visualMode: 'tactical_twist') -> The real strategic problem (pitch dynamics, balance).
   - Beat 4: Verdict & Viewer Question (visualMode: 'question_hook') -> High-stakes dilemma & closing debate question.

Return ONLY a valid JSON object matching this schema:
{
  "title": "Engaging Short Title (under 80 chars)",
  "headline": "PUNCHY BADGE HEADLINE (under 35 chars)",
  "team": "KKR" | "CSK" | "MI" | "RCB" | "SRH" | "PBKS" | "DC" | "RR" | "GT" | "LSG" | "DEFAULT",
  "beats": [
    {
      "beatIndex": 0,
      "visualMode": "big_stat",
      "headlineTag": "TOPIC HOOK",
      "bigStat": "220+ RUN ERA",
      "subStat": "SQUAD AUDIT • 2027",
      "cardData": {
        "bigStat": "220+ RUN ERA",
        "subStat": "SQUAD AUDIT • 2027",
        "label": "TACTICAL CHALLENGE",
        "highlight": "HIGH SCORING PRESSURE",
        "context1": "Short key point 1",
        "context2": "Short key point 2"
      },
      "narration": "Fast energetic Hindi voiceover for beat 0 (2-3 sentences)",
      "captionText": "UPPERCASE PUNCHY ENGLISH CAPTION FOR BEAT 0"
    },
    {
      "beatIndex": 1,
      "visualMode": "squad_grid",
      "headlineTag": "SQUAD BALANCE",
      "cardData": {
        "gridTitle": "CORE VS VACANCIES",
        "gridItems": [
          { "slot": "DEPT 1", "player": "Player Name", "status": "LOCKED", "tag": "CORE" },
          { "slot": "DEPT 2", "player": "Player Name", "status": "LOCKED", "tag": "POWER" },
          { "slot": "DEPT 3", "player": "Missing Slot", "status": "VACANT", "tag": "URGENT" },
          { "slot": "DEPT 4", "player": "Missing Slot", "status": "VACANT", "tag": "REBUILD" }
        ]
      },
      "narration": "Fast energetic Hindi voiceover for beat 1",
      "captionText": "UPPERCASE PUNCHY ENGLISH CAPTION FOR BEAT 1"
    },
    {
      "beatIndex": 2,
      "visualMode": "departure_replacement",
      "headlineTag": "TACTICAL SHIFT",
      "cardData": {
        "title": "ROSTER TRANSITION",
        "outPlayer": { "name": "Tactical Gap", "price": "Past Trend", "role": "Weakness", "status": "GAP" },
        "inTarget": { "name": "Target Solution", "price": "Key Role", "role": "Modern Need", "status": "PRIORITY" },
        "takeaway": "Key tactical takeaway sentence"
      },
      "narration": "Fast energetic Hindi voiceover for beat 2",
      "captionText": "UPPERCASE PUNCHY ENGLISH CAPTION FOR BEAT 2"
    },
    {
      "beatIndex": 3,
      "visualMode": "tactical_twist",
      "headlineTag": "THE TACTICAL PARADOX",
      "cardData": {
        "twistTitle": "THE STRATEGIC DILEMMA",
        "point1": "Deep tactical point 1 (pitch, conditions, balance)",
        "point2": "Deep tactical point 2 (death overs, strike rate)"
      },
      "narration": "Fast energetic Hindi voiceover for beat 3",
      "captionText": "UPPERCASE PUNCHY ENGLISH CAPTION FOR BEAT 3"
    },
    {
      "beatIndex": 4,
      "visualMode": "question_hook",
      "headlineTag": "VERDICT & DEBATE",
      "cardData": {
        "questionTitle": "THE BIG DECISION",
        "optionA": "Clear Option A Choice",
        "optionB": "Clear Option B Choice",
        "callToAction": "Which move would you back?"
      },
      "narration": "Fast energetic Hindi closing debate question in Hindi",
      "captionText": "UPPERCASE CLOSING QUESTION TO VIEWERS"
    }
  ],
  "visualSceneQueries": [
    "cricket stadium floodlights crowd night",
    "cricket bat and ball nets practice pitch",
    "cricket batsman powerful match boundary shot",
    "cricket team victory celebration golden trophy"
  ],
  "tags": ["Cricket", "IPL", "TacticalExplainer", "Shorts"]
}`;

      const userPrompt = topicSeed
        ? `Generate a 5-beat tactical squad explainer Short on this specific topic: "${topicSeed}". Focus on current 2026/2027 context, real numbers, and deep tactical strategy.`
        : `Generate a fresh, high-energy 5-beat tactical squad explainer Short for 2026/2027. Recent topics covered: ${recentTopics.slice(0, 8).join(', ')}. Pick a completely fresh, exciting franchise or international dilemma.`;

      const aiResponse = await generateGeminiJson({
        prompt: userPrompt,
        systemPrompt,
        temperature: 0.7,
        maxOutputTokens: 1800,
        timeoutMs: 18000,
      });

      if (aiResponse && aiResponse.beats && Array.isArray(aiResponse.beats) && aiResponse.beats.length >= 4) {
        // Sanitize AI outputs against clichés
        for (const b of aiResponse.beats) {
          if (containsBannedPhrases(b.narration)) {
            b.narration = sanitizeScriptText(b.narration);
          }
        }
        aiGenerated = aiResponse;
        logger.success(`[Slot 6 Explainer] Successfully generated tactical script via Gemini: "${aiResponse.title}"`);
      }
    } catch (err) {
      logger.warn(`[Slot 6 Explainer] Gemini generation error: ${err.message}. Falling back to procedural scenarios.`);
    }
  }

  // 2. Select scenario if AI not used or failed
  if (aiGenerated) {
    chosenScenario = aiGenerated;
  } else {
    logger.info('[Slot 6 Explainer] Using verified tactical procedural synthesizer.');
    let available = TACTICAL_SCENARIOS.filter((s) => !isTopicRecentlyPublished(s.headline, 25));

    if (topicSeed) {
      const matched = TACTICAL_SCENARIOS.filter(
        (s) =>
          s.id.toLowerCase().includes(topicSeed) ||
          s.team.toLowerCase().includes(topicSeed) ||
          s.topicKey.toLowerCase().includes(topicSeed) ||
          s.title.toLowerCase().includes(topicSeed)
      );
      if (matched.length > 0) available = matched;
    }

    chosenScenario = available.length > 0
      ? available[Math.floor(Math.random() * available.length)]
      : TACTICAL_SCENARIOS[Math.floor(Math.random() * TACTICAL_SCENARIOS.length)];
  }

  // Extract beats and metadata
  const beats = chosenScenario.beats.map((b, idx) => ({
    beatIndex: idx,
    visualMode: b.visualMode || 'big_stat',
    headlineTag: b.headlineTag || chosenScenario.headline || 'TACTICAL EXPLAINER',
    bigStat: b.bigStat || '',
    subStat: b.subStat || '',
    cardData: b.cardData || {},
    narration: sanitizeScriptText(b.narration),
    captionText: (b.captionText || '').toUpperCase(),
  }));

  const teamKey = chosenScenario.team || 'DEFAULT';
  const headline = chosenScenario.headline || 'IPL TACTICAL EXPLAINER';
  const formattedTitle = chosenScenario.title || `${headline} | Tactical Breakdown`;

  const voiceScript = beats.map((b) => b.narration).join(' ');
  const subtitleText = beats.map((b) => b.captionText).join(' ');
  const segments = beats.map((b) => ({
    hindi: b.narration,
    english: b.captionText,
  }));

  const tags = [
    'Cricket',
    'IPL',
    'CricketShorts',
    'TacticalExplainer',
    'Shorts',
    'ViralShorts',
    ...(chosenScenario.tags || []),
    teamKey,
  ].map((t) => t.replace(/[^a-zA-Z0-9]/g, ''));

  const description = `${formattedTitle}\n\n` +
    `🏏 Beat-by-Beat Tactical Cricket & Squad Explainer:\n` +
    `• Topic: ${headline}\n` +
    `• Team / Subject: ${teamKey}\n` +
    `• High-energy Hindi tactical analysis with real squad insights & burned-in English captions.\n\n` +
    `Which tactical move would you back? Share your thoughts below!\n\n` +
    `Follow`;

  const bgMusicPath = path.join(config.assetsDir, 'audio', 'cricket.mp3');
  const sfxAudioPath = path.join(config.assetsDir, 'audio', 'whoosh.mp3');

  const visualSceneQueries = Array.isArray(chosenScenario.visualSceneQueries) && chosenScenario.visualSceneQueries.length >= 3
    ? chosenScenario.visualSceneQueries
    : [
        'cricket stadium floodlights crowd night',
        'cricket bat and ball nets practice pitch',
        'cricket batsman powerful match boundary shot',
        'cricket team victory celebration golden trophy',
      ];

  return {
    slot: 'slot6',
    slotName: 'Cricket Tactical & Squad Explainer',
    title: formattedTitle.slice(0, 95),
    headline,
    cleanTitle: headline,
    team: teamKey,
    primaryPlayer: teamKey,
    beats,
    description,
    tags,
    voice: config.voices.slot6 || config.voices.slot5 || 'hi-IN-MadhurNeural',
    pitch: '+0Hz',
    rate: '+10%', // High-energy commentary pacing
    voiceScript,
    subtitleText,
    englishSubtitles: subtitleText,
    segments,
    bgMusicPath,
    sfxAudioPath,
    visualSceneQueries,
    categoryId: '17', // YouTube category: Sports
  };
}

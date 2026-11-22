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
 * Verified Real IPL & Cricket Tactical Scenarios
 * Grounded in verified auction purses, retentions, departures, and tactical dynamics.
 */
export const TACTICAL_SCENARIOS = [
  {
    id: 'kkr_auction_blueprint',
    team: 'KKR',
    franchiseName: 'Kolkata Knight Riders',
    topicKey: 'KKR Captaincy & Auction Blueprint',
    title: 'KKR Auction Puzzle: Shreyas Iyer Departure & ₹51 Cr Rebuild',
    headline: 'KKR AUCTION PUZZLE • ₹51 CR REBUILD',
    beats: [
      {
        beatIndex: 0,
        visualMode: 'big_stat',
        headlineTag: 'KKR AUCTION BLUEPRINT',
        bigStat: '₹51 CRORE',
        subStat: 'REMAINING PURSE • 6 SLOTS',
        cardData: {
          bigStat: '₹51 CRORE',
          subStat: 'REMAINING PURSE • 6 SLOTS',
          label: 'AUCTION WAR CHEST',
          highlight: 'CHAMPION CORE RESET',
          context1: 'Title winners entered auction without designated captain',
          context2: '6 elite retentions locked, 19 roster spots to fill',
        },
        narration: 'कोलकाता नाइट राइडर्स चैंपियन बनने के बाद इक्यावन करोड़ के पर्स के साथ नीलामी में उतरी, लेकिन सबसे बड़ा सवाल था कप्तान कौन बनेगा!',
        captionText: 'KKR ENTERED THE AUCTION WITH ₹51 CRORE PURSE, BUT WITH NO CAPTAIN LOCKED IN!',
      },
      {
        beatIndex: 1,
        visualMode: 'squad_grid',
        headlineTag: 'SQUAD BALANCE & VACANCIES',
        cardData: {
          gridTitle: 'RETAINED CORE VS OPEN SLOTS',
          gridItems: [
            { slot: 'SPIN TWINS', player: 'Narine & Varun', status: 'LOCKED', tag: 'STRENGTH' },
            { slot: 'FINISHER CORE', player: 'Rinku & Russell', status: 'LOCKED', tag: 'FIREPOWER' },
            { slot: 'CAPTAINCY', player: 'No Designated Leader', status: 'VACANT', tag: 'URGENT' },
            { slot: 'INDIAN PACE', player: 'Harshit Rana Only', status: 'THIN', tag: 'REBUILD' },
          ],
        },
        narration: 'सुनील नरेन, वरुण चक्रवर्ती, रिंकू सिंह और आंद्रे रसेल के रूप में कोर मजबूत है, लेकिन टीम के पास भारतीय तेज गेंदबाज और कप्तान की भारी कमी थी।',
        captionText: 'NARINE, VARUN, RINKU AND RUSSELL PROVIDE POWER, BUT PACE AND LEADERSHIP REMAIN OPEN!',
      },
      {
        beatIndex: 2,
        visualMode: 'departure_replacement',
        headlineTag: 'DEPARTURE VS TARGET',
        cardData: {
          title: 'DEPARTURE VS REPLACEMENT DILEMMA',
          outPlayer: { name: 'Shreyas Iyer', price: '₹12.25 Cr', role: 'Title-Winning Captain', status: 'RELEASED' },
          inTarget: { name: 'Venkatesh / Indian Core', price: '₹15+ Cr Target', role: 'Leadership & Anchor', status: 'PRIORITY' },
          takeaway: 'Replacing an IPL-winning captain is the toughest auction assignment.',
        },
        narration: 'श्रेयस अय्यर का अलग होना बहुत बड़ा झटका था, क्योंकि चैंपियन कप्तान की जगह लेना कभी आसान नहीं होता। वेंकटेश अय्यर को वापस लाना पहली प्राथमिकता बन गया।',
        captionText: 'RELEASING TITLE CAPTAIN SHREYAS IYER CREATED A MASSIVE GAP IN THE LEADERSHIP SPINE!',
      },
      {
        beatIndex: 3,
        visualMode: 'tactical_twist',
        headlineTag: 'THE TACTICAL PARADOX',
        cardData: {
          twistTitle: 'THE EDEN GARDENS PARADOX',
          point1: 'Eden 220+ Highway pitches demand minimum 6 genuine bowling options.',
          point2: 'Without Mitchell Starc, powerplay wickets rely entirely on Harshit Rana.',
        },
        narration: 'ईडन गार्डन्स की 220 प्लस पिच पर सिर्फ स्पिन से काम नहीं चल सकता। स्टार्क के बिना पावरप्ले में विकेट निकालने का सारा दबाव हर्षित राणा पर आ गया।',
        captionText: 'HIGH-SCORING EDEN TRACKS REQUIRE 6 BOWLING OPTIONS; PACE DEPTH WILL DECIDE THE SEASON!',
      },
      {
        beatIndex: 4,
        visualMode: 'question_hook',
        headlineTag: 'VERDICT & DEBATE',
        cardData: {
          questionTitle: 'THE BIG KKR VERDICT',
          optionA: 'Back Venkatesh Iyer as Full-Time Captain',
          optionB: 'Hand Captaincy to Overseas Star Russell/Narine',
          callToAction: 'Which captaincy formula guarantees KKR defending their trophy?',
        },
        narration: 'क्या केकेआर को वेंकटेश अय्यर को कप्तानी सौंपनी चाहिए, या किसी विदेशी सितारे पर भरोसा करना चाहिए? कमेंट्स में अपनी राय बताइए!',
        captionText: 'SHOULD KKR APPOINT VENKATESH IYER AS CAPTAIN OR GO WITH AN OVERSEAS LEADER? VOTE BELOW!',
      },
    ],
  },
  {
    id: 'csk_pace_arsenal',
    team: 'CSK',
    franchiseName: 'Chennai Super Kings',
    topicKey: 'CSK Pace Arsenal & Ruturaj Era',
    title: 'CSK Tactical Blueprint: Ruturaj Captaincy & Pace Battery Rebuild',
    headline: 'CSK PACE ARSENAL • RUTURAJ ERA',
    beats: [
      {
        beatIndex: 0,
        visualMode: 'big_stat',
        headlineTag: 'CSK WAR CHEST',
        bigStat: '₹55 CRORE',
        subStat: 'REMAINING PURSE • CHEPAUK FORTRESS',
        cardData: {
          bigStat: '₹55 CRORE',
          subStat: 'REMAINING PURSE • 5 RETAINED STARS',
          label: 'AUCTION STRATEGY',
          highlight: 'DHONI UNCAPPED ERA',
          context1: 'MS Dhoni retained under uncapped player rule at ₹4 Crore',
          context2: 'Ruturaj and Jadeja lead the ₹18 Cr top tier',
        },
        narration: 'चेन्नई सुपर किंग्स पचपन करोड़ के पर्स के साथ मैदान में उतरी, जहां धोनी को अनकैप्ड नियम से चार करोड़ में रिटेन करके मास्टरस्ट्रोक खेला गया!',
        captionText: 'CSK RETAINED MS DHONI AT ₹4 CRORE WITH A ₹55 CRORE PURSE FOR SQUAD RECONSTRUCTION!',
      },
      {
        beatIndex: 1,
        visualMode: 'squad_grid',
        headlineTag: 'CSK ROSTER BALANCE',
        cardData: {
          gridTitle: 'CORE PILLARS VS PACE NEEDS',
          gridItems: [
            { slot: 'CAPTAIN & OPENER', player: 'Ruturaj Gaikwad', status: 'LOCKED', tag: 'STABLE' },
            { slot: 'SPIN & FINISHER', player: 'Jadeja & Dube', status: 'LOCKED', tag: 'MATCH WINNERS' },
            { slot: 'DEATH WEAPON', player: 'Matheesha Pathirana', status: 'LOCKED', tag: 'LETHAL' },
            { slot: 'INDIAN PACERS', player: 'Chahar & Shardul Out', status: 'VACANT', tag: 'CRITICAL' },
          ],
        },
        narration: 'ऋतुराज, जडेजा और शिवम दुबे का भारतीय कोर तैयार है, और पथिराना डेथ ओवर्स के यॉर्कर किंग हैं। लेकिन नई गेंद का सीमर ढूंढना सबसे बड़ी चुनौती थी।',
        captionText: 'RUTURAJ, JADEJA, DUBE AND PATHIRANA FORM THE SPINE, BUT NEW-BALL PACERS ARE NEEDED!',
      },
      {
        beatIndex: 2,
        visualMode: 'departure_replacement',
        headlineTag: 'PACE REBUILD',
        cardData: {
          title: 'INDIAN PACE RESTRUCTURING',
          outPlayer: { name: 'Deepak Chahar', price: '₹14 Cr Slot', role: 'Powerplay Swing Spearhead', status: 'RELEASED' },
          inTarget: { name: 'Indian Seam Targets', price: '₹8-12 Cr Budget', role: 'Khaleel / Kamboj / Seamers', status: 'SEARCH' },
          takeaway: 'Chepauk now demands pace hit-the-deck skills alongside spin.',
        },
        narration: 'दीपक चाहर और शार्दुल ठाकुर के जाने से पावरप्ले में स्विंग का खालीपन आया। सीएसके को ऐसे भारतीय तेज गेंदबाज चाहिए जो चेपॉक के नए ट्रैक पर रन रोक सकें।',
        captionText: 'LOSING DEEPAK CHAHAR CREATES A VACUUM IN EARLY POWERPLAY WICKETS AT CHEPAUK!',
      },
      {
        beatIndex: 3,
        visualMode: 'tactical_twist',
        headlineTag: 'CHEPAUK TACTICAL SHIFT',
        cardData: {
          twistTitle: 'THE MODERN CHEPAUK REALITY',
          point1: 'Chepauk pitches now produce 200+ totals with flat powerplay boundaries.',
          point2: 'Spin choke only works in middle overs if early wickets fall in first 6 overs.',
        },
        narration: 'चेपॉक अब पहले जैसा स्लो टर्निंग ट्रैक नहीं रहा। 200 प्लस के मैच में अगर पावरप्ले में विकेट नहीं मिले, तो मिडिल ओवर्स में स्पिनर्स पर भी अटैक होता है।',
        captionText: 'CHEPAUK HAS EVOLVED INTO A HIGH-SCORING DECK; EARLY WICKETS ARE NON-NEGOTIABLE!',
      },
      {
        beatIndex: 4,
        visualMode: 'question_hook',
        headlineTag: 'CSK DEBATE',
        cardData: {
          questionTitle: 'THE RUTURAJ ERA TARGET',
          optionA: 'Spend Heavily on Top Indian Fast Bowler',
          optionB: 'Rely on All-Round Depth and Spin Choke',
          callToAction: 'Which bowling strategy takes CSK to their 6th IPL title?',
        },
        narration: 'क्या ऋतुराज गायकवाड़ की कप्तानी में सीएसके अपनी छठी ट्रॉफी जीत पाएगी? अपनी राय कमेंट्स में बताएं!',
        captionText: 'CAN RUTURAJ GAIKWAD LEAD CSK TO THEIR RECORD 6TH IPL TROPHY? SHARE YOUR THOUGHTS!',
      },
    ],
  },
  {
    id: 'mi_hardik_rohit_bowling',
    team: 'MI',
    franchiseName: 'Mumbai Indians',
    topicKey: 'MI 5-Star Core & Death Bowling Puzzle',
    title: 'MI Tactical Paradox: 5-Star Indian Core & Death Overs Puzzle',
    headline: 'MI AUCTION DILEMMA • BUMRAH & CO.',
    beats: [
      {
        beatIndex: 0,
        visualMode: 'big_stat',
        headlineTag: 'MI STAR RETENTIONS',
        bigStat: '₹45 CRORE',
        subStat: 'REMAINING PURSE • 5 MEGASTARS',
        cardData: {
          bigStat: '₹45 CRORE',
          subStat: 'REMAINING PURSE • 5 INDIAN SUPERSTARS',
          label: 'ROSTER CONSTRAINTS',
          highlight: 'TOP-HEAVY SALARY CAP',
          context1: 'Bumrah (18 Cr), Surya (16.35 Cr), Hardik (16.35 Cr), Rohit (16.3 Cr)',
          context2: 'Over ₹75 Crore locked in 5 world-class Indian players',
        },
        narration: 'मुंबई इंडियंस ने बुमराह, रोहित, सूर्या, हार्दिक और तिलक पर पिचहत्तर करोड़ खर्च कर दिए, जिससे पर्स में सिर्फ पैंतालीस करोड़ बचे!',
        captionText: 'MUMBAI INDIANS LOCKED OVER ₹75 CRORE IN 5 SUPERSTARS, LEAVING JUST ₹45 CRORE IN THE PURSE!',
      },
      {
        beatIndex: 1,
        visualMode: 'squad_grid',
        headlineTag: 'MI SQUAD BALANCE',
        cardData: {
          gridTitle: 'WORLD-CLASS CORE VS HOLES',
          gridItems: [
            { slot: 'WORLD NO.1 PACER', player: 'Jasprit Bumrah', status: 'LOCKED', tag: 'IMMORTAL' },
            { slot: 'T20 BEST BATSMAN', player: 'Suryakumar Yadav', status: 'LOCKED', tag: '360 DEGREE' },
            { slot: 'LEADERSHIP & FINISH', player: 'Rohit & Hardik', status: 'LOCKED', tag: 'CHAMPIONS' },
            { slot: 'OVERSEAS BOWLING', player: 'Coetzee & Madhwal Gap', status: 'VACANT', tag: 'ALARMING' },
          ],
        },
        narration: 'बल्लेबाजी में रोहित, सूर्या और हार्दिक का कोई मुकाबला नहीं है, और बुमराह दुनिया के सबसे घातक गेंदबाज हैं। लेकिन बाकी सोलह ओवर्स कौन डालेगा?',
        captionText: 'THE TOP ORDER AND BUMRAH ARE WORLD-CLASS, BUT WHO BOWLS THE OTHER 16 OVERS AT WANKHEDE?',
      },
      {
        beatIndex: 2,
        visualMode: 'departure_replacement',
        headlineTag: 'WICKETKEEPER VOID',
        cardData: {
          title: 'ISHAN KISHAN DEPARTURE',
          outPlayer: { name: 'Ishan Kishan', price: '₹15.25 Cr Buy', role: 'Powerplay Wicketkeeper Opener', status: 'RELEASED' },
          inTarget: { name: 'Dynamic Keeper-Opener', price: '₹6-9 Cr Budget', role: 'Rickelton / Indian Wicketkeeper', status: 'SEARCH' },
          takeaway: 'Replacing Ishan Kishan requires a high strike-rate wicketkeeper.',
        },
        narration: 'ईशान किशन को रिलीज करना बड़ा फैसला था। मुंबई को एक ऐसा विकेटकीपर चाहिए जो वानखेड़े में पहले छह ओवर में बिना रुके चौके-छक्के लगा सके।',
        captionText: 'RELEASING ISHAN KISHAN LEAVES A MAJOR VACANCY FOR AN AGGRESSIVE POWERPLAY WICKETKEEPER!',
      },
      {
        beatIndex: 3,
        visualMode: 'tactical_twist',
        headlineTag: 'WANKHEDE TACTICAL PARADOX',
        cardData: {
          twistTitle: 'THE WANKHEDE REALITY',
          point1: 'Bumrah gives 4 overs for 22 runs, but the remaining 16 overs often leak 180+.',
          point2: 'Without a quality second pacer and spinner, 230 chases become routine.',
        },
        narration: 'वानखेड़े की फ्लैट पिच और छोटी बाउंड्री पर बुमराह चार ओवर में बाइस रन देते हैं, लेकिन बाकी गेंदबाज एक सौ अस्सी रन लुटा देते हैं। यह मुंबई की असली कमजोरी है।',
        captionText: 'BUMRAH CONCEDES UNDER 25, BUT THE OTHER 16 OVERS LEAK 180+ ON FLAT WANKHEDE DECKS!',
      },
      {
        beatIndex: 4,
        visualMode: 'question_hook',
        headlineTag: 'MI VERDICT',
        cardData: {
          questionTitle: 'THE MI BOWLING DILEMMA',
          optionA: 'Spend Entire Purse on Two Express Fast Bowlers',
          optionB: 'Back Domestic Indian Bowlers Around Bumrah',
          callToAction: 'Can Mumbai Indians win their 6th title under Hardik Pandya?',
        },
        narration: 'क्या हार्दिक पंड्या की कप्तानी में मुंबई इंडियंस अपनी छठी ट्रॉफी जीत पाएगी? अपनी राय कमेंट्स में जरूर बताइए!',
        captionText: 'CAN HARDIK PANDYA LEAD MUMBAI INDIANS TO TROPHY NUMBER 6? CAST YOUR VOTE!',
      },
    ],
  },
  {
    id: 'rcb_chinnaswamy_reset',
    team: 'RCB',
    franchiseName: 'Royal Challengers Bengaluru',
    topicKey: 'RCB ₹83 Cr War Chest & Chinnaswamy Blueprint',
    title: 'RCB Auction Strategy: ₹83 Cr War Chest & Chinnaswamy Bowling Reality',
    headline: 'RCB ₹83 CR RESET • CHINNASWAMY BLUEPRINT',
    beats: [
      {
        beatIndex: 0,
        visualMode: 'big_stat',
        headlineTag: 'RCB MEGA WAR CHEST',
        bigStat: '₹83 CRORE',
        subStat: 'SECOND LARGEST PURSE • BLANK SLATE',
        cardData: {
          bigStat: '₹83 CRORE',
          subStat: 'REMAINING PURSE • ONLY 3 PLAYERS RETAINED',
          label: 'AUCTION POWER',
          highlight: 'CLEAN SLATE RESET',
          context1: 'Virat Kohli retained at ₹21 Cr alongside Patidar & Dayal',
          context2: 'Over 18 vacant squad spots with massive financial power',
        },
        narration: 'आरसीबी तिरासी करोड़ के विशाल पर्स के साथ नीलामी में उतरी! सिर्फ विराट कोहली, रजत पाटीदार और यश दयाल को रिटेन करके पूरी टीम नए सिरे से बनाने का फैसला लिया गया।',
        captionText: 'RCB ENTERED THE MEGA AUCTION WITH ₹83 CRORE PURSE AFTER RETAINING ONLY 3 PLAYERS!',
      },
      {
        beatIndex: 1,
        visualMode: 'squad_grid',
        headlineTag: 'RCB SQUAD REBUILD',
        cardData: {
          gridTitle: 'CORE ANCHORS VS OPEN SQUAD',
          gridItems: [
            { slot: 'CHAMPION ANCHOR', player: 'Virat Kohli (₹21 Cr)', status: 'LOCKED', tag: 'GOAT' },
            { slot: 'SPIN DESTROYER', player: 'Rajat Patidar (₹11 Cr)', status: 'LOCKED', tag: 'AGGRESSIVE' },
            { slot: 'LEFT-ARM SEAM', player: 'Yash Dayal (₹5 Cr)', status: 'LOCKED', tag: 'CLUTCH' },
            { slot: 'CAPTAIN & SPEED', player: 'Entire Attack Open', status: 'VACANT', tag: 'WAR CHEST' },
          ],
        },
        narration: 'विराट कोहली की क्लास और रजत पाटीदार की स्पिन के खिलाफ मारक क्षमता पक्की है। लेकिन कप्तान कौन होगा और चिन्नास्वामी में गेंदबाजी कौन संभालेगा?',
        captionText: 'KOHLI AND PATIDAR SECURE THE BATTING, BUT LEADERSHIP AND BOWLING ARE TOTALLY OPEN!',
      },
      {
        beatIndex: 2,
        visualMode: 'departure_replacement',
        headlineTag: 'FAF & MAXWELL EXIT',
        cardData: {
          title: 'OVERSEAS CORE DISMANTLED',
          outPlayer: { name: 'Faf du Plessis & Maxwell', price: 'Captains Released', role: 'Leader & Explosive All-Rounder', status: 'RELEASED' },
          inTarget: { name: 'New Captain & Power Finishers', price: '₹30+ Cr Allocated', role: 'Phil Salt / Indian Seam Core', status: 'PRIORITY' },
          takeaway: 'Chinnaswamy requires fearlessness at both ends of the innings.',
        },
        narration: 'फाफ डुप्लेसिस और ग्लेन मैक्सवेल के जाने से लीडरशिप खाली हुई। आरसीबी को ऐसे खिलाड़ी चाहिए जो दो सौ बीस के दबाव में भी बेखौफ क्रिकेट खेल सकें।',
        captionText: 'MOVING ON FROM FAF AND MAXWELL DEMANDS A BRAND-NEW TACTICAL IDENTITY FOR RCB!',
      },
      {
        beatIndex: 3,
        visualMode: 'tactical_twist',
        headlineTag: 'CHINNASWAMY 65M PUZZLE',
        cardData: {
          twistTitle: 'THE 65-METER BOUNDARY TRUTH',
          point1: 'Chinnaswamy boundaries are 65 meters where even mistimed edges fly for six.',
          point2: 'Bowlers need extreme 145+ pace or deceptive back-of-hand slower cutters.',
        },
        narration: 'चिन्नास्वामी की बाउंड्री सिर्फ पैंसठ मीटर है, जहां मिसटाइम शॉट भी छक्का हो जाता है। यहां औसत गेंदबाजी नहीं चल सकती, सिर्फ एक सौ पैंतालीस की रफ्तार और कटर्स ही बचा सकते हैं।',
        captionText: 'AT 65-METER CHINNASWAMY, MISTIMED HITS FLY FOR SIX; RCB NEED GENUINE WICKET-TAKERS!',
      },
      {
        beatIndex: 4,
        visualMode: 'question_hook',
        headlineTag: 'RCB VERDICT',
        cardData: {
          questionTitle: 'THE RCB CAPTAINCY CALL',
          optionA: 'Bring Back Virat Kohli as RCB Captain',
          optionB: 'Appoint an Aggressive New Young Leader',
          callToAction: 'Can this ₹83 Cr squad finally break RCB’s title drought?',
        },
        narration: 'क्या विराट कोहली को दोबारा आरसीबी का कप्तान बनना चाहिए, या किसी नए युवा चेहरे को कमान मिलनी चाहिए? कमेंट्स में अपनी राय बताइए!',
        captionText: 'SHOULD VIRAT KOHLI RETURN AS RCB CAPTAIN, OR SHOULD RCB BACK A NEW LEADER? VOTE NOW!',
      },
    ],
  },
  {
    id: 'srh_explosive_storm',
    team: 'SRH',
    franchiseName: 'Sunrisers Hyderabad',
    topicKey: 'SRH 270+ Storm & Bowling Balance',
    title: 'SRH 270+ Destruction Formula: Explosive Batting vs Bowling Rebuild',
    headline: 'SRH 270+ BLUEPRINT • BOWLING PUZZLE',
    beats: [
      {
        beatIndex: 0,
        visualMode: 'big_stat',
        headlineTag: 'RECORD RETENTIONS',
        bigStat: '₹23 CRORE',
        subStat: 'HEINRICH KLAASEN • HISTORIC RETENTION',
        cardData: {
          bigStat: '₹23 CRORE',
          subStat: 'HIGHEST RETENTION SLAB • HEINRICH KLAASEN',
          label: 'FIREPOWER INVESTMENT',
          highlight: 'UNPRECEDENTED CONTRACT',
          context1: 'Pat Cummins (18 Cr), Abhishek (14 Cr), Head (14 Cr), Nitish (6 Cr)',
          context2: 'Retained the core that scored 287 & 266 in IPL 2024',
        },
        narration: 'सनराइजर्स हैदराबाद ने हेनरिक क्लासेन को तेईस करोड़ देकर आईपीएल इतिहास का सबसे बड़ा रिटेंशन दांव खेल दिया!',
        captionText: 'SRH SECURED HEINRICH KLAASEN AT ₹23 CRORE, BACKING THEIR FEARLESS 270+ BATTING TEMPLATE!',
      },
      {
        beatIndex: 1,
        visualMode: 'squad_grid',
        headlineTag: 'SRH EXPLOSIVE ENGINE',
        cardData: {
          gridTitle: 'DESTRUCTIVE TOP 5 VS BOWLING',
          gridItems: [
            { slot: 'BLITZ OPENERS', player: 'Head & Abhishek', status: 'LOCKED', tag: '250+ TEMPLATE' },
            { slot: 'MIDDLE ORDER BEAST', player: 'Heinrich Klaasen', status: 'LOCKED', tag: 'UNSTOPPABLE' },
            { slot: 'LEADER & PACER', player: 'Pat Cummins (Captain)', status: 'LOCKED', tag: 'TACTICAL BRAIN' },
            { slot: 'SPECIALIST SPINNERS', player: 'No Premier Spinner', status: 'VACANT', tag: 'VULNERABLE' },
          ],
        },
        narration: 'ट्रेविस हेड, अभिषेक शर्मा और क्लासेन की तिकड़ी दो सौ अस्सी रन ठोकने की ताकत रखती है, और पैट कमिंस कमाल के कप्तान हैं। लेकिन स्पेशलिस्ट स्पिनर और डेथ बॉलिंग का क्या?',
        captionText: 'HEAD, ABHISHEK AND KLAASEN CAN DESTROY ANY ATTACK, BUT THE SPIN DEPARTMENT IS EMPTY!',
      },
      {
        beatIndex: 2,
        visualMode: 'departure_replacement',
        headlineTag: 'INDIAN PACE OVERHAUL',
        cardData: {
          title: 'DEATH BOWLING TRANSITION',
          outPlayer: { name: 'Bhuvneshwar & Natarajan', price: 'Veterans Released', role: 'Swing Master & Yorker King', status: 'RELEASED' },
          inTarget: { name: 'Mohammed Shami / Pace Targets', price: '₹12+ Cr Budget', role: 'Powerplay Strike Bowler', status: 'HUNT' },
          takeaway: 'Replacing Bhuvneshwar Kumar’s new-ball swing is essential.',
        },
        narration: 'भुवनेश्वर कुमार और टी नटराजन को छोड़ना बड़ा जोखिम था। नई गेंद के स्विंग और अंतिम ओवरों के यॉर्कर का विकल्प हैदराबाद को हर हाल में तलाशना होगा।',
        captionText: 'LETTING GO OF BHUVNESHWAR AND NATARAJAN STRIPS SRH OF EXPERIENCED INDIAN SEAM DEPTH!',
      },
      {
        beatIndex: 3,
        visualMode: 'tactical_twist',
        headlineTag: 'GRIPPING PITCH DILEMMA',
        cardData: {
          twistTitle: 'THE FLAT DECK TRAP',
          point1: 'When pitches grip or turn, SRH’s all-out attack risks collapses inside 12 overs.',
          point2: 'Championship teams need defensive bowling control when 175 is a winning score.',
        },
        narration: 'जब पिच धीमी होती है या गेंद ग्रिप करती है, तो अंधाधुंध चौके-छक्के मारना मुश्किल होता है। एक सौ पचहत्तर के लो-स्कोरिंग मैच में हैदराबाद की गेंदबाजी की असली परीक्षा होगी।',
        captionText: 'ON SLOW GRIPPING DECKS, ALL-OUT AGGRESSION FAILS; DEFENSIVE BOWLING IS REQUIRED!',
      },
      {
        beatIndex: 4,
        visualMode: 'question_hook',
        headlineTag: 'SRH VERDICT',
        cardData: {
          questionTitle: 'THE HYDERABAD TITLE FORMULA',
          optionA: 'Double Down on Ultra-Aggressive 250+ Batting',
          optionB: 'Balance the Playing 11 with Defensive Spin Bowling',
          callToAction: 'Can Pat Cummins take SRH all the way to the trophy this time?',
        },
        narration: 'क्या पैट कमिंस इस बार सनराइजर्स हैदराबाद को चैंपियन बना पाएंगे? अपनी राय कमेंट्स में जरूर बताइए!',
        captionText: 'CAN PAT CUMMINS LEAD HYDERABAD TO THE IPL TROPHY THIS SEASON? DROP YOUR VERDICT!',
      },
    ],
  },
  {
    id: 'pbks_record_rebuild',
    team: 'PBKS',
    franchiseName: 'Punjab Kings',
    topicKey: 'PBKS Record ₹110 Cr Purse & Ponting Era',
    title: 'PBKS ₹110.5 Cr Record Auction War Chest: Ricky Ponting Blank Slate',
    headline: 'PBKS ₹110 CR WAR CHEST • PONTING ERA',
    beats: [
      {
        beatIndex: 0,
        visualMode: 'big_stat',
        headlineTag: 'ALL-TIME RECORD PURSE',
        bigStat: '₹110.5 CR',
        subStat: 'ALL-TIME IPL RECORD PURSE • 18 VACANCIES',
        cardData: {
          bigStat: '₹110.5 CR',
          subStat: 'HIGHEST AUCTION PURSE IN IPL HISTORY',
          label: 'FINANCIAL DOMINANCE',
          highlight: 'UNLIMITED BIDDING POWER',
          context1: 'Retained only Shashank Singh (5.5 Cr) & Prabhsimran (4 Cr)',
          context2: 'Over ₹110 Crore to outbid any franchise for marquee stars',
        },
        narration: 'पंजाब किंग्स ने एक सौ दस करोड़ पचास लाख के रिकॉर्ड पर्स के साथ इतिहास रच दिया! सिर्फ शशांक सिंह और प्रभसिमरन सिंह को रिटेन करके पूरी स्लेट साफ कर दी।',
        captionText: 'PUNJAB KINGS BROKE ALL IPL RECORDS WITH A MASSIVE ₹110.5 CRORE AUCTION PURSE!',
      },
      {
        beatIndex: 1,
        visualMode: 'squad_grid',
        headlineTag: 'PBKS CLEAN SLATE',
        cardData: {
          gridTitle: 'UNCAPPED PAIR VS CLEAN CANVAS',
          gridItems: [
            { slot: 'CLUTCH FINISHER', player: 'Shashank Singh', status: 'LOCKED', tag: 'PROVEN' },
            { slot: 'BLITZ OPENER', player: 'Prabhsimran Singh', status: 'LOCKED', tag: 'DANGEROUS' },
            { slot: 'HEAD COACH', player: 'Ricky Ponting', status: 'LOCKED', tag: 'SERIAL WINNER' },
            { slot: 'SQUAD SPINE (1-11)', player: '18 Open Auction Slots', status: 'VACANT', tag: 'BUY ANYTHING' },
          ],
        },
        narration: 'रिकी पोंटिंग के हेड कोच बनते ही पंजाब के पास मनचाहा खिलाड़ी खरीदने की ताकत है। वे ऑक्शन टेबल पर किसी भी टीम को आसानी से आउट-बिड कर सकते हैं।',
        captionText: 'WITH RICKY PONTING AT THE HELM AND ₹110 CR, PBKS CAN OUT-BID ANYONE ON THE AUCTION FLOOR!',
      },
      {
        beatIndex: 2,
        visualMode: 'departure_replacement',
        headlineTag: 'MARQUEE TARGETS',
        cardData: {
          title: 'PURSUING MARQUEE LEADERS',
          outPlayer: { name: 'Sam Curran & Rabada', price: 'High Contracts', role: 'Costly Overseas Stars', status: 'RELEASED' },
          inTarget: { name: 'Shreyas Iyer / Rishabh Pant', price: '₹20-25 Cr Target', role: 'Franchise Captain & Face', status: 'PRIORITY' },
          takeaway: 'PBKS must secure a proven Indian captain to anchor the squad.',
        },
        narration: 'सैम करन और रबाडा को हटाकर पंजाब ने साफ कर दिया कि वे एक बड़े भारतीय कप्तान और विकेटकीपर के लिए पच्चीस करोड़ तक की बोली लगाने को तैयार हैं।',
        captionText: 'RELEASING OVERSEAS UNDERPERFORMERS FREES PBKS TO HUNT A PREMIER INDIAN LEADER!',
      },
      {
        beatIndex: 3,
        visualMode: 'tactical_twist',
        headlineTag: 'THE COHESION PARADOX',
        cardData: {
          twistTitle: 'THE 48-HOUR SQUAD RISK',
          point1: 'Buying 18 players from scratch creates an immediate chemistry challenge.',
          point2: 'Individual marquee talent does not automatically create a functioning team.',
        },
        narration: 'लेकिन ज्यादा पैसा होना ही जीत की गारंटी नहीं होता। अड़तालीस घंटे में अठारह नए खिलाड़ी खरीदकर टीम का माहौल और तालमेल बनाना सबसे कठिन काम है।',
        captionText: 'MONEY DOES NOT BUY TEAM CHEMISTRY; BUILDING AN ENTIRE 20-MAN ROSTER CARRIES HIGH RISK!',
      },
      {
        beatIndex: 4,
        visualMode: 'question_hook',
        headlineTag: 'PBKS VERDICT',
        cardData: {
          questionTitle: 'THE PONTING REVOLUTION',
          optionA: 'Spend Big on One ₹25 Cr Superstar Captain',
          optionB: 'Build a Deep, Balanced 18-Player Squad',
          callToAction: 'Can Ricky Ponting guide Punjab Kings to their first-ever IPL trophy?',
        },
        narration: 'क्या रिकी पोंटिंग पंजाब किंग्स को उनका पहला आईपीएल खिताब दिला पाएंगे? कमेंट्स में अपनी भविष्यवाणी बताइए!',
        captionText: 'WILL RICKY PONTING FINALLY DELIVER A CHAMPIONSHIP TO PUNJAB KINGS? SHARE YOUR VIEW!',
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
      const systemPrompt = `You are a premier cricket tactical analyst & IPL auction strategist for viral vertical Shorts (@dailypulseshortss).
Your task is to generate an energetic, fast-paced Hindi commentary script structured into exactly 5 timed beats (~50-60 seconds total), accompanied by punchy English subtitles and structured visual card metadata.

STRICT GLOBAL RULES:
1. ZERO GENERIC FILLER: Absolutely NO "सूत्रों की रिपोर्ट", "टीम मैनेजमेंट और चयनकर्ता", "रणनीतिक बैठक", "प्लेइंग 11 और रणनीतिक संतुलन", "फैसला सही है या भूल", or generic subscribe calls.
2. 100% REAL ACCURATE CRICKET DATA: Mention real IPL franchises, actual player names, real auction purses, retention numbers, and genuine tactical friction points (e.g., pitch dimensions, 200+ run rates, death bowling holes).
3. 5-BEAT STRUCTURE:
   - Beat 0: Hook & Big Numbers (visualMode: 'big_stat') -> Headline stat, purse/contract, curiosity hook.
   - Beat 1: Squad Balance & Vacancies (visualMode: 'squad_grid') -> 3-4 structured grid slots (Pillars vs Open Holes).
   - Beat 2: Departure vs Replacement (visualMode: 'departure_replacement') -> Key outgoing player vs target replacement.
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
      "bigStat": "₹51 CRORE",
      "subStat": "REMAINING PURSE • 6 SLOTS",
      "cardData": {
        "bigStat": "₹51 CRORE",
        "subStat": "REMAINING PURSE • 6 SLOTS",
        "label": "AUCTION WAR CHEST",
        "highlight": "CORE RESET",
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
      "headlineTag": "DEPARTURE VS TARGET",
      "cardData": {
        "title": "ROSTER TRANSITION",
        "outPlayer": { "name": "Player Out", "price": "Contract Info", "role": "Outgoing Role", "status": "RELEASED" },
        "inTarget": { "name": "Target In", "price": "Expected Price", "role": "Target Role", "status": "PRIORITY" },
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
  "tags": ["Cricket", "IPL", "Auction", "Shorts"]
}`;

      const userPrompt = topicSeed
        ? `Generate a 5-beat tactical squad & auction explainer Short on this specific topic: "${topicSeed}". Focus on real facts, real numbers, and deep tactical strategy.`
        : `Generate a fresh, high-energy 5-beat tactical squad & auction explainer Short. Recent topics covered: ${recentTopics.slice(0, 8).join(', ')}. Pick a completely fresh, exciting franchise or auction dilemma.`;

      const aiResponse = await generateGeminiJson({
        prompt: userPrompt,
        systemPrompt,
        temperature: 0.7,
        maxOutputTokens: 1800,
        timeoutMs: 18000,
      });

      if (aiResponse && aiResponse.beats && Array.isArray(aiResponse.beats) && aiResponse.beats.length >= 4) {
        // Sanitize AI outputs against clichés
        let clean = true;
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
    'IPLAuction',
    'Shorts',
    'ViralShorts',
    ...(chosenScenario.tags || []),
    teamKey,
  ].map((t) => t.replace(/[^a-zA-Z0-9]/g, ''));

  const description = `${formattedTitle}\n\n` +
    `🏏 Beat-by-Beat Tactical Cricket & Squad Explainer:\n` +
    `• Topic: ${headline}\n` +
    `• Team / Franchise: ${teamKey}\n` +
    `• High-energy Hindi tactical analysis with real squad numbers & burned-in English captions.\n\n` +
    `Which decision would you back? Share your thoughts below!`;

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

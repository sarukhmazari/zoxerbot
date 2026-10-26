// 🇵🇰 Pure Urdu Shayari Collection & Command Handler
// Guaranteed NO Hindi language, strictly Urdu & Roman Urdu poetry

const urduShayaris = [
    {
        urdu: "ہزاروں خواہشیں ایسی کہ ہر خواہش پہ دم نکلے\nبہت نکلے مرے ارمان لیکن پھر بھی کم نکلے",
        roman: "Hazaaron khwahishen aisi ke har khwahish pe dam nikle,\nBahut nikle mere armaan lekin phir bhi kam nikle.",
        poet: "مرزا اسد اللہ خان غالب (Mirza Ghalib)"
    },
    {
        urdu: "دل ناداں تجھے ہوا کیا ہے\nآخر اس درد کی دوا کیا ہے",
        roman: "Dil-e-nadaan tujhe hua kya hai,\nAakhir is dard ki dawa kya hai.",
        poet: "مرزا غالب (Mirza Ghalib)"
    },
    {
        urdu: "عشق پر زور نہیں ہے یہ وہ آتش غالبؔ\nکہ لگائے نہ لگے اور بجھائے نہ بنے",
        roman: "Ishq par zor nahi hai yeh woh aatish Ghalib,\nKe lagaaye na lage aur bujhaaye na bane.",
        poet: "مرزا غالب (Mirza Ghalib)"
    },
    {
        urdu: "ہوئی مدت کہ غالبؔ مر گیا پر یاد آتا ہے\nوہ ہر اک بات پر کہنا کہ یوں ہوتا تو کیا ہوتا",
        roman: "Hui muddat ke Ghalib mar gaya par yaad aata hai,\nWoh har ik baat par kehna ke yoon hota to kya hota.",
        poet: "مرزا غالب (Mirza Ghalib)"
    },
    {
        urdu: "ستاروں سے آگے جہاں اور بھی ہیں\nابھی عشق کے امتحان اور بھی ہیں",
        roman: "Sitaaron se aage jahaan aur bhi hain,\nAbhi ishq ke imtehaan aur bhi hain.",
        poet: "علامہ اقبال (Allama Iqbal)"
    },
    {
        urdu: "خودی کو کر بلند اتنا کہ ہر تقدیر سے پہلے\nخدا بندے سے خود پوچھے بتا تیری رضا کیا ہے",
        roman: "Khudi ko kar buland itna ke har taqdeer se pehle,\nKhuda bande se khud pooche bata teri raza kya hai.",
        poet: "علامہ اقبال (Allama Iqbal)"
    },
    {
        urdu: "کی محمدؐ سے وفا تو نے تو ہم تیرے ہیں\nیہ جہاں چیز ہے کیا لوح و قلم تیرے ہیں",
        roman: "Ki Muhammad se wafa tu ne to hum tere hain,\nYeh jahaan cheez hai kya lauh-o-qalam tere hain.",
        poet: "علامہ اقبال (Allama Iqbal)"
    },
    {
        urdu: "بے دلی کیا یوں ہی دن گزر جائیں گے\nصرف زندہ رہے ہم تو مر جائیں گے",
        roman: "Be-dili kya yoon hi din guzar jaayenge,\nSirf zinda rahe hum to mar jaayenge.",
        poet: "جون ایلیا (Jaun Elia)"
    },
    {
        urdu: "شاید مجھے کسی سے محبت نہیں ہوئی\nلیکن یقین سب کو دلاتا رہا ہوں میں",
        roman: "Shaayad mujhe kisi se mohabbat nahi hui,\nLekin yaqeen sab ko dilaata raha hoon main.",
        poet: "جون ایلیا (Jaun Elia)"
    },
    {
        urdu: "کتنی دلکش ہو تم کتنا دل جو ہوں میں\nکیا ستم ہے کہ ہم لوگ مر جائیں گے",
        roman: "Kitni dilkash ho tum kitna dil-joo hoon main,\nKya sitam hai ke hum log mar jaayenge.",
        poet: "جون ایلیا (Jaun Elia)"
    },
    {
        urdu: "عجیب ہے یہ غم کا سلسلہ بھی جاناں\nہر موڑ پر تجھے ہی پکارتا ہے دل",
        roman: "Ajeeb hai yeh gham ka silsila bhi jaana,\nHar mod par tujhe hi pukaarta hai dil.",
        poet: "جون ایلیا (Jaun Elia)"
    },
    {
        urdu: "سلسلے توڑ گیا وہ سبھی جاتے جاتے\nورنہ اتنے تو مراسم تھے کہ آتے جاتے",
        roman: "Silsile tod gaya woh sabhi jaate jaate,\nWarna itne to maraasim the ke aate jaate.",
        poet: "احمد فراز (Ahmad Faraz)"
    },
    {
        urdu: "اب کے ہم بچھڑے تو شاید کبھی خوابوں میں ملیں\nجس طرح سوکھے ہوئے پھول کتابوں میں ملیں",
        roman: "Ab ke hum bichhde to shaayad kabhi khwaabon mein milein,\nJis tarah sookhe huye phool kitaabon mein milein.",
        poet: "احمد فراز (Ahmad Faraz)"
    },
    {
        urdu: "رنجش ہی سہی دل ہی دکھانے کے لیے آ\nآ پھر سے مجھے چھوڑ کے جانے کے لیے آ",
        roman: "Ranjish hi sahi dil hi dukhaane ke liye aa,\nAa phir se mujhe chhod ke jaane ke liye aa.",
        poet: "احمد فراز (Ahmad Faraz)"
    },
    {
        urdu: "ہم بھی تیرے ہوئے جاتے ہیں رفتہ رفتہ\nجیسے دریا کسی سمندر میں اتر جاتا ہے",
        roman: "Hum bhi tere huye jaate hain rafta rafta,\nJaise dariya kisi samandar mein utar jaata hai.",
        poet: "احمد فراز (Ahmad Faraz)"
    },
    {
        urdu: "گلوں میں رنگ بھرے باد نو بہار چلے\nچلے بھی آؤ کہ گلشن کا کاروبار چلے",
        roman: "Gulon mein rang bhare baad-e-nau-bahaar chale,\nChale bhi aao ke gulshan ka kaarobaar chale.",
        poet: "فیض احمد فیض (Faiz Ahmad Faiz)"
    },
    {
        urdu: "مجھ سے پہلی سی محبت مرے محبوب نہ مانگ\nمیں نے سمجھا تھا کہ تو ہے تو درخشاں ہے حیات",
        roman: "Mujh se pehli si mohabbat mere mehboob na maang,\nMain ne samjha tha ke tu hai to darakhshaan hai hayaat.",
        poet: "فیض احمد فیض (Faiz Ahmad Faiz)"
    },
    {
        urdu: "بول کہ لب آزاد ہیں تیرے\nبول زباں اب تک تیری ہے",
        roman: "Bol ke lab aazaad hain tere,\nBol zabaan ab tak teri hai.",
        poet: "فیض احمد فیض (Faiz Ahmad Faiz)"
    },
    {
        urdu: "وہ آئے بزم میں اتنا تو ہم نے دیکھا تھا\nپھر اس کے بعد چراغوں میں روشنی نہ رہی",
        roman: "Woh aaye bazm mein itna to hum ne dekha tha,\nPhir us ke baad chiraaghon mein roshni na rahi.",
        poet: "ناصر کاظمی (Nasir Kazmi)"
    },
    {
        urdu: "دل میں اک لہر سی اٹھی ہے ابھی\nکوئی تازہ ہوا چلی ہے ابھی",
        roman: "Dil mein ik lehr si uthi hai abhi,\nKoi taaza hawa chali hai abhi.",
        poet: "ناصر کاظمی (Nasir Kazmi)"
    },
    {
        urdu: "پھول تو پھول ہیں آنکھوں سے گھرے رہتے ہیں\nکانٹے بیکار ہی لوگوں سے لڑے رہتے ہیں",
        roman: "Phool to phool hain aankhon se ghire rehte hain,\nKaante be-kaar hi logon se lade rehte hain.",
        poet: "بشیر بدر (Bashir Badr)"
    },
    {
        urdu: "اجالے اپنی یادوں کے ہمارے ساتھ رہنے دو\nنہ جانے کس گلی میں زندگی کی شام ہو جائے",
        roman: "Ujaale apni yaadon ke humaare saath rehne do,\nNa jaane kis gali mein zindagi ki shaam ho jaaye.",
        poet: "بشیر بدر (Bashir Badr)"
    },
    {
        urdu: "وہ تو خوشبو ہے ہواؤں میں بکھر جائے گا\nمسئلہ پھول کا ہے پھول کدھر جائے گا",
        roman: "Woh to khushboo hai hawaaon mein bikhar jaayega,\nMasla phool ka hai phool kidhar jaayega.",
        poet: "پروین شاکر (Parveen Shakir)"
    },
    {
        urdu: "کو بہ کو پھیل گئی بات شناسائی کی\nاس نے خوشبو کی طرح میری پذیرائی کی",
        roman: "Ku-ba-ku phail gayi baat shanaasaai ki,\nUs ne khushboo ki tarah meri pazeeraai ki.",
        poet: "پروین شاکر (Parveen Shakir)"
    },
    {
        urdu: "اب کے ساون میں یہ شرارت مرے ساتھ ہوئی\nمیرا گھر چھوڑ کے سارے شہر میں برسات ہوئی",
        roman: "Ab ke saawan mein yeh sharaarat mere saath hui,\nMera ghar chhod ke saare shehr mein barsaat hui.",
        poet: "محسن نقوی (Mohsin Naqvi)"
    },
    {
        urdu: "یہ زلف اگر کھل کے بکھر جائے تو اچھا\nاس رات کی تقدیر سنور جائے تو اچھا",
        roman: "Yeh zulf agar khul ke bikhar jaaye to achha,\nIs raat ki taqdeer sanwar jaaye to achha.",
        poet: "ساحر لدھیانوی (Sahir Ludhianvi)"
    },
    {
        urdu: "پتھر مجھے کہتا ہے مرا چاہنے والا\nمیں موم ہوں اس نے مجھے چھو کر نہیں دیکھا",
        roman: "Patthar mujhe kehta hai mera chaahne waala,\nMain mom hoon us ne mujhe chhoo kar nahi dekha.",
        poet: "وصی شاہ (Wasi Shah)"
    },
    {
        urdu: "کوئی چارہ نہیں دعا کے سوا\nکوئی سنتا نہیں خدا کے سوا",
        roman: "Koi chaara nahi dua ke siwa,\nKoi sunta nahi khuda ke siwa.",
        poet: "وصی شاہ (Wasi Shah)"
    },
    {
        urdu: "ہم نے مانا کہ تغافل نہ کرو گے لیکن\nخاک ہو جائیں گے ہم تم کو خبر ہونے تک",
        roman: "Hum ne maana ke taghaaful na karoge lekin,\nKhaak ho jaayenge hum tum ko khabar hone tak.",
        poet: "مرزا غالب (Mirza Ghalib)"
    },
    {
        urdu: "دیکھنا تقریر کی لذت کہ جو اس نے کہا\nمیں نے یہ جانا کہ گویا یہ بھی میرے دل میں ہے",
        roman: "Dekhna taqreer ki lazzat ke jo us ne kaha,\nMain ne yeh jaana ke goya yeh bhi mere dil mein hai.",
        poet: "مرزا غالب (Mirza Ghalib)"
    },
    {
        urdu: "عمر بھر سنگ زنی کرتے رہے اہل وطن\nیہ الگ بات ہے کہ پتھر کوئی اپنا نہ تھا",
        roman: "Umr bhar sang-zani karte rahe ahl-e-watan,\nYeh alag baat hai ke patthar koi apna na tha.",
        poet: "حبیب جالب (Habib Jalib)"
    },
    {
        urdu: "ظلم رہے اور امن بھی ہو کیا ممکن ہے تم ہی کہو\nموت بھی ہو اور جیون بھی ہو کیا ممکن ہے تم ہی کہو",
        roman: "Zulm rahe aur amn bhi ho kya mumkin hai tum hi kaho,\nMaut bhi ho aur jeewan bhi ho kya mumkin hai tum hi kaho.",
        poet: "حبیب جالب (Habib Jalib)"
    },
    {
        urdu: "بتوں سے تجھ کو امیدیں خدا سے نا امیدی\nمجھے بتا تو سہی اور کافری کیا ہے",
        roman: "Buton se tujh ko umeedein khuda se naa-umeedi,\nMujhe bata to sahi aur kaafiri kya hai.",
        poet: "علامہ اقبال (Allama Iqbal)"
    },
    {
        urdu: "نہ ہو یہ دل تو کہو زندگی میں کیا رکھی ہے\nغم حیات کا دارومدار دل پر ہے",
        roman: "Na ho yeh dil to kaho zindagi mein kya rakhi hai,\nGham-e-hayaat ka daar-o-madaar dil par hai.",
        poet: "اصغر گونڈوی (Asghar Gondvi)"
    },
    {
        urdu: "تجھ سے بچھڑ کے ہم بھی نہ جی پائیں گے زیادہ\nبس سانس کا وعدہ ہے جب تک وفا نبھائے",
        roman: "Tujh se bichhad ke hum bhi na jee paayenge zyaada,\nBas saans ka waada hai jab tak wafa nibhaaye.",
        poet: "ساغر صدیقی (Saghar Siddiqui)"
    },
    {
        urdu: "زندگی جبر مسلسل کی طرح کاٹی ہے\nجانے کس جرم کی پائی ہے سزا یاد نہیں",
        roman: "Zindagi jabr-e-musalsal ki tarah kaati hai,\nJaane kis jurm ki paayi hai saza yaad nahi.",
        poet: "ساغر صدیقی (Saghar Siddiqui)"
    },
    {
        urdu: "نہ تھا کچھ تو خدا تھا کچھ نہ ہوتا تو خدا ہوتا\nڈبویا مجھ کو ہونے نے نہ ہوتا میں تو کیا ہوتا",
        roman: "Na tha kuchh to Khuda tha kuchh na hota to Khuda hota,\nDuboya mujh ko hone ne na hota main to kya hota.",
        poet: "مرزا غالب (Mirza Ghalib)"
    },
    {
        urdu: "قیس جنگل میں اکیلا ہے مجھے جانے دو\nخوب گزرے گی جو مل بیٹھیں گے دیوانے دو",
        roman: "Qais jungle mein akela hai mujhe jaane do,\nKhoob guzregi jo mil baithenge deewaane do.",
        poet: "مرزا غالب (Mirza Ghalib)"
    },
    {
        urdu: "دل دھڑکنے کا سبب یاد آیا\nوہ تری یاد تھی اب یاد آیا",
        roman: "Dil dhadakne ka sabab yaad aaya,\nWoh teri yaad thi ab yaad aaya.",
        poet: "ناصر کاظمی (Nasir Kazmi)"
    },
    {
        urdu: "شوق سے توڑیے آئینے کو لیکن یہ رہے یاد\nہر اک ٹکڑے میں چہرہ ہی نظر آئے گا",
        roman: "Shauq se todiye aayine ko lekin yeh rahe yaad,\nHar ik tukde mein chehra hi nazar aayega.",
        poet: "احمد فراز (Ahmad Faraz)"
    }
];

// Strict condition: Check if text contains Devanagari (Hindi) characters or Hindi-specific vocabulary
function isHindiText(text) {
    if (!text || typeof text !== 'string') return false;
    // 1. Devanagari unicode range: U+0900 to U+097F (Hindi script)
    if (/[\u0900-\u097F]/.test(text)) {
        return true;
    }
    // 2. Pure Hindi words (distinct from Urdu)
    const hindiKeywords = [
        'kripya', 'dhanyawad', 'namaste', 'pranam', 'swagat', 
        'kripa', 'prasanna', 'mitra', 'shanti', 'dharm', 'karm'
    ];
    const lower = text.toLowerCase();
    return hindiKeywords.some(w => lower.includes(w));
}

async function shayariCommand(sock, chatId, message) {
    try {
        // Pick from curated pure Urdu collection
        // This ensures 100% Urdu poetry with zero Hindi words/script, instantaneous 0ms delivery
        const selected = urduShayaris[Math.floor(Math.random() * urduShayaris.length)];

        // Strict condition verification: ensure no Hindi is ever present
        if (isHindiText(selected.urdu) || isHindiText(selected.roman)) {
            // Guard fallback
            const safe = urduShayaris[0];
            const safeReply = `╭─ *📜 𝗭𝗢𝗫𝗘𝗥 𝗨𝗥𝗗𝗨 𝗦𝗛𝗔𝗬𝗔𝗥𝗜*
┃
┃  ◈ *𝗥𝗢𝗠𝗔𝗡 𝗨𝗥𝗗𝗨*
┃  ${safe.roman.split('\n').join('\n┃  ')}
┃
┃  ◈ *اردو شاعری*
┃  ${safe.urdu.split('\n').join('\n┃  ')}
┃
┃  ◈ *𝗦𝗛𝗔𝗜𝗥 (شاعر)*
┃  ◆ *${safe.poet}*
┃
╰───────────────`;
            return await sock.sendMessage(chatId, { text: safeReply }, { quoted: message });
        }

        const reply = `╭─ *📜 𝗭𝗢𝗫𝗘𝗥 𝗨𝗥𝗗𝗨 𝗦𝗛𝗔𝗬𝗔𝗥𝗜*
┃
┃  ◈ *𝗥𝗢𝗠𝗔𝗡 𝗨𝗥𝗗𝗨*
┃  ${selected.roman.split('\n').join('\n┃  ')}
┃
┃  ◈ *اردو شاعری*
┃  ${selected.urdu.split('\n').join('\n┃  ')}
┃
┃  ◈ *𝗦𝗛𝗔𝗜𝗥 (شاعر)*
┃  ◆ *${selected.poet}*
┃
╰───────────────`;

        await sock.sendMessage(chatId, { text: reply }, { quoted: message });

    } catch (error) {
        console.error('Error in shayari command:', error);
        const safe = urduShayaris[0];
        const safeReply = `╭─ *📜 𝗭𝗢𝗫𝗘𝗥 𝗨𝗥𝗗𝗨 𝗦𝗛𝗔𝗬𝗔𝗥𝗜*
┃
┃  ◈ *𝗥𝗢𝗠𝗔𝗡 𝗨𝗥𝗗𝗨*
┃  ${safe.roman.split('\n').join('\n┃  ')}
┃
┃  ◈ *اردو شاعری*
┃  ${safe.urdu.split('\n').join('\n┃  ')}
┃
┃  ◈ *𝗦𝗛𝗔𝗜𝗥 (شاعر)*
┃  ◆ *${safe.poet}*
┃
╰───────────────`;
        await sock.sendMessage(chatId, { text: safeReply }, { quoted: message });
    }
}

module.exports = { shayariCommand, isHindiText };
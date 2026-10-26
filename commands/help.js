const settings = require('../settings');
const fs = require('fs');
const path = require('path');
const isAdmin = require('../lib/isAdmin');
const isOwnerOrSudo = require('../lib/isOwner');

// Command details dictionary for single-command help (.help <command>)
const commandCatalog = {
    'ping': { category: 'Core', desc: "Check bot's response time and network latency.", usage: '.ping' },
    'alive': { category: 'Core', desc: 'Display bot uptime and active status banner.', usage: '.alive' },
    'owner': { category: 'Core', desc: 'Send contact vCard of the bot owner.', usage: '.owner' },
    'repo': { category: 'Core', desc: 'Display official GitHub repository source info.', usage: '.repo' },
    'settings': { category: 'Core', desc: 'Show current bot configuration and settings.', usage: '.settings' },
    'status': { category: 'Core', desc: 'Display process uptime, memory usage, and runtime stats.', usage: '.status' },
    'jid': { category: 'Core', desc: 'Get your WhatsApp JID or current group JID.', usage: '.jid' },
    'topmembers': { category: 'Core', desc: 'View leaderboard of most active group participants.', usage: '.topmembers' },
    'time': { category: 'Core', desc: 'Check current time and timezone for any global city.', usage: '.time [city/country]' },
    'sticker': { category: 'Media', desc: 'Convert replied image or video into a WebP sticker.', usage: '.sticker or .s' },
    'crop': { category: 'Media', desc: 'Crop replied image or video into a 1:1 square sticker.', usage: '.crop' },
    'take': { category: 'Media', desc: 'Change sticker pack name and author EXIF metadata.', usage: '.take [pack] | [author]' },
    'simage': { category: 'Media', desc: 'Convert replied sticker back into an image photo.', usage: '.simage' },
    'toaudio': { category: 'Media', desc: 'Extract audio from replied video or voice note into MP3.', usage: '.toaudio or .tomp3' },
    'tovideo': { category: 'Media', desc: 'Convert replied animated sticker or GIF into playable MP4.', usage: '.tovideo or .mp4' },
    'toptt': { category: 'Media', desc: 'Convert replied audio file into a native WhatsApp voice note.', usage: '.toptt or .vn' },
    'qr': { category: 'Media', desc: 'Generate a scannable QR code image from given text or URL.', usage: '.qr [text/url]' },
    'blur': { category: 'Media', desc: 'Blur replied photo image.', usage: '.blur' },
    'remini': { category: 'Media', desc: 'Enhance photo resolution and clarity using AI.', usage: '.remini or .enhance' },
    'removebg': { category: 'Media', desc: 'Remove background from replied photo.', usage: '.removebg' },
    'invert': { category: 'Media', desc: 'Invert colors of replied photo image.', usage: '.invert' },
    'rotate': { category: 'Media', desc: 'Rotate replied photo by 90, 180, or 270 degrees.', usage: '.rotate [degrees]' },
    'wasted': { category: 'Media', desc: 'Apply GTA Wasted overlay onto user avatar.', usage: '.wasted' },
    'tts': { category: 'Media', desc: 'Convert text to speech voice note audio.', usage: '.tts [lang] [text]' },
    'qc': { category: 'Media', desc: 'Generate quote bubble sticker with user profile picture.', usage: '.qc [text]' },
    'react': { category: 'Text Tools', desc: 'React with specified emoji to quoted message.', usage: '.react [emoji]' },
    'fancy': { category: 'Text Tools', desc: 'Transform input text into aesthetic Unicode fonts.', usage: '.fancy [text]' },
    'readmore': { category: 'Text Tools', desc: 'Create hidden read-more spoiler message.', usage: '.readmore [header] | [hidden]' },
    'morse': { category: 'Text Tools', desc: 'Encode text into Morse code or decode Morse into text.', usage: '.morse [text/code]' },
    'count': { category: 'Text Tools', desc: 'Count characters, words, and lines in text.', usage: '.count [text]' },
    'reverse': { category: 'Text Tools', desc: 'Reverse text characters backwards.', usage: '.reverse [text]' },
    'calc': { category: 'Text Tools', desc: 'Safely evaluate mathematical calculations.', usage: '.calc [expression]' },
    'poll': { category: 'Text Tools', desc: 'Create an interactive WhatsApp voting poll.', usage: '.poll [Question|Option1|Option2]' },
    'vv': { category: 'Text Tools', desc: 'Unlock and view View-Once media secretly.', usage: '.vv' },
    'delete': { category: 'Text Tools', desc: 'Delete replied message.', usage: '.delete or .del' },
    'clear': { category: 'Text Tools', desc: 'Send blank space to clear chat window.', usage: '.clear' },
    'wiki': { category: 'Search & Info', desc: 'Search Wikipedia for articles and summaries.', usage: '.wiki [topic]' },
    'crypto': { category: 'Search & Info', desc: 'Check real-time cryptocurrency prices in USD.', usage: '.crypto [coin]' },
    'dict': { category: 'Search & Info', desc: 'Look up English dictionary word definition.', usage: '.dict [word]' },
    'weather': { category: 'Search & Info', desc: 'Fetch current weather and temperature for any city.', usage: '.weather [city]' },
    'news': { category: 'Search & Info', desc: 'Fetch top international news headlines.', usage: '.news' },
    'pinterest': { category: 'Search & Info', desc: 'Search and download images from Pinterest.', usage: '.pinterest [query]' },
    'ss': { category: 'Search & Info', desc: 'Capture full screenshot of any web page.', usage: '.ss [url]' },
    'tourl': { category: 'Search & Info', desc: 'Upload media to temporary cloud URL.', usage: '.tourl' },
    'facebook': { category: 'Search & Info', desc: 'Download Facebook video.', usage: '.facebook [url]' },
    'instagram': { category: 'Search & Info', desc: 'Download Instagram reel or post.', usage: '.instagram [url]' },
    'tiktok': { category: 'Search & Info', desc: 'Download TikTok video.', usage: '.tiktok [url]' },
    'tictactoe': { category: 'Games & Fun', desc: 'Start an interactive Tic-Tac-Toe match in group.', usage: '.tictactoe @user' },
    'hangman': { category: 'Games & Fun', desc: 'Play word-guessing Hangman game.', usage: '.hangman' },
    'trivia': { category: 'Games & Fun', desc: 'Multiple-choice trivia questions.', usage: '.trivia' },
    'roll': { category: 'Games & Fun', desc: 'Roll a random dice (1 to 6 or custom).', usage: '.roll [sides]' },
    'flipcoin': { category: 'Games & Fun', desc: 'Flip a coin for Heads or Tails.', usage: '.flipcoin' },
    'slots': { category: 'Games & Fun', desc: 'Play emoji slot machine jackpot game.', usage: '.slots' },
    'riddle': { category: 'Games & Fun', desc: 'Random brain teaser riddle with hidden answer.', usage: '.riddle' },
    'pick': { category: 'Games & Fun', desc: 'Randomly choose between comma-separated options.', usage: '.pick [opt1, opt2, opt3]' },
    'truth': { category: 'Games & Fun', desc: 'Get a random Truth prompt.', usage: '.truth' },
    'dare': { category: 'Games & Fun', desc: 'Get a random Dare challenge.', usage: '.dare' },
    '8ball': { category: 'Games & Fun', desc: 'Ask Magic 8-Ball a yes/no question.', usage: '.8ball [question]' },
    'meme': { category: 'Games & Fun', desc: 'Get a random funny meme.', usage: '.meme' },
    'joke': { category: 'Games & Fun', desc: 'Get a random funny joke.', usage: '.joke' },
    'quote': { category: 'Games & Fun', desc: 'Get an inspirational quote.', usage: '.quote' },
    'compliment': { category: 'Games & Fun', desc: 'Send a wholesome compliment.', usage: '.compliment' },
    'insult': { category: 'Games & Fun', desc: 'Send a playful roast.', usage: '.insult' },
    'ship': { category: 'Games & Fun', desc: 'Calculate compatibility between two users.', usage: '.ship @user' },
    'simp': { category: 'Games & Fun', desc: 'Calculate simp percentage card.', usage: '.simp' },
    'flirt': { category: 'Games & Fun', desc: 'Get a romantic pick-up line.', usage: '.flirt' },
    'shayari': { category: 'Games & Fun', desc: 'Urdu and Hindi poetry.', usage: '.shayari' },
    'waifu': { category: 'Games & Fun', desc: 'Fetch anime waifu artwork.', usage: '.waifu' },
    'neko': { category: 'Games & Fun', desc: 'Fetch anime catgirl artwork.', usage: '.neko' },
    'animequote': { category: 'Games & Fun', desc: 'Random anime quote.', usage: '.animequote' },
    'base64': { category: 'Developer', desc: 'Encode text to or decode from Base64.', usage: '.base64 [text]' },
    'binary': { category: 'Developer', desc: 'Encode text to or decode from Binary 0/1 bits.', usage: '.binary [text]' },
    'hash': { category: 'Developer', desc: 'Generate MD5, SHA-1, and SHA-256 hashes.', usage: '.hash [text]' },
    'kick': { category: 'Group Management', desc: 'Remove a member from the group.', usage: '.kick @user' },
    'add': { category: 'Group Management', desc: 'Add a user by phone number or link.', usage: '.add [number]' },
    'promote': { category: 'Group Management', desc: 'Promote an eligible group participant to admin.', usage: '.promote @user' },
    'demote': { category: 'Group Management', desc: 'Demote a group administrator to regular member.', usage: '.demote @user' },
    'mute': { category: 'Group Management', desc: 'Close group chat so only admins can send messages.', usage: '.mute [mins]' },
    'unmute': { category: 'Group Management', desc: 'Open group chat so all members can send messages.', usage: '.unmute' },
    'link': { category: 'Group Management', desc: 'Fetch current group invite link.', usage: '.link' },
    'resetlink': { category: 'Group Management', desc: 'Revoke and regenerate new group invite link.', usage: '.resetlink' },
    'tagall': { category: 'Group Management', desc: 'Mention every participant in the group.', usage: '.tagall [message]' },
    'tagadmin': { category: 'Group Management', desc: 'Mention all group administrators.', usage: '.tagadmin [message]' },
    'tagnotadmin': { category: 'Group Management', desc: 'Mention all non-admin group members.', usage: '.tagnotadmin [message]' },
    'hidetag': { category: 'Group Management', desc: 'Send an invisible broadcast mention to all members.', usage: '.hidetag [message]' },
    'tagghost': { category: 'Group Management', desc: 'Detect inactive members who have not sent messages.', usage: '.tagghost' },
    'warn': { category: 'Group Management', desc: 'Issue a warning strike to user (kicks at 3 warnings).', usage: '.warn @user' },
    'warnings': { category: 'Group Management', desc: 'Check active warning count for user.', usage: '.warnings @user' },
    'resetwarn': { category: 'Group Management', desc: 'Clear warning strikes for user back to 0/3.', usage: '.resetwarn @user' },
    'leave': { category: 'Group Management', desc: 'Instruct the bot to gracefully exit group.', usage: '.leave' },
    'groupinfo': { category: 'Group Management', desc: 'Show group metadata, creation date, and member count.', usage: '.groupinfo' },
    'staff': { category: 'Group Management', desc: 'List all group administrators.', usage: '.staff' },
    'adminlock': { category: 'Group Management', desc: 'Auto demote unauthorized admin promotions.', usage: '.adminlock' },
    'setgname': { category: 'Group Management', desc: 'Update group title / subject.', usage: '.setgname [name]' },
    'setgdesc': { category: 'Group Management', desc: 'Update group description text.', usage: '.setgdesc [desc]' },
    'setgpp': { category: 'Group Management', desc: 'Update group icon from replied image.', usage: '.setgpp' },
    'welcome': { category: 'Group Management', desc: 'Toggle automatic join greeting messages.', usage: '.welcome on / off' },
    'goodbye': { category: 'Group Management', desc: 'Toggle automatic leave farewell messages.', usage: '.goodbye on / off' },
    'antilink': { category: 'Group Management', desc: 'Auto delete invite links and punish offenders.', usage: '.antilink on / off' },
    'antitag': { category: 'Group Management', desc: 'Prevent mass mention spamming.', usage: '.antitag on / off' },
    'antibadword': { category: 'Group Management', desc: 'Filter abusive language.', usage: '.antibadword on / off' },
    'antispam': { category: 'Group Management', desc: 'Repetition kick detector.', usage: '.antispam on / off' },
    'mode': { category: 'Owner Control', desc: 'Toggle bot mode between public and private.', usage: '.mode public / private' },
    'restart': { category: 'Owner Control', desc: 'Restart the bot session.', usage: '.restart' },
    'broadcast': { category: 'Owner Control', desc: 'Broadcast announcement to all groups.', usage: '.broadcast [text]' },
    'block': { category: 'Owner Control', desc: 'Block contact on WhatsApp.', usage: '.block [number/@user]' },
    'unblock': { category: 'Owner Control', desc: 'Unblock contact on WhatsApp.', usage: '.unblock [number/@user]' },
    'setname': { category: 'Owner Control', desc: 'Change bot WhatsApp profile name.', usage: '.setname [name]' },
    'setbio': { category: 'Owner Control', desc: 'Change bot WhatsApp status bio.', usage: '.setbio [text]' },
    'setpp': { category: 'Owner Control', desc: 'Change bot profile picture.', usage: '.setpp' },
    'clearsession': { category: 'Owner Control', desc: 'Clean orphan pre-keys and session garbage.', usage: '.clearsession' },
    'cleartmp': { category: 'Owner Control', desc: 'Flush temporary cache directory.', usage: '.cleartmp' },
    'autostatus': { category: 'Owner Control', desc: 'Toggle auto reading contact statuses.', usage: '.autostatus on / off' },
    'autoreact': { category: 'Owner Control', desc: 'Toggle auto emoji reaction on messages.', usage: '.autoreact on / off' },
    'autotyping': { category: 'Owner Control', desc: 'Toggle auto typing indicator.', usage: '.autotyping on / off' },
    'autoread': { category: 'Owner Control', desc: 'Toggle auto blue tick receipts.', usage: '.autoread on / off' },
    'anticall': { category: 'Owner Control', desc: 'Toggle auto reject voice and video calls.', usage: '.anticall on / off' },
    'pmblocker': { category: 'Owner Control', desc: 'Block incoming private DMs.', usage: '.pmblocker on / off' },
    'smartreply': { category: 'Owner Control', desc: 'Toggle automatic greeting responses.', usage: '.smartreply on / off' }
};

async function helpCommand(sock, chatId, message, customChannelLink) {
    try {
        const rawText = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const parts = rawText.trim().split(/\s+/);
        const subCommand = parts[1] ? parts[1].replace(/^\./, '').toLowerCase() : null;

        // Specific command explanation requested (.help <cmd>)
        if (subCommand && commandCatalog[subCommand]) {
            const cmd = commandCatalog[subCommand];
            const detailText = `📖 *COMMAND EXPLANATION*\n\n` +
                `*Command:* \`.${subCommand}\`\n` +
                `*Category:* ${cmd.category}\n` +
                `*Description:* ${cmd.desc}\n` +
                `*Usage:* \`${cmd.usage}\``;

            return await sock.sendMessage(chatId, { text: detailText }, { quoted: message });
        }

        // Determine user permissions
        const senderId = message.key.participant || message.key.remoteJid;
        const isGroup = chatId.endsWith('@g.us');
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
        let isSenderAdmin = false;

        if (isGroup) {
            const adminCheck = await isAdmin(sock, chatId, senderId);
            isSenderAdmin = adminCheck.isSenderAdmin;
        }

        // Get Bot Mode
        let isPublic = true;
        try {
            const modePath = './data/bot-settings.json';
            const legacyPath = './data/messageCount.json';
            if (fs.existsSync(modePath)) {
                const data = JSON.parse(fs.readFileSync(modePath, 'utf8'));
                if (typeof data.isPublic === 'boolean') isPublic = data.isPublic;
            } else if (fs.existsSync(legacyPath)) {
                const data = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
                if (typeof data.isPublic === 'boolean') isPublic = data.isPublic;
            }
        } catch (_) {}
        const mode = isPublic ? '𝗣𝗨𝗕𝗟𝗜𝗖' : '𝗣𝗥𝗜𝗩𝗔𝗧𝗘';

        // Construct requested custom stylized menu
        let helpMessage = `╭─ *𝗭𝗢𝗫𝗘𝗥 𝗕𝗢𝗧*\n` +
            `┃\n` +
            `┃  ◈ *𝗢𝗪𝗡𝗘𝗥*\n` +
            `┃  ◆ *𝗭𝗢𝗫𝗘𝗥 𝗧𝗘𝗔𝗠*\n` +
            `┃  ◈ *𝗠𝗢𝗗𝗘*\n` +
            `┃  ◆ *${mode}*\n` +
            `┃  ◈ *𝗣𝗥𝗘𝗙𝗜𝗫*\n` +
            `┃  ◆ *.*\n` +
            `┃\n` +
            `┣─〔 ◈ 𝗖𝗢𝗥𝗘 〕\n` +
            `┃  ◆ *.ping*\n` +
            `┃  ◆ *.alive*\n` +
            `┃  ◆ *.owner*\n` +
            `┃  ◆ *.repo*\n` +
            `┃  ◆ *.settings*\n` +
            `┃  ◆ *.status*\n` +
            `┃  ◆ *.jid*\n` +
            `┃  ◆ *.topmembers*\n` +
            `┃  ◆ *.time <city>*\n` +
            `┃\n` +
            `┣─〔 ▣ 𝗠𝗘𝗗𝗜𝗔 〕\n` +
            `┃  ▸ *.sticker* 〔*.s*〕\n` +
            `┃  ▸ *.crop*\n` +
            `┃  ▸ *.take <pack> | <author>* 〔*.steal*〕\n` +
            `┃  ▸ *.simage*\n` +
            `┃  ▸ *.toaudio* 〔*.tomp3*〕\n` +
            `┃  ▸ *.tovideo* 〔*.mp4*〕\n` +
            `┃  ▸ *.toptt* 〔*.vn*〕\n` +
            `┃  ▸ *.qr <text/url>* 〔*.qrcode*〕\n` +
            `┃  ▸ *.blur*\n` +
            `┃  ▸ *.remini* 〔*.enhance*, *.upscale*〕\n` +
            `┃  ▸ *.removebg* 〔*.rmbg*, *.nobg*〕\n` +
            `┃  ▸ *.invert*\n` +
            `┃  ▸ *.rotate <deg>*\n` +
            `┃  ▸ *.wasted* 〔*.waste*〕\n` +
            `┃  ▸ *.tts <lang> <text>*\n` +
            `┃  ▸ *.qc <text>*\n` +
            `┃\n` +
            `┣─〔 ✧ 𝗧𝗘𝗫𝗧 𝗧𝗢𝗢𝗟𝗦 〕\n` +
            `┃  ◆ *.react <emoji>*\n` +
            `┃  ◆ *.fancy <text>* 〔*.styletext*〕\n` +
            `┃  ◆ *.readmore <header> | <hidden>* 〔*.spoiler*〕\n` +
            `┃  ◆ *.morse <text>*\n` +
            `┃  ◆ *.count <text>* 〔*.wordcount*〕\n` +
            `┃  ◆ *.reverse <text>*\n` +
            `┃  ◆ *.calc <expression>* 〔*.math*〕\n` +
            `┃  ◆ *.poll <question|opt1|opt2>*\n` +
            `┃  ◆ *.vv*\n` +
            `┃  ◆ *.delete* 〔*.del*〕\n` +
            `┃  ◆ *.clear*\n` +
            `┃\n` +
            `┣─〔 ◎ 𝗦𝗘𝗔𝗥𝗖𝗛 & 𝗜𝗡𝗙𝗢 〕\n` +
            `┃  ◈ *.wiki <query>* 〔*.wikipedia*〕\n` +
            `┃  ◈ *.crypto <coin>* 〔*.coin*〕\n` +
            `┃  ◈ *.dict <word>* 〔*.define*〕\n` +
            `┃  ◈ *.weather <city>*\n` +
            `┃  ◈ *.news*\n` +
            `┃  ◈ *.pinterest <query>* 〔*.pin*〕\n` +
            `┃  ◈ *.ss <url>* 〔*.ssweb*〕\n` +
            `┃  ◈ *.tourl* 〔*.url*〕\n` +
            `┃  ◈ *.facebook <url>* 〔*.fb*〕\n` +
            `┃  ◈ *.instagram <url>* 〔*.ig*, *.insta*〕\n` +
            `┃  ◈ *.tiktok <url>* 〔*.tt*〕\n` +
            `┃\n` +
            `┣─〔 ♟ 𝗚𝗔𝗠𝗘𝗦 & 𝗙𝗨𝗡 〕\n` +
            `┃  ▹ *.tictactoe @user* 〔*.ttt*〕\n` +
            `┃  ▹ *.hangman*\n` +
            `┃  ▹ *.trivia*\n` +
            `┃  ▹ *.roll <sides>* 〔*.dice*〕\n` +
            `┃  ▹ *.flipcoin* 〔*.coinflip*〕\n` +
            `┃  ▹ *.slots* 〔*.casino*〕\n` +
            `┃  ▹ *.riddle*\n` +
            `┃  ▹ *.pick <opt1, opt2>* 〔*.choose*〕\n` +
            `┃  ▹ *.truth*\n` +
            `┃  ▹ *.dare*\n` +
            `┃  ▹ *.8ball <question>*\n` +
            `┃  ▹ *.meme*\n` +
            `┃  ▹ *.joke*\n` +
            `┃  ▹ *.quote*\n` +
            `┃  ▹ *.compliment*\n` +
            `┃  ▹ *.insult*\n` +
            `┃  ▹ *.ship @user*\n` +
            `┃  ▹ *.simp*\n` +
            `┃  ▹ *.flirt*\n` +
            `┃  ▹ *.shayari* 〔*.shayri*〕\n` +
            `┃  ▹ *.waifu*\n` +
            `┃  ▹ *.neko*\n` +
            `┃  ▹ *.maid*\n` +
            `┃  ▹ *.uniform*\n` +
            `┃  ▹ *.husbando*\n` +
            `┃  ▹ *.kitsune*\n` +
            `┃  ▹ *.shinobu*\n` +
            `┃  ▹ *.megumin*\n` +
            `┃  ▹ *.animequote*\n` +
            `┃\n` +
            `┣─〔 ⌘ 𝗗𝗘𝗩𝗘𝗟𝗢𝗣𝗘𝗥 〕\n` +
            `┃  ⌘ *.base64 <text>*\n` +
            `┃  ⌘ *.binary <text>*\n` +
            `┃  ⌘ *.hash <text>*\n` +
            `┃\n`;

        // Section: Group Management (Shown to Group Admins or Owner)
        if (isSenderAdmin || isOwner) {
            helpMessage += `┣─〔 ♧ 𝗚𝗥𝗢𝗨𝗣 𝗠𝗔𝗡𝗔𝗚𝗘𝗠𝗘𝗡𝗧 〕\n` +
                `┃  ▸ *.kick @user*\n` +
                `┃  ▸ *.add <number>*\n` +
                `┃  ▸ *.promote @user*\n` +
                `┃  ▸ *.demote @user*\n` +
                `┃  ▸ *.mute <mins>*\n` +
                `┃  ▸ *.unmute*\n` +
                `┃  ▸ *.link* 〔*.glink*〕\n` +
                `┃  ▸ *.resetlink* 〔*.revoke*〕\n` +
                `┃  ▸ *.tagall <text>*\n` +
                `┃  ▸ *.tagadmin <text>*\n` +
                `┃  ▸ *.tagnotadmin <text>*\n` +
                `┃  ▸ *.hidetag <text>*\n` +
                `┃  ▸ *.tagghost* 〔*.ghosts*〕\n` +
                `┃  ▸ *.warn @user*\n` +
                `┃  ▸ *.warnings @user*\n` +
                `┃  ▸ *.resetwarn @user* 〔*.unwarn*〕\n` +
                `┃  ▸ *.leave* 〔*.leavegc*〕\n` +
                `┃  ▸ *.groupinfo* 〔*.infogp*〕\n` +
                `┃  ▸ *.staff* 〔*.admins*〕\n` +
                `┃  ▸ *.adminlock*\n` +
                `┃  ▸ *.setgname <name>*\n` +
                `┃  ▸ *.setgdesc <desc>*\n` +
                `┃  ▸ *.setgpp*\n` +
                `┃  ▸ *.welcome on/off*\n` +
                `┃  ▸ *.goodbye on/off*\n` +
                `┃  ▸ *.antilink on/off*\n` +
                `┃  ▸ *.antitag on/off*\n` +
                `┃  ▸ *.antibadword on/off*\n` +
                `┃  ▸ *.antispam on/off*\n` +
                `┃\n`;
        }

        // Section: Owner Control (Shown to Owner / Sudo)
        if (isOwner) {
            helpMessage += `┣─〔 ♛ 𝗢𝗪𝗡𝗘𝗥 𝗖𝗢𝗡𝗧𝗥𝗢𝗟 〕\n` +
                `┃  ♛ *.mode public/private*\n` +
                `┃  ♛ *.restart* 〔*.reboot*〕\n` +
                `┃  ♛ *.broadcast <text>* 〔*.bc*〕\n` +
                `┃  ♛ *.block <number>*\n` +
                `┃  ♛ *.unblock <number>*\n` +
                `┃  ♛ *.setname <name>*\n` +
                `┃  ♛ *.setbio <text>* 〔*.setabout*〕\n` +
                `┃  ♛ *.setpp*\n` +
                `┃  ♛ *.setmenudp* 〔*.setdp*〕\n` +
                `┃  ♛ *.setdpd* 〔*.setdpdefault*〕\n` +
                `┃  ♛ *.setmenumusic* 〔*.setmusic*〕\n` +
                `┃  ♛ *.clearsession*\n` +
                `┃  ♛ *.cleartmp*\n` +
                `┃  ♛ *.update*\n` +
                `┃  ♛ *.autostatus on/off*\n` +
                `┃  ♛ *.autoreact on/off*\n` +
                `┃  ♛ *.autotyping on/off*\n` +
                `┃  ♛ *.autoread on/off*\n` +
                `┃  ♛ *.anticall on/off*\n` +
                `┃  ♛ *.pmblocker on/off*\n` +
                `┃  ♛ *.smartreply on/off*\n` +
                `┃  ♛ *.chatbot on/off*\n` +
                `┃  ♛ *.antidelete on/off*\n` +
                `┃  ♛ *.sudo add/del*\n` +
                `┃  ♛ *.pair*\n` +
                `┃\n`;
        }

        helpMessage += `╰────────────────────\n` +
            `     ✦ *𝗭𝗢𝗫𝗘𝗥 𝗕𝗢𝗧* ✦`;

        const candidatePaths = [
            path.resolve(__dirname, '..', 'zoxer.jfif'),
            path.resolve(__dirname, '..', 'assets', 'images', 'custom_menu.jpg'),
            path.resolve(__dirname, '..', 'assets', 'images', 'banner.png'),
            path.resolve(__dirname, '..', 'assets', 'images', 'logo.png')
        ];
        const customMenuPath = candidatePaths.find(filePath => fs.existsSync(filePath));

        if (customMenuPath) {
            try {
                await sock.sendMessage(chatId, {
                    image: fs.readFileSync(customMenuPath),
                    mimetype: 'image/jpeg',
                    caption: helpMessage
                }, { quoted: message });
                return;
            } catch (imgErr) {
                console.error('Failed to send menu with image, sending text:', imgErr);
            }
        }

        await sock.sendMessage(chatId, { text: helpMessage }, { quoted: message });

    } catch (error) {
        console.error('Error in help command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to load menu. Please try again.' }, { quoted: message });
    }
}

module.exports = helpCommand;
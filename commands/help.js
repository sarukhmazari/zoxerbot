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
    'img2pdf': { category: 'Media', desc: 'Convert single or batch images into a clean multi-page PDF document.', usage: '.img2pdf <title> or .img2pdf start <title>' },
    'emojimix': { category: 'Media', desc: 'Merge two emojis into a Google Emoji Kitchen sticker.', usage: '.emojimix <emoji1>+<emoji2>' },
    'crop': { category: 'Media', desc: 'Crop replied image or video into a 1:1 square sticker.', usage: '.crop' },
    'take': { category: 'Media', desc: 'Change sticker pack name and author EXIF metadata.', usage: '.take [pack] | [author]' },
    'simage': { category: 'Media', desc: 'Convert replied sticker back into an image photo.', usage: '.simage' },
    'song': { category: 'Media', desc: 'Download high quality MP3 song from YouTube/Music.', usage: '.song [title/link]' },
    'spotify': { category: 'Media', desc: 'Download Spotify track with official artist metadata and cover art.', usage: '.spotify [title/link]' },
    'slowed': { category: 'Media', desc: 'Download song with aesthetic Slowed + Reverb audio processing.', usage: '.slowed [title/link]' },
    'video': { category: 'Media', desc: 'Download high definition MP4 video from YouTube.', usage: '.video [title/link]' },
    'drama': { category: 'Media', desc: 'Download Pakistani/Turkish/Indian drama full episodes.', usage: '.drama [drama name/episode]' },
    'toaudio': { category: 'Media', desc: 'Extract audio from replied video or voice note into MP3.', usage: '.toaudio or .tomp3' },
    'reelsaudio': { category: 'Media', desc: 'Extract trending audio from Instagram Reel, TikTok, or replied video.', usage: '.reelsaudio [url or reply to video]' },
    'tovideo': { category: 'Media', desc: 'Convert replied animated sticker or GIF into playable MP4.', usage: '.tovideo or .mp4' },
    'toptt': { category: 'Media', desc: 'Convert replied audio file into a native WhatsApp voice note.', usage: '.toptt or .vn' },
    'robot': { category: 'Media', desc: 'Modulate voice note or audio with a futuristic robotic synthesizer.', usage: '.robot (reply to audio)' },
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
    'apk': { category: 'Search & Info', desc: 'Search and download Android APK apps and games directly.', usage: '.apk [app name]' },
    'song': { category: 'Search & Info', desc: 'Search and download MP3 audio from YouTube.', usage: '.song <name/url> or .play <name>' },
    'play': { category: 'Search & Info', desc: 'Search and play song audio.', usage: '.play <song name>' },
    'spotify': { category: 'Search & Info', desc: 'Download high quality 320kbps MP3 from Spotify link.', usage: '.spotify <link/title>' },
    'video': { category: 'Search & Info', desc: 'Search and download MP4 video from YouTube.', usage: '.video <name/url> or .ytmp4 <name>' },
    'ytmp4': { category: 'Search & Info', desc: 'Download MP4 video from YouTube.', usage: '.ytmp4 <name/url>' },
    'lyrics': { category: 'Search & Info', desc: 'Search song lyrics with artist and album info.', usage: '.lyrics <song name>' },
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
    'imgevent': { category: 'Group Management', desc: 'Create promotional event card with image & mention all group members.', usage: '.imgevent Title | Description | Hours' },
    'promoevent': { category: 'Group Management', desc: 'Alias for .imgevent.', usage: '.promoevent Title | Description | Hours' },
    'tagadmin': { category: 'Group Management', desc: 'Mention all group administrators.', usage: '.tagadmin [message]' },
    'tagnotadmin': { category: 'Group Management', desc: 'Mention all non-admin group members.', usage: '.tagnotadmin [message]' },
    'hidetag': { category: 'Group Management', desc: 'Silently tag all group members, or toggle auto-hidetag.', usage: '.hidetag [message] or .hidetag on/off' },
    'tagghost': { category: 'Group Management', desc: 'Detect inactive members who have not sent messages.', usage: '.tagghost' },
    'warn': { category: 'Group Management', desc: 'Issue a warning strike to user (kicks at 3 warnings).', usage: '.warn @user' },
    'warnings': { category: 'Group Management', desc: 'Check active warning count for user.', usage: '.warnings @user' },
    'resetwarn': { category: 'Group Management', desc: 'Clear warning strikes for user back to 0/3.', usage: '.resetwarn @user' },
    'leave': { category: 'Group Management', desc: 'Instruct the bot to gracefully exit group.', usage: '.leave' },
    'leaveclosed': { category: 'Group Management', desc: 'Auto-exit closed groups where bot is not admin.', usage: '.leaveclosed [on/off/run/status]' },
    'autoleaveclosed': { category: 'Group Management', desc: 'Auto-exit closed groups where bot is not admin.', usage: '.autoleaveclosed [on/off/run/status]' },
    'autoreqaccept': { category: 'Group Management', desc: 'Auto approve pending join requests safely (5 per min).', usage: '.autoreqaccept [on/off/now]' },
    'autoaccept': { category: 'Group Management', desc: 'Alias for .autoreqaccept.', usage: '.autoaccept [on/off/now]' },
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
    'antisticker': { category: 'Group Management', desc: 'Auto delete stickers sent by non-admins.', usage: '.antisticker on / warn / kick / off' },
    'antibot': { category: 'Group Management', desc: 'Auto detect and kick rival bots from groups.', usage: '.antibot on / delete / off' },
    'antiforeign': { category: 'Group Management', desc: 'Kick foreign/unauthorized country code numbers.', usage: '.antiforeign on / off / set / block / scan' },
    'antiviewonce': { category: 'Security & Privacy', desc: 'Stealthily intercept View-Once photos/videos to owner DM.', usage: '.antiviewonce on / off' },
    'afk': { category: 'Utility & Tools', desc: 'Set away-from-keyboard status with auto responder.', usage: '.afk [reason] or .afk off' },
    'unafk': { category: 'Utility & Tools', desc: 'Turn off AFK status manually.', usage: '.unafk or .afk off' },
    'cookies': { category: 'Owner Control', desc: 'Manage YouTube cookies for music/video downloads.', usage: '.cookies / .setcookies' },
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
    'autogroupstatus': { category: 'Owner Control', desc: 'Auto-view and archive group statuses.', usage: '.autogroupstatus on / off / archive on' },
    'autostatusview': { category: 'Owner Control', desc: 'Alias for .autogroupstatus.', usage: '.autostatusview on / off' },
    'autoreact': { category: 'Owner Control', desc: 'Toggle auto emoji reaction on messages.', usage: '.autoreact on / off' },
    'autotyping': { category: 'Owner Control', desc: 'Toggle auto typing indicator.', usage: '.autotyping on / off' },
    'autoread': { category: 'Owner Control', desc: 'Toggle auto blue tick receipts.', usage: '.autoread on / off' },
    'autojoinlinks': { category: 'Owner Control', desc: 'Toggle automatic WhatsApp group link detection and joining.', usage: '.autojoinlinks on / off / status' },
    'anticall': { category: 'Owner Control', desc: 'Toggle auto reject voice and video calls.', usage: '.anticall on / off' },
    'pmblocker': { category: 'Owner Control', desc: 'Block incoming private DMs.', usage: '.pmblocker on / off' },
    'smartreply': { category: 'Owner Control', desc: 'Toggle Gemini AI-powered automatic message replies.', usage: '.smartreply on / off / status / reset' },
    'autoreply': { category: 'Owner Control', desc: 'Alias for .smartreply Gemini AI automatic replies.', usage: '.autoreply on / off' },
    'waifu': { category: 'Anime & Manga', desc: 'Fetch a random high quality anime waifu image.', usage: '.waifu' },
    'neko': { category: 'Anime & Manga', desc: 'Fetch a cute catgirl anime picture.', usage: '.neko' },
    'kitsune': { category: 'Anime & Manga', desc: 'Fetch a foxgirl anime picture.', usage: '.kitsune' },
    'husbando': { category: 'Anime & Manga', desc: 'Fetch an anime husbando picture.', usage: '.husbando' },
    'wallpaper': { category: 'Anime & Manga', desc: 'Fetch high quality anime wallpaper.', usage: '.wallpaper' },
    'anime': { category: 'Anime & Manga', desc: 'Send anime reaction GIF with mentions.', usage: '.anime <reaction> or .hug @user' },
    'animequote': { category: 'Anime & Manga', desc: 'Fetch inspirational anime quotes.', usage: '.animequote' },
    'whatanime': { category: 'Anime & Manga', desc: 'Identify anime title and episode from replied screenshot.', usage: '.whatanime (reply to image)' }
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

        // Get Bot Mode for this session (Private by default)
        const { getBotMode } = require('../lib/session-settings');
        const isPublic = getBotMode(sock).isPublic;
        const mode = isPublic ? '𝗣𝗨𝗕𝗟𝗜𝗖' : '𝗣𝗥𝗜𝗩𝗔𝗧𝗘';

        // Construct requested custom stylized menu
        let helpMessage = `╭━━━〔 👑 𝗭𝗢𝗫𝗘𝗥 𝗕𝗢𝗧 〕━━━╮\n` +
            `┃\n` +
            `┃  ◈ 𝗢𝗪𝗡𝗘𝗥 : 𝗭𝗢𝗫𝗘𝗥 \n` +
            `┃  ◈ 𝗠𝗢𝗗𝗘 : ${mode}\n` +
            `┃  ◈ 𝗣𝗥𝗘𝗙𝗜𝗫 : .\n` +
            `┃\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `╭━━〔 ✦ 𝗖𝗢𝗥𝗘 〕━━╮\n` +
            `┃  ───◈ .𝗣𝗜𝗡𝗚\n` +
            `┃  ───◈ .𝗔𝗟𝗜𝗩𝗘\n` +
            `┃  ───◈ .𝗢𝗪𝗡𝗘𝗥\n` +
            `┃  ───◈ .𝗥𝗘𝗣𝗢\n` +
            `┃  ───◈ .𝗦𝗘𝗧𝗧𝗜𝗡𝗚𝗦\n` +
            `┃  ───◈ .𝗦𝗧𝗔𝗧𝗨𝗦\n` +
            `┃  ───◈ .𝗝𝗜𝗗\n` +
            `┃  ───◈ .𝗧𝗢𝗣𝗠𝗘𝗠𝗕𝗘𝗥𝗦\n` +
            `┃  ───◈ .𝗧𝗜𝗠𝗘 <𝗖𝗜𝗧𝗬>\n` +
            `╰━━━━━━━━━━━━━━╯\n\n` +
            `╭━━〔 ✦ 𝗠𝗘𝗗𝗜𝗔 〕━━╮\n` +
            `┃  ───◈ .𝗜𝗠𝗚𝟮𝗣𝗗𝗙 <𝗧𝗜𝗧𝗟𝗘>\n` +
            `┃  ───◈ .𝗧𝗢𝗣𝗗𝗙\n` +
            `┃  ───◈ .𝗣𝗗𝗙\n` +
            `┃  ───◈ .𝗦𝗧𝗜𝗖𝗞𝗘𝗥\n` +
            `┃  ───◈ .𝗦\n` +
            `┃  ───◈ .𝗘𝗠𝗢𝗝𝗜𝗠𝗜𝗫 <𝗘𝟭>+<𝗘𝟮>\n` +
            `┃  ───◈ .𝗘𝗠𝗜𝗫\n` +
            `┃  ───◈ .𝗖𝗥𝗢𝗣\n` +
            `┃  ───◈ .𝗧𝗔𝗞𝗘 <𝗣𝗔𝗖𝗞> | <𝗔𝗨𝗧𝗛𝗢𝗥>\n` +
            `┃  ───◈ .𝗦𝗧𝗘𝗔𝗟\n` +
            `┃  ───◈ .𝗦𝗜𝗠𝗔𝗚𝗘\n` +
            `┃  ───◈ .𝗧𝗢𝗔𝗨𝗗𝗜𝗢\n` +
            `┃  ───◈ .𝗧𝗢𝗠𝗣𝟯\n` +
            `┃  ───◈ .𝗥𝗘𝗘𝗟𝗦𝗔𝗨𝗗𝗜𝗢 <𝗨𝗥𝗟/𝗥𝗘𝗣𝗟𝗬>\n` +
            `┃  ───◈ .𝗘𝗫𝗧𝗥𝗔𝗖𝗧𝗔𝗨𝗗𝗜𝗢\n` +
            `┃  ───◈ .𝗥𝗘𝗘𝗟𝗦𝗠𝗣𝟯\n` +
            `┃  ───◈ .𝗧𝗢𝗩𝗜𝗗𝗘𝗢\n` +
            `┃  ───◈ .𝗠𝗣𝟰\n` +
            `┃  ───◈ .𝗗𝗥𝗔𝗠𝗔 <𝗡𝗔𝗠𝗘/𝗘𝗣>\n` +
            `┃  ───◈ .𝗧𝗢𝗣𝗧𝗧\n` +
            `┃  ───◈ .𝗩𝗡\n` +
            `┃  ───◈ .𝗥𝗢𝗕𝗢𝗧\n` +
            `┃  ───◈ .𝗤𝗥 <𝗧𝗘𝗫𝗧/𝗨𝗥𝗟>\n` +
            `┃  ───◈ .𝗤𝗥𝗖𝗢𝗗𝗘\n` +
            `┃  ───◈ .𝗦𝗖𝗔𝗡𝗤𝗥\n` +
            `┃  ───◈ .𝗥𝗘𝗔𝗗𝗤𝗥\n` +
            `┃  ───◈ .𝗕𝗟𝗨𝗥\n` +
            `┃  ───◈ .𝗥𝗘𝗠𝗜𝗡𝗜\n` +
            `┃  ───◈ .𝗘𝗡𝗛𝗔𝗡𝗖𝗘\n` +
            `┃  ───◈ .𝗨𝗣𝗦𝗖𝗔𝗟𝗘\n` +
            `┃  ───◈ .𝗥𝗘𝗠𝗢𝗩𝗘𝗕𝗚\n` +
            `┃  ───◈ .𝗥𝗠𝗕𝗚\n` +
            `┃  ───◈ .𝗡𝗢𝗕𝗚\n` +
            `┃  ───◈ .𝗜𝗡𝗩𝗘𝗥𝗧\n` +
            `┃  ───◈ .𝗥𝗢𝗧𝗔𝗧𝗘 <𝗗𝗘𝗚>\n` +
            `┃  ───◈ .𝗪𝗔𝗦𝗧𝗘𝗗\n` +
            `┃  ───◈ .𝗪𝗔𝗦𝗧𝗘\n` +
            `┃  ───◈ .𝗧𝗧𝗦 <𝗟𝗔𝗡𝗚> <𝗧𝗘𝗫𝗧>\n` +
            `┃  ───◈ .𝗤𝗖 <𝗧𝗘𝗫𝗧>\n` +
            `╰━━━━━━━━━━━━━━╯\n\n` +
            `╭━━〔 ✦ 𝗧𝗘𝗫𝗧 𝗧𝗢𝗢𝗟𝗦 〕━━╮\n` +
            `┃  ───◈ .𝗥𝗘𝗔𝗖𝗧 <𝗘𝗠𝗢𝗝𝗜>\n` +
            `┃  ───◈ .𝗙𝗔𝗡𝗖𝗬 <𝗧𝗘𝗫𝗧>\n` +
            `┃  ───◈ .𝗦𝗧𝗬𝗟𝗘𝗧𝗘𝗫𝗧\n` +
            `┃  ───◈ .𝗥𝗘𝗔𝗗𝗠𝗢𝗥𝗘 <𝗛𝗘𝗔𝗗𝗘𝗥> | <𝗛𝗜𝗗𝗗𝗘𝗡>\n` +
            `┃  ───◈ .𝗦𝗣𝗢𝗜𝗟𝗘𝗥\n` +
            `┃  ───◈ .𝗠𝗢𝗥𝗦𝗘 <𝗧𝗘𝗫𝗧>\n` +
            `┃  ───◈ .𝗖𝗢𝗨𝗡𝗧 <𝗧𝗘𝗫𝗧>\n` +
            `┃  ───◈ .𝗪𝗢𝗥𝗗𝗖𝗢𝗨𝗡𝗧\n` +
            `┃  ───◈ .𝗥𝗘𝗩𝗘𝗥𝗦𝗘 <𝗧𝗘𝗫𝗧>\n` +
            `┃  ───◈ .𝗖𝗔𝗟𝗖 <𝗘𝗫𝗣𝗥𝗘𝗦𝗦𝗜𝗢𝗡>\n` +
            `┃  ───◈ .𝗠𝗔𝗧𝗛\n` +
            `┃  ───◈ .𝗣𝗢𝗟𝗟 <𝗤𝗨𝗘𝗦𝗧𝗜𝗢𝗡|𝗢𝗣𝗧𝟭|𝗢𝗣𝗧𝟮>\n` +
            `┃  ───◈ .𝗩𝗩\n` +
            `┃  ───◈ .𝗗𝗘𝗟𝗘𝗧𝗘\n` +
            `┃  ───◈ .𝗗𝗘𝗟\n` +
            `┃  ───◈ .𝗖𝗟𝗘𝗔𝗥\n` +
            `╰━━━━━━━━━━━━━━╯\n\n` +
            `╭━━〔 ✦ 𝗦𝗘𝗔𝗥𝗖𝗛 & 𝗜𝗡𝗙𝗢 〕━━╮\n` +
            `┃  ───◈ .𝗪𝗜𝗞𝗜 <𝗤𝗨𝗘𝗥𝗬>\n` +
            `┃  ───◈ .𝗪𝗜𝗞𝗜𝗣𝗘𝗗𝗜𝗔\n` +
            `┃  ───◈ .𝗖𝗥𝗬𝗣𝗧𝗢 <𝗖𝗢𝗜𝗡>\n` +
            `┃  ───◈ .𝗖𝗢𝗜𝗡\n` +
            `┃  ───◈ .𝗗𝗜𝗖𝗧 <𝗪𝗢𝗥𝗗>\n` +
            `┃  ───◈ .𝗗𝗘𝗙𝗜𝗡𝗘\n` +
            `┃  ───◈ .𝗪𝗘𝗔𝗧𝗛𝗘𝗥 <𝗖𝗜𝗧𝗬>\n` +
            `┃  ───◈ .𝗡𝗘𝗪𝗦\n` +
            `┃  ───◈ .𝗣𝗜𝗡𝗧𝗘𝗥𝗘𝗦𝗧 <𝗤𝗨𝗘𝗥𝗬>\n` +
            `┃  ───◈ .𝗣𝗜𝗡\n` +
            `┃  ───◈ .𝗦𝗦 <𝗨𝗥𝗟>\n` +
            `┃  ───◈ .𝗦𝗦𝗪𝗘𝗕\n` +
            `┃  ───◈ .𝗧𝗢𝗨𝗥𝗟\n` +
            `┃  ───◈ .𝗨𝗥𝗟\n` +
            `┃  ───◈ .𝗙𝗔𝗖𝗘𝗕𝗢𝗢𝗞 <𝗨𝗥𝗟>\n` +
            `┃  ───◈ .𝗙𝗕\n` +
            `┃  ───◈ .𝗜𝗡𝗦𝗧𝗔𝗚𝗥𝗔𝗠 <𝗨𝗥𝗟>\n` +
            `┃  ───◈ .𝗜𝗚\n` +
            `┃  ───◈ .𝗜𝗡𝗦𝗧𝗔\n` +
            `┃  ───◈ .𝗧𝗜𝗞𝗧𝗢𝗞 <𝗨𝗥𝗟>\n` +
            `┃  ───◈ .𝗧𝗧\n` +
            `┃  ───◈ .𝗔𝗣𝗞 <𝗔𝗣𝗣 𝗡𝗔𝗠𝗘>\n` +
            `┃  ───◈ .𝗔𝗣𝗣\n` +
            `╰━━━━━━━━━━━━━━╯\n\n` +
            `╭━━〔 ✦ 𝗚𝗔𝗠𝗘𝗦 & 𝗙𝗨𝗡 〕━━╮\n` +
            `┃  ───◈ .𝗧𝗜𝗖𝗧𝗔𝗖𝗧𝗢𝗘 @𝗨𝗦𝗘𝗥\n` +
            `┃  ───◈ .𝗧𝗧𝗧\n` +
            `┃  ───◈ .𝗛𝗔𝗡𝗚𝗠𝗔𝗡\n` +
            `┃  ───◈ .𝗧𝗥𝗜𝗩𝗜𝗔\n` +
            `┃  ───◈ .𝗥𝗢𝗟𝗟 <𝗦𝗜𝗗𝗘𝗦>\n` +
            `┃  ───◈ .𝗗𝗜𝗖𝗘\n` +
            `┃  ───◈ .𝗙𝗟𝗜𝗣𝗖𝗢𝗜𝗡\n` +
            `┃  ───◈ .𝗖𝗢𝗜𝗡𝗙𝗟𝗜𝗣\n` +
            `┃  ───◈ .𝗦𝗟𝗢𝗧𝗦\n` +
            `┃  ───◈ .𝗖𝗔𝗦𝗜𝗡𝗢\n` +
            `┃  ───◈ .𝗥𝗜𝗗𝗗𝗟𝗘\n` +
            `┃  ───◈ .𝗣𝗜𝗖𝗞 <𝗢𝗣𝗧𝟭, 𝗢𝗣𝗧𝟮>\n` +
            `┃  ───◈ .𝗖𝗛𝗢𝗢𝗦𝗘\n` +
            `┃  ───◈ .𝗧𝗥𝗨𝗧𝗛\n` +
            `┃  ───◈ .𝗗𝗔𝗥𝗘\n` +
            `┃  ───◈ .𝟴𝗕𝗔𝗟𝗟 <𝗤𝗨𝗘𝗦𝗧𝗜𝗢𝗡>\n` +
            `┃  ───◈ .𝗠𝗘𝗠𝗘\n` +
            `┃  ───◈ .𝗝𝗢𝗞𝗘\n` +
            `┃  ───◈ .𝗤𝗨𝗢𝗧𝗘\n` +
            `┃  ───◈ .𝗖𝗢𝗠𝗣𝗟𝗜𝗠𝗘𝗡𝗧\n` +
            `┃  ───◈ .𝗜𝗡𝗦𝗨𝗟𝗧\n` +
            `┃  ───◈ .𝗦𝗛𝗜𝗣 @𝗨𝗦𝗘𝗥\n` +
            `┃  ───◈ .𝗦𝗜𝗠𝗣\n` +
            `┃  ───◈ .𝗙𝗟𝗜𝗥𝗧\n` +
            `┃  ───◈ .𝗦𝗛𝗔𝗬𝗔𝗥𝗜\n` +
            `┃  ───◈ .𝗦𝗛𝗔𝗬𝗥𝗜\n` +
            `┃  ───◈ .𝗪𝗔𝗜𝗙𝗨\n` +
            `┃  ───◈ .𝗡𝗘𝗞𝗢\n` +
            `┃  ───◈ .𝗠𝗔𝗜𝗗\n` +
            `┃  ───◈ .𝗨𝗡𝗜𝗙𝗢𝗥𝗠\n` +
            `┃  ───◈ .𝗛𝗨𝗦𝗕𝗔𝗡𝗗𝗢\n` +
            `┃  ───◈ .𝗞𝗜𝗧𝗦𝗨𝗡𝗘\n` +
            `┃  ───◈ .𝗦𝗛𝗜𝗡𝗢𝗕𝗨\n` +
            `┃  ───◈ .𝗠𝗘𝗚𝗨𝗠𝗜𝗡\n` +
            `┃  ───◈ .𝗔𝗡𝗜𝗠𝗘𝗤𝗨𝗢𝗧𝗘\n` +
            `╰━━━━━━━━━━━━━━╯\n\n` +
            `╭━━〔 ✦ 𝗗𝗘𝗩𝗘𝗟𝗢𝗣𝗘𝗥 〕━━╮\n` +
            `┃  ───◈ .𝗕𝗔𝗦𝗘𝟲𝟰 <𝗧𝗘𝗫𝗧>\n` +
            `┃  ───◈ .𝗕𝗜𝗡𝗔𝗥𝗬 <𝗧𝗘𝗫𝗧>\n` +
            `┃  ───◈ .𝗛𝗔𝗦𝗛 <𝗧𝗘𝗫𝗧>\n` +
            `╰━━━━━━━━━━━━━━╯\n\n`;

        // Section: Group Management (Shown to Group Admins or Owner)
        if (isSenderAdmin || isOwner) {
            helpMessage += `╭━━〔 ✦ 𝗚𝗥𝗢𝗨𝗣 𝗠𝗔𝗡𝗔𝗚𝗘𝗠𝗘𝗡𝗧 〕━━╮\n` +
                `┃  *Visible to Group Admins & Owner*\n` +
                `┃\n` +
                `┃  ───◈ .𝗞𝗜𝗖𝗞 @𝗨𝗦𝗘𝗥\n` +
                `┃  ───◈ .𝗔𝗗𝗗 <𝗡𝗨𝗠𝗕𝗘𝗥>\n` +
                `┃  ───◈ .𝗣𝗥𝗢𝗠𝗢𝗧𝗘 @𝗨𝗦𝗘𝗥\n` +
                `┃  ───◈ .𝗗𝗘𝗠𝗢𝗧𝗘 @𝗨𝗦𝗘𝗥\n` +
                `┃  ───◈ .𝗠𝗨𝗧𝗘 <𝗠𝗜𝗡𝗦>\n` +
                `┃  ───◈ .𝗨𝗡𝗠𝗨𝗧𝗘\n` +
                `┃  ───◈ .𝗟𝗜𝗡𝗞\n` +
                `┃  ───◈ .𝗚𝗟𝗜𝗡𝗞\n` +
                `┃  ───◈ .𝗥𝗘𝗦𝗘𝗧𝗟𝗜𝗡𝗞\n` +
                `┃  ───◈ .𝗥𝗘𝗩𝗢𝗞𝗘\n` +
                `┃  ───◈ .𝗧𝗔𝗚𝗔𝗟𝗟 <𝗧𝗘𝗫𝗧>\n` +
                `┃  ───◈ .𝗧𝗔𝗚𝗔𝗗𝗠𝗜𝗡 <𝗧𝗘𝗫𝗧>\n` +
                `┃  ───◈ .𝗧𝗔𝗚𝗡𝗢𝗧𝗔𝗗𝗠𝗜𝗡 <𝗧𝗘𝗫𝗧>\n` +
                `┃  ───◈ .𝗛𝗜𝗗𝗘𝗧𝗔𝗚 <𝗧𝗘𝗫𝗧>\n` +
                `┃  ───◈ .𝗧𝗔𝗚𝗚𝗛𝗢𝗦𝗧\n` +
                `┃  ───◈ .𝗚𝗛𝗢𝗦𝗧𝗦\n` +
                `┃  ───◈ .𝗪𝗔𝗥𝗡 @𝗨𝗦𝗘𝗥\n` +
                `┃  ───◈ .𝗪𝗔𝗥𝗡𝗜𝗡𝗚𝗦 @𝗨𝗦𝗘𝗥\n` +
                `┃  ───◈ .𝗥𝗘𝗦𝗘𝗧𝗪𝗔𝗥𝗡 @𝗨𝗦𝗘𝗥\n` +
                `┃  ───◈ .𝗨𝗡𝗪𝗔𝗥𝗡\n` +
                `┃  ───◈ .𝗟𝗘𝗔𝗩𝗘\n` +
                `┃  ───◈ .𝗟𝗘𝗔𝗩𝗘𝗚𝗖\n` +
                `┃  ───◈ .𝗚𝗥𝗢𝗨𝗣𝗜𝗡𝗙𝗢\n` +
                `┃  ───◈ .𝗜𝗡𝗙𝗢𝗚𝗣\n` +
                `┃  ───◈ .𝗦𝗧𝗔𝗙𝗙\n` +
                `┃  ───◈ .𝗔𝗗𝗠𝗜𝗡𝗦\n` +
                `┃  ───◈ .𝗔𝗗𝗠𝗜𝗡𝗟𝗢𝗖𝗞\n` +
                `┃  ───◈ .𝗦𝗘𝗧𝗚𝗡𝗔𝗠𝗘 <𝗡𝗔𝗠𝗘>\n` +
                `┃  ───◈ .𝗦𝗘𝗧𝗚𝗗𝗘𝗦𝗖 <𝗗𝗘𝗦𝗖>\n` +
                `┃  ───◈ .𝗦𝗘𝗧𝗚𝗣𝗣\n` +
                `┃  ───◈ .𝗪𝗘𝗟𝗖𝗢𝗠𝗘 𝗢𝗡/𝗢𝗙𝗙\n` +
                `┃  ───◈ .𝗚𝗢𝗢𝗗𝗕𝗬𝗘 𝗢𝗡/𝗢𝗙𝗙\n` +
                `┃  ───◈ .𝗔𝗨𝗧𝗢𝗥𝗘𝗤𝗔𝗖𝗖𝗘𝗣𝗧 𝗢𝗡/𝗢𝗙𝗙/𝗡𝗢𝗪\n` +
                `┃  ───◈ .𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞 𝗢𝗡/𝗢𝗙𝗙\n` +
                `┃  ───◈ .𝗔𝗡𝗧𝗜𝗧𝗔𝗚 𝗢𝗡/𝗢𝗙𝗙\n` +
                `┃  ───◈ .𝗔𝗡𝗧𝗜𝗕𝗔𝗗𝗪𝗢𝗥𝗗 𝗢𝗡/𝗢𝗙𝗙\n` +
                `┃  ───◈ .𝗔𝗡𝗧𝗜𝗙𝗢𝗥𝗘𝗜𝗚𝗡 𝗢𝗡/𝗢𝗙𝗙\n` +
                `┃  ───◈ .𝗔𝗡𝗧𝗜𝗦𝗣𝗔𝗠 𝗢𝗡/𝗢𝗙𝗙\n` +
                `╰━━━━━━━━━━━━━━╯\n\n`;
        }

        // Section: Owner Control (Shown to Owner / Sudo)
        if (isOwner) {
            helpMessage += `╭━━〔 ✦ 𝗢𝗪𝗡𝗘𝗥 𝗖𝗢𝗡𝗧𝗥𝗢𝗟 〕━━╮\n` +
                `┃  *Visible to Bot Owner*\n` +
                `┃\n` +
                `┃  ───◈ .𝗠𝗢𝗗𝗘 𝗣𝗨𝗕𝗟𝗜𝗖/𝗣𝗥𝗜𝗩𝗔𝗧𝗘\n` +
                `┃  ───◈ .𝗥𝗘𝗦𝗧𝗔𝗥𝗧\n` +
                `┃  ───◈ .𝗥𝗘𝗕𝗢𝗢𝗧\n` +
                `┃  ───◈ .𝗕𝗥𝗢𝗔𝗗𝗖𝗔𝗦𝗧 <𝗧𝗘𝗫𝗧>\n` +
                `┃  ───◈ .𝗕𝗖\n` +
                `┃  ───◈ .𝗕𝗟𝗢𝗖𝗞 <𝗡𝗨𝗠𝗕𝗘𝗥>\n` +
                `┃  ───◈ .𝗨𝗡𝗕𝗟𝗢𝗖𝗞 <𝗡𝗨𝗠𝗕𝗘𝗥>\n` +
                `┃  ───◈ .𝗦𝗘𝗧𝗡𝗔𝗠𝗘 <𝗡𝗔𝗠𝗘>\n` +
                `┃  ───◈ .𝗦𝗘𝗧𝗕𝗜𝗢 <𝗧𝗘𝗫𝗧>\n` +
                `┃  ───◈ .𝗦𝗘𝗧𝗔𝗕𝗢𝗨𝗧\n` +
                `┃  ───◈ .𝗦𝗘𝗧𝗣𝗣\n` +
                `┃  ───◈ .𝗦𝗘𝗧𝗠𝗘𝗡𝗨𝗗𝗣\n` +
                `┃  ───◈ .𝗦𝗘𝗧𝗗𝗣\n` +
                `┃  ───◈ .𝗦𝗘𝗧𝗗𝗣𝗗\n` +
                `┃  ───◈ .𝗦𝗘𝗧𝗗𝗣𝗗𝗘𝗙𝗔𝗨𝗟𝗧\n` +
                `┃  ───◈ .𝗦𝗘𝗧𝗠𝗘𝗡𝗨𝗠𝗨𝗦𝗜𝗖\n` +
                `┃  ───◈ .𝗦𝗘𝗧𝗠𝗨𝗦𝗜𝗖\n` +
                `┃  ───◈ .𝗖𝗟𝗘𝗔𝗥𝗦𝗘𝗦𝗦𝗜𝗢𝗡\n` +
                `┃  ───◈ .𝗖𝗟𝗘𝗔𝗥𝗧𝗠𝗣\n` +
                `┃  ───◈ .𝗨𝗣𝗗𝗔𝗧𝗘\n` +
                `┃  ───◈ .𝗔𝗨𝗧𝗢𝗦𝗧𝗔𝗧𝗨𝗦 𝗢𝗡/𝗢𝗙𝗙\n` +
                `┃  ───◈ .𝗔𝗨𝗧𝗢𝗚𝗥𝗢𝗨𝗣𝗦𝗧𝗔𝗧𝗨𝗦 <𝗢𝗡/𝗢𝗙𝗙>\n` +
                `┃  ───◈ .𝗔𝗨𝗧𝗢𝗦𝗧𝗔𝗧𝗨𝗦𝗩𝗜𝗘𝗪 <𝗢𝗡/𝗢𝗙𝗙>\n` +
                `┃  ───◈ .𝗔𝗨𝗧𝗢𝗥𝗘𝗔𝗖𝗧 𝗢𝗡/𝗢𝗙𝗙\n` +
                `┃  ───◈ .𝗔𝗨𝗧𝗢𝗧𝗬𝗣𝗜𝗡𝗚 𝗢𝗡/𝗢𝗙𝗙\n` +
                `┃  ───◈ .𝗔𝗨𝗧𝗢𝗥𝗘𝗔𝗗 𝗢𝗡/𝗢𝗙𝗙\n` +
                `┃  ───◈ .𝗔𝗨𝗧𝗢𝗝𝗢𝗜𝗡𝗟𝗜𝗡𝗞𝗦 𝗢𝗡/𝗢𝗙𝗙\n` +
                `┃  ───◈ .𝗔𝗡𝗧𝗜𝗖𝗔𝗟𝗟 𝗢𝗡/𝗢𝗙𝗙\n` +
                `┃  ───◈ .𝗣𝗠𝗕𝗟𝗢𝗖𝗞𝗘𝗥 𝗢𝗡/𝗢𝗙𝗙\n` +
                `┃  ───◈ .𝗦𝗠𝗔𝗥𝗧𝗥𝗘𝗣𝗟𝗬 𝗢𝗡/𝗢𝗙𝗙\n` +
                `┃  ───◈ .𝗖𝗛𝗔𝗧𝗕𝗢𝗧 𝗢𝗡/𝗢𝗙𝗙\n` +
                `┃  ───◈ .𝗔𝗡𝗧𝗜𝗗𝗘𝗟𝗘𝗧𝗘 𝗢𝗡/𝗢𝗙𝗙\n` +
                `┃  ───◈ .𝗦𝗨𝗗𝗢 𝗔𝗗𝗗/𝗗𝗘𝗟\n` +
                `┃  ───◈ .𝗣𝗔𝗜𝗥\n` +
                `╰━━━━━━━━━━━━━━╯\n\n`;
        }

        helpMessage += `╭━━━〔 👑 𝗭𝗢𝗫𝗘𝗥  〕━━━╮\n` +
            `┃  𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗭𝗢𝗫𝗘𝗥\n` +
            `╰━━━━━━━━━━━━━━━━━━╯`;

        const candidatePaths = [
            path.resolve(__dirname, '..', 'assets', 'images', 'custom_menu.jpg'),
            path.resolve(__dirname, '..', 'zoxer.jpg'),
            path.resolve(process.cwd(), 'zoxer.jpg'),
            path.resolve(__dirname, '..', 'assets', 'images', 'zoxer.jpg'),
            path.resolve(process.cwd(), 'assets', 'images', 'zoxer.jpg')
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

helpCommand.commandCatalog = commandCatalog;
module.exports = helpCommand;
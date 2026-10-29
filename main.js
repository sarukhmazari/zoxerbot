// 🧹 Safe dotenv initialization
try {
    require('dotenv').config();
} catch (_) {}

// 📱 Auto-check & install Termux / node dependencies
try {
    require('./lib/auto-installer')();
} catch (_) {}

// Record bot process boot timestamp and sync real server time offset
global.botStartTime = Math.floor(Date.now() / 1000);
global.timeOffset = 0;
function syncTimeOffset() {
    try {
        const https = require('https');
        https.get('https://web.whatsapp.com', (res) => {
            if (res.headers.date) {
                const serverSec = Math.floor(new Date(res.headers.date).getTime() / 1000);
                const localSec = Math.floor(Date.now() / 1000);
                global.timeOffset = localSec - serverSec;
            }
        }).on('error', () => {});
    } catch (_) {}
}
syncTimeOffset();
setInterval(syncTimeOffset, 15 * 60 * 1000);

// Global log capturer for Admin Panel
global.botLogs = [];
function addLog(args, type = 'info') {
    const time = new Date().toLocaleTimeString();
    let str = Array.isArray(args) ? args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') : String(args);
    // Remove ansi color codes from string for clean web display
    str = str.replace(/\x1B\[\d+m/g, '').replace(/\[\d+m/g, '');
    global.botLogs.push({ time, msg: str, type });
    if (global.botLogs.length > 200) global.botLogs.shift();
}

// Helper to identify internal Baileys noise and protocol logs
function isBaileysInternalNoise(str) {
    if (!str) return false;
    return (
        str.includes('Closing open session') ||
        str.includes('SessionEntry') ||
        str.includes('Decrypted message') ||
        str.includes('Failed to decrypt') ||
        str.includes('Bad MAC') ||
        str.includes('PreKey') ||
        str.includes('stream error') ||
        str.includes('No matching session') ||
        str.includes('MessageCounterError') ||
        str.includes('rate-overlimit') ||
        str.includes('conflict') ||
        str.includes('ECONNRESET') ||
        str.includes('ETIMEDOUT')
    );
}

// Suppress raw stdout/stderr spam from underlying Baileys streams
const originalWrite = process.stdout.write;
process.stdout.write = function (chunk, encoding, callback) {
    const str = chunk ? chunk.toString() : '';
    if (isBaileysInternalNoise(str)) {
        return true;
    }
    return originalWrite.apply(process.stdout, arguments);
};

const originalErrWrite = process.stderr.write;
process.stderr.write = function (chunk, encoding, callback) {
    const str = chunk ? chunk.toString() : '';
    if (isBaileysInternalNoise(str)) {
        return true;
    }
    return originalErrWrite.apply(process.stderr, arguments);
};

const originalLog = console.log;
console.log = function (...args) {
    addLog(args, 'info');
    const joined = args.map(a => typeof a === 'object' ? (a?.message || JSON.stringify(a) || '') : String(a)).join(' ');

    // User requirement: ONLY show commands (with prefix), responses, and startup/pairing banners
    const isCommandLog = joined.includes('[COMMAND]') || 
                         joined.includes('[TERMINAL COMMAND]') || 
                         joined.includes('[ZOXER BOT RESPONSE]') || 
                         joined.includes('finished.') || 
                         joined.includes('Command "');
    const isStartupOrPairing = joined.includes('PAIRING CODE') ||
                              joined.includes('Enter this code on WhatsApp') ||
                              joined.includes('Please enter your WhatsApp') ||
                              joined.includes('No active WhatsApp session detected') ||
                              joined.includes('[WHATSAPP CONNECTED]') ||
                              joined.includes('[API SERVER]') ||
                              joined.includes('ZOXER BOT core is running') ||
                              joined.includes('Tip: You can send commands');

    const isAutoReact = joined.includes('[AUTOREACT]') || joined.includes('[AUTOFOLLOW]');

    if (isCommandLog || isStartupOrPairing || isAutoReact) {
        originalLog.apply(console, args);
    }
};

const originalError = console.error;
console.error = function (...args) {
    addLog(args, 'error');
    const joined = args.map(a => typeof a === 'object' ? (a?.message || JSON.stringify(a) || '') : String(a)).join(' ');
    
    // Only print command execution errors, autoreact errors, or fatal process crashes to terminal
    const isCommandError = joined.includes('[COMMAND ERROR]') || 
                           joined.includes('[AUTOREACT]') ||
                           joined.includes('Terminal command error') || 
                           joined.includes('💥') || 
                           joined.includes('Launch failed');
    if (isCommandError) {
        originalError.apply(console, args);
    }
};

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const supabase = require('./lib/supabase');
let startAdminApi = () => { };
try {
    const adminApiModule = require('./admin_panel/admin_api');
    if (adminApiModule && typeof adminApiModule.startAdminApi === 'function') {
        startAdminApi = adminApiModule.startAdminApi;
    }
} catch (e) {
    // Admin panel API module optional
}

// Redirect temp storage away from system /tmp (safe for serverless and local)
const isVercelEnv = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
const customTemp = isVercelEnv ? '/tmp' : path.join(process.cwd(), 'temp');
if (!isVercelEnv && !fs.existsSync(customTemp)) {
    try { fs.mkdirSync(customTemp, { recursive: true }); } catch (e) {}
}
process.env.TMPDIR = customTemp;
process.env.TEMP = customTemp;
process.env.TMP = customTemp;

// Auto-cleaner every 3 hours
setInterval(() => {
    fs.readdir(customTemp, (err, files) => {
        if (err) return;
        for (const file of files) {
            const filePath = path.join(customTemp, file);
            fs.stat(filePath, (err, stats) => {
                if (!err && Date.now() - stats.mtimeMs > 3 * 60 * 60 * 1000) {
                    fs.unlink(filePath, () => { });
                }
            });
        }
    });
    console.log('🧹 Temp folder auto-cleaned');
}, 3 * 60 * 60 * 1000);

const settings = require('./settings');
const { isBanned } = require('./lib/isBanned');
const yts = require('yt-search');
const { fetchBuffer, reSize } = require('./lib/myfunc');
const fetch = require('node-fetch');
const ytdl = require('ytdl-core');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const { isSudo, getCustomCommands, getPrivateCustomCommands, getAutoblock } = require('./lib/index');
const isOwnerOrSudo = require('./lib/isOwner');
const { autotypingCommand, isAutotypingEnabled, handleAutotypingForMessage, handleAutotypingForCommand, showTypingAfterCommand } = require('./commands/autotyping');
const { autoreadCommand, isAutoreadEnabled, handleAutoread } = require('./commands/autoread');

// Command imports
const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const tagAllCommand = require('./commands/tagall');
const tagAdminCommand = require('./commands/tagadmin');
const helpCommand = require('./commands/help');
const { setmenudpCommand, resetmenudpCommand } = require('./commands/setmenudp');
const setmenumusicCommand = require('./commands/setmenumusic');
const banCommand = require('./commands/ban');
const { promoteCommand } = require('./commands/promote');
const { demoteCommand } = require('./commands/demote');
const muteCommand = require('./commands/mute');
const unmuteCommand = require('./commands/unmute');
const stickerCommand = require('./commands/sticker');
const isAdmin = require('./lib/isAdmin');
const warnCommand = require('./commands/warn');
const warningsCommand = require('./commands/warnings');
const ttsCommand = require('./commands/tts');
const { tictactoeCommand, handleTicTacToeMove } = require('./commands/tictactoe');
const { incrementMessageCount, topMembers } = require('./commands/topmembers');
const ownerCommand = require('./commands/owner');
const deleteCommand = require('./commands/delete');
const tostatusCommand = require('./commands/tostatus');
const gcsstatusCommand = require('./commands/gcsstatus');
const { handleAntilinkCommand, handleLinkDetection } = require('./commands/antilink');
const { handleAntitagCommand, handleTagDetection } = require('./commands/antitag');
const { Antilink } = require('./lib/antilink');
const { handleMentionDetection, mentionToggleCommand, setMentionCommand } = require('./commands/mention');
const memeCommand = require('./commands/meme');
const tagCommand = require('./commands/tag');
const tagNotAdminCommand = require('./commands/tagnotadmin');
const hideTagCommand = require('./commands/hidetag');
const sendLinkCommand = require('./commands/sendlink');
const jokeCommand = require('./commands/joke');
const quoteCommand = require('./commands/quote');
const factCommand = require('./commands/fact');
const weatherCommand = require('./commands/weather');
const newsCommand = require('./commands/news');
const kickCommand = require('./commands/kick');
const simageCommand = require('./commands/simage');
const { startHangman, guessLetter } = require('./commands/hangman');
const { startTrivia, answerTrivia } = require('./commands/trivia');
const { complimentCommand } = require('./commands/compliment');
const { insultCommand } = require('./commands/insult');
const { eightBallCommand } = require('./commands/eightball');
const { lyricsCommand } = require('./commands/lyrics');
const { dareCommand } = require('./commands/dare');
const { truthCommand } = require('./commands/truth');
const { clearCommand } = require('./commands/clear');
const pingCommand = require('./commands/ping');
const aliveCommand = require('./commands/alive');
const blurCommand = require('./commands/img-blur');
const { welcomeCommand, handleJoinEvent } = require('./commands/welcome');
const { goodbyeCommand, handleLeaveEvent } = require('./commands/goodbye');
const githubCommand = require('./commands/github');
const { handleAntiBadwordCommand, handleBadwordDetection } = require('./lib/antibadword');
const antibadwordCommand = require('./commands/antibadword');
const { handleChatbotCommand, handleChatbotResponse } = require('./commands/chatbot');
const takeCommand = require('./commands/take');
const { flirtCommand } = require('./commands/flirt');
const characterCommand = require('./commands/character');
const wastedCommand = require('./commands/wasted');
const shipCommand = require('./commands/ship');
const pairCommand = require('./commands/pair');
const groupInfoCommand = require('./commands/groupinfo');
const resetlinkCommand = require('./commands/resetlink');
const staffCommand = require('./commands/staff');
const { adminlockCommand, handleAdminlockPromotion } = require('./commands/adminlock');
const addCommand = require('./commands/add');
const unbanCommand = require('./commands/unban');
const { handlePromotionEvent } = require('./commands/promote');
const { handleDemotionEvent } = require('./commands/demote');
const viewOnceCommand = require('./commands/viewonce');
const { extractViewOnceMedia } = require('./commands/viewonce');
const clearSessionCommand = require('./commands/clearsession');
const { autoStatusCommand, handleStatusUpdate } = require('./commands/autostatus');
const { simpCommand } = require('./commands/simp');
const { stupidCommand } = require('./commands/stupid');
const textmakerCommand = require('./commands/textmaker');
const { handleAntideleteCommand, handleMessageRevocation, storeMessage } = require('./commands/antidelete');
const clearTmpCommand = require('./commands/cleartmp');
const setProfilePicture = require('./commands/setpp');
const { setGroupDescription, setGroupName, setGroupPhoto } = require('./commands/groupmanage');
const instagramCommand = require('./commands/instagram');
const facebookCommand = require('./commands/facebook');
const tiktokCommand = require('./commands/tiktok');
const songCommand = require('./commands/song');
const spotifyCommand = require('./commands/spotify');
const videoCommand = require('./commands/video');
const aiCommand = require('./commands/ai');
const urlCommand = require('./commands/url');
const qcCommand = require('./commands/qc');
const pollCommand = require('./commands/poll');
const tourlCommand = require('./commands/tourl');
const pinterestCommand = require('./commands/pinterest');
const { handleTranslateCommand } = require('./commands/translate');
const { handleSsCommand } = require('./commands/ss');
const { autoreactCommand, addAutoReaction } = require('./commands/autoreact');
const { goodnightCommand } = require('./commands/goodnight');
const { shayariCommand } = require('./commands/shayari');
const { rosedayCommand } = require('./commands/roseday');
const imagineCommand = require('./commands/imagine');
const sudoCommand = require('./commands/sudo');
const { miscCommand, handleHeart } = require('./commands/misc');
const { animeCommand } = require('./commands/anime');
const { animePicsCommand, animeQuoteCommand } = require('./commands/animepics');
const { piesCommand, piesAlias } = require('./commands/pies');
const stickercropCommand = require('./commands/stickercrop');
const updateCommand = require('./commands/update');
const removebgCommand = require('./commands/removebg');
const { reminiCommand } = require('./commands/remini');
const { igsCommand } = require('./commands/igs');
const dpCommand = require('./commands/dp');
const { anticallCommand, readState: readAnticallState } = require('./commands/anticall');
const { pmblockerCommand, readState: readPmBlockerState } = require('./commands/pmblocker');
const settingsCommand = require('./commands/settings');
const soraCommand = require('./commands/sora');
const statusCommand = require('./commands/status');
const customCommand = require('./commands/custom');
const autoblockCommand = require('./commands/autoblock');
const antispamCommand = require('./commands/antispam');
const pcustomeCommand = require('./commands/pcustome');
const { handleSpamDetection, isUserIgnored } = require('./lib/spamTracker');
const { handleAntispamDetection } = require('./lib/antispamTracker');
const { smartreplyCommand, getSmartReplyStatus } = require('./commands/smartreply');
const toAudioCommand = require('./commands/toaudio');
const toVideoCommand = require('./commands/tovideo');
const toPttCommand = require('./commands/toptt');
const qrcodeCommand = require('./commands/qrcode');
const { invertCommand, rotateCommand } = require('./commands/imageedit');
const reactCommand = require('./commands/react');
const { fancyCommand, readmoreCommand, morseCommand, countCommand, reverseCommand } = require('./commands/textutils');
const wikipediaCommand = require('./commands/wikipedia');
const cryptoCommand = require('./commands/crypto');
const dictionaryCommand = require('./commands/dictionary');
const timezoneCommand = require('./commands/timezone');
const calcCommand = require('./commands/calc');
const { linkCommand, leaveCommand, tagGhostCommand } = require('./commands/groupextras');
const { getBioCommand, blockCommand, unblockCommand, setNameCommand, setBioCommand } = require('./commands/profileutils');
const { rollCommand, flipCoinCommand, slotsCommand, riddleCommand, pickCommand } = require('./commands/games');
const { base64Command, binaryCommand, hashCommand } = require('./commands/devutils');
const { restartCommand, broadcastCommand } = require('./commands/owneradmin');

// Global Cooldown System - Optimized with auto-cleanup
const globalSmartReplyCooldowns = new Map();
const chatbotCooldowns = new Map();

// 🛠️ Optimization: Periodically cleanup cooldown caches to prevent memory buildup
setInterval(() => {
    const now = Date.now();
    for (const [key, time] of globalSmartReplyCooldowns) {
        if (now - time > 60000) globalSmartReplyCooldowns.delete(key);
    }
    for (const [key, time] of chatbotCooldowns) {
        if (now - time > 300000) chatbotCooldowns.delete(key);
    }
}, 10 * 60 * 1000); // Every 10 minutes

// 🛠️ Optimization: Cache bot mode in memory to avoid constant disk IO
let cachedBotMode = { isPublic: true, lastUpdate: 0 };
function readBotModeFile() {
    const modePath = './data/bot-settings.json';
    const legacyPath = './data/messageCount.json';
    try {
        if (fs.existsSync(modePath)) {
            const data = JSON.parse(fs.readFileSync(modePath, 'utf8'));
            if (typeof data.isPublic === 'boolean') return data;
        }
        if (fs.existsSync(legacyPath)) {
            const data = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
            if (typeof data.isPublic === 'boolean') {
                fs.writeFileSync(modePath, JSON.stringify({ isPublic: data.isPublic }, null, 2));
                return { isPublic: data.isPublic };
            }
        }
    } catch (e) { }
    return { isPublic: true };
}
function getCachedMode() {
    const now = Date.now();
    if (now - cachedBotMode.lastUpdate > 30000) { // Refresh every 30 seconds
        cachedBotMode = { ...readBotModeFile(), lastUpdate: now };
    }
    return cachedBotMode;
}

// Global settings
global.packname = settings.packname;
global.author = settings.author;
global.channelLink = settings.channelLink;
global.channelLink2 = settings.channelLink;
global.ytch = "";

// global.channelInfo and global.promotionInfo are empty by default
global.channelInfo = {};
global.promotionInfo = {};

// Smart Reply Response Pool
const smartReplyPool = {
    greeting_urdu: [
        'Wa Alaikum Assalam 🌸 How are you?',
        'Aslam o Alaikum! Kya haal hai?',
        'Alaikum Assalam! Sab theek?',
        'Wa Alaikum Assalam! Kya chal raha hai?',
        'Assalam o Alaikum 😊 Batao, kya scene hai?',
    ],
    greeting_english: [
        'Hello! 👋 How can I help?',
        'Hi there! 😄 Kya haal hai?',
        'Hey! 👋 What\'s up?',
        'Hello bro! 😊 Sab theek?',
        'Hi! How are you doing?',
    ],
    how_are_you: [
        'Alhamdulillah, theek hun! 😊 Tu kaisa hai?',
        'Badhiya hun! Tum batao? 😄',
        'All good! Kya haal hai tum ka?',
        'Sab khairiyat! Aap theek ho?',
        'Bilkul theek hun! Tu kya bol raha hai?',
    ]
};

// Get random response from pool
function getRandomReply(category) {
    const replies = smartReplyPool[category] || [];
    return replies[Math.floor(Math.random() * replies.length)] || '';
}

// Check if message is a greeting (fuzzy matching)
function isGreetingMessage(text) {
    // Remove special characters and convert to lowercase
    const cleanText = text.toLowerCase().trim();

    // Urdu/Pakistani style greetings
    const urduGreetings = [
        'aoa', 'assalam', 'aslam', 'slam', 'salam', 'alaikum', 'alikum',
        'walaikum', 'wa alaikum', 'assalamo alaikum', 'aslamo alaikum'
    ];

    // English greetings
    const englishGreetings = [
        'hi', 'hello', 'hey', 'helo', 'hii', 'helloo', 'hy', 'helo'
    ];

    // How are you variations
    const howAreYouPatterns = [
        'kia hal', 'kaisa hal', 'kaise ho', 'kya hal', 'hall', 'haal', 'kaise', 'kaise ho'
    ];

    // Check for Urdu greetings
    for (const greeting of urduGreetings) {
        if (cleanText.includes(greeting)) {
            return 'greeting_urdu';
        }
    }

    // Check for English greetings
    for (const greeting of englishGreetings) {
        if (cleanText.includes(greeting)) {
            return 'greeting_english';
        }
    }

    // Check for "how are you" patterns
    for (const pattern of howAreYouPatterns) {
        if (cleanText.includes(pattern)) {
            return 'how_are_you';
        }
    }

    return null;
}

/**
 * Handle Smart Auto-Replies for greetings
 */
async function handleSmartReplies(sock, chatId, message, userMessage, senderId) {
    try {
        // Get user-specific status
        const userJid = message.key.participant || message.key.remoteJid;

        // ⚠️ STRICT MODE CHECK - MUST BE AT THE VERY TOP ⚠️
        const isSmartReplyEnabled = getSmartReplyStatus();

        // EARLY EXIT: If smartreply is OFF, STOP immediately - no further processing
        if (!isSmartReplyEnabled) {
            return false; // HARD STOP - do not proceed
        }

        // At this point, we KNOW smartreply is ON - safe to proceed
        // 🛠️ Optimization: Reduced logging to only critical hits
        // console.log('✅ SmartReply is ON for', userJid);

        // Don't reply to bot's own messages
        if (message.key.fromMe) {
            return false;
        }

        if (!userMessage || userMessage.length > 100) {
            return false;
        }

        // Detect greeting message using fuzzy matching
        const greetingCategory = isGreetingMessage(userMessage);

        if (!greetingCategory) {
            return false;
        }

        // Anti-spam cooldown (20 seconds per user per chat)
        const cooldownKey = `${chatId}-${userJid}`;
        const now = Date.now();

        if (globalSmartReplyCooldowns.has(cooldownKey)) {
            const lastReplyTime = globalSmartReplyCooldowns.get(cooldownKey);
            if (now - lastReplyTime < 20000) {
                return false; // Still in cooldown
            }
        }

        // Get random response from appropriate category
        const response = getRandomReply(greetingCategory);

        if (response) {
            globalSmartReplyCooldowns.set(cooldownKey, now);
            await sock.sendMessage(chatId, { text: response }, { quoted: message });
            return true;
        }

        return false;
    } catch (err) {
        console.error('SmartReply error:', err.message);
        return false;
    }
}

async function handleMessages(sock, messageUpdate, printLog) {
    let chatId;

    const channelInfo = global.channelInfo; // Get latest global state
    try {
        const { messages, type } = messageUpdate || {};
        const message = messages?.[0];
        if (!message?.message) return;

        // Extract message timestamp safely
        let messageTime = message.messageTimestamp;
        if (typeof messageTime === 'object' && messageTime !== null) {
            messageTime = messageTime.low !== undefined ? messageTime.low : Number(messageTime);
        }

        const getMessageTextEarly = (m) => {
            const msg = m?.message || m;
            if (!msg) return "";
            if (msg.conversation) return msg.conversation;
            if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
            if (msg.imageMessage?.caption) return msg.imageMessage.caption;
            if (msg.videoMessage?.caption) return msg.videoMessage.caption;
            if (msg.buttonsResponseMessage?.selectedButtonId) return msg.buttonsResponseMessage.selectedButtonId;
            if (msg.templateButtonReplyMessage?.selectedId) return msg.templateButtonReplyMessage.selectedId;
            if (msg.ephemeralMessage?.message) return getMessageTextEarly(msg.ephemeralMessage.message);
            if (msg.viewOnceMessage?.message) return getMessageTextEarly(msg.viewOnceMessage.message);
            if (msg.viewOnceMessageV2?.message) return getMessageTextEarly(msg.viewOnceMessageV2.message);
            if (msg.viewOnceMessageV2Extension?.message) return getMessageTextEarly(msg.viewOnceMessageV2Extension.message);
            if (msg.documentWithCaptionMessage?.message) return getMessageTextEarly(msg.documentWithCaptionMessage.message);
            if (msg.editedMessage?.message) return getMessageTextEarly(msg.editedMessage.message);
            return "";
        };

        const earlyText = (getMessageTextEarly(message) || "").trim();
        const isCommandEarly = earlyText.startsWith('.') || earlyText === '❤' || earlyText === '❤️';

        // Drop historical backlog only if NOT a command and sent before this bot session booted
        const botBootTime = global.botStartTime || Math.floor(Date.now() / 1000);
        if (messageTime && messageTime < botBootTime - 120 && !isCommandEarly) {
            return;
        }

        // Only ignore append batches if NOT fromMe and NOT a command
        if (type === 'append' && !message.key?.fromMe && !isCommandEarly) {
            return;
        }

        // Smart Deduplication: Only drop duplicates after confirming message has content
        if (!global.processedMessageIds) {
            global.processedMessageIds = new Map();
        }

        // We only deduplicate non-commands or if ID is matched exactly within 10s
        const msgId = message.key.id;
        if (global.processedMessageIds.has(msgId)) {
            const lastTime = global.processedMessageIds.get(msgId);
            if (Date.now() - lastTime < 10000) return; // Ignore actual duplicates within 10s
        }
        global.processedMessageIds.set(msgId, Date.now());

        chatId = message.key?.remoteJid;
        const senderId = message.key.participant || message.key.remoteJid;
        const isGroup = chatId?.endsWith('@g.us');
        const senderIsSudo = await isSudo(senderId);
        const senderIsOwnerOrSudo = await isOwnerOrSudo(senderId, sock, chatId);

        const getMessageText = (m) => {
            const msg = m?.message || m;
            if (!msg) return "";
            if (msg.conversation) return msg.conversation;
            if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
            if (msg.imageMessage?.caption) return msg.imageMessage.caption;
            if (msg.videoMessage?.caption) return msg.videoMessage.caption;
            if (msg.buttonsResponseMessage?.selectedButtonId) return msg.buttonsResponseMessage.selectedButtonId;
            if (msg.templateButtonReplyMessage?.selectedId) return msg.templateButtonReplyMessage.selectedId;
            if (msg.ephemeralMessage?.message) return getMessageText(msg.ephemeralMessage.message);
            if (msg.viewOnceMessage?.message) return getMessageText(msg.viewOnceMessage.message);
            if (msg.viewOnceMessageV2?.message) return getMessageText(msg.viewOnceMessageV2.message);
            if (msg.viewOnceMessageV2Extension?.message) return getMessageText(msg.viewOnceMessageV2Extension.message);
            if (msg.documentWithCaptionMessage?.message) return getMessageText(msg.documentWithCaptionMessage.message);
            if (msg.editedMessage?.message) return getMessageText(msg.editedMessage.message);
            return "";
        };

        const rawText = getMessageText(message) || "";
        const userMessage = rawText.toLowerCase().replace(/\.\s+/g, '.').trim();

        // 👻 SECRET ❤ COMMAND - Silent view-once extraction for ANY user (not owner-only)
        if ((rawText.trim() === '❤️' || rawText.trim() === '❤')) {
            const userJid = message.key.participant || message.key.remoteJid;
            console.log('❤ command detected from:', userJid);

            const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted) {
                try {
                    // Use same extraction logic as .vv command
                    const extracted = await extractViewOnceMedia(message);

                    if (extracted) {
                        const { mediaType, mimeType, caption, buffer } = extracted;
                        console.log('Using VV extraction pipeline for user:', userJid);

                        // Always send privately to the current bot connected number
                        const targetJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : userJid;

                        if (mediaType === 'image') {
                            await sock.sendMessage(targetJid, { image: buffer, caption: caption || '' });
                        } else if (mediaType === 'video') {
                            await sock.sendMessage(targetJid, { video: buffer, caption: caption || '' });
                        } else if (mediaType === 'audio') {
                            await sock.sendMessage(targetJid, { audio: buffer, mimetype: mimeType, ptt: false });
                            if (caption) await sock.sendMessage(targetJid, { text: caption });
                        }

                        console.log('Secret ❤ extraction sent to:', targetJid);
                    }
                } catch (e) {
                    console.error('Secret ❤ extraction failed:', e.message);
                    // Silently ignore - no error message to group
                }
            }
            return; // 🛑 ALWAYS return silently to prevent visibility in group
        }

        // Auto-Block on Spam logic: Check if user is ignored (simulated block)
        if (isUserIgnored(chatId) && !message.key.fromMe && !senderIsOwnerOrSudo) return;

        // Handle autoread functionality
        await handleAutoread(sock, message);

        // Store message for antidelete feature
        if (message.message) {
            storeMessage(sock, message);
        }

        // Handle message revocation
        if (message.message?.protocolMessage?.type === 0) {
            await handleMessageRevocation(sock, message);
            return;
        }



        // Auto-Block on Spam logic (DM only)
        await handleSpamDetection(sock, chatId, message.key.fromMe, senderIsOwnerOrSudo, isGroup, getAutoblock);

        // Group Anti-Spam Detection (Repetition Kick System)
        if (isGroup && userMessage && !message.key.fromMe) {
            const adminStatus = await isAdmin(sock, chatId, senderId);
            await handleAntispamDetection(sock, chatId, senderId, userMessage, isGroup, adminStatus.isSenderAdmin, senderIsOwnerOrSudo, message);
        }

        // 🚀 Auto-react to Owner Messages (Requirement)
        const ownerNumbers = settings.ownerNumbers || [settings.ownerNumber];
        const botNumber = (sock.user?.id || '').split(':')[0].split('@')[0];
        const senderNumber = senderId.split(':')[0].split('@')[0];

        const isActuallyOwner = ownerNumbers.some(num => {
            const cleanNum = num.replace(/[^0-9]/g, '');
            return senderNumber === cleanNum;
        });

        // Channel/Newsletter posts are handled by the dedicated autoreact engine
        if (chatId?.endsWith('@newsletter')) {
            return;
        }

        // React if it's an owner, but NOT if it's from the bot itself
        if (isActuallyOwner && !message.key.fromMe) {
            try {
                await sock.sendMessage(chatId, {
                    react: {
                        text: "🔥",
                        key: message.key
                    }
                });
            } catch (e) {
                // Ignore reaction errors
            }
        }

        // Handle button responses
        if (message.message?.buttonsResponseMessage) {
            const buttonId = message.message.buttonsResponseMessage.selectedButtonId;
            const chatId = message.key.remoteJid;

            if (buttonId === 'channel') {
                await sock.sendMessage(chatId, {
                    text: '📢 *Bot Information*\nZOXER BOT - Professional WhatsApp Bot'
                }, { quoted: message });
                return;
            } else if (buttonId === 'owner') {
                await ownerCommand(sock, chatId);
                return;
            } else if (buttonId === 'support') {
                await sock.sendMessage(chatId, {
                    text: `🔗 *Support*\n\nContact the bot owner for support.`
                }, { quoted: message });
                return;
            }
        }

        // Log command usage in terminal
        if (userMessage.startsWith('.')) {
            const senderClean = senderId ? senderId.split('@')[0].split(':')[0] : 'Unknown';
            console.log(`📌 [COMMAND] "${rawText.trim()}" | User: @${senderClean} | ${isGroup ? `Group: ${chatId}` : 'Private DM'}`);
        }
        // Read bot mode from cache
        const configMode = getCachedMode();
        let isPublic = configMode.isPublic;
        const isOwnerOrSudoCheck = message.key.fromMe || senderIsOwnerOrSudo;
        // Check if user is banned (skip ban check for unban command)
        if (isBanned(senderId) && !userMessage.startsWith('.unban')) {
            // Only respond occasionally to avoid spam
            if (Math.random() < 0.1) {
                await sock.sendMessage(chatId, {
                    text: '❌ You are banned from using the bot. Contact an admin to get unbanned.',
                    ...channelInfo
                });
            }
            return;
        }

        // First check if it's a game move
        if (/^[1-9]$/.test(userMessage) || userMessage.toLowerCase() === 'surrender') {
            await handleTicTacToeMove(sock, chatId, senderId, userMessage);
            return;
        }

        /*  // Basic message response in private chat
          if (!isGroup && (userMessage === 'hi' || userMessage === 'hello' || userMessage === 'bot' || userMessage === 'hlo' || userMessage === 'hey' || userMessage === 'bro')) {
              await sock.sendMessage(chatId, {
                  text: 'Hi, How can I help you?\nYou can use .menu for more info and commands.',
                  ...channelInfo
              });
              return;
          } */

        if (!message.key.fromMe) incrementMessageCount(chatId, senderId);

        // Check for bad words and antilink FIRST, before ANY other processing
        // Always run moderation in groups, regardless of mode
        if (isGroup) {
            if (userMessage) {
                const badwordHandled = await handleBadwordDetection(sock, chatId, message, userMessage, senderId);
                if (badwordHandled) return;
            }
            // Antilink checks message text internally, so run it even if userMessage is empty
            await Antilink(message, sock);
        }

        // 💬 Handle Smart Auto-Replies for greetings
        if (!message.key.fromMe && userMessage) {
            const replied = await handleSmartReplies(sock, chatId, message, userMessage, senderId);
            if (replied) return; // Silent return if auto-replied
        }

        // PM blocker: block non-owner DMs when enabled (do not ban)
        if (!isGroup && !message.key.fromMe && !senderIsSudo) {
            try {
                const pmState = readPmBlockerState();
                if (pmState.enabled) {
                    // Inform user immediately and block without artificial delay.
                    await sock.sendMessage(chatId, { text: pmState.message || 'Private messages are blocked. Please contact the owner in groups only.' });
                    try { await sock.updateBlockStatus(chatId, 'block'); } catch (e) { }
                    return;
                }
            } catch (e) { }
        }

        // Auto-react to incoming messages
        await addAutoReaction(sock, message);

        // Then check for command prefix
        if (!userMessage.startsWith('.')) {
            // Show typing indicator if autotyping is enabled
            handleAutotypingForMessage(sock, chatId, userMessage).catch(console.error);


            if (isGroup) {
                // Always run moderation features (antitag) regardless of mode
                await handleTagDetection(sock, chatId, message, senderId);
                await handleMentionDetection(sock, chatId, message);

                // Only run chatbot in public mode or for owner/sudo
                if (isPublic || isOwnerOrSudoCheck) {
                    await handleChatbotResponse(sock, chatId, message, userMessage, senderId);
                }
            }
            return;
        }
        // In private mode, only owner/sudo can run commands
        if (!isPublic && !isOwnerOrSudoCheck) {
            let allowedToBypass = false;
            if (isGroup && userMessage.startsWith('.')) {
                const allowedPCommands = await getPrivateCustomCommands(chatId);
                if (allowedPCommands && allowedPCommands.length > 0) {
                    const usedCommand = userMessage.split(/\s+/)[0].slice(1).toLowerCase().trim();
                    if (allowedPCommands.includes(usedCommand)) {
                        allowedToBypass = true;
                    }
                }
            }
            if (!allowedToBypass) return;
        }

        // List of admin commands
        const adminCommands = ['.mute', '.unmute', '.ban', '.unban', '.promote', '.demote', '.kick', '.add', '.status', '.tagadmin', '.tagnotadmin', '.hidetag', '.antilink', '.antitag', '.setgdesc', '.setgname', '.setgpp', '.resetwarn', '.leave', '.tagghost'];
        const isAddLink = userMessage.startsWith('.add') && /(?:chat\.whatsapp\.com\/)[a-zA-Z0-9\-]+/i.test(userMessage);
        const isAdminCommand = adminCommands.some(cmd => userMessage.startsWith(cmd)) && !isAddLink;

        // List of owner commands
        const ownerCommands = ['.mode', '.smartreply', '.autostatus', '.antidelete', '.cleartmp', '.setpp', '.clearsession', '.areact', '.autoreact', '.autotyping', '.autoread', '.pmblocker', '.setmenudp', '.setdp', '.setmenumusic', '.setmusic', '.setdpd', '.setdpdefault', '.restart', '.reboot', '.broadcast', '.bc', '.block', '.unblock', '.setname', '.setbio', '.setabout'];
        const isOwnerCommand = ownerCommands.some(cmd => userMessage.startsWith(cmd));

        let isSenderAdmin = false;
        let isBotAdmin = false;

        // Check admin status only for admin commands in groups
        if (isGroup && isAdminCommand) {
            const adminStatus = await isAdmin(sock, chatId, senderId);
            isSenderAdmin = adminStatus.isSenderAdmin;
            isBotAdmin = adminStatus.isBotAdmin;

            if (!isBotAdmin) {
                await sock.sendMessage(chatId, { text: 'Please make the bot an admin to use admin commands.', ...channelInfo }, { quoted: message });
                return;
            }

            if (
                userMessage.startsWith('.mute') ||
                userMessage === '.unmute' ||
                userMessage.startsWith('.ban') ||
                userMessage.startsWith('.unban') ||
                userMessage.startsWith('.promote') ||
                userMessage.startsWith('.demote')
            ) {
                if (!isSenderAdmin && !message.key.fromMe) {
                    await sock.sendMessage(chatId, {
                        text: 'Sorry, only group admins can use this command.',
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }
            }
        }

        // Check owner status for owner commands
        if (isOwnerCommand) {
            if (!message.key.fromMe && !senderIsOwnerOrSudo) {
                await sock.sendMessage(chatId, { text: '❌ This command is only available for the owner or sudo!' }, { quoted: message });
                return;
            }
        }

        // Custom command restriction for groups
        if (isGroup && !isOwnerOrSudoCheck) {
            const allowedCommands = await getCustomCommands(chatId);
            if (allowedCommands && allowedCommands.length > 0) {
                const adminStatusForCheck = await isAdmin(sock, chatId, senderId);
                if (!adminStatusForCheck.isSenderAdmin) {
                    const usedCommand = userMessage.split(/\s+/)[0].slice(1).toLowerCase().trim();
                    if (!allowedCommands.includes(usedCommand)) {
                        await sock.sendMessage(chatId, { text: '❌ This command is not allowed in this group.' }, { quoted: message });
                        return;
                    }
                }
            }
        }

        // Command handlers - Execute commands immediately without waiting for typing indicator
        // We'll show typing indicator after command execution if needed
        let commandExecuted = false;

        switch (true) {
            case userMessage === '.simage': {
                const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                if (quotedMessage?.stickerMessage) {
                    await simageCommand(sock, quotedMessage, chatId);
                } else {
                    await sock.sendMessage(chatId, { text: 'Please reply to a sticker with the .simage command to convert it.', ...channelInfo }, { quoted: message });
                }
                commandExecuted = true;
                break;
            }
            case userMessage.startsWith('.kick'):
                const mentionedJidListKick = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await kickCommand(sock, chatId, senderId, mentionedJidListKick, message);
                break;
            case userMessage.startsWith('.add'):
                const mentionedJidListAdd = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await addCommand(sock, chatId, senderId, mentionedJidListAdd, message);
                break;
            case userMessage.startsWith('.status'):
                const statusArgs = userMessage.split(/\s+/).slice(1);
                await statusCommand(sock, chatId, senderId, statusArgs, message);
                break;
            case userMessage.startsWith('.mute'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const muteArg = parts[1];
                    const muteDuration = muteArg !== undefined ? parseInt(muteArg, 10) : undefined;
                    if (muteArg !== undefined && (isNaN(muteDuration) || muteDuration <= 0)) {
                        await sock.sendMessage(chatId, { text: 'Please provide a valid number of minutes or use .mute with no number to mute immediately.', ...channelInfo }, { quoted: message });
                    } else {
                        await muteCommand(sock, chatId, senderId, message, muteDuration);
                    }
                }
                break;
            case userMessage === '.unmute':
                await unmuteCommand(sock, chatId, senderId, message);
                break;
            case userMessage.startsWith('.ban'):
                if (!isGroup) {
                    if (!message.key.fromMe && !senderIsSudo) {
                        await sock.sendMessage(chatId, { text: 'Only owner/sudo can use .ban in private chat.' }, { quoted: message });
                        break;
                    }
                }
                await banCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.unban'):
                if (!isGroup) {
                    if (!message.key.fromMe && !senderIsSudo) {
                        await sock.sendMessage(chatId, { text: 'Only owner/sudo can use .unban in private chat.' }, { quoted: message });
                        break;
                    }
                }
                await unbanCommand(sock, chatId, message);
                break;
            case (['.waifu', '.neko', '.maid', '.uniform', '.husbando', '.kitsune', '.shinobu', '.megumin'].includes(userMessage)): {
                const type = userMessage.slice(1).toLowerCase();
                await animePicsCommand(sock, chatId, message, type);
                commandExecuted = true;
                break;
            }
            case userMessage === '.animequote':
                await animeQuoteCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case (['.help', '.menu', '.bot', '.list'].includes(userMessage)):
                await helpCommand(sock, chatId, message, global.channelLink);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.qc'): {
                const qcText = rawText.slice(3).trim();
                await qcCommand(sock, chatId, qcText, message);
                commandExecuted = true;
                break;
            }
            case userMessage.startsWith('.poll'): {
                const pollText = rawText.slice(5).trim();
                await pollCommand(sock, chatId, pollText, message);
                commandExecuted = true;
                break;
            }
            case userMessage.startsWith('.tourl'): {
                const tourlText = rawText.slice(6).trim();
                await tourlCommand(sock, chatId, tourlText, message);
                commandExecuted = true;
                break;
            }
            case (userMessage.startsWith('.pinterest ') || userMessage === '.pinterest' || userMessage.startsWith('.pin ') || userMessage === '.pin'): {
                const pinQuery = (userMessage.startsWith('.pinterest') ? rawText.slice(10) : rawText.slice(4)).trim();
                await pinterestCommand(sock, chatId, pinQuery, message);
                commandExecuted = true;
                break;
            }
            case userMessage === '.sticker' || userMessage === '.s':
                await stickerCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.warnings'):
                const mentionedJidListWarnings = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await warningsCommand(sock, chatId, mentionedJidListWarnings);
                break;
            case userMessage.startsWith('.warn'):
                const mentionedJidListWarn = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await warnCommand(sock, chatId, senderId, mentionedJidListWarn, message);
                break;
            case userMessage.startsWith('.tts'):
                const text = userMessage.slice(4).trim();
                await ttsCommand(sock, chatId, text, message);
                break;
            case userMessage.startsWith('.delete') || userMessage.startsWith('.del'):
                await deleteCommand(sock, chatId, message, senderId);
                break;

            case userMessage === '.settings':
                await settingsCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.autoreact') || userMessage.startsWith('.areact'):
                await autoreactCommand(sock, chatId, message, userMessage.split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.autoread'):
                await autoreadCommand(sock, chatId, message, userMessage.split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.autotyping'):
                await autotypingCommand(sock, chatId, message, userMessage.split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.pair'):
                await pairCommand(sock, chatId, message, userMessage.split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.pcustome'):
                await pcustomeCommand(sock, chatId, senderId, userMessage.split(/\s+/).slice(1), message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.autostatus'):
                {
                    const autoStatusArgs = userMessage.split(' ').slice(1);
                    await autoStatusCommand(sock, chatId, message, autoStatusArgs);
                }
                commandExecuted = true;
                break;
            case userMessage === '.setdpd' || userMessage === '.setdpdefault':
                await resetmenudpCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.setmenudp') || userMessage.startsWith('.setdp'):
                await setmenudpCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.setmenumusic') || userMessage.startsWith('.setmusic'):
                await setmenumusicCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.mode'):
                // Check if sender is the owner
                {
                    const modeSenderId = message.key.participant || message.key.remoteJid;
                    const isModeOwner = await isOwnerOrSudo(modeSenderId, sock, chatId);
                    if (!message.key.fromMe && !isModeOwner) {
                        await sock.sendMessage(chatId, { text: 'Only bot owner can use this command!', ...channelInfo }, { quoted: message });
                        return;
                    }
                }
                // Read current data first
                let data = { isPublic: true };
                try {
                    if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
                    const modeFilePath = './data/bot-settings.json';
                    if (!fs.existsSync(modeFilePath)) {
                        const legacyPath = './data/messageCount.json';
                        if (fs.existsSync(legacyPath)) {
                            const legacyData = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
                            if (typeof legacyData.isPublic === 'boolean') {
                                data = { isPublic: legacyData.isPublic };
                            }
                        }
                        fs.writeFileSync(modeFilePath, JSON.stringify(data, null, 2));
                    }
                    data = JSON.parse(fs.readFileSync(modeFilePath, 'utf8'));
                } catch (error) {
                    /* fallback to default */
                }

                const action = userMessage.split(' ')[1]?.toLowerCase();
                // If no argument provided, show current status
                if (!action) {
                    const currentMode = data.isPublic ? 'public' : 'private';
                    await sock.sendMessage(chatId, {
                        text: `Current bot mode: *${currentMode}*\n\nUsage: .mode public/private\n\nExample:\n.mode public - Allow everyone to use bot\n.mode private - Restrict to owner only`,
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }

                if (action !== 'public' && action !== 'private') {
                    await sock.sendMessage(chatId, {
                        text: 'Usage: .mode public/private\n\nExample:\n.mode public - Allow everyone to use bot\n.mode private - Restrict to owner only',
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }

                try {
                    // Update access mode
                    data.isPublic = action === 'public';

                    // Save updated data
                    fs.writeFileSync('./data/bot-settings.json', JSON.stringify({ isPublic: data.isPublic }, null, 2));

                    await sock.sendMessage(chatId, { text: `Bot is now in *${action}* mode`, ...channelInfo });
                } catch (error) {
                    console.error('Error updating access mode:', error);
                    await sock.sendMessage(chatId, { text: 'Failed to update bot access mode', ...channelInfo });
                }
                break;
            case userMessage.startsWith('.anticall'):
                if (!message.key.fromMe && !senderIsOwnerOrSudo) {
                    await sock.sendMessage(chatId, { text: 'Only owner/sudo can use anticall.' }, { quoted: message });
                    break;
                }
                {
                    const args = userMessage.split(' ').slice(1).join(' ');
                    await anticallCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.pmblocker'):
                {
                    const args = userMessage.split(' ').slice(1).join(' ');
                    await pmblockerCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage === '.owner':
                await ownerCommand(sock, chatId);
                break;
            case userMessage === '.tagall':
                await tagAllCommand(sock, chatId, senderId, message);
                break;
            case userMessage.startsWith('.tagadmin'):
                await tagAdminCommand(sock, chatId, senderId, message, rawText.slice(9).trim());
                break;
            case userMessage === '.tagnotadmin':
                await tagNotAdminCommand(sock, chatId, senderId, message);
                break;
            case userMessage.startsWith('.hidetag'):
                {
                    const messageText = rawText.slice(8).trim();
                    const replyMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
                    await hideTagCommand(sock, chatId, senderId, messageText, replyMessage, message);
                }
                break;
            case userMessage.startsWith('.send'):
                {
                    let prefixLength = 5;
                    if (userMessage.startsWith('.send link')) prefixLength = 10;
                    else if (userMessage.startsWith('.sendlink')) prefixLength = 9;
                    const messageText = rawText.slice(prefixLength).trim();
                    const replyMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
                    await sendLinkCommand(sock, chatId, senderId, messageText, replyMessage, message);
                }
                break;
            case userMessage.startsWith('.tag'):
                const messageText = rawText.slice(4).trim();  // use rawText here, not userMessage
                const replyMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
                await tagCommand(sock, chatId, senderId, messageText, replyMessage, message);
                break;
            case userMessage.startsWith('.antilink'):
                if (!isGroup) {
                    await sock.sendMessage(chatId, {
                        text: 'This command can only be used in groups.',
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }
                if (!isBotAdmin) {
                    await sock.sendMessage(chatId, {
                        text: 'Please make the bot an admin first.',
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }
                await handleAntilinkCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message);
                break;
            case userMessage.startsWith('.antitag'):
                if (!isGroup) {
                    await sock.sendMessage(chatId, {
                        text: 'This command can only be used in groups.',
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }
                if (!isBotAdmin) {
                    await sock.sendMessage(chatId, {
                        text: 'Please make the bot an admin first.',
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }
                await handleAntitagCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message);
                break;
            case userMessage === '.meme':
                await memeCommand(sock, chatId, message);
                break;
            case userMessage === '.joke':
                await jokeCommand(sock, chatId, message);
                break;
            case userMessage === '.quote':
                await quoteCommand(sock, chatId, message);
                break;
            case userMessage === '.fact':
                await factCommand(sock, chatId, message, message);
                break;
            case userMessage.startsWith('.weather'):
                const city = userMessage.slice(9).trim();
                if (city) {
                    await weatherCommand(sock, chatId, message, city);
                } else {
                    await sock.sendMessage(chatId, { text: 'Please specify a city, e.g., .weather London', ...channelInfo }, { quoted: message });
                }
                break;
            case userMessage === '.news':
                await newsCommand(sock, chatId);
                break;
            case userMessage.startsWith('.ttt') || userMessage.startsWith('.tictactoe'):
                const tttText = userMessage.split(' ').slice(1).join(' ');
                await tictactoeCommand(sock, chatId, senderId, tttText);
                break;
            case userMessage.startsWith('.move'):
                const position = parseInt(userMessage.split(' ')[1]);
                if (isNaN(position)) {
                    await sock.sendMessage(chatId, { text: 'Please provide a valid position number for Tic-Tac-Toe move.', ...channelInfo }, { quoted: message });
                } else {
                    handleTicTacToeMove(sock, chatId, senderId, position);
                }
                break;
            case userMessage === '.topmembers':
                topMembers(sock, chatId, isGroup);
                break;
            case userMessage.startsWith('.hangman'):
                startHangman(sock, chatId);
                break;
            case userMessage.startsWith('.guess'):
                const guessedLetter = userMessage.split(' ')[1];
                if (guessedLetter) {
                    guessLetter(sock, chatId, guessedLetter);
                } else {
                    sock.sendMessage(chatId, { text: 'Please guess a letter using .guess <letter>', ...channelInfo }, { quoted: message });
                }
                break;
            case userMessage.startsWith('.trivia'):
                startTrivia(sock, chatId);
                break;
            case userMessage.startsWith('.answer'):
                const answer = userMessage.split(' ').slice(1).join(' ');
                if (answer) {
                    answerTrivia(sock, chatId, answer);
                } else {
                    sock.sendMessage(chatId, { text: 'Please provide an answer using .answer <answer>', ...channelInfo }, { quoted: message });
                }
                break;
            case userMessage.startsWith('.compliment'):
                await complimentCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.insult'):
                await insultCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.8ball'):
                const question = userMessage.split(' ').slice(1).join(' ');
                await eightBallCommand(sock, chatId, question);
                break;
            case userMessage.startsWith('.lyrics'):
                const songTitle = userMessage.split(' ').slice(1).join(' ');
                await lyricsCommand(sock, chatId, songTitle, message);
                break;
            case userMessage.startsWith('.simp'):
                const quotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const mentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await simpCommand(sock, chatId, quotedMsg, mentionedJid, senderId);
                break;
            case userMessage.startsWith('.stupid') || userMessage.startsWith('.itssostupid') || userMessage.startsWith('.iss'):
                const stupidQuotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const stupidMentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const stupidArgs = userMessage.split(' ').slice(1);
                await stupidCommand(sock, chatId, stupidQuotedMsg, stupidMentionedJid, senderId, stupidArgs);
                break;
            case userMessage === '.dare':
                await dareCommand(sock, chatId, message);
                break;
            case userMessage === '.truth':
                await truthCommand(sock, chatId, message);
                break;
            case userMessage === '.clear':
                if (isGroup) await clearCommand(sock, chatId);
                break;
            case userMessage.startsWith('.promote'):
                const mentionedJidListPromote = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await promoteCommand(sock, chatId, mentionedJidListPromote, message);
                break;
            case userMessage.startsWith('.demote'):
                const mentionedJidListDemote = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await demoteCommand(sock, chatId, mentionedJidListDemote, message);
                break;
            case userMessage.startsWith('.adminlock'):
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                    return;
                }
                {
                    const adminLockArgs = userMessage.split(' ').slice(1);
                    await adminlockCommand(sock, chatId, senderId, adminLockArgs, message);
                }
                break;
            case userMessage.startsWith('.custom'):
                {
                    const customArgs = userMessage.split(/\s+/).slice(1);
                    await customCommand(sock, chatId, senderId, customArgs, message);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.autoblock'):
                {
                    const autoblockArgs = userMessage.split(/\s+/).slice(1);
                    await autoblockCommand(sock, chatId, senderId, autoblockArgs, message);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.antispam'):
                {
                    const antispamArgs = userMessage.split(/\s+/).slice(1);
                    await antispamCommand(sock, chatId, senderId, antispamArgs, message);
                }
                commandExecuted = true;
                break;
            case userMessage === '.ping':
                await pingCommand(sock, chatId, message);
                break;
            case userMessage === '.alive':
                await aliveCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.mention '):
                {
                    const args = userMessage.split(' ').slice(1).join(' ');
                    const isOwner = message.key.fromMe || senderIsSudo;
                    await mentionToggleCommand(sock, chatId, message, args, isOwner);
                }
                break;
            case userMessage === '.setmention':
                {
                    const isOwner = message.key.fromMe || senderIsSudo;
                    await setMentionCommand(sock, chatId, message, isOwner);
                }
                break;
            case userMessage.startsWith('.blur'):
                const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                await blurCommand(sock, chatId, message, quotedMessage);
                break;
            case userMessage.startsWith('.welcome'):
                if (isGroup) {
                    // Check admin status if not already checked
                    if (!isSenderAdmin) {
                        const adminStatus = await isAdmin(sock, chatId, senderId);
                        isSenderAdmin = adminStatus.isSenderAdmin;
                    }

                    if (isSenderAdmin || message.key.fromMe) {
                        await welcomeCommand(sock, chatId, message);
                    } else {
                        await sock.sendMessage(chatId, { text: 'Sorry, only group admins can use this command.', ...channelInfo }, { quoted: message });
                    }
                } else {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                }
                break;
            case userMessage.startsWith('.goodbye'):
                if (isGroup) {
                    // Check admin status if not already checked
                    if (!isSenderAdmin) {
                        const adminStatus = await isAdmin(sock, chatId, senderId);
                        isSenderAdmin = adminStatus.isSenderAdmin;
                    }

                    if (isSenderAdmin || message.key.fromMe) {
                        await goodbyeCommand(sock, chatId, message);
                    } else {
                        await sock.sendMessage(chatId, { text: 'Sorry, only group admins can use this command.', ...channelInfo }, { quoted: message });
                    }
                } else {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                }
                break;
            case userMessage === '.git':
            case userMessage === '.github':
            case userMessage === '.sc':
            case userMessage === '.script':
            case userMessage === '.repo':
                await githubCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.antibadword'):
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                    return;
                }

                const adminStatus = await isAdmin(sock, chatId, senderId);
                isSenderAdmin = adminStatus.isSenderAdmin;
                isBotAdmin = adminStatus.isBotAdmin;

                if (!isBotAdmin) {
                    await sock.sendMessage(chatId, { text: '*Bot must be admin to use this feature*', ...channelInfo }, { quoted: message });
                    return;
                }

                await antibadwordCommand(sock, chatId, message, senderId, isSenderAdmin);
                break;
            case userMessage.startsWith('.chatbot'):
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                    return;
                }

                // Check if sender is admin or bot owner
                const chatbotAdminStatus = await isAdmin(sock, chatId, senderId);
                if (!chatbotAdminStatus.isSenderAdmin && !message.key.fromMe) {
                    await sock.sendMessage(chatId, { text: '*Only admins or bot owner can use this command*', ...channelInfo }, { quoted: message });
                    return;
                }

                const match = userMessage.slice(8).trim();
                await handleChatbotCommand(sock, chatId, message, match);
                break;
            case userMessage.startsWith('.take') || userMessage.startsWith('.steal'):
                {
                    const isSteal = userMessage.startsWith('.steal');
                    const sliceLen = isSteal ? 6 : 5; // '.steal' vs '.take'
                    const takeArgs = rawText.slice(sliceLen).trim().split(' ');
                    await takeCommand(sock, chatId, message, takeArgs);
                }
                break;
            case userMessage === '.flirt':
                await flirtCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.character'):
                await characterCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.waste'):
                await wastedCommand(sock, chatId, message);
                break;
            case userMessage === '.ship':
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                    return;
                }
                await shipCommand(sock, chatId, message);
                break;
            case userMessage === '.groupinfo' || userMessage === '.infogp' || userMessage === '.infogrupo':
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                    return;
                }
                await groupInfoCommand(sock, chatId, message);
                break;
            case userMessage === '.resetlink' || userMessage === '.revoke' || userMessage === '.anularlink':
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                    return;
                }
                await resetlinkCommand(sock, chatId, senderId);
                break;
            case userMessage === '.staff' || userMessage === '.admins' || userMessage === '.listadmin':
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                    return;
                }
                await staffCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.tourl') || userMessage.startsWith('.url'):
                await urlCommand(sock, chatId, message);
                break;

            case userMessage.startsWith('.vv'):
                await viewOnceCommand(sock, chatId, message);
                break;
            case userMessage === '.clearsession' || userMessage === '.clearsesi':
                await clearSessionCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.autostatus'):
                const autoStatusArgs = userMessage.split(' ').slice(1);
                await autoStatusCommand(sock, chatId, message, autoStatusArgs);
                break;
            case userMessage.startsWith('.simp'):
                await simpCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.metallic'):
                await textmakerCommand(sock, chatId, message, userMessage, 'metallic');
                break;
            case userMessage.startsWith('.ice'):
                await textmakerCommand(sock, chatId, message, userMessage, 'ice');
                break;
            case userMessage.startsWith('.snow'):
                await textmakerCommand(sock, chatId, message, userMessage, 'snow');
                break;
            case userMessage.startsWith('.impressive'):
                await textmakerCommand(sock, chatId, message, userMessage, 'impressive');
                break;
            case userMessage.startsWith('.matrix'):
                await textmakerCommand(sock, chatId, message, userMessage, 'matrix');
                break;
            case userMessage.startsWith('.light'):
                await textmakerCommand(sock, chatId, message, userMessage, 'light');
                break;
            case userMessage.startsWith('.neon'):
                await textmakerCommand(sock, chatId, message, userMessage, 'neon');
                break;
            case userMessage.startsWith('.devil'):
                await textmakerCommand(sock, chatId, message, userMessage, 'devil');
                break;
            case userMessage.startsWith('.purple'):
                await textmakerCommand(sock, chatId, message, userMessage, 'purple');
                break;
            case userMessage.startsWith('.thunder'):
                await textmakerCommand(sock, chatId, message, userMessage, 'thunder');
                break;
            case userMessage.startsWith('.leaves'):
                await textmakerCommand(sock, chatId, message, userMessage, 'leaves');
                break;
            case userMessage.startsWith('.1917'):
                await textmakerCommand(sock, chatId, message, userMessage, '1917');
                break;
            case userMessage.startsWith('.arena'):
                await textmakerCommand(sock, chatId, message, userMessage, 'arena');
                break;
            case userMessage.startsWith('.hacker'):
                await textmakerCommand(sock, chatId, message, userMessage, 'hacker');
                break;
            case userMessage.startsWith('.sand'):
                await textmakerCommand(sock, chatId, message, userMessage, 'sand');
                break;
            case userMessage.startsWith('.blackpink'):
                await textmakerCommand(sock, chatId, message, userMessage, 'blackpink');
                break;
            case userMessage.startsWith('.glitch'):
                await textmakerCommand(sock, chatId, message, userMessage, 'glitch');
                break;
            case userMessage.startsWith('.fire'):
                await textmakerCommand(sock, chatId, message, userMessage, 'fire');
                break;
            case userMessage.startsWith('.antidelete'):
                const antideleteMatch = userMessage.slice(11).trim();
                await handleAntideleteCommand(sock, chatId, message, antideleteMatch);
                break;
            case userMessage === '.surrender':
                // Handle surrender command for tictactoe game
                await handleTicTacToeMove(sock, chatId, senderId, 'surrender');
                break;
            case userMessage === '.cleartmp':
                await clearTmpCommand(sock, chatId, message);
                break;
            case userMessage === '.setpp':
                await setProfilePicture(sock, chatId, message);
                break;
            case userMessage.startsWith('.setgdesc'):
                {
                    const text = rawText.slice(9).trim();
                    await setGroupDescription(sock, chatId, senderId, text, message);
                }
                break;
            case userMessage.startsWith('.setgname'):
                {
                    const text = rawText.slice(9).trim();
                    await setGroupName(sock, chatId, senderId, text, message);
                }
                break;
            case userMessage.startsWith('.setgpp'):
                await setGroupPhoto(sock, chatId, senderId, message);
                break;
            case userMessage.startsWith('.igd ') || userMessage === '.igd' || userMessage.startsWith('.instagram') || userMessage.startsWith('.insta '):
                await instagramCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.ig ') || userMessage === '.ig' || userMessage.startsWith('.igs ') || userMessage === '.igs':
                await igsCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.fb') || userMessage.startsWith('.facebook'):
                await facebookCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.tiktok') || userMessage.startsWith('.tt'):
                await tiktokCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.song') || userMessage.startsWith('.play') || userMessage.startsWith('.mp3 '):
                await songCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.spotify') || userMessage.startsWith('.sp ') || userMessage === '.sp':
                await spotifyCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.video') || userMessage.startsWith('.ytmp4') || userMessage.startsWith('.ytvideo'):
                await videoCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.gpt') || userMessage.startsWith('.gemini'):
                await aiCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.translate') || userMessage.startsWith('.trt'):
                const commandLength = userMessage.startsWith('.translate') ? 10 : 4;
                await handleTranslateCommand(sock, chatId, message, userMessage.slice(commandLength));
                return;
            case userMessage.startsWith('.ss') || userMessage.startsWith('.ssweb') || userMessage.startsWith('.screenshot'):
                const ssCommandLength = userMessage.startsWith('.screenshot') ? 11 : (userMessage.startsWith('.ssweb') ? 6 : 3);
                await handleSsCommand(sock, chatId, message, userMessage.slice(ssCommandLength).trim());
                break;
            case userMessage.startsWith('.sudo'):
                await sudoCommand(sock, chatId, message);
                break;
            case userMessage === '.goodnight' || userMessage === '.lovenight' || userMessage === '.gn':
                await goodnightCommand(sock, chatId, message);
                break;
            case userMessage === '.shayari' || userMessage === '.shayri':
                await shayariCommand(sock, chatId, message);
                break;
            case userMessage === '.roseday':
                await rosedayCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.imagine') || userMessage.startsWith('.flux') || userMessage.startsWith('.dalle'): await imagineCommand(sock, chatId, message);
                break;
            case userMessage === '.jid': await groupJidCommand(sock, chatId, message);
                break;
            case userMessage === '.dp' || userMessage.startsWith('.dp '):
                await dpCommand(sock, chatId, message);
                break;
            case userMessage.startsWith('.heart'):
                await handleHeart(sock, chatId, message);
                break;
            case userMessage.startsWith('.horny'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['horny', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.circle'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['circle', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.lgbt'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['lgbt', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.lolice'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['lolice', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.simpcard'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['simpcard', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.tonikawa'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['tonikawa', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.its-so-stupid'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['its-so-stupid', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.namecard'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['namecard', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;

            case userMessage.startsWith('.oogway2'):
            case userMessage.startsWith('.oogway'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const sub = userMessage.startsWith('.oogway2') ? 'oogway2' : 'oogway';
                    const args = [sub, ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.tweet'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['tweet', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.ytcomment'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['youtube-comment', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.comrade'):
            case userMessage.startsWith('.gay'):
            case userMessage.startsWith('.glass'):
            case userMessage.startsWith('.jail'):
            case userMessage.startsWith('.passed'):
            case userMessage.startsWith('.triggered'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const sub = userMessage.slice(1).split(/\s+/)[0];
                    const args = [sub, ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case userMessage.startsWith('.animu'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = parts.slice(1);
                    await animeCommand(sock, chatId, message, args);
                }
                break;
            // animu aliases
            case userMessage.startsWith('.nom'):
            case userMessage.startsWith('.poke'):
            case userMessage.startsWith('.cry'):
            case userMessage.startsWith('.kiss'):
            case userMessage.startsWith('.pat'):
            case userMessage.startsWith('.hug'):
            case userMessage.startsWith('.wink'):
            case userMessage.startsWith('.facepalm'):
            case userMessage.startsWith('.face-palm'):
            case userMessage.startsWith('.animuquote'):
            case userMessage.startsWith('.quote'):
            case userMessage.startsWith('.loli'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    let sub = parts[0].slice(1);
                    if (sub === 'facepalm') sub = 'face-palm';
                    if (sub === 'quote' || sub === 'animuquote') sub = 'quote';
                    await animeCommand(sock, chatId, message, [sub]);
                }
                break;
            case userMessage.startsWith('.smartreply'):
                {
                    const args = userMessage.split(/\s+/).slice(1);
                    await smartreplyCommand(sock, chatId, message, args, senderId, isGroup);
                }
                break;
            case userMessage === '.tostatus':
                await tostatusCommand(sock, chatId, senderId, message);
                break;
            case userMessage.startsWith('.gcsstatus') || userMessage.startsWith('.gpstatus') || userMessage.startsWith('.gstatus') || userMessage.startsWith('.gcstatus') || userMessage.startsWith('.groupstatus') || userMessage.startsWith('.gorupstatus'):
                {
                    const argsText = rawText.replace(/^\.(gcsstatus|gpstatus|gstatus|gcstatus|groupstatus|gorupstatus)\s*/i, '').trim();
                    gcsstatusCommand(sock, chatId, senderId, message, argsText).catch(err => {
                        console.error('[GCS-STATUS] Background execution error:', err.message);
                    });
                }
                break;
            case userMessage === '.crop':
                await stickercropCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.pies'):
                {
                    const parts = rawText.trim().split(/\s+/);
                    const args = parts.slice(1);
                    await piesCommand(sock, chatId, message, args);
                    commandExecuted = true;
                }
                break;
            case userMessage === '.china':
                await piesAlias(sock, chatId, message, 'china');
                commandExecuted = true;
                break;
            case userMessage === '.indonesia':
                await piesAlias(sock, chatId, message, 'indonesia');
                commandExecuted = true;
                break;
            case userMessage === '.japan':
                await piesAlias(sock, chatId, message, 'japan');
                commandExecuted = true;
                break;
            case userMessage === '.korea':
                await piesAlias(sock, chatId, message, 'korea');
                commandExecuted = true;
                break;
            case userMessage === '.india':
                await piesAlias(sock, chatId, message, 'india');
                commandExecuted = true;
                break;
            case userMessage === '.malaysia':
                await piesAlias(sock, chatId, message, 'malaysia');
                commandExecuted = true;
                break;
            case userMessage === '.thailand':
                await piesAlias(sock, chatId, message, 'thailand');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.update'):
                {
                    const parts = rawText.trim().split(/\s+/);
                    const zipArg = parts[1] && parts[1].startsWith('http') ? parts[1] : '';
                    await updateCommand(sock, chatId, message, zipArg);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.removebg') || userMessage.startsWith('.rmbg') || userMessage.startsWith('.nobg'):
                await removebgCommand.exec(sock, message, userMessage.split(' ').slice(1));
                break;
            case userMessage.startsWith('.remini') || userMessage.startsWith('.enhance') || userMessage.startsWith('.upscale'):
                await reminiCommand(sock, chatId, message, userMessage.split(' ').slice(1));
                break;
            case userMessage.startsWith('.sora'):
                await soraCommand(sock, chatId, message);
                break;
            case userMessage === '.toaudio' || userMessage === '.tomp3':
                await toAudioCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.tovideo' || userMessage === '.mp4':
                await toVideoCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.toptt' || userMessage === '.vn':
                await toPttCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.qr') || userMessage.startsWith('.qrcode'):
                await qrcodeCommand(sock, chatId, message, userMessage.split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage === '.invert':
                await invertCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.rotate'):
                await rotateCommand(sock, chatId, message, userMessage.split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.react'):
                await reactCommand(sock, chatId, message, userMessage.split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.fancy') || userMessage.startsWith('.styletext'):
                await fancyCommand(sock, chatId, message, userMessage.split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.readmore') || userMessage.startsWith('.spoiler'):
                await readmoreCommand(sock, chatId, message, rawText.trim().split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.morse'):
                await morseCommand(sock, chatId, message, userMessage.split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.count') || userMessage.startsWith('.wordcount'):
                await countCommand(sock, chatId, message, rawText.trim().split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.reverse'):
                await reverseCommand(sock, chatId, message, rawText.trim().split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.wiki') || userMessage.startsWith('.wikipedia'):
                await wikipediaCommand(sock, chatId, message, userMessage.split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.crypto') || userMessage.startsWith('.coin'):
                await cryptoCommand(sock, chatId, message, userMessage.split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.dict') || userMessage.startsWith('.define'):
                await dictionaryCommand(sock, chatId, message, userMessage.split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.time') || userMessage.startsWith('.timezone'):
                await timezoneCommand(sock, chatId, message, userMessage.split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.calc') || userMessage.startsWith('.math'):
                await calcCommand(sock, chatId, message, userMessage.split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage === '.link' || userMessage === '.glink':
                await linkCommand(sock, chatId, message, senderId);
                commandExecuted = true;
                break;
            case userMessage === '.leave' || userMessage === '.leavegc':
                await leaveCommand(sock, chatId, message, senderId);
                commandExecuted = true;
                break;
            case userMessage === '.tagghost' || userMessage === '.ghosts':
                await tagGhostCommand(sock, chatId, message, senderId);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.resetwarn') || userMessage.startsWith('.unwarn'):
                const mentionedJidListResetWarn = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await warnCommand.resetWarn(sock, chatId, senderId, mentionedJidListResetWarn, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.getbio') || userMessage.startsWith('.statusbio'):
                await getBioCommand(sock, chatId, message, userMessage.split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.block'):
                await blockCommand(sock, chatId, message, userMessage.split(/\s+/).slice(1), senderId);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.unblock'):
                await unblockCommand(sock, chatId, message, userMessage.split(/\s+/).slice(1), senderId);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.setname'):
                await setNameCommand(sock, chatId, message, rawText.trim().split(/\s+/).slice(1), senderId);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.setbio') || userMessage.startsWith('.setabout'):
                await setBioCommand(sock, chatId, message, rawText.trim().split(/\s+/).slice(1), senderId);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.roll') || userMessage.startsWith('.dice'):
                await rollCommand(sock, chatId, message, userMessage.split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage === '.flipcoin' || userMessage === '.coinflip':
                await flipCoinCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.slots' || userMessage === '.casino':
                await slotsCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.riddle':
                await riddleCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.pick') || userMessage.startsWith('.choose'):
                await pickCommand(sock, chatId, message, rawText.trim().split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.base64'):
                await base64Command(sock, chatId, message, rawText.trim().split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.binary'):
                await binaryCommand(sock, chatId, message, rawText.trim().split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.hash'):
                await hashCommand(sock, chatId, message, rawText.trim().split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage === '.restart' || userMessage === '.reboot':
                await restartCommand(sock, chatId, message, senderId);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.broadcast') || userMessage.startsWith('.bc'):
                await broadcastCommand(sock, chatId, message, rawText.trim().split(/\s+/).slice(1), senderId);
                commandExecuted = true;
                break;
            default:
                if (isGroup) {
                    // Handle non-command group messages
                    if (userMessage) {  // Make sure there's a message
                        await handleChatbotResponse(sock, chatId, message, userMessage, senderId);
                    }
                    await handleTagDetection(sock, chatId, message, senderId);
                    await handleMentionDetection(sock, chatId, message);
                }
                commandExecuted = false;
                break;
        }

        // If a command was executed, show typing status after command execution
        if (commandExecuted !== false) {
            // Command was executed, now show typing status after command execution
            await showTypingAfterCommand(sock, chatId);
        }

        // Function to handle .jid command
        async function groupJidCommand(sock, chatId, message) {
            try {
                // Determine the correct JID (Newsletter/Channel, Group, or User)
                const newsletterJid = message.message?.newsletterMessageInfo?.newsletterJid;
                const targetJid = newsletterJid || message.key?.remoteJid || chatId;

                if (!targetJid) {
                    return await sock.sendMessage(chatId, { text: "❌ Could not determine JID." });
                }

                await sock.sendMessage(chatId, {
                    text: `✅ JID: ${targetJid}`
                }, {
                    quoted: message
                });
            } catch (error) {
                console.error('Error in JID command:', error);
                if (chatId) {
                    await sock.sendMessage(chatId, { text: "❌ Error fetching JID." });
                }
            }
        }

    } catch (error) {
        console.error('❌ Error in message handler:', error.message);
        // Only try to send error message if we have a valid chatId
        if (chatId) {
            await sock.sendMessage(chatId, {
                text: '❌ Failed to process command!',
                ...channelInfo
            });
        }
    }
}

async function handleGroupParticipantUpdate(sock, update) {
    try {
        const { id, participants, action, author } = update;

        // Check if it's a group
        if (!id.endsWith('@g.us')) return;

        // Respect bot mode: only announce promote/demote in public mode
        let isPublic = true;
        try {
            const modePath = './data/bot-settings.json';
            const legacyPath = './data/messageCount.json';
            if (fs.existsSync(modePath)) {
                const modeData = JSON.parse(fs.readFileSync(modePath, 'utf8'));
                if (typeof modeData.isPublic === 'boolean') isPublic = modeData.isPublic;
            } else if (fs.existsSync(legacyPath)) {
                const modeData = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
                if (typeof modeData.isPublic === 'boolean') isPublic = modeData.isPublic;
            }
        } catch (e) {
            // If reading fails, default to public behavior
        }

        // Handle promotion events
        if (action === 'promote') {
            await handleAdminlockPromotion(sock, id, participants, author);
            if (!isPublic) return;
            await handlePromotionEvent(sock, id, participants, author);
            return;
        }

        // Handle demotion events (Anti-Bot-Demotion Protection)
        if (action === 'demote') {
            // Check if BOT or OWNER were target of demote
            const getPhone = (jid) => {
                if (!jid) return "";
                const jidStr = typeof jid === 'string' ? jid : (jid.id || jid.toString() || "");
                return jidStr.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
            };

            const botPhone = getPhone(sock.user.id);
            const botLidPhone = sock.user.lid ? getPhone(sock.user.lid) : null;

            const isBotTarget = participants.some(p => {
                const pPhone = getPhone(p);
                return pPhone === botPhone || pPhone === botLidPhone;
            });

            if (isBotTarget) {
                // Someone tried to demote the bot!
                const authorJid = author ? (typeof author === 'string' ? author : (author.id || author.toString())) : null;
                const authorPhone = getPhone(authorJid);

                if (authorJid && authorPhone) {
                    // Check if author is authorized (Owner ONLY)
                    const ownerNumber = settings.ownerNumber.replace(/[^0-9]/g, '');
                    const ownerNumbersArray = (settings.ownerNumbers || []).map(n => n.replace(/[^0-9]/g, ''));

                    const isAuthorized = authorPhone === ownerNumber ||
                        ownerNumbersArray.includes(authorPhone);

                    if (!isAuthorized) {
                        try {
                            const timeString = new Date().toLocaleString();
                            console.log(`🚨 [BOT-PROTECTION] Bot (${botPhone}) demoted in ${id} by @${authorPhone} at ${timeString}`);

                            // 1. KICK the offender
                            await sock.groupParticipantsUpdate(id, [authorJid], 'remove');

                            await sock.sendMessage(id, {
                                text: `🚨 *CRITICAL SECURITY VIOLATION:* Unauthorized attempt to demote the Bot detected at ${timeString}!\n\nPromoter: @${authorPhone}\n*Action:* Offender has been PERMANENTLY REMOVED from the group.`,
                                mentions: [authorJid]
                            });

                            // 2. SELF-RECOVERY: Use other active sessions to promote the bot back
                            const { sessions } = require('./lib/baileys-helper');
                            const targetJidToPromote = authorJid; // Wait, I want to promote the BOT back, not the author!
                            const botJidToRestore = sock.user.id.split(':')[0] + '@s.whatsapp.net';

                            for (const [sId, otherSock] of sessions.entries()) {
                                if (sId === botPhone) continue; // Skip the demoted one

                                try {
                                    const meta = await otherSock.groupMetadata(id);
                                    const me = meta.participants.find(p => p.id.split('@')[0].split(':')[0] === sId);
                                    if (me && (me.admin === 'admin' || me.admin === 'superadmin')) {
                                        // Found another admin instance! Promote the first one back.
                                        await otherSock.groupParticipantsUpdate(id, [botJidToRestore], 'promote');
                                        await otherSock.sendMessage(id, { text: `✅ *RECOVERY:* Bot admin rights restored by system instance @${sId}.` });
                                        break;
                                    }
                                } catch (err) { }
                            }

                        } catch (e) {
                            console.error('Bot Protection Error:', e.message);
                        }
                    }
                }
            }

            if (!isPublic) return;
            await handleDemotionEvent(sock, id, participants, author);
            return;
        }

        // Handle join events
        if (action === 'add') {
            await handleJoinEvent(sock, id, participants);
        }

        // Handle leave events
        if (action === 'remove') {
            await handleLeaveEvent(sock, id, participants);
        }
    } catch (error) {
        console.error('Error in handleGroupParticipantUpdate:', error);
    }
}

global.botMainHandler = handleMessages;
global.botGroupHandler = handleGroupParticipantUpdate;

// Instead, export the handlers along with handleMessages
module.exports = {
    handleMessages,
    handleGroupParticipantUpdate,
    handleStatus: async (sock, status) => {
        await handleStatusUpdate(sock, status);
    }
};

// --- Launch & Orchestration Function (merged from index.js) ---
async function launch() {
    console.log('ZoxerBot');

    // Ensure directories exist
    const sessionDir = process.env.SESSION_DIR ? path.resolve(process.env.SESSION_DIR) : path.join(__dirname, 'session');
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    // Ensure Data Directory and essential files exist
    const dataDir = path.join(__dirname, 'data');
    const bannedPath = path.join(dataDir, 'banned.json');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log(chalk.gray('📁 [SYSTEM] Created data directory.'));
    }
    if (!fs.existsSync(bannedPath)) {
        fs.writeFileSync(bannedPath, JSON.stringify({}, null, 2));
        console.log(chalk.gray('📝 [SYSTEM] Initialized empty banned.json.'));
    }

    // Check database connectivity silently
    let dbConnected = false;
    let dbSessions = [];

    if (!supabase.isMock) {
        try {
            const { data, error: healthError } = await supabase.from('bot_sessions').select('phone_number').eq('is_paired', true);
            if (!healthError && data) {
                dbConnected = true;
                dbSessions = data || [];
            }
        } catch (err) {
            // Silently fallback without logging errors
        }
    }

    startAdminApi();

    // Import initSession and question dynamically
    const { initSession, question } = require('./lib/baileys-helper');
    const settings = require('./settings');

    // Check if primary session or any existing session exists
    let primaryPhone = null;
    let hasExistingSession = false;

    if (fs.existsSync(sessionDir)) {
        const folders = fs.readdirSync(sessionDir).filter(name => {
            const folderPath = path.join(sessionDir, name);
            return fs.lstatSync(folderPath).isDirectory() && fs.existsSync(path.join(folderPath, 'creds.json'));
        });
        if (folders.length > 0) {
            hasExistingSession = true;
            primaryPhone = folders[0];
        }
    }

    if (hasExistingSession) {
        console.log(chalk.yellow(`\n🔄 Initializing primary session for ${primaryPhone}...`));
        await initSession(primaryPhone, { usePairingCode: false });
    } else if (dbSessions && dbSessions.length > 0) {
        hasExistingSession = true;
        primaryPhone = dbSessions[0].phone_number.replace(/[^0-9]/g, '');
        console.log(chalk.yellow(`\n🔄 Initializing primary session from database for ${primaryPhone}...`));
        await initSession(primaryPhone, { usePairingCode: false });
    } else {
        console.log(chalk.bold.cyan('\n=========================================='));
        console.log(chalk.bold.yellow('📱 No active WhatsApp session detected!'));
        console.log(chalk.bold.cyan('==========================================\n'));

        if (!process.stdin.isTTY) {
            console.log(chalk.cyan('🌐 Web server active. Waiting for pairing via frontend at https://zoxermdfrontend.vercel.app'));
        } else {
            const defaultNum = settings.ownerNumber ? settings.ownerNumber.replace(/[^0-9]/g, '') : '';
            const promptText = defaultNum 
                ? chalk.bold.green(`👉 Please enter your WhatsApp number with country code (e.g. 923xxxxxxxxx) [Default: ${defaultNum}]: `)
                : chalk.bold.green('👉 Please enter your WhatsApp number with country code (e.g. 923xxxxxxxxx): ');

            let phone = await question(promptText);
            phone = phone.trim();
            if (!phone && defaultNum) {
                phone = defaultNum;
            }
            phone = phone.replace(/[^0-9]/g, '');

            while (!phone || phone.length < 10) {
                console.log(chalk.red('❌ Invalid phone number. Please enter digits with country code (e.g., 923232391033):'));
                phone = await question(chalk.bold.green('👉 Phone Number: '));
                phone = phone.trim().replace(/[^0-9]/g, '');
            }

            primaryPhone = phone;
            console.log(chalk.yellow(`\n🔄 Requesting pairing code for ${primaryPhone}...`));
            await initSession(primaryPhone, { usePairingCode: true, isOwner: true });
        }
    }

    // Initialize/Resume other existing sessions
    if (dbConnected) {
        const pairedSessions = dbSessions || [];
        const otherSessions = pairedSessions.filter(s => s.phone_number.replace(/[^0-9]/g, '') !== primaryPhone);
        if (otherSessions.length > 0) {
            console.log(chalk.blue(`📡 Resuming ${otherSessions.length} active sessions from database...`));
            for (const session of otherSessions) {
                const dbPhone = session.phone_number.replace(/[^0-9]/g, '');
                initSession(dbPhone).catch(err => console.error(`Failed to init session ${dbPhone}:`, err));
                await new Promise(resolve => setTimeout(resolve, 2000)); // 2s stagger
            }
        }
    } else if (fs.existsSync(sessionDir)) {
        const localSessions = fs.readdirSync(sessionDir).filter(name => {
            const folderPath = path.join(sessionDir, name);
            return fs.lstatSync(folderPath).isDirectory() && fs.existsSync(path.join(folderPath, 'creds.json'));
        });
        const sessionsToLoad = localSessions.filter(phone => phone !== primaryPhone);
        if (sessionsToLoad.length > 0) {
            console.log(chalk.blue(`📁 Loading ${sessionsToLoad.length} sessions from local storage...`));
            for (const phone of sessionsToLoad) {
                initSession(phone).catch(err => console.error(`Failed to init local session ${phone}:`, err));
                await new Promise(resolve => setTimeout(resolve, 2000)); // 2s stagger
            }
        }
    }

    process.on('uncaughtException', (err) => console.error('💥 Uncaught Exception:', err));
    process.on('unhandledRejection', (reason) => console.error('💥 Unhandled Rejection:', reason));

    // Watchdog - Monitoring bot health every 15 minutes
    setInterval(async () => {
        const { sessionStates, sessions, initSession } = require('./lib/baileys-helper');
        console.log(chalk.blue(`🛡️ [WATCHDOG] Checking health of ${sessionStates.size} sessions...`));

        for (const [phone, state] of sessionStates.entries()) {
            if (state === 'CONNECTED') {
                const sock = sessions.get(phone);
                if (!sock || !sock.ws || sock.ws.readyState !== 1) {
                    console.log(chalk.bgRed(`🚨 [WATCHDOG] Session ${phone} is ghosting. Restarting...`));
                    initSession(phone);
                }
            }
        }

        // Auto-restart if memory is too high
        const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
        if (memoryUsage > 800) {
            console.log(chalk.bgRed(`⚠️ [SYSTEM] Memory usage critical (${memoryUsage.toFixed(2)}MB). Performing scheduled restart...`));
            process.exit(0);
        }
    }, 15 * 60 * 1000);

    console.log(chalk.bold.cyan('✨ ZOXER BOT core is running and listening.'));
    console.log(chalk.gray('💡 Tip: You can send commands via WhatsApp (.ping, .menu) OR type them directly into this terminal!\n'));

    // Terminal Interactive Command Prompt: Allow typing commands directly in the terminal
    const readline = require('readline');
    const rlTerminal = readline.createInterface({ input: process.stdin, output: process.stdout });
    rlTerminal.on('line', async (line) => {
        const text = line.trim();
        if (!text) return;

        const cmd = text.startsWith('.') ? text : ('.' + text);
        console.log(chalk.bold.magenta(`\n⌨️ [TERMINAL COMMAND] Executing: "${cmd}"`));

        const { sessions, sessionStates } = require('./lib/baileys-helper');
        let activeSock = null;
        let activePhone = null;
        for (const [phone, sock] of sessions.entries()) {
            if (sessionStates.get(phone) === 'CONNECTED') {
                activeSock = sock;
                activePhone = phone;
                break;
            }
        }
        if (!activeSock) {
            const anyConnecting = Array.from(sessionStates.entries()).find(([_, st]) => st === 'CONNECTING' || st === 'RECONNECTING');
            if (anyConnecting) {
                console.log(chalk.yellow(`⏳ WhatsApp session (${anyConnecting[0]}) is currently ${anyConnecting[1]}... Please wait a few seconds and try again.`));
            } else {
                console.log(chalk.yellow('⚠️ No active connected WhatsApp session found. Please ensure a session is paired and connected.'));
            }
            return;
        }

        // Intercept sendMessage to display the response right here in the terminal AND deliver to WhatsApp
        const terminalSock = Object.create(activeSock);
        terminalSock.sendMessage = async (targetJid, content, opt) => {
            const textToDisplay = content?.text || content?.caption;
            if (textToDisplay) {
                console.log(chalk.bold.green('\n🤖 [ZOXER BOT RESPONSE]:\n') + chalk.white(textToDisplay) + '\n');
            } else {
                console.log(chalk.bold.green('\n🤖 [ZOXER BOT RESPONSE]: [Sent media or rich card to WhatsApp]\n'));
            }
            return activeSock.sendMessage(targetJid, content, opt);
        };

        const fakeUpdate = {
            type: 'notify',
            messages: [{
                key: {
                    remoteJid: activePhone + '@s.whatsapp.net',
                    fromMe: true,
                    id: 'CLI_' + Date.now()
                },
                messageTimestamp: Math.floor(Date.now() / 1000),
                message: { conversation: cmd }
            }]
        };

        try {
            await handleMessages(terminalSock, fakeUpdate, true);
            console.log(chalk.green(`✅ Command "${cmd}" finished.`));
        } catch (err) {
            console.error(chalk.red('❌ Terminal command error:'), err.message || err);
        }
    });
}

if (require.main === module) {
    launch().catch(err => {
        console.error('Launch failed:', err);
        process.exit(1);
    });
}

module.exports = { launch, handleMessages };
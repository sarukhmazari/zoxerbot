const fs = require('fs');
const path = require('path');
const axios = require('axios');
const settings = require('../settings');
const isOwnerOrSudo = require('../lib/isOwner');

const statusPath = path.join(__dirname, '../data/smartReply.json');

// Global smart reply status
let globalSmartReplyEnabled = false;

// -------------------------------------------------------------
// Status Persistence
// -------------------------------------------------------------
function loadSmartReplyStatus() {
    try {
        if (fs.existsSync(statusPath)) {
            const data = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
            globalSmartReplyEnabled = data.enabled === true;
        }
    } catch (e) {
        console.error('[SmartReply] Failed to load status:', e.message);
    }
}

function saveSmartReplyStatus() {
    try {
        const data = { enabled: globalSmartReplyEnabled };
        const dir = path.dirname(statusPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(statusPath, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('[SmartReply] Failed to save status:', e.message);
    }
}

// Load on startup
loadSmartReplyStatus();

function getSmartReplyStatus() {
    return globalSmartReplyEnabled;
}

function setSmartReplyStatus(enabled) {
    globalSmartReplyEnabled = Boolean(enabled);
    saveSmartReplyStatus();
}

// -------------------------------------------------------------
// Conversation Memory (Per Chat / Sender)
// -------------------------------------------------------------
// Map: chatKey => { history: [ { role: 'user'|'model', parts: [{ text }] } ], lastActivity: timestamp }
const conversationMemory = new Map();
const MAX_HISTORY_MESSAGES = 10; // 5 user turns + 5 model turns
const MEMORY_TTL_MS = 30 * 60 * 1000; // 30 minutes of inactivity

function getConversationHistory(chatKey) {
    const session = conversationMemory.get(chatKey);
    if (!session) return [];

    // Expire old sessions
    if (Date.now() - session.lastActivity > MEMORY_TTL_MS) {
        conversationMemory.delete(chatKey);
        return [];
    }

    return Array.isArray(session.history) ? [...session.history] : [];
}

function updateConversationHistory(chatKey, userText, modelText) {
    let session = conversationMemory.get(chatKey);
    if (!session || Date.now() - session.lastActivity > MEMORY_TTL_MS) {
        session = { history: [], lastActivity: Date.now() };
    }

    session.history.push({ role: 'user', parts: [{ text: userText }] });
    session.history.push({ role: 'model', parts: [{ text: modelText }] });

    // Trim history if it exceeds maximum turns
    if (session.history.length > MAX_HISTORY_MESSAGES) {
        session.history = session.history.slice(-MAX_HISTORY_MESSAGES);
    }

    session.lastActivity = Date.now();
    conversationMemory.set(chatKey, session);
}

function clearConversationHistory(chatKey) {
    if (chatKey) conversationMemory.delete(chatKey);
}

function clearAllConversationHistory() {
    conversationMemory.clear();
}

// Cleanup expired sessions every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, session] of conversationMemory.entries()) {
        if (now - session.lastActivity > MEMORY_TTL_MS) {
            conversationMemory.delete(key);
        }
    }
}, 10 * 60 * 1000);

// -------------------------------------------------------------
// Concurrency, Rate Limiting & Deduplication
// -------------------------------------------------------------
const activeProcessing = new Set(); // Set of chatKey currently awaiting Gemini
const userCooldowns = new Map();   // chatKey => last reply timestamp
const processedMessageIds = new Set(); // Baileys message.key.id deduplication

// -------------------------------------------------------------
// Bot System Instruction & Personality
// -------------------------------------------------------------
function buildSystemInstruction() {
    const botName = settings.botName || 'ZOXER BOT';
    const botOwner = settings.botOwner || 'ZOXER TEAM';
    const ownerNumber = settings.ownerNumber || '923232391033';
    const prefix = '.';

    // Key commands summary for bot command awareness
    const commandHighlights = [
        "Core: .ping, .alive, .owner, .settings, .status, .jid, .time",
        "Media/Downloads: .song <name/url>, .video <name/url>, .play <name>, .spotify <link>, .drama <title>, .sticker (reply to media), .take <pack|author>, .simage (sticker to image), .toaudio, .toptt (voice note), .remini (AI photo enhance), .removebg, .qr <text>, .tts <text>",
        "Utility/Tools: .calc <expression>, .translate <text|reply>, .fancy <text>, .vv (unlock view-once), .weather <city>, .wiki <query>, .ss <url>, .apk <app name>",
        "Fun/Social: .tictactoe, .hangman, .trivia, .joke, .quote, .compliment, .shayari, .flirt, .truth, .dare, .8ball, .ship @user",
        "Group Management: .tagall, .hidetag, .mute, .unmute, .kick @user, .warn @user, .link, .welcome on/off, .antilink on/off, .antispam on/off, .antibot on/off",
        "Smart Reply: .smartreply on / off / status / reset"
    ].join('\n');

    return `You are "${botName}", a friendly, helpful, and intelligent WhatsApp bot assistant created by "${botOwner}" (Owner contact: ${ownerNumber}).
You are chatting with a user on WhatsApp in real time.

CORE PERSONALITY & BEHAVIOR:
1. Speak naturally, warmly, and conversationally. Do NOT sound robotic or formal.
2. NEVER say "I am an AI language model created by Google" or give generic corporate AI disclaimers. You are simply "${botName}".
3. LANGUAGE MATCHING:
   - Match the user's language automatically and fluidly.
   - If they message in Roman Urdu (e.g. "kya haal hai", "kaise ho", "kya kar sakte ho", "bhai help chahiye"), respond naturally in friendly Roman Urdu.
   - If they message in Urdu (اردو), reply in Urdu.
   - If they message in English, reply in English.
   - If they use Hindi/Hinglish, match their phrasing naturally.
4. BREVITY:
   - Keep casual conversation replies concise (1-3 sentences max).
   - Only provide longer, structured responses when the user explicitly asks for an explanation, tutorial, list, or detailed guide.
5. EMOJIS:
   - Use emojis tastefully (1-3 per message) to keep the chat friendly and human-like. Do not spam emojis.
6. WHATSAPP FORMATTING:
   - Use WhatsApp text styles when appropriate (*bold*, _italic_).

BOT IDENTITY & COMMAND AWARENESS:
1. Command prefix is "${prefix}".
2. You know all actual bot features. Here are real command highlights:
${commandHighlights}
3. STRICT COMMAND RULE: If a user asks what commands you have or how to do something, ONLY suggest real commands from the list above with the "${prefix}" prefix. NEVER hallucinate or invent fake commands.
4. If asked who created you or who your owner is, introduce ${botOwner} (${ownerNumber}).

Be polite, helpful, and natural!`;
}

// -------------------------------------------------------------
// Gemini API Integration
// -------------------------------------------------------------
const GEMINI_MODELS = [
    'gemini-flash-lite-latest',
    'gemini-3.8-flash',
    'gemini-flash-latest'
];

async function callGemini(contents, systemInstruction) {
    const apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('Gemini API key is not configured.');
    }

    const payload = {
        systemInstruction: {
            parts: [{ text: systemInstruction }]
        },
        contents: contents,
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 600,
            topP: 0.95
        }
    };

    let lastError = null;

    for (const model of GEMINI_MODELS) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

        try {
            const res = await axios.post(url, payload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 20000,
                validateStatus: (status) => status >= 200 && status < 600
            });

            if (res.status === 429) {
                console.warn(`[SmartReply Gemini] Rate limited (429) on ${model}, attempting fallback...`);
                lastError = new Error('Rate limit reached (429)');
                continue;
            }

            if (res.status === 503 || res.status === 500) {
                console.warn(`[SmartReply Gemini] Model ${model} returned status ${res.status}, attempting fallback...`);
                lastError = new Error(`Server error (${res.status})`);
                continue;
            }

            if (res.status < 200 || res.status >= 300) {
                console.error(`[SmartReply Gemini] HTTP error ${res.status} on ${model}`);
                lastError = new Error(`HTTP ${res.status}`);
                continue;
            }

            const candidateText = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (candidateText && typeof candidateText === 'string') {
                return candidateText.trim();
            }
        } catch (err) {
            if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
                console.warn(`[SmartReply Gemini] Request timed out on model ${model}`);
                lastError = new Error('Gemini API request timed out');
            } else {
                console.warn(`[SmartReply Gemini] Request failed on model ${model}:`, err.message);
                lastError = err;
            }
        }
    }

    throw lastError || new Error('All Gemini models failed to generate content.');
}

// -------------------------------------------------------------
// Message Text Extractor
// -------------------------------------------------------------
function extractTextFromMessage(m) {
    if (!m) return '';
    let msg = m.message || m;

    // Handle nested message wrappers (ephemeral, viewOnce, etc.)
    if (msg.ephemeralMessage?.message) return extractTextFromMessage(msg.ephemeralMessage.message);
    if (msg.viewOnceMessage?.message) return extractTextFromMessage(msg.viewOnceMessage.message);
    if (msg.viewOnceMessageV2?.message) return extractTextFromMessage(msg.viewOnceMessageV2.message);
    if (msg.viewOnceMessageV2Extension?.message) return extractTextFromMessage(msg.viewOnceMessageV2Extension.message);
    if (msg.documentWithCaptionMessage?.message) return extractTextFromMessage(msg.documentWithCaptionMessage.message);
    if (msg.editedMessage?.message) return extractTextFromMessage(msg.editedMessage.message);

    if (typeof msg.conversation === 'string') return msg.conversation;
    if (typeof msg.extendedTextMessage?.text === 'string') return msg.extendedTextMessage.text;
    if (typeof msg.imageMessage?.caption === 'string') return msg.imageMessage.caption;
    if (typeof msg.videoMessage?.caption === 'string') return msg.videoMessage.caption;
    if (typeof msg.documentMessage?.caption === 'string') return msg.documentMessage.caption;

    return '';
}

// -------------------------------------------------------------
// Incoming Message Auto-Reply Handler
// -------------------------------------------------------------
async function handleSmartReplyMessage(sock, chatId, message, userMessage, senderId, isGroup) {
    try {
        // 1. Feature Toggle Check
        if (!globalSmartReplyEnabled) return false;

        // 2. Validate input and message key
        if (!sock || !chatId || !message || !message.key) return false;

        // 3. Prevent self-replies / bot loop
        if (message.key.fromMe) return false;

        // 4. Filter status updates, broadcast, and newsletter channels
        if (chatId === 'status@broadcast' || chatId.endsWith('@broadcast') || chatId.endsWith('@newsletter')) {
            return false;
        }

        // 5. Exclude bot's own JID
        const botJid = sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : null;
        const cleanSender = senderId ? senderId.split(':')[0] + '@s.whatsapp.net' : null;
        if (botJid && cleanSender && botJid === cleanSender) return false;

        // 6. Deduplication Check
        const msgId = message.key.id;
        if (msgId) {
            if (processedMessageIds.has(msgId)) return false;
            processedMessageIds.add(msgId);
            if (processedMessageIds.size > 800) {
                const firstKey = processedMessageIds.values().next().value;
                processedMessageIds.delete(firstKey);
            }
        }

        // 7. Extract raw message text
        let rawText = (typeof userMessage === 'string' ? userMessage : '').trim();
        if (!rawText) {
            rawText = extractTextFromMessage(message).trim();
        }
        if (!rawText) return false;

        // 8. Ignore bot commands (starts with prefix e.g. '.')
        if (rawText.startsWith('.') || rawText.startsWith('!') || rawText.startsWith('/')) {
            return false;
        }

        // 9. Group Chat Behavior
        const isGroupChat = isGroup !== undefined ? isGroup : chatId.endsWith('@g.us');
        if (isGroupChat) {
            const botNumber = botJid ? botJid.split('@')[0] : '';
            const contextInfo = message.message?.extendedTextMessage?.contextInfo ||
                                message.message?.imageMessage?.contextInfo ||
                                message.message?.videoMessage?.contextInfo;

            const isMentioned = (botNumber && rawText.includes('@' + botNumber)) ||
                                (contextInfo?.mentionedJid && botJid && contextInfo.mentionedJid.includes(botJid));

            const isReplyToBot = contextInfo?.participant && botJid &&
                                (contextInfo.participant.split(':')[0] === botJid.split('@')[0]);

            // In groups: only reply if mentioned or quoted to avoid spamming member-to-member conversations
            if (!isMentioned && !isReplyToBot) {
                return false;
            }
        }

        // 10. Chat Key for Memory and Locks
        const chatKey = isGroupChat ? `${chatId}_${senderId}` : chatId;

        // Concurrency Lock: avoid overlapping requests for the same chat/user
        if (activeProcessing.has(chatKey)) {
            return false;
        }

        // Rate Limiting Cooldown: minimum 2.5s between AI replies for the same user
        const now = Date.now();
        const lastReplyTime = userCooldowns.get(chatKey) || 0;
        if (now - lastReplyTime < 2500) {
            return false;
        }

        // Clean prompt text (strip @bot mention)
        let cleanPrompt = rawText;
        if (botJid) {
            const botNum = botJid.split('@')[0];
            cleanPrompt = cleanPrompt.replace(new RegExp(`@${botNum}`, 'g'), '').trim();
        }
        if (!cleanPrompt) return false;

        // Set active lock
        activeProcessing.add(chatKey);

        try {
            // Send typing presence
            try {
                await sock.sendPresenceUpdate('composing', chatId);
            } catch (_) {}

            // Assemble conversation history for context awareness
            const history = getConversationHistory(chatKey);
            const contents = [
                ...history,
                { role: 'user', parts: [{ text: cleanPrompt }] }
            ];

            // Build system prompt and request Gemini
            const systemInstruction = buildSystemInstruction();
            const aiResponse = await callGemini(contents, systemInstruction);

            if (aiResponse && aiResponse.trim().length > 0) {
                // Update conversation memory with new turn
                updateConversationHistory(chatKey, cleanPrompt, aiResponse);
                userCooldowns.set(chatKey, Date.now());

                // Send response to the chat
                await sock.sendMessage(chatId, { text: aiResponse }, { quoted: message });
                return true;
            }

            return false;
        } catch (apiErr) {
            console.error('[SmartReply] Error processing Gemini response:', apiErr.message);
            // Graceful silent fallback without leaking error trace to chat
            return false;
        } finally {
            activeProcessing.delete(chatKey);
            try {
                await sock.sendPresenceUpdate('available', chatId);
            } catch (_) {}
        }

    } catch (err) {
        console.error('[SmartReply] Fatal handler error:', err.message);
        return false;
    }
}

// -------------------------------------------------------------
// Command Interface (.smartreply / .autoreply)
// -------------------------------------------------------------
async function smartreplyCommand(sock, chatId, message, args, senderId, isGroup) {
    const sub = (args[0] || '').toLowerCase().trim();

    // Check admin / owner permissions for configuration changes
    const isOwner = message.key.fromMe || await isOwnerOrSudo(senderId, sock, chatId);
    if (!isOwner && (sub === 'on' || sub === 'off' || sub === 'reset' || sub === 'clear')) {
        return await sock.sendMessage(chatId, {
            text: '❌ *Access Denied:* Only bot administrators can toggle `.smartreply`.'
        }, { quoted: message });
    }

    if (sub === 'on') {
        globalSmartReplyEnabled = true;
        saveSmartReplyStatus();
        await sock.sendMessage(chatId, {
            text: '🤖 *Gemini AI Smart Reply is now ENABLED!* 🚀\n\n' +
                  '• All incoming messages will receive intelligent, context-aware AI replies.\n' +
                  '• Conversation memory and multilingual support (English, Urdu, Roman Urdu) are active.\n' +
                  '• Use *.smartreply off* to disable anytime.'
        }, { quoted: message });
    } else if (sub === 'off') {
        globalSmartReplyEnabled = false;
        saveSmartReplyStatus();
        clearAllConversationHistory();
        await sock.sendMessage(chatId, {
            text: '❌ *Gemini AI Smart Reply has been DISABLED.*'
        }, { quoted: message });
    } else if (sub === 'reset' || sub === 'clear') {
        clearAllConversationHistory();
        await sock.sendMessage(chatId, {
            text: '🧹 *AI conversation context memory has been cleared!*'
        }, { quoted: message });
    } else if (sub === 'status') {
        const state = globalSmartReplyEnabled ? 'ON ✅ (Gemini AI Active)' : 'OFF ❌';
        await sock.sendMessage(chatId, {
            text: `⚙️ *Smart Reply System Status*\n\n` +
                  `• Status: *${state}*\n` +
                  `• Model: *gemini-flash-lite-latest*\n` +
                  `• Active Sessions in Memory: *${conversationMemory.size}*\n\n` +
                  `*Available Commands:*\n` +
                  `• \`.smartreply on\` — Enable Gemini auto-replies\n` +
                  `• \`.smartreply off\` — Disable auto-replies\n` +
                  `• \`.smartreply status\` — View current status\n` +
                  `• \`.smartreply reset\` — Clear context memory\n\n` +
                  `_Alias: .autoreply on/off/status_`
        }, { quoted: message });
    } else {
        await sock.sendMessage(chatId, {
            text: `🤖 *Gemini AI Smart Reply Control*\n\n` +
                  `*Usage:*\n` +
                  `• \`.smartreply on\` — Enable automatic AI replies\n` +
                  `• \`.smartreply off\` — Disable automatic replies\n` +
                  `• \`.smartreply status\` — Check system status\n` +
                  `• \`.smartreply reset\` — Reset conversation memory\n\n` +
                  `_Alias: .autoreply on/off/status_`
        }, { quoted: message });
    }
}

// -------------------------------------------------------------
// Backwards Compatibility Pool
// -------------------------------------------------------------
const smartReplyPool = {
    greeting_urdu: ['Wa Alaikum Assalam! Kya haal hai?'],
    greeting_english: ['Hello! How can I help you today?'],
    how_are_you: ['Alhamdulillah, I am doing great!']
};

function getRandomReply(category) {
    const replies = smartReplyPool[category] || [];
    return replies[Math.floor(Math.random() * replies.length)] || '';
}

function isGreetingMessage(text) {
    if (!text) return null;
    const clean = text.toLowerCase().trim();
    if (clean.includes('assalam') || clean.includes('salam') || clean.includes('aoa')) return 'greeting_urdu';
    if (clean.includes('hello') || clean.includes('hi') || clean.includes('hey')) return 'greeting_english';
    if (clean.includes('kaise ho') || clean.includes('kya hal') || clean.includes('how are')) return 'how_are_you';
    return null;
}

module.exports = {
    smartreplyCommand,
    getSmartReplyStatus,
    setSmartReplyStatus,
    handleSmartReplyMessage,
    getConversationHistory,
    updateConversationHistory,
    clearConversationHistory,
    clearAllConversationHistory,
    buildSystemInstruction,
    callGemini,
    // Backward compatibility exports
    isGreetingMessage,
    getRandomReply,
    smartReplyPool,
    lastSmartReplyTime: {}
};

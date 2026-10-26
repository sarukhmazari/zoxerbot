/**
 * Zoxer Bot - WhatsApp Bot
 * Context-Aware Scoped Auto React System
 * - In Private Chat (DM): Enables/Disables auto-react for personal chats only.
 * - In Group Chat: Enables/Disables auto-react for that specific group only.
 */

const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

const configPath = path.join(__dirname, '..', 'data', 'react.json');

const defaultEmojis = [
    // ✨ Stars, Cosmic & Magic
    "✨", "⭐", "🌟", "💫", "🌠", "🪐", "🌌", "🌙", "☄️", "🔮", "🪄", "⚡", "💥", "🔥", "❤️‍🔥", "💎", "👑",
    // 🗿 Funny, Memes & Expressive Faces
    "🗿", "🤡", "💀", "☠️", "👻", "😈", "👿", "👽", "👾", "🤖", "🫠", "🫣", "🫡", "🤪", "🤤", "🤯", "🥳", "😎", "🧐", "🥸", "🤠", "🥶", "🥵", "🤫", "🤭", "🥱", "😹", "😼",
    // 🥷 Characters & Mythical Creatures
    "🥷", "🧙", "🧛", "🧟", "🧌", "🧞", "🦄", "🐉", "🐲", "🦁", "🐯", "🦊", "🐺", "🐼", "🦅", "🦉", "🦇", "🦈", "🐙", "🦖", "🦕", "🦋",
    // 🧿 Unique Objects & Power Symbols
    "🧿", "🎯", "🎲", "🕹️", "🎭", "🎪", "🏆", "🎖️", "⚔️", "🗡️", "🛡️", "🏹", "🚀", "🛸", "🧨", "🎇", "🎆", "🔱", "⚜️", "💯", "🪀", "🥏",
    // 🖤 Aesthetic Hearts & Badges
    "🖤", "🤍", "💜", "💙", "💖", "❤️‍🩹", "💤", "☣️", "☢️"
];

const defaultData = {
    autoreact_dm: false,
    enabledGroups: [],
    reactEmojis: defaultEmojis
};

// Ensure config exists and load safely
function initConfig() {
    try {
        if (!fs.existsSync(configPath)) {
            fs.mkdirSync(path.dirname(configPath), { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify(defaultData, null, 2));
            return { ...defaultData };
        }
        const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (typeof data.autoreact_dm !== 'boolean') {
            data.autoreact_dm = false;
        }
        if (!Array.isArray(data.enabledGroups)) {
            data.enabledGroups = [];
        }
        if (!Array.isArray(data.reactEmojis) || data.reactEmojis.length === 0) {
            data.reactEmojis = defaultData.reactEmojis;
        }
        return data;
    } catch (err) {
        console.error("Config error:", err);
        return { ...defaultData };
    }
}

// Command to toggle autoreact (.autoreact on / .autoreact off / .autoreact)
async function autoreactCommand(sock, chatId, message, args = []) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);

        if (!message.key.fromMe && !isOwner) {
            return sock.sendMessage(chatId, {
                text: '❌ This command is only for the owner!'
            }, { quoted: message });
        }

        const isGroup = chatId.endsWith('@g.us');
        const config = initConfig();
        const action = args.length > 0 ? args[0].toLowerCase() : null;

        if (action === 'status') {
            const dmStatus = config.autoreact_dm ? 'Enabled (ON)' : 'Disabled (OFF)';
            const thisGroupStatus = isGroup 
                ? (config.enabledGroups.includes(chatId) ? 'Enabled (ON)' : 'Disabled (OFF)')
                : 'N/A (Private Chat)';

            const reply = `╭─ *⚡ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗨𝗧𝗢-𝗥𝗘𝗔𝗖𝗧*
┃
┃  ◈ *𝗗𝗠 𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *${dmStatus}*
┃  ◈ *𝗧𝗛𝗜𝗦 𝗖𝗛𝗔𝗧*
┃  ◆ *${thisGroupStatus}*
┃  ◈ *𝗔𝗖𝗧𝗜𝗩𝗘 𝗚𝗥𝗢𝗨𝗣𝗦*
┃  ◆ *${config.enabledGroups.length}*
┃
╰───────────────`;
            return sock.sendMessage(chatId, { text: reply }, { quoted: message });
        }

        if (action && !['on', 'enable', 'off', 'disable'].includes(action)) {
            return sock.sendMessage(chatId, {
                text: '❌ Use: `.autoreact on` or `.autoreact off`'
            }, { quoted: message });
        }

        if (!isGroup) {
            // Context: Private Chat (DM)
            let isEnabled;
            if (action === 'on' || action === 'enable') {
                isEnabled = true;
            } else if (action === 'off' || action === 'disable') {
                isEnabled = false;
            } else {
                isEnabled = !config.autoreact_dm;
            }

            config.autoreact_dm = isEnabled;
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

            const reply = `╭─ *⚡ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗨𝗧𝗢-𝗥𝗘𝗔𝗖𝗧*
┃
┃  ◈ *𝗖𝗛𝗔𝗧 𝗦𝗖𝗢𝗣𝗘*
┃  ◆ *Personal DMs (Direct Messages)*
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *${isEnabled ? 'Enabled (ON)' : 'Disabled (OFF)'}*
┃
╰───────────────`;
            await sock.sendMessage(chatId, { text: reply }, { quoted: message });
        } else {
            // Context: Group Chat
            const isAlreadyActive = config.enabledGroups.includes(chatId);
            let isEnabled;
            if (action === 'on' || action === 'enable') {
                isEnabled = true;
            } else if (action === 'off' || action === 'disable') {
                isEnabled = false;
            } else {
                isEnabled = !isAlreadyActive;
            }

            if (isEnabled) {
                if (!config.enabledGroups.includes(chatId)) {
                    config.enabledGroups.push(chatId);
                }
            } else {
                config.enabledGroups = config.enabledGroups.filter(id => id !== chatId);
            }

            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

            const reply = `╭─ *⚡ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗨𝗧𝗢-𝗥𝗘𝗔𝗖𝗧*
┃
┃  ◈ *𝗖𝗛𝗔𝗧 𝗦𝗖𝗢𝗣𝗘*
┃  ◆ *This Group Only*
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *${isEnabled ? 'Enabled (ON)' : 'Disabled (OFF)'}*
┃
╰───────────────`;
            await sock.sendMessage(chatId, { text: reply }, { quoted: message });
        }
    } catch (error) {
        console.error("AutoReact command error:", error);
        await sock.sendMessage(chatId, { text: '❌ An error occurred in Auto-React!' }, { quoted: message });
    }
}

// Check status
function isAutoreactEnabled(chatId = null) {
    try {
        const config = initConfig();
        if (!chatId) {
            return Boolean(config.autoreact_dm || (Array.isArray(config.enabledGroups) && config.enabledGroups.length > 0));
        }
        if (chatId.endsWith('@g.us')) {
            return Array.isArray(config.enabledGroups) && config.enabledGroups.includes(chatId);
        }
        return Boolean(config.autoreact_dm);
    } catch {
        return false;
    }
}

// React function
async function addAutoReaction(sock, message) {
    try {
        if (!message?.key?.id) return;
        if (message.key.fromMe) return; // Ignore own messages

        const remoteJid = message.key.remoteJid;
        if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.endsWith('@newsletter')) return;

        // Skip owners
        const senderId = message.key.participant || remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, remoteJid);
        if (isOwner) return;

        const config = initConfig();
        const isGroup = remoteJid.endsWith('@g.us');

        if (isGroup) {
            // Group message: ONLY react if this group is explicitly enabled
            if (!Array.isArray(config.enabledGroups) || !config.enabledGroups.includes(remoteJid)) {
                return;
            }
        } else {
            // Private DM: ONLY react if private DM autoreact is enabled
            if (!config.autoreact_dm) {
                return;
            }
        }

        // Select random emoji
        const emojis = Array.isArray(config.reactEmojis) && config.reactEmojis.length > 0
            ? config.reactEmojis
            : defaultData.reactEmojis;

        const emoji = emojis[Math.floor(Math.random() * emojis.length)];

        await sock.sendMessage(remoteJid, {
            react: {
                text: emoji,
                key: message.key
            }
        });
    } catch (err) {
        console.error("AutoReact Error:", err);
    }
}

module.exports = {
    autoreactCommand,
    isAutoreactEnabled,
    addAutoReaction
};
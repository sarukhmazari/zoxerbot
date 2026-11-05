/**
 * Zoxer Bot - WhatsApp Bot
 * Context-Aware Scoped Auto React System (Per-Session Scoped)
 * - In Private Chat (DM): Enables/Disables auto-react for personal chats only for this session.
 * - In Group Chat: Enables/Disables auto-react for that specific group only for this session.
 * - STRICTLY OFF BY DEFAULT FOR ALL SESSIONS.
 */

const {
    getSessionPhone,
    isSessionOwner,
    getAutoReactConfig,
    setAutoReactConfig,
    isAutoReactEnabled: checkAutoReact
} = require('../lib/session-settings');

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

// Command to toggle autoreact (.autoreact on / .autoreact off / .autoreact status)
async function autoreactCommand(sock, chatId, message, args = []) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const isOwner = isSessionOwner(sock, senderId, message);

        if (!message.key.fromMe && !isOwner) {
            return sock.sendMessage(chatId, {
                text: '❌ This command is only for the session owner!'
            }, { quoted: message });
        }

        const sessionPhone = getSessionPhone(sock);
        const isGroup = chatId.endsWith('@g.us');
        const config = getAutoReactConfig(sock);
        const action = args.length > 0 ? args[0].toLowerCase() : null;

        if (action === 'status') {
            const dmStatus = config.autoreact_dm ? 'Enabled (ON)' : 'Disabled (OFF)';
            const thisGroupStatus = isGroup 
                ? (config.enabledGroups.includes(chatId) ? 'Enabled (ON)' : 'Disabled (OFF)')
                : 'N/A (Private Chat)';

            const reply = `╭─ *⚡ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗨𝗧𝗢-𝗥𝗘𝗔𝗖𝗧*
┃
┃  ◈ *𝗦𝗘𝗦𝗦𝗜𝗢𝗡*
┃  ◆ *${sessionPhone}*
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

            setAutoReactConfig(sock, { autoreact_dm: isEnabled });

            const reply = `╭─ *⚡ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗨𝗧𝗢-𝗥𝗘𝗔𝗖𝗧*
┃
┃  ◈ *𝗦𝗘𝗦𝗦𝗜𝗢𝗡*
┃  ◆ *${sessionPhone}*
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

            let newGroups = [...config.enabledGroups];
            if (isEnabled) {
                if (!newGroups.includes(chatId)) {
                    newGroups.push(chatId);
                }
            } else {
                newGroups = newGroups.filter(id => id !== chatId);
            }

            setAutoReactConfig(sock, { enabledGroups: newGroups });

            const reply = `╭─ *⚡ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗨𝗧𝗢-𝗥𝗘𝗔𝗖𝗧*
┃
┃  ◈ *𝗦𝗘𝗦𝗦𝗜𝗢𝗡*
┃  ◆ *${sessionPhone}*
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
function isAutoreactEnabled(sock, chatId = null) {
    if (!sock) return false;
    return checkAutoReact(sock, chatId);
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
        const isOwner = isSessionOwner(sock, senderId, message);
        if (isOwner) return;

        // Check if autoreact is enabled for THIS session and THIS chat (strictly OFF by default)
        const isEnabled = isAutoreactEnabled(sock, remoteJid);
        if (!isEnabled) {
            return;
        }

        const config = getAutoReactConfig(sock);
        const emojis = Array.isArray(config.reactEmojis) && config.reactEmojis.length > 0
            ? config.reactEmojis
            : defaultEmojis;

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

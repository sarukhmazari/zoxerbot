const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');
const isAdmin = require('../lib/isAdmin');

const dataFilePath = path.join(__dirname, '../data/antibot.json');

// In-memory cache
let antibotConfig = {};

function loadConfig() {
    try {
        if (fs.existsSync(dataFilePath)) {
            antibotConfig = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));
        } else {
            antibotConfig = {};
            fs.writeFileSync(dataFilePath, JSON.stringify(antibotConfig, null, 2));
        }
    } catch (e) {
        console.error('[ANTIBOT] Failed to load config:', e);
        antibotConfig = {};
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(dataFilePath, JSON.stringify(antibotConfig, null, 2));
    } catch (e) {
        console.error('[ANTIBOT] Failed to save config:', e);
    }
}

loadConfig();

/**
 * .antibot command handler
 * Usage:
 *   .antibot on / kick   -> Kick detected rival bots automatically
 *   .antibot delete      -> Delete rival bot messages without kicking
 *   .antibot off         -> Disable Anti-Bot
 *   .antibot             -> View current status
 */
async function antibotCommand(sock, chatId, senderId, args, message) {
    const isGroup = chatId.endsWith('@g.us');
    if (!isGroup) {
        return await sock.sendMessage(chatId, {
            text: '❌ *Anti-Bot can only be configured in groups!*'
        }, { quoted: message });
    }

    const senderIsOwner = await isOwnerOrSudo(senderId, sock, chatId);
    const adminStatus = await isAdmin(sock, chatId, senderId);

    if (!message.key.fromMe && !senderIsOwner && !adminStatus.isSenderAdmin) {
        return await sock.sendMessage(chatId, {
            text: '❌ *Only group admins or the bot owner can configure Anti-Bot!*'
        }, { quoted: message });
    }

    const sub = (args[0] || '').toLowerCase().trim();

    if (sub === 'on' || sub === 'kick' || sub === 'enable') {
        antibotConfig[chatId] = { enabled: true, action: 'kick' };
        saveConfig();
        return await sock.sendMessage(chatId, {
            text: `╭─ *🛡️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗕𝗢𝗧*\n` +
                  `┃\n` +
                  `┃  ◈ *STATUS:* ✅ Enabled\n` +
                  `┃  ◈ *ACTION:* ⛔ Auto-Kick rival bots\n` +
                  `┃  ◈ *DETECTION:* Baileys / Multi-device signatures\n` +
                  `┃\n` +
                  `╰─ Rival bots sending automated messages will be immediately kicked!`
        }, { quoted: message });

    } else if (sub === 'delete') {
        antibotConfig[chatId] = { enabled: true, action: 'delete' };
        saveConfig();
        return await sock.sendMessage(chatId, {
            text: `╭─ *🛡️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗕𝗢𝗧*\n` +
                  `┃\n` +
                  `┃  ◈ *STATUS:* ✅ Enabled\n` +
                  `┃  ◈ *ACTION:* 🗑️ Delete rival bot messages\n` +
                  `┃\n` +
                  `╰─ Messages from rival bots will be deleted without kicking.`
        }, { quoted: message });

    } else if (sub === 'off' || sub === 'disable') {
        delete antibotConfig[chatId];
        saveConfig();
        return await sock.sendMessage(chatId, {
            text: `╭─ *🛡️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗕𝗢𝗧*\n` +
                  `┃\n` +
                  `┃  ◈ *STATUS:* ❌ Disabled\n` +
                  `┃\n` +
                  `╰─ Anti-Bot shield is now inactive.`
        }, { quoted: message });

    } else {
        const cfg = antibotConfig[chatId];
        const isEnabled = cfg && cfg.enabled;
        const action = cfg?.action || 'none';

        return await sock.sendMessage(chatId, {
            text: `╭─ *🛡️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗕𝗢𝗧*\n` +
                  `┃\n` +
                  `┃  ◈ *Current Status:* ${isEnabled ? '✅ Enabled' : '❌ Disabled'}\n` +
                  `┃  ◈ *Current Action:* ${action}\n` +
                  `┃\n` +
                  `┃  *Available Options:*\n` +
                  `┃  • \`.antibot on\` (Auto-kick rival bots)\n` +
                  `┃  • \`.antibot delete\` (Delete bot messages only)\n` +
                  `┃  • \`.antibot off\` (Disable)\n` +
                  `╰─────────────────────────`
        }, { quoted: message });
    }
}

/**
 * Inspect message for known bot signatures
 */
function isBotMessage(message) {
    const keyId = message?.key?.id || '';

    // 1. Check known multi-device bot ID signatures
    if (keyId.startsWith('BAE5')) return true; // Standard Baileys bot ID prefix
    if (keyId.startsWith('B1E')) return true;
    if (keyId.startsWith('XYZ')) return true;
    if (keyId.startsWith('BOT')) return true;
    if (keyId.startsWith('3EB0') && (keyId.length === 12 || keyId.length === 16 || keyId.length === 20 || keyId.length === 22)) return true;

    // 2. Check bot-exclusive payload structures
    const msg = message?.message || {};
    if (msg.templateMessage || msg.buttonsMessage || msg.listMessage || msg.interactiveMessage) {
        return true;
    }

    // 3. Fake external ad reply / fake forwarding injected by bot scripts
    const contextInfo = msg.extendedTextMessage?.contextInfo ||
                        msg.imageMessage?.contextInfo ||
                        msg.videoMessage?.contextInfo ||
                        msg.audioMessage?.contextInfo;

    if (contextInfo) {
        // Normal official mobile users cannot generate externalAdReply cards
        if (contextInfo.externalAdReply && !contextInfo.externalAdReply.showAdAttribution) {
            return true;
        }
        if (contextInfo.forwardingScore && contextInfo.forwardingScore >= 99) {
            return true;
        }
    }

    return false;
}

/**
 * Message listener called in main.js
 * Returns true if rival bot was detected and handled
 */
async function handleBotDetection(sock, chatId, message, senderId) {
    try {
        if (!chatId.endsWith('@g.us')) return false;

        const cfg = antibotConfig[chatId];
        if (!cfg || !cfg.enabled) return false;

        // Never kick our own bot
        if (message.key.fromMe) return false;

        // Never kick bot owner or sudo users
        const senderIsOwner = await isOwnerOrSudo(senderId, sock, chatId);
        if (senderIsOwner) return false;

        // Never kick group admins (admins are trusted)
        const adminStatus = await isAdmin(sock, chatId, senderId);
        if (adminStatus.isSenderAdmin) return false;

        // Check if message matches bot signatures
        if (!isBotMessage(message)) return false;

        console.log(`[ANTIBOT] Rival bot signature detected from ${senderId} in ${chatId}`);

        // Delete the bot's message
        try {
            await sock.sendMessage(chatId, { delete: message.key });
        } catch (delErr) {
            console.error('[ANTIBOT] Failed to delete bot message:', delErr.message);
        }

        const senderTag = `@${String(senderId).split('@')[0]}`;
        const action = cfg.action || 'kick';

        if (action === 'kick') {
            if (adminStatus.isBotAdmin) {
                try {
                    await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
                    await sock.sendMessage(chatId, {
                        text: `⛔ ${senderTag} *has been removed (Rival automated bot detected).*`,
                        mentions: [senderId]
                    });
                } catch (kErr) {
                    console.error('[ANTIBOT] Failed to kick rival bot:', kErr.message);
                }
            } else {
                await sock.sendMessage(chatId, {
                    text: `⚠️ *Rival bot detected:* ${senderTag}\n_Please promote me to group admin to automatically kick it!_`,
                    mentions: [senderId]
                });
            }
            return true;
        }

        // Action 'delete'
        await sock.sendMessage(chatId, {
            text: `🛡️ *Automated bot message from ${senderTag} was intercepted and deleted.*`,
            mentions: [senderId]
        });

        return true;

    } catch (err) {
        console.error('[ANTIBOT] Error in detection:', err);
        return false;
    }
}

module.exports = {
    antibotCommand,
    handleBotDetection
};

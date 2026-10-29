const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');
const isAdmin = require('../lib/isAdmin');

const dataFilePath = path.join(__dirname, '../data/antisticker.json');

// In-memory cache
let antistickerConfig = {};

function loadConfig() {
    try {
        if (fs.existsSync(dataFilePath)) {
            antistickerConfig = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));
        } else {
            antistickerConfig = {};
            fs.writeFileSync(dataFilePath, JSON.stringify(antistickerConfig, null, 2));
        }
    } catch (e) {
        console.error('[ANTISTICKER] Failed to load config:', e);
        antistickerConfig = {};
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(dataFilePath, JSON.stringify(antistickerConfig, null, 2));
    } catch (e) {
        console.error('[ANTISTICKER] Failed to save config:', e);
    }
}

// In-memory warning tracker: { "groupId:senderId": count }
const stickerWarnings = new Map();

loadConfig();

/**
 * .antisticker command handler
 * Usage:
 *   .antisticker on / delete  -> Delete stickers sent by non-admins
 *   .antisticker warn         -> Warn and delete (kick after 3 warnings)
 *   .antisticker kick         -> Immediately kick on sticker
 *   .antisticker off          -> Disable
 *   .antisticker              -> View status
 */
async function antistickerCommand(sock, chatId, senderId, args, message) {
    const isGroup = chatId.endsWith('@g.us');
    if (!isGroup) {
        return await sock.sendMessage(chatId, {
            text: '❌ *Anti-Sticker can only be configured in groups!*'
        }, { quoted: message });
    }

    const senderIsOwner = await isOwnerOrSudo(senderId, sock, chatId);
    const adminStatus = await isAdmin(sock, chatId, senderId);

    if (!message.key.fromMe && !senderIsOwner && !adminStatus.isSenderAdmin) {
        return await sock.sendMessage(chatId, {
            text: '❌ *Only group admins or the bot owner can configure Anti-Sticker!*'
        }, { quoted: message });
    }

    const sub = (args[0] || '').toLowerCase().trim();

    if (sub === 'on' || sub === 'delete' || sub === 'enable') {
        antistickerConfig[chatId] = { enabled: true, action: 'delete' };
        saveConfig();
        return await sock.sendMessage(chatId, {
            text: `╭─ *🛡️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗦𝗧𝗜𝗖𝗞𝗘𝗥*\n` +
                  `┃\n` +
                  `┃  ◈ *STATUS:* ✅ Enabled\n` +
                  `┃  ◈ *ACTION:* 🗑️ Delete sticker\n` +
                  `┃  ◈ *TARGET:* Non-admins\n` +
                  `┃\n` +
                  `╰─ Stickers sent by non-admins will now be automatically deleted!`
        }, { quoted: message });

    } else if (sub === 'warn') {
        antistickerConfig[chatId] = { enabled: true, action: 'warn' };
        saveConfig();
        return await sock.sendMessage(chatId, {
            text: `╭─ *🛡️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗦𝗧𝗜𝗖𝗞𝗘𝗥*\n` +
                  `┃\n` +
                  `┃  ◈ *STATUS:* ✅ Enabled\n` +
                  `┃  ◈ *ACTION:* ⚠️ Warn (3 strikes = Kick)\n` +
                  `┃  ◈ *TARGET:* Non-admins\n` +
                  `┃\n` +
                  `╰─ Stickers will be deleted and users will be warned/kicked!`
        }, { quoted: message });

    } else if (sub === 'kick') {
        antistickerConfig[chatId] = { enabled: true, action: 'kick' };
        saveConfig();
        return await sock.sendMessage(chatId, {
            text: `╭─ *🛡️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗦𝗧𝗜𝗖𝗞𝗘𝗥*\n` +
                  `┃\n` +
                  `┃  ◈ *STATUS:* ✅ Enabled\n` +
                  `┃  ◈ *ACTION:* ⛔ Instant Kick\n` +
                  `┃  ◈ *TARGET:* Non-admins\n` +
                  `┃\n` +
                  `╰─ Anyone sending stickers will be immediately removed!`
        }, { quoted: message });

    } else if (sub === 'off' || sub === 'disable') {
        delete antistickerConfig[chatId];
        saveConfig();
        return await sock.sendMessage(chatId, {
            text: `╭─ *🛡️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗦𝗧𝗜𝗖𝗞𝗘𝗥*\n` +
                  `┃\n` +
                  `┃  ◈ *STATUS:* ❌ Disabled\n` +
                  `┃\n` +
                  `╰─ Stickers are now allowed in this group.`
        }, { quoted: message });

    } else {
        // Status display
        const cfg = antistickerConfig[chatId];
        const isEnabled = cfg && cfg.enabled;
        const action = cfg?.action || 'none';

        return await sock.sendMessage(chatId, {
            text: `╭─ *🛡️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗦𝗧𝗜𝗖𝗞𝗘𝗥*\n` +
                  `┃\n` +
                  `┃  ◈ *Current Status:* ${isEnabled ? '✅ Enabled' : '❌ Disabled'}\n` +
                  `┃  ◈ *Current Action:* ${action}\n` +
                  `┃\n` +
                  `┃  *Available Options:*\n` +
                  `┃  • \`.antisticker on\` (Delete stickers)\n` +
                  `┃  • \`.antisticker warn\` (Warn + Kick after 3)\n` +
                  `┃  • \`.antisticker kick\` (Instant kick)\n` +
                  `┃  • \`.antisticker off\` (Disable)\n` +
                  `╰─────────────────────────`
        }, { quoted: message });
    }
}

/**
 * Message listener: Called whenever an incoming message is received
 * Returns true if sticker was handled (so main.js stops further processing)
 */
async function handleStickerDetection(sock, chatId, message, senderId) {
    try {
        if (!chatId.endsWith('@g.us')) return false;

        // Check if message is a sticker
        const isSticker = Boolean(message.message?.stickerMessage);
        if (!isSticker) return false;

        const cfg = antistickerConfig[chatId];
        if (!cfg || !cfg.enabled) return false;

        // Ignore bot's own messages
        if (message.key.fromMe) return false;

        // Ignore bot owner or group admins
        const senderIsOwner = await isOwnerOrSudo(senderId, sock, chatId);
        if (senderIsOwner) return false;

        const adminStatus = await isAdmin(sock, chatId, senderId);
        if (adminStatus.isSenderAdmin) return false;

        // Bot must be admin to delete/kick
        if (!adminStatus.isBotAdmin) {
            return false;
        }

        // Delete the sticker message
        try {
            await sock.sendMessage(chatId, { delete: message.key });
        } catch (delErr) {
            console.error('[ANTISTICKER] Failed to delete sticker:', delErr.message);
        }

        const senderTag = `@${String(senderId).split('@')[0]}`;
        const action = cfg.action || 'delete';

        if (action === 'kick') {
            try {
                await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
                await sock.sendMessage(chatId, {
                    text: `⛔ ${senderTag} *has been removed for sending stickers.*`,
                    mentions: [senderId]
                });
            } catch (kErr) {
                console.error('[ANTISTICKER] Failed to kick user:', kErr.message);
            }
            return true;
        }

        if (action === 'warn') {
            const warnKey = `${chatId}:${senderId}`;
            const currentWarns = (stickerWarnings.get(warnKey) || 0) + 1;
            stickerWarnings.set(warnKey, currentWarns);

            if (currentWarns >= 3) {
                try {
                    await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
                    stickerWarnings.delete(warnKey);
                    await sock.sendMessage(chatId, {
                        text: `⛔ ${senderTag} *has been removed after 3 sticker warnings.*`,
                        mentions: [senderId]
                    });
                } catch (kErr) {
                    console.error('[ANTISTICKER] Failed to kick user after warnings:', kErr.message);
                }
                return true;
            }

            await sock.sendMessage(chatId, {
                text: `⚠️ ${senderTag} *Stickers are not allowed in this group! (Warning: ${currentWarns}/3)*`,
                mentions: [senderId]
            });
            return true;
        }

        // Default 'delete': brief notification
        await sock.sendMessage(chatId, {
            text: `🚫 ${senderTag} *Stickers are disabled in this group!*`,
            mentions: [senderId]
        });

        return true;
    } catch (err) {
        console.error('[ANTISTICKER] Error in detection:', err);
        return false;
    }
}

module.exports = {
    antistickerCommand,
    handleStickerDetection
};

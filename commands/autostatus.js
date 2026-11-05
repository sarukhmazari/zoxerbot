const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');
const {
    getSessionPhone,
    isSessionOwner,
    getAutoStatusConfig,
    setAutoStatusConfig
} = require('../lib/session-settings');

// Path to store auto status configuration
const configPath = path.join(__dirname, '../data/autoStatus.json');

// Emoji list for reactions
const REACT_EMOJIS = ['❤️', '🔥', '👏', '😍', '🎉', '💯', '✨', '🙌', '💚', '😊'];

// 📦 In-memory queue: stores status keys that arrived (seen or unseen)
const pendingStatusQueue = new Map(); // Map<id, {sock, key}>

// Get config from file or session-settings
function getConfig(sock = null) {
    if (sock) return getAutoStatusConfig(sock);
    try {
        if (!fs.existsSync(configPath)) {
            const defaultConfig = { enabled: false, reactOn: false, reactEmoji: '❤️', sessions: {} };
            fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
            return defaultConfig;
        }
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
        return { enabled: false, reactOn: false, reactEmoji: '❤️', sessions: {} };
    }
}

// ✅ Main command handler
async function autoStatusCommand(sock, chatId, msg, args) {
    try {
        const senderId = msg.key.participant || msg.key.remoteJid;
        const isOwner = isSessionOwner(sock, senderId, msg);

        if (!msg.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, {
                text: '❌ Yeh command sirf session owner use kar sakta hai!'
            }, { quoted: msg });
            return;
        }

        const sessionPhone = getSessionPhone(sock);
        const config = getAutoStatusConfig(sock);

        // No args - show current status
        if (!args || args.length === 0) {
            const statusEmoji = config.enabled ? '✅' : '❌';
            const reactEmoji = config.reactOn ? '✅' : '❌';
            await sock.sendMessage(chatId, {
                text: `╔══════════════════════╗\n` +
                      `║   📡 *AUTO STATUS*      ║\n` +
                      `╚══════════════════════╝\n\n` +
                      `📱 *Session:* ${sessionPhone}\n` +
                      `${statusEmoji} *Auto View:* ${config.enabled ? 'ON' : 'OFF'}\n` +
                      `${reactEmoji} *Auto React:* ${config.reactOn ? 'ON' : 'OFF'}\n` +
                      `💬 *React Emoji:* ${config.reactEmoji || '❤️'}\n\n` +
                      `📖 *Commands:*\n` +
                      `• \`.autostatus on\` - Auto view enable karo (is session ke liye)\n` +
                      `• \`.autostatus off\` - Auto view disable karo (is session ke liye)\n` +
                      `• \`.autostatus react on\` - Auto react enable karo\n` +
                      `• \`.autostatus react off\` - Auto react disable karo\n` +
                      `• \`.autostatus seen\` - Abhi sare statuses manually seen karo`
            }, { quoted: msg });
            return;
        }

        const command = args[0].toLowerCase();

        if (command === 'on') {
            setAutoStatusConfig(sock, { enabled: true });
            // Immediately try to see existing statuses
            seenAllExistingStatuses(sock).catch(() => {});
            await sock.sendMessage(chatId, {
                text: `✅ *Auto Status View ENABLED for session ${sessionPhone}!*\n\n📡 Bot ab automatically sab statuses seen karega.`
            }, { quoted: msg });

        } else if (command === 'off') {
            setAutoStatusConfig(sock, { enabled: false });
            await sock.sendMessage(chatId, {
                text: `❌ *Auto Status View DISABLED for session ${sessionPhone}!*\n\nBot ab statuses seen nahi karega.`
            }, { quoted: msg });

        } else if (command === 'seen') {
            await sock.sendMessage(chatId, {
                text: `⏳ Sare statuses seen kar raha hun...`
            }, { quoted: msg });
            const count = await seenAllExistingStatuses(sock);
            await sock.sendMessage(chatId, {
                text: `✅ *Done!* ${count} status(es) seen kar diye!`
            }, { quoted: msg });

        } else if (command === 'react') {
            if (!args[1]) {
                await sock.sendMessage(chatId, {
                    text: '❌ Use: `.autostatus react on/off`'
                }, { quoted: msg });
                return;
            }
            const reactCmd = args[1].toLowerCase();
            if (reactCmd === 'on') {
                setAutoStatusConfig(sock, { reactOn: true });
                await sock.sendMessage(chatId, {
                    text: `✅ *Auto React ENABLED for session ${sessionPhone}!*\nBot status updates par ${config.reactEmoji || '❤️'} react karega.`
                }, { quoted: msg });
            } else if (reactCmd === 'off') {
                setAutoStatusConfig(sock, { reactOn: false });
                await sock.sendMessage(chatId, {
                    text: `❌ *Auto React DISABLED for session ${sessionPhone}!*`
                }, { quoted: msg });
            } else {
                await sock.sendMessage(chatId, { text: '❌ Use: `.autostatus react on/off`' }, { quoted: msg });
            }

        } else {
            await sock.sendMessage(chatId, {
                text: `❌ Invalid command!\n\nUse:\n• \`.autostatus on/off\`\n• \`.autostatus react on/off\`\n• \`.autostatus seen\``
            }, { quoted: msg });
        }

    } catch (error) {
        console.error('❌ AutoStatus command error:', error.message);
        await sock.sendMessage(chatId, { text: '❌ Error: ' + error.message }, { quoted: msg });
    }
}

// ✅ Seen all queued/existing statuses
async function seenAllExistingStatuses(sock) {
    let count = 0;
    try {
        const entries = [...pendingStatusQueue.entries()];
        for (const [id, item] of entries) {
            try {
                const targetSock = sock || item.sock;
                if (targetSock && item.key) {
                    await targetSock.readMessages([item.key]);
                    count++;
                    pendingStatusQueue.delete(id);
                    await new Promise(r => setTimeout(r, 150));
                }
            } catch (e) {}
        }
        console.log(`👁️ [AUTOSTATUS] Flushed ${count} queued status(es) as seen.`);
    } catch (err) {
        console.error('❌ seenAllExistingStatuses error:', err.message);
    }
    return count;
}

// ✅ React to a status message
async function reactToStatus(sock, statusKey) {
    const config = getAutoStatusConfig(sock);
    if (!config.reactOn) return;
    try {
        const emoji = config.reactEmoji || REACT_EMOJIS[Math.floor(Math.random() * REACT_EMOJIS.length)];
        const participantJid = statusKey.participant || statusKey.remoteJid;
        await sock.sendMessage('status@broadcast', {
            react: {
                text: emoji,
                key: {
                    remoteJid: 'status@broadcast',
                    id: statusKey.id,
                    participant: participantJid,
                    fromMe: false
                }
            }
        }, { statusJidList: [participantJid] });
    } catch (error) {
        // Silent fail
    }
}

// ✅ Main status update handler (called from baileys-helper.js)
async function handleStatusUpdate(sock, statusUpdate) {
    try {
        const config = getAutoStatusConfig(sock);

        if (!statusUpdate?.messages || statusUpdate.messages.length === 0) return;

        for (const msg of statusUpdate.messages) {
            if (msg.key?.remoteJid !== 'status@broadcast') continue;
            if (msg.key?.fromMe) continue;

            const sender = msg.key.participant || msg.key.remoteJid;
            const keyId = msg.key.id || (sender + Date.now());

            pendingStatusQueue.set(keyId, { sock, key: msg.key });
            if (pendingStatusQueue.size > 500) {
                const firstKey = pendingStatusQueue.keys().next().value;
                pendingStatusQueue.delete(firstKey);
            }

            // Auto-view: mark status as seen only if enabled for this session (OFF by default)
            if (config.enabled) {
                try {
                    await sock.readMessages([msg.key]);
                    pendingStatusQueue.delete(keyId);
                    console.log(`👁️ [AUTOSTATUS] [${getSessionPhone(sock)}] Seen: ${sender?.split('@')[0]}`);
                } catch (e) {}

                // Auto-react if enabled
                if (config.reactOn) {
                    await reactToStatus(sock, msg.key);
                }
            }

            // ---- Status Mention/Link Restriction ----
            try {
                const { loadUserGroupData } = require('../lib/index');
                const data = loadUserGroupData();
                const restrictedGroups = Object.keys(data.statusRestriction || {}).filter(gid => data.statusRestriction[gid] === false);
                if (restrictedGroups.length === 0) continue;

                const botId = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
                const rawText = (
                    msg.message?.conversation ||
                    msg.message?.extendedTextMessage?.text ||
                    msg.message?.imageMessage?.caption ||
                    msg.message?.videoMessage?.caption || ''
                ).toLowerCase();

                const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const isBotMentioned = mentions.includes(botId);
                const hasGroupLink = /chat\.whatsapp\.com\/[a-zA-Z0-9]+/i.test(rawText);

                if (isBotMentioned || hasGroupLink) {
                    for (const groupId of restrictedGroups) {
                        try {
                            const groupMetadata = await sock.groupMetadata(groupId);
                            const normalizedBotId = botId.split('@')[0];
                            const botHandle = groupMetadata.participants.find(p => p.id.split('@')[0] === normalizedBotId);
                            if (!botHandle?.admin && !botHandle?.isAdmin) continue;

                            const senderNum = sender.split('@')[0];
                            const participant = groupMetadata.participants.find(p => {
                                const pid = p.id.split('@')[0];
                                const plid = p.lid ? p.lid.split('@')[0] : '';
                                return pid === senderNum || plid === senderNum;
                            });

                            if (participant) {
                                await sock.groupParticipantsUpdate(groupId, [participant.id], 'remove');
                                await sock.sendMessage(groupId, {
                                    text: `🚫 @${participant.id.split('@')[0]} ko status violation ki wajah se group se remove kiya gaya!`,
                                    mentions: [participant.id]
                                });
                            }
                        } catch (err) {
                            console.error(`❌ Status restriction error in ${groupId}:`, err.message);
                        }
                    }
                }
            } catch (e) {
                // Ignore
            }
        }
    } catch (error) {
        console.error('❌ handleStatusUpdate error:', error.message);
    }
}

function isAutoStatusEnabled(sock = null) {
    if (sock) return getAutoStatusConfig(sock).enabled;
    return false;
}
function isStatusReactionEnabled(sock = null) {
    if (sock) return getAutoStatusConfig(sock).reactOn;
    return false;
}

module.exports = {
    autoStatusCommand,
    handleStatusUpdate,
    isAutoStatusEnabled,
    isStatusReactionEnabled,
    seenAllExistingStatuses
};

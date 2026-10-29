const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const settings = require('../settings');
const isOwnerOrSudo = require('../lib/isOwner');
const isAdmin = require('../lib/isAdmin');

const dataFilePath = path.join(__dirname, '../data/antiviewonce.json');

// In-memory config: { dm: boolean, recipient: string, groups: { [groupId]: { enabled: boolean, recipient: string } } }
let avoConfig = { dm: false, recipient: null, groups: {} };

function cleanJid(jid) {
    if (!jid) return '';
    const num = jid.split(':')[0].split('@')[0].replace(/[^0-9]/g, '');
    return num ? `${num}@s.whatsapp.net` : '';
}

function loadConfig() {
    try {
        if (fs.existsSync(dataFilePath)) {
            const raw = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));
            avoConfig = {
                dm: Boolean(raw.dm),
                recipient: raw.recipient || null,
                groups: raw.groups || {}
            };
        } else {
            avoConfig = { dm: false, recipient: null, groups: {} };
            fs.writeFileSync(dataFilePath, JSON.stringify(avoConfig, null, 2));
        }
    } catch (e) {
        console.error('[ANTIVIEWONCE] Failed to load config:', e);
        avoConfig = { dm: false, recipient: null, groups: {} };
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(dataFilePath, JSON.stringify(avoConfig, null, 2));
    } catch (e) {
        console.error('[ANTIVIEWONCE] Failed to save config:', e);
    }
}

loadConfig();

/**
 * Command: .antiviewonce / .antivo
 * Usage:
 *   .antiviewonce on   -> Enable stealth interception for this chat
 *   .antiviewonce off  -> Disable
 *   .antiviewonce      -> View status
 */
async function antiviewonceCommand(sock, chatId, senderId, args, message) {
    const isGroup = chatId.endsWith('@g.us');
    const senderIsOwner = await isOwnerOrSudo(senderId, sock, chatId);
    const normalizedSender = cleanJid(senderId || message.key.participant || chatId);

    if (isGroup) {
        const adminStatus = await isAdmin(sock, chatId, senderId);
        if (!message.key.fromMe && !senderIsOwner && !adminStatus.isSenderAdmin) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Only group admins or bot owner can configure Anti-ViewOnce!*'
            }, { quoted: message });
        }
    } else {
        if (!message.key.fromMe && !senderIsOwner) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Only the bot owner can configure private chat Anti-ViewOnce!*'
            }, { quoted: message });
        }
    }

    const sub = (args[0] || '').toLowerCase().trim();

    if (sub === 'on' || sub === 'enable') {
        if (isGroup) {
            avoConfig.groups[chatId] = {
                enabled: true,
                recipient: normalizedSender
            };
        } else {
            avoConfig.dm = true;
            avoConfig.recipient = normalizedSender;
        }
        saveConfig();

        return await sock.sendMessage(chatId, {
            text: `╭─ *👁️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗩𝗜𝗘𝗪𝗢𝗡𝗖𝗘*\n` +
                  `┃\n` +
                  `┃  ◈ *STATUS:* ✅ Enabled\n` +
                  `┃  ◈ *SCOPE:* ${isGroup ? 'This Group' : 'Private Direct Messages'}\n` +
                  `┃  ◈ *FORWARD TO:* @${normalizedSender.split('@')[0]}\n` +
                  `┃  ◈ *MODE:* 🥷 100% Stealth / Secret\n` +
                  `┃\n` +
                  `╰─ Whenever View-Once media is sent, it will be automatically extracted and sent to your private chat without alerting anyone in this chat!`,
            mentions: [normalizedSender]
        }, { quoted: message });

    } else if (sub === 'off' || sub === 'disable') {
        if (isGroup) {
            delete avoConfig.groups[chatId];
        } else {
            avoConfig.dm = false;
        }
        saveConfig();

        return await sock.sendMessage(chatId, {
            text: `╭─ *👁️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗩𝗜𝗘𝗪𝗢𝗡𝗖𝗘*\n` +
                  `┃\n` +
                  `┃  ◈ *STATUS:* ❌ Disabled\n` +
                  `┃  ◈ *SCOPE:* ${isGroup ? 'This Group' : 'Private Direct Messages'}\n` +
                  `┃\n` +
                  `╰─ Stealth interception has been turned off.`
        }, { quoted: message });

    } else {
        const isCurrentActive = isGroup ? Boolean(avoConfig.groups[chatId]?.enabled || avoConfig.groups[chatId]) : Boolean(avoConfig.dm);
        return await sock.sendMessage(chatId, {
            text: `╭─ *👁️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗩𝗜𝗘𝗪𝗢𝗡𝗖𝗘*\n` +
                  `┃\n` +
                  `┃  ◈ *This Chat:* ${isCurrentActive ? '✅ Active (Stealth)' : '❌ Inactive'}\n` +
                  `┃  ◈ *Private DMs:* ${avoConfig.dm ? '✅ Enabled' : '❌ Disabled'}\n` +
                  `┃  ◈ *Active Groups:* ${Object.keys(avoConfig.groups).length}\n` +
                  `┃\n` +
                  `┃  *Options:*\n` +
                  `┃  • \`.antiviewonce on\` (Enable stealth interceptor)\n` +
                  `┃  • \`.antiviewonce off\` (Disable)\n` +
                  `╰─────────────────────────`
        }, { quoted: message });
    }
}

/**
 * Deep search to find View-Once media inside any nested Baileys structure
 */
function findViewOnceMedia(message) {
    if (!message || !message.message) return null;

    let m = message.message;

    // Unwrap wrappers
    if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
    if (m.documentWithCaptionMessage?.message) m = m.documentWithCaptionMessage.message;
    if (m.editedMessage?.message) m = m.editedMessage.message;

    let vOnce = null;
    if (m.viewOnceMessageV2?.message) vOnce = m.viewOnceMessageV2.message;
    else if (m.viewOnceMessage?.message) vOnce = m.viewOnceMessage.message;
    else if (m.viewOnceMessageV2Extension?.message) vOnce = m.viewOnceMessageV2Extension.message;

    if (vOnce?.ephemeralMessage?.message) vOnce = vOnce.ephemeralMessage.message;

    let mediaContent = null;
    let mediaType = null;
    let mimeType = null;
    let caption = '';

    if (vOnce) {
        if (vOnce.imageMessage) {
            mediaContent = vOnce.imageMessage;
            mediaType = 'image';
            mimeType = 'image/jpeg';
            caption = vOnce.imageMessage.caption || '';
        } else if (vOnce.videoMessage) {
            mediaContent = vOnce.videoMessage;
            mediaType = 'video';
            mimeType = 'video/mp4';
            caption = vOnce.videoMessage.caption || '';
        } else if (vOnce.audioMessage) {
            mediaContent = vOnce.audioMessage;
            mediaType = 'audio';
            mimeType = vOnce.audioMessage.mimetype || 'audio/ogg; codecs=opus';
            caption = '';
        }
    } else {
        // Direct flags on media
        if (m.imageMessage && (m.imageMessage.viewOnce || m.imageMessage.viewOnceMessage)) {
            mediaContent = m.imageMessage;
            mediaType = 'image';
            mimeType = 'image/jpeg';
            caption = m.imageMessage.caption || '';
        } else if (m.videoMessage && (m.videoMessage.viewOnce || m.videoMessage.viewOnceMessage)) {
            mediaContent = m.videoMessage;
            mediaType = 'video';
            mimeType = 'video/mp4';
            caption = m.videoMessage.caption || '';
        } else if (m.audioMessage && (m.audioMessage.viewOnce || m.audioMessage.viewOnceMessage)) {
            mediaContent = m.audioMessage;
            mediaType = 'audio';
            mimeType = m.audioMessage.mimetype || 'audio/ogg; codecs=opus';
            caption = '';
        }
    }

    if (!mediaContent || !mediaContent.mediaKey) {
        return null;
    }

    return { mediaContent, mediaType, mimeType, caption };
}

/**
 * Background detector: called on every incoming message.
 * Extracts View-Once media and silently sends it to the owner / recipient private chat.
 * Leaves ZERO trace or response in the source chat.
 */
async function handleViewOnceDetection(sock, chatId, message, senderId) {
    try {
        if (!chatId || message.key?.fromMe) return false;

        const isGroup = chatId.endsWith('@g.us');
        const groupEntry = avoConfig.groups?.[chatId];
        const isGroupEnabled = isGroup && (groupEntry === true || Boolean(groupEntry?.enabled));
        const isDmEnabled = !isGroup && Boolean(avoConfig.dm);

        if (!isGroupEnabled && !isDmEnabled) {
            return false;
        }

        const found = findViewOnceMedia(message);
        if (!found) {
            return false;
        }

        const { mediaContent, mediaType, mimeType, caption } = found;
        console.log(`[ANTIVIEWONCE] Detected ViewOnce ${mediaType} from ${senderId} in ${chatId}`);

        // Download media buffer
        const stream = await downloadContentFromMessage(mediaContent, mediaType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        if (!buffer || buffer.length === 0) {
            console.error('[ANTIVIEWONCE] Downloaded buffer was empty');
            return false;
        }

        // Collect all target recipient JIDs
        const targets = new Set();

        // 1. Configured recipient who enabled the command
        if (!isGroup && avoConfig.recipient) {
            targets.add(cleanJid(avoConfig.recipient));
        }
        if (isGroup && groupEntry?.recipient) {
            targets.add(cleanJid(groupEntry.recipient));
        }

        // 2. All owners and sudo users from settings
        const ownerNums = settings.ownerNumbers || [settings.ownerNumber];
        for (const num of ownerNums) {
            const c = cleanJid(num);
            if (c) targets.add(c);
        }
        if (settings.ownerNumber) {
            const c = cleanJid(settings.ownerNumber);
            if (c) targets.add(c);
        }

        // 3. If the sender themself is an owner testing the bot, also ensure it goes back to them
        const senderClean = cleanJid(senderId || message.key.participant || chatId);
        const senderIsOwner = await isOwnerOrSudo(senderClean, sock, chatId);
        if (senderIsOwner) {
            targets.add(senderClean);
        }

        // 4. Also add the bot's own self JID
        if (sock.user?.id) {
            targets.add(cleanJid(sock.user.id));
        }

        let chatName = 'Private Chat';
        if (isGroup) {
            try {
                const groupMeta = await sock.groupMetadata(chatId);
                chatName = groupMeta.subject || 'Group';
            } catch (_) {
                chatName = 'Group';
            }
        }

        const senderTag = `@${senderClean.split('@')[0]}`;
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const headerCaption = `🥷 *STEALTH VIEW-ONCE INTERCEPTED*\n\n` +
                              `👤 *Sender:* ${senderTag}\n` +
                              `📍 *Source:* ${chatName}\n` +
                              `🕒 *Time:* ${timeStr}\n` +
                              (caption ? `💬 *Caption:* ${caption}\n` : '') +
                              `\n_Sent privately. No message was left in the source chat._`;

        let sentCount = 0;
        for (const targetJid of targets) {
            if (!targetJid) continue;
            try {
                if (mediaType === 'image') {
                    await sock.sendMessage(targetJid, {
                        image: buffer,
                        caption: headerCaption,
                        mentions: [senderClean]
                    });
                } else if (mediaType === 'video') {
                    await sock.sendMessage(targetJid, {
                        video: buffer,
                        caption: headerCaption,
                        mentions: [senderClean]
                    });
                } else if (mediaType === 'audio') {
                    await sock.sendMessage(targetJid, {
                        audio: buffer,
                        mimetype: mimeType,
                        ptt: true
                    });
                    await sock.sendMessage(targetJid, {
                        text: headerCaption,
                        mentions: [senderClean]
                    });
                }
                sentCount++;
            } catch (err) {
                console.error(`[ANTIVIEWONCE] Failed to send to ${targetJid}:`, err.message);
            }
        }

        console.log(`[ANTIVIEWONCE] Intercepted & forwarded to ${sentCount} recipient(s)!`);
        return true;

    } catch (err) {
        console.error('[ANTIVIEWONCE] Error in handleViewOnceDetection:', err);
        return false;
    }
}

module.exports = {
    antiviewonceCommand,
    handleViewOnceDetection,
    findViewOnceMedia
};

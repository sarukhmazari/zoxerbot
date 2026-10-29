const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const settings = require('../settings');
const isOwnerOrSudo = require('../lib/isOwner');
const isAdmin = require('../lib/isAdmin');

const dataFilePath = path.join(__dirname, '../data/antiviewonce.json');

// In-memory config: { dm: boolean, groups: { [groupId]: boolean } }
let avoConfig = { dm: false, groups: {} };

function loadConfig() {
    try {
        if (fs.existsSync(dataFilePath)) {
            avoConfig = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));
            if (!avoConfig.groups) avoConfig.groups = {};
        } else {
            avoConfig = { dm: false, groups: {} };
            fs.writeFileSync(dataFilePath, JSON.stringify(avoConfig, null, 2));
        }
    } catch (e) {
        console.error('[ANTIVIEWONCE] Failed to load config:', e);
        avoConfig = { dm: false, groups: {} };
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

    if (isGroup) {
        const adminStatus = await isAdmin(sock, chatId, senderId);
        if (!message.key.fromMe && !senderIsOwner && !adminStatus.isSenderAdmin) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Only group admins or bot owner can configure Anti-ViewOnce!*'
            }, { quoted: message });
        }
    } else {
        // In DM: Only owner / sudo can toggle DM interceptor
        if (!message.key.fromMe && !senderIsOwner) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Only the bot owner can configure private chat Anti-ViewOnce!*'
            }, { quoted: message });
        }
    }

    const sub = (args[0] || '').toLowerCase().trim();

    if (sub === 'on' || sub === 'enable') {
        if (isGroup) {
            avoConfig.groups[chatId] = true;
        } else {
            avoConfig.dm = true;
        }
        saveConfig();

        return await sock.sendMessage(chatId, {
            text: `╭─ *👁️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗩𝗜𝗘𝗪𝗢𝗡𝗖𝗘*\n` +
                  `┃\n` +
                  `┃  ◈ *STATUS:* ✅ Enabled\n` +
                  `┃  ◈ *SCOPE:* ${isGroup ? 'This Group' : 'Private Direct Messages'}\n` +
                  `┃  ◈ *MODE:* 🥷 100% Stealth / Secret\n` +
                  `┃\n` +
                  `╰─ Whenever anyone sends View-Once media, it will be secretly extracted and forwarded directly to the owner's private chat without alerting anyone in this chat!`
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
        const isCurrentActive = isGroup ? Boolean(avoConfig.groups[chatId]) : Boolean(avoConfig.dm);
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
 * Background detector: called on every incoming message.
 * Extracts View-Once media and silently sends it to the owner's private chat.
 * CRITICAL: Leaves ZERO trace or response in the source chat.
 */
async function handleViewOnceDetection(sock, chatId, message, senderId) {
    try {
        if (message.key.fromMe) return false;

        const isGroup = chatId.endsWith('@g.us');
        const isEnabled = isGroup ? Boolean(avoConfig.groups?.[chatId]) : Boolean(avoConfig.dm);
        if (!isEnabled) return false;

        const m = message.message || {};
        const vOnce = m.viewOnceMessageV2?.message ||
                      m.viewOnceMessage?.message ||
                      m.viewOnceMessageV2Extension?.message ||
                      null;

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
                mimeType = 'audio/ogg; codecs=opus';
                caption = '';
            }
        } else if (m.imageMessage?.viewOnce) {
            mediaContent = m.imageMessage;
            mediaType = 'image';
            mimeType = 'image/jpeg';
            caption = m.imageMessage.caption || '';
        } else if (m.videoMessage?.viewOnce) {
            mediaContent = m.videoMessage;
            mediaType = 'video';
            mimeType = 'video/mp4';
            caption = m.videoMessage.caption || '';
        } else if (m.audioMessage?.viewOnce) {
            mediaContent = m.audioMessage;
            mediaType = 'audio';
            mimeType = 'audio/ogg; codecs=opus';
            caption = '';
        }

        if (!mediaContent || !mediaContent.mediaKey) {
            return false;
        }

        console.log(`[ANTIVIEWONCE] Stealth-intercepting ViewOnce ${mediaType} from ${senderId} in ${chatId}`);

        // Download the media stream
        const stream = await downloadContentFromMessage(mediaContent, mediaType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        if (!buffer || buffer.length === 0) return false;

        // Determine target private destinations (Bot's own number & primary owner)
        const selfJid = sock.user?.id ? (sock.user.id.split(':')[0].split('@')[0] + '@s.whatsapp.net') : null;
        const ownerJid = (settings.ownerNumber || '').replace(/[^0-9]/g, '') + '@s.whatsapp.net';

        const destinations = new Set([selfJid, ownerJid].filter(Boolean));

        // Get chat metadata for context
        let chatName = 'Private Chat';
        if (isGroup) {
            try {
                const groupMeta = await sock.groupMetadata(chatId);
                chatName = groupMeta.subject || 'Group';
            } catch (_) {
                chatName = 'Group';
            }
        }

        const senderTag = `@${String(senderId).split('@')[0]}`;
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const headerCaption = `🥷 *STEALTH VIEW-ONCE INTERCEPTED*\n\n` +
                              `👤 *Sender:* ${senderTag}\n` +
                              `📍 *Source:* ${chatName}\n` +
                              `🕒 *Time:* ${timeStr}\n` +
                              (caption ? `💬 *Caption:* ${caption}\n` : '') +
                              `\n_Sent privately to owner. No message was posted in the chat._`;

        for (const dest of destinations) {
            try {
                if (mediaType === 'image') {
                    await sock.sendMessage(dest, {
                        image: buffer,
                        caption: headerCaption,
                        mentions: [senderId]
                    });
                } else if (mediaType === 'video') {
                    await sock.sendMessage(dest, {
                        video: buffer,
                        caption: headerCaption,
                        mentions: [senderId]
                    });
                } else if (mediaType === 'audio') {
                    await sock.sendMessage(dest, {
                        audio: buffer,
                        mimetype: mimeType,
                        ptt: true,
                        contextInfo: {
                            externalAdReply: {
                                title: `View-Once Voice Note from ${senderTag}`,
                                body: `Intercepted from ${chatName}`,
                                mediaType: 2
                            }
                        }
                    });
                }
            } catch (sendErr) {
                console.error(`[ANTIVIEWONCE] Failed sending to ${dest}:`, sendErr.message);
            }
        }

        // Return true to signify interception, but notice we DO NOT send anything to chatId!
        return true;

    } catch (err) {
        console.error('[ANTIVIEWONCE] Error in stealth interceptor:', err);
        return false;
    }
}

module.exports = {
    antiviewonceCommand,
    handleViewOnceDetection
};

const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const settings = require('../settings');
const isOwnerOrSudo = require('../lib/isOwner');
const isAdmin = require('../lib/isAdmin');

const dataFilePath = path.join(__dirname, '../data/antiviewonce.json');

// In-memory config: { dm: boolean, allGroups: boolean, recipient: string|null, groups: { [groupId]: { enabled: boolean, recipient: string|null } } }
let avoConfig = { dm: false, allGroups: false, recipient: null, groups: {} };
const processedViewOnceIds = new Set();
const MAX_PROCESSED_IDS = 1000;

/**
 * Normalizes JIDs safely, stripping device suffixes (:device_id) to avoid send failures.
 */
function cleanJid(jid) {
    if (!jid || typeof jid !== 'string') return '';
    if (jid.endsWith('@g.us') || jid.endsWith('@newsletter')) {
        return jid;
    }
    if (jid.endsWith('@lid')) {
        const user = jid.split('@')[0].split(':')[0];
        return `${user}@lid`;
    }
    const num = jid.split(':')[0].split('@')[0].replace(/[^0-9]/g, '');
    return num ? `${num}@s.whatsapp.net` : '';
}

/**
 * Loads configuration from disk, creating the directory and file if needed.
 */
function loadConfig() {
    try {
        if (fs.existsSync(dataFilePath)) {
            const raw = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));
            avoConfig = {
                dm: Boolean(raw.dm),
                allGroups: Boolean(raw.allGroups),
                recipient: raw.recipient || null,
                groups: (typeof raw.groups === 'object' && raw.groups !== null) ? raw.groups : {}
            };
        } else {
            avoConfig = { dm: false, allGroups: false, recipient: null, groups: {} };
            const dir = path.dirname(dataFilePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(dataFilePath, JSON.stringify(avoConfig, null, 2));
        }
    } catch (e) {
        console.error('[ANTIVIEWONCE] Failed to load config:', e);
        avoConfig = { dm: false, allGroups: false, recipient: null, groups: {} };
    }
}

/**
 * Saves current configuration to JSON file.
 */
function saveConfig() {
    try {
        const dir = path.dirname(dataFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(dataFilePath, JSON.stringify(avoConfig, null, 2));
    } catch (e) {
        console.error('[ANTIVIEWONCE] Failed to save config:', e);
    }
}

loadConfig();

/**
 * Checks whether Anti-ViewOnce is enabled for a given chatId.
 */
function isChatEnabled(chatId) {
    if (!chatId) return false;
    const isGroup = chatId.endsWith('@g.us');
    if (isGroup) {
        const groupEntry = avoConfig.groups?.[chatId];
        if (groupEntry !== undefined && groupEntry !== null) {
            if (typeof groupEntry === 'boolean') return groupEntry;
            if (typeof groupEntry.enabled === 'boolean') return groupEntry.enabled;
        }
        return Boolean(avoConfig.allGroups);
    }
    return Boolean(avoConfig.dm);
}

/**
 * Resolves the destination owner/admin private chat JID.
 * Strips device suffixes (:device_id) to prevent Baileys delivery failures.
 */
function resolveOwnerRecipient(sock, chatId) {
    // 1. Group-specific configured recipient
    const groupRecipient = chatId && avoConfig.groups?.[chatId]?.recipient;
    if (groupRecipient) {
        const cleaned = cleanJid(groupRecipient);
        if (cleaned && !cleaned.endsWith('@g.us')) return cleaned;
    }

    // 2. Global configured recipient
    if (avoConfig.recipient) {
        const cleaned = cleanJid(avoConfig.recipient);
        if (cleaned && !cleaned.endsWith('@g.us')) return cleaned;
    }

    // 3. Connected bot session user ID
    if (sock?.user?.id) {
        const botUser = cleanJid(sock.user.id);
        if (botUser && !botUser.endsWith('@g.us')) return botUser;
    }

    // 4. Default bot owner number from settings
    const ownerNum = settings.ownerNumber || (Array.isArray(settings.ownerNumbers) ? settings.ownerNumbers[0] : null);
    if (ownerNum) {
        return cleanJid(ownerNum);
    }

    return null;
}

/**
 * Recursively unwraps message containers up to a safe maximum depth.
 * Tracks all wrapper layers encountered (e.g. ephemeralMessage, viewOnceMessageV2, deviceSentMessage).
 */
function unwrapMessage(message) {
    if (!message) return { content: null, wrappers: [] };

    let current = message.message || message;
    const wrappers = [];
    const maxDepth = 12;
    let depth = 0;

    while (current && typeof current === 'object' && depth < maxDepth) {
        depth++;
        if (current.ephemeralMessage?.message) {
            wrappers.push('ephemeralMessage');
            current = current.ephemeralMessage.message;
        } else if (current.viewOnceMessage?.message) {
            wrappers.push('viewOnceMessage');
            current = current.viewOnceMessage.message;
        } else if (current.viewOnceMessageV2?.message) {
            wrappers.push('viewOnceMessageV2');
            current = current.viewOnceMessageV2.message;
        } else if (current.viewOnceMessageV2Extension?.message) {
            wrappers.push('viewOnceMessageV2Extension');
            current = current.viewOnceMessageV2Extension.message;
        } else if (current.documentWithCaptionMessage?.message) {
            wrappers.push('documentWithCaptionMessage');
            current = current.documentWithCaptionMessage.message;
        } else if (current.editedMessage?.message) {
            wrappers.push('editedMessage');
            const inner = current.editedMessage.message;
            current = inner?.protocolMessage?.editedMessage || inner;
        } else if (current.deviceSentMessage?.message) {
            wrappers.push('deviceSentMessage');
            current = current.deviceSentMessage.message;
        } else if (current.botInvokeMessage?.message) {
            wrappers.push('botInvokeMessage');
            current = current.botInvokeMessage.message;
        } else if (current.associatedChildMessage?.message) {
            wrappers.push('associatedChildMessage');
            current = current.associatedChildMessage.message;
        } else if (current.groupStatusMessage?.message) {
            wrappers.push('groupStatusMessage');
            current = current.groupStatusMessage.message;
        } else if (current.groupStatusMessageV2?.message) {
            wrappers.push('groupStatusMessageV2');
            current = current.groupStatusMessageV2.message;
        } else if (current.message && typeof current.message === 'object' && !current.imageMessage && !current.videoMessage && !current.audioMessage && !current.documentMessage && !current.ptvMessage) {
            wrappers.push('message');
            current = current.message;
        } else {
            break;
        }
    }

    return { content: current, wrappers };
}

/**
 * Deep search to find View-Once media inside any nested Baileys structure.
 * Returns media info object if message is View-Once, or null if normal/unsupported.
 */
function findViewOnceMedia(message) {
    if (!message) return null;

    const { content, wrappers } = unwrapMessage(message);
    if (!content || typeof content !== 'object') return null;

    const hasViewOnceWrapper = wrappers.some(w =>
        w === 'viewOnceMessage' ||
        w === 'viewOnceMessageV2' ||
        w === 'viewOnceMessageV2Extension'
    );

    let mediaContent = null;
    let mediaType = null;
    let mimeType = null;
    let caption = '';

    if (content.imageMessage) {
        if (hasViewOnceWrapper || content.imageMessage.viewOnce || content.imageMessage.viewOnceMessage) {
            mediaContent = content.imageMessage;
            mediaType = 'image';
            mimeType = content.imageMessage.mimetype || 'image/jpeg';
            caption = content.imageMessage.caption || '';
        }
    } else if (content.videoMessage) {
        if (hasViewOnceWrapper || content.videoMessage.viewOnce || content.videoMessage.viewOnceMessage) {
            mediaContent = content.videoMessage;
            mediaType = 'video';
            mimeType = content.videoMessage.mimetype || 'video/mp4';
            caption = content.videoMessage.caption || '';
        }
    } else if (content.ptvMessage) {
        if (hasViewOnceWrapper || content.ptvMessage.viewOnce || content.ptvMessage.viewOnceMessage) {
            mediaContent = content.ptvMessage;
            mediaType = 'video';
            mimeType = content.ptvMessage.mimetype || 'video/mp4';
            caption = content.ptvMessage.caption || '';
        }
    } else if (content.audioMessage) {
        if (hasViewOnceWrapper || content.audioMessage.viewOnce || content.audioMessage.viewOnceMessage) {
            mediaContent = content.audioMessage;
            mediaType = 'audio';
            mimeType = content.audioMessage.mimetype || 'audio/ogg; codecs=opus';
            caption = '';
        }
    } else if (content.documentMessage) {
        if (hasViewOnceWrapper || content.documentMessage.viewOnce || content.documentMessage.viewOnceMessage) {
            mediaContent = content.documentMessage;
            mediaType = 'document';
            mimeType = content.documentMessage.mimetype || 'application/octet-stream';
            caption = content.documentMessage.caption || content.documentMessage.fileName || '';
        }
    }

    if (!mediaContent) {
        return null;
    }

    return {
        mediaContent,
        mediaType,
        mimeType,
        caption,
        isViewOnce: true,
        wrapperStructure: wrappers.length > 0 ? wrappers.join(' -> ') : 'direct'
    };
}

/**
 * Command: .antiviewonce / .antivo
 * Usage:
 *   .antiviewonce on       -> Enable detection for this chat
 *   .antiviewonce off      -> Disable for this chat
 *   .antiviewonce all on   -> Enable globally for ALL private chats & groups
 *   .antiviewonce all off  -> Disable globally
 *   .antiviewonce          -> View status
 */
async function antiviewonceCommand(sock, chatId, senderId, args, message) {
    const isGroup = chatId.endsWith('@g.us');
    const senderIsOwner = await isOwnerOrSudo(senderId, sock, chatId);
    const normalizedSender = cleanJid(senderId || message.key?.participant || chatId);

    if (isGroup) {
        const adminStatus = await isAdmin(sock, chatId, senderId);
        if (!message.key?.fromMe && !senderIsOwner && !adminStatus.isSenderAdmin) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Only group admins or bot owner can configure Anti-ViewOnce!*'
            }, { quoted: message });
        }
    } else {
        if (!message.key?.fromMe && !senderIsOwner) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Only the bot owner can configure private chat Anti-ViewOnce!*'
            }, { quoted: message });
        }
    }

    const sub = (args[0] || '').toLowerCase().trim();
    const sub2 = (args[1] || '').toLowerCase().trim();
    const isAll = sub === 'all' || sub2 === 'all';

    if (sub === 'on' || sub === 'enable' || (isAll && (sub2 === 'on' || sub === 'on'))) {
        if (isAll) {
            avoConfig.dm = true;
            avoConfig.allGroups = true;
            avoConfig.recipient = normalizedSender;
        } else if (isGroup) {
            avoConfig.groups[chatId] = {
                enabled: true,
                recipient: normalizedSender
            };
            if (!avoConfig.recipient) avoConfig.recipient = normalizedSender;
        } else {
            avoConfig.dm = true;
            avoConfig.recipient = normalizedSender;
        }
        saveConfig();

        const scopeText = isAll ? '🌐 Global (All DMs & All Groups)' : (isGroup ? '👥 This Group' : '👤 Private Direct Messages');

        return await sock.sendMessage(chatId, {
            text: `╭─ *👁️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗩𝗜𝗘𝗪𝗢𝗡𝗖𝗘*\n` +
                  `┃\n` +
                  `┃  ◈ *STATUS:* ✅ Enabled\n` +
                  `┃  ◈ *SCOPE:* ${scopeText}\n` +
                  `┃  ◈ *RECIPIENT:* @${normalizedSender.split('@')[0]}\n` +
                  `┃  ◈ *MODE:* 🤫 100% Silent Media Interceptor\n` +
                  `┃\n` +
                  `╰─ Anti-ViewOnce is active. When ephemeral photos, videos, or audio are sent, they will be automatically decrypted and forwarded directly to your private chat without notifying the sender.`,
            mentions: [normalizedSender]
        }, { quoted: message });

    } else if (sub === 'off' || sub === 'disable' || (isAll && (sub2 === 'off' || sub === 'off'))) {
        if (isAll) {
            avoConfig.dm = false;
            avoConfig.allGroups = false;
            avoConfig.groups = {};
        } else if (isGroup) {
            avoConfig.groups[chatId] = {
                enabled: false,
                recipient: null
            };
        } else {
            avoConfig.dm = false;
        }
        saveConfig();

        const scopeText = isAll ? '🌐 Global (All DMs & Groups)' : (isGroup ? '👥 This Group' : '👤 Private Direct Messages');

        return await sock.sendMessage(chatId, {
            text: `╭─ *👁️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗩𝗜𝗘𝗪𝗢𝗡𝗖𝗘*\n` +
                  `┃\n` +
                  `┃  ◈ *STATUS:* ❌ Disabled\n` +
                  `┃  ◈ *SCOPE:* ${scopeText}\n` +
                  `┃\n` +
                  `╰─ Anti-ViewOnce media interception has been turned off.`
        }, { quoted: message });

    } else {
        const isCurrentActive = isChatEnabled(chatId);
        const activeGroupCount = Object.values(avoConfig.groups).filter(g => g === true || g?.enabled === true).length;
        const currentRecipient = resolveOwnerRecipient(sock, chatId);

        return await sock.sendMessage(chatId, {
            text: `╭─ *👁️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗩𝗜𝗘𝗪𝗢𝗡𝗖𝗘*\n` +
                  `┃\n` +
                  `┃  ◈ *This Chat:* ${isCurrentActive ? '✅ Active' : '❌ Inactive'}\n` +
                  `┃  ◈ *Private DMs:* ${avoConfig.dm ? '✅ Enabled' : '❌ Disabled'}\n` +
                  `┃  ◈ *All Groups:* ${avoConfig.allGroups ? '✅ Enabled' : '❌ Disabled'}\n` +
                  `┃  ◈ *Configured Groups:* ${activeGroupCount}\n` +
                  `┃  ◈ *Recipient:* ${currentRecipient ? '@' + currentRecipient.split('@')[0] : 'Not Set'}\n` +
                  `┃  ◈ *Mode:* 🤫 100% Silent Interceptor\n` +
                  `┃\n` +
                  `┃  *Options:*\n` +
                  `┃  • \`.antiviewonce on\` (Enable for this chat)\n` +
                  `┃  • \`.antiviewonce off\` (Disable for this chat)\n` +
                  `┃  • \`.antiviewonce all on\` (Enable for ALL DMs & Groups)\n` +
                  `┃  • \`.antiviewonce all off\` (Disable globally)\n` +
                  `╰─────────────────────────`,
            mentions: currentRecipient ? [currentRecipient] : []
        }, { quoted: message });
    }
}

/**
 * Background detector: called on incoming messages.
 * Intercepts, decrypts, downloads, and forwards View-Once media silently to the owner's DM.
 * 100% stealth: never sends any messages, reactions, or read markers into the originating chat.
 */
async function handleViewOnceDetection(sock, chatId, message, senderId) {
    try {
        if (!chatId || !message || !sock) {
            return false;
        }

        const msgId = message.key?.id || 'unknown';

        // 1. Deduplication: only ignore if this exact message was already processed
        if (msgId !== 'unknown' && processedViewOnceIds.has(msgId)) {
            return false;
        }

        // 2. Check configuration (chat-level or global)
        const isEnabled = isChatEnabled(chatId);
        if (!isEnabled) {
            return false;
        }

        // 3. Detect View-Once media structure
        const vOnceMedia = findViewOnceMedia(message);
        if (!vOnceMedia || !vOnceMedia.mediaContent) {
            return false;
        }

        // Add to processed cache immediately to prevent duplicate runs
        if (msgId !== 'unknown') {
            processedViewOnceIds.add(msgId);
            if (processedViewOnceIds.size > MAX_PROCESSED_IDS) {
                const first = processedViewOnceIds.values().next().value;
                processedViewOnceIds.delete(first);
            }
        }

        const { mediaContent, mediaType, mimeType, caption } = vOnceMedia;

        // 4. Decrypt and download media buffer directly
        let buffer;
        try {
            const stream = await downloadContentFromMessage(mediaContent, mediaType);
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            buffer = Buffer.concat(chunks);
        } catch (dlErr) {
            console.error('[ANTIVIEWONCE] Media decryption/download error:', dlErr.message);
            return false;
        }

        if (!buffer || buffer.length === 0) {
            console.warn('[ANTIVIEWONCE] Downloaded buffer is empty, aborting forwarding.');
            return false;
        }

        // 5. Resolve target recipient (owner/authorized receiver)
        const recipientJid = resolveOwnerRecipient(sock, chatId);
        if (!recipientJid) {
            console.error('[ANTIVIEWONCE] No recipient JID found to deliver intercepted media.');
            return false;
        }

        // 6. Format metadata caption
        const senderClean = cleanJid(senderId || message.key?.participant || chatId);
        const senderNum = senderClean ? senderClean.split('@')[0] : 'Unknown';
        const senderTag = `@${senderNum}`;

        const isGroup = chatId.endsWith('@g.us');
        let chatName = isGroup ? 'Group' : 'Private DM';
        if (isGroup && sock.groupMetadata) {
            try {
                const meta = await sock.groupMetadata(chatId);
                if (meta?.subject) chatName = meta.subject;
            } catch (_) {}
        }

        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', ' +
                        now.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

        let metaCaption = `╭─〔 👁️ *ANTI-VIEWONCE INTERCEPTED* 〕\n` +
                          `│ 👤 *Sender:* ${senderTag} (+${senderNum})\n` +
                          `│ 📍 *Source:* ${chatName}\n` +
                          `│ 🕒 *Time:* ${timeStr}\n` +
                          `│ 📦 *Type:* View-Once ${mediaType.toUpperCase()}\n`;
        if (caption) {
            metaCaption += `│ 📝 *Caption:* ${caption}\n`;
        }
        metaCaption += `╰────────────────────────\n` +
                       `⚡ *Captured silently by Zoxer Bot*`;

        const sendOptions = {
            mentions: senderClean ? [senderClean] : []
        };

        const dispatch = async (target) => {
            if (mediaType === 'image') {
                await sock.sendMessage(target, {
                    image: buffer,
                    caption: metaCaption,
                    ...sendOptions
                });
            } else if (mediaType === 'video') {
                await sock.sendMessage(target, {
                    video: buffer,
                    caption: metaCaption,
                    mimetype: mimeType || 'video/mp4',
                    ...sendOptions
                });
            } else if (mediaType === 'audio') {
                const isPtt = Boolean(mediaContent.ptt);
                await sock.sendMessage(target, {
                    audio: buffer,
                    mimetype: mimeType || 'audio/ogg; codecs=opus',
                    ptt: isPtt
                });
                await sock.sendMessage(target, {
                    text: metaCaption,
                    ...sendOptions
                });
            } else if (mediaType === 'document') {
                await sock.sendMessage(target, {
                    document: buffer,
                    mimetype: mimeType || 'application/octet-stream',
                    fileName: mediaContent.fileName || `viewonce_${Date.now()}`,
                    caption: metaCaption,
                    ...sendOptions
                });
            }
        };

        // 7. Stealth Dispatch - Send to recipient with fallback
        try {
            await dispatch(recipientJid);
            console.log(`[ANTIVIEWONCE] Intercepted View-Once ${mediaType} from ${senderNum} delivered to ${recipientJid}`);
        } catch (sendErr) {
            console.error(`[ANTIVIEWONCE] Dispatch failed to primary recipient (${recipientJid}):`, sendErr.message);
            const fallback = cleanJid(sock.user?.id || settings.ownerNumber);
            if (fallback && fallback !== recipientJid) {
                try {
                    await dispatch(fallback);
                    console.log(`[ANTIVIEWONCE] Fallback delivered to ${fallback}`);
                } catch (fbErr) {
                    console.error(`[ANTIVIEWONCE] Fallback dispatch failed to (${fallback}):`, fbErr.message);
                }
            }
        }

        return true;

    } catch (err) {
        console.error('[ANTIVIEWONCE] Unexpected handler error:', err.message);
        return false;
    }
}

module.exports = {
    antiviewonceCommand,
    handleViewOnceDetection,
    findViewOnceMedia,
    unwrapMessage,
    cleanJid,
    isChatEnabled,
    resolveOwnerRecipient,
    loadConfig,
    saveConfig,
    getConfig: () => avoConfig,
    setConfig: (newCfg) => {
        avoConfig = {
            dm: Boolean(newCfg.dm),
            allGroups: Boolean(newCfg.allGroups),
            recipient: newCfg.recipient || null,
            groups: newCfg.groups || {}
        };
        saveConfig();
    },
    resetProcessedIds: () => processedViewOnceIds.clear(),
    getProcessedIds: () => processedViewOnceIds
};

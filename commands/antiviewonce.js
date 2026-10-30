const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const settings = require('../settings');
const isOwnerOrSudo = require('../lib/isOwner');
const isAdmin = require('../lib/isAdmin');

const dataFilePath = path.join(__dirname, '../data/antiviewonce.json');

// In-memory config: { dm: boolean, allGroups: boolean, recipient: string, groups: { [groupId]: { enabled: boolean, recipient: string } } }
let avoConfig = { dm: false, allGroups: false, recipient: null, groups: {} };
const processedViewOnceIds = new Set();
const MAX_PROCESSED_IDS = 1000;

/**
 * Normalizes JIDs safely, preserving @lid, @g.us, and @newsletter identities.
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
 * Structured diagnostic logger for authorized testing.
 * Avoids logging sensitive message contents, auth credentials, or media keys.
 */
function logDiagnostic(data) {
    const timestamp = new Date().toISOString();
    const parts = [
        `[AVO-DIAG ${timestamp}]`,
        `event: ${data.event || 'message'}`,
        `chatType: ${data.chatType || 'unknown'}`,
        `msgType: ${data.messageType || 'none'}`,
        `wrappers: ${data.wrappers || 'none'}`,
        `detection: ${data.detectionResult || 'none'}`,
        `config: ${data.configStatus || 'unknown'}`
    ];
    if (data.details) parts.push(`details: ${data.details}`);
    if (data.error) parts.push(`error: ${data.error}`);
    console.log(parts.join(' | '));
}

/**
 * Recursively unwraps message containers up to a safe maximum depth.
 * Tracks all wrapper layers encountered (e.g. ephemeralMessage, viewOnceMessageV2, deviceSentMessage).
 */
function unwrapMessage(message) {
    if (!message) return { content: null, wrappers: [] };

    let current = message.message || message;
    const wrappers = [];
    const maxDepth = 10;
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
 * Inspects a message for any media type (View-Once or normal media).
 * Used by diagnostic logging and authorized testing workflows.
 */
function inspectMediaMessage(message) {
    if (!message) return null;

    const vOnce = findViewOnceMedia(message);
    if (vOnce) return vOnce;

    const { content, wrappers } = unwrapMessage(message);
    if (!content || typeof content !== 'object') return null;

    let mediaContent = null;
    let mediaType = null;
    let mimeType = null;
    let caption = '';

    if (content.imageMessage) {
        mediaContent = content.imageMessage;
        mediaType = 'image';
        mimeType = content.imageMessage.mimetype || 'image/jpeg';
        caption = content.imageMessage.caption || '';
    } else if (content.videoMessage) {
        mediaContent = content.videoMessage;
        mediaType = 'video';
        mimeType = content.videoMessage.mimetype || 'video/mp4';
        caption = content.videoMessage.caption || '';
    } else if (content.audioMessage) {
        mediaContent = content.audioMessage;
        mediaType = 'audio';
        mimeType = content.audioMessage.mimetype || 'audio/ogg; codecs=opus';
    } else if (content.documentMessage) {
        mediaContent = content.documentMessage;
        mediaType = 'document';
        mimeType = content.documentMessage.mimetype || 'application/octet-stream';
        caption = content.documentMessage.caption || content.documentMessage.fileName || '';
    }

    if (!mediaContent) return null;

    return {
        mediaContent,
        mediaType,
        mimeType,
        caption,
        isViewOnce: false,
        wrapperStructure: wrappers.length > 0 ? wrappers.join(' -> ') : 'normal'
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
                  `┃  ◈ *MODE:* 🛡️ Privacy-Safe Detection & Alert\n` +
                  `┃\n` +
                  `╰─ Anti-ViewOnce is active. When ephemeral media is detected, alerts are generated while respecting WhatsApp View-Once privacy protections.`,
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
                  `╰─ Anti-ViewOnce detection has been turned off.`
        }, { quoted: message });

    } else {
        const isCurrentActive = isChatEnabled(chatId);
        const activeGroupCount = Object.values(avoConfig.groups).filter(g => g === true || g?.enabled === true).length;

        return await sock.sendMessage(chatId, {
            text: `╭─ *👁️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗩𝗜𝗘𝗪𝗢𝗡𝗖𝗘*\n` +
                  `┃\n` +
                  `┃  ◈ *This Chat:* ${isCurrentActive ? '✅ Active' : '❌ Inactive'}\n` +
                  `┃  ◈ *Private DMs:* ${avoConfig.dm ? '✅ Enabled' : '❌ Disabled'}\n` +
                  `┃  ◈ *All Groups:* ${avoConfig.allGroups ? '✅ Enabled' : '❌ Disabled'}\n` +
                  `┃  ◈ *Configured Groups:* ${activeGroupCount}\n` +
                  `┃  ◈ *Recipient:* ${avoConfig.recipient ? '@' + avoConfig.recipient.split('@')[0] : 'Not Set'}\n` +
                  `┃  ◈ *Privacy Mode:* 🛡️ Compliant\n` +
                  `┃\n` +
                  `┃  *Options:*\n` +
                  `┃  • \`.antiviewonce on\` (Enable for this chat)\n` +
                  `┃  • \`.antiviewonce off\` (Disable for this chat)\n` +
                  `┃  • \`.antiviewonce all on\` (Enable for ALL DMs & Groups)\n` +
                  `┃  • \`.antiviewonce all off\` (Disable globally)\n` +
                  `╰─────────────────────────`,
            mentions: avoConfig.recipient ? [avoConfig.recipient] : []
        }, { quoted: message });
    }
}

/**
 * Background detector: called on incoming messages.
 * Respects WhatsApp View-Once privacy controls.
 * Does not bypass restrictions or secretly extract/forward unauthorized ephemeral media.
 * Provides structured diagnostic logging and authorized test workflow support.
 */
async function handleViewOnceDetection(sock, chatId, message, senderId, options = {}) {
    try {
        if (!chatId || !message) {
            return false;
        }

        const isGroup = chatId.endsWith('@g.us');
        const chatType = isGroup ? 'group' : 'dm';
        const msgId = message.key?.id || 'unknown';

        // 1. Check configuration
        const isEnabled = isChatEnabled(chatId);
        const configStatus = isEnabled ? `enabled (${chatType})` : `disabled (${chatType})`;

        // 2. Inspect message structure
        const inspection = inspectMediaMessage(message);
        const isViewOnce = Boolean(findViewOnceMedia(message));
        const messageType = inspection?.mediaType || (message.message ? Object.keys(message.message)[0] : 'unknown');
        const wrappers = inspection?.wrapperStructure || 'none';

        // 3. Deduplication: only ignore if this exact message was already processed
        if (msgId !== 'unknown' && processedViewOnceIds.has(msgId)) {
            logDiagnostic({
                event: 'duplicate_event',
                chatType,
                messageType,
                wrappers,
                detectionResult: isViewOnce ? 'view_once_duplicate' : 'duplicate_ignored',
                configStatus,
                details: `msgId: ${msgId} already processed`
            });
            return false;
        }

        // If feature is disabled for this chat
        if (!isEnabled) {
            logDiagnostic({
                event: 'message_received',
                chatType,
                messageType,
                wrappers,
                detectionResult: isViewOnce ? 'view_once_skipped_disabled' : 'ignored_not_enabled',
                configStatus
            });
            return false;
        }

        // If not a View-Once message
        if (!isViewOnce) {
            // Check if this is an authorized test workflow for normal media
            if (options.isAuthorizedTest && inspection) {
                if (msgId !== 'unknown') {
                    processedViewOnceIds.add(msgId);
                }

                logDiagnostic({
                    event: 'authorized_test_received',
                    chatType,
                    messageType,
                    wrappers,
                    detectionResult: 'normal_media_test_success',
                    configStatus,
                    details: 'Authorized test workflow with normal media completed'
                });

                // In authorized test workflow, if download testing is requested
                if (options.downloadTest && inspection.mediaContent) {
                    try {
                        const stream = await downloadContentFromMessage(inspection.mediaContent, inspection.mediaType);
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) {
                            buffer = Buffer.concat([buffer, chunk]);
                        }
                        logDiagnostic({
                            event: 'authorized_download_test',
                            chatType,
                            messageType,
                            wrappers,
                            detectionResult: 'download_success',
                            configStatus,
                            details: `Downloaded ${buffer.length} bytes in authorized test workflow`
                        });
                        return { success: true, test: true, mediaType: inspection.mediaType, bufferLength: buffer.length };
                    } catch (dlErr) {
                        logDiagnostic({
                            event: 'authorized_download_test',
                            chatType,
                            messageType,
                            wrappers,
                            detectionResult: 'download_failed',
                            configStatus,
                            error: dlErr.message
                        });
                        return { success: false, test: true, error: dlErr.message };
                    }
                }

                return { success: true, test: true, mediaType: inspection.mediaType };
            }

            logDiagnostic({
                event: 'message_received',
                chatType,
                messageType,
                wrappers,
                detectionResult: 'not_view_once',
                configStatus
            });
            return false;
        }

        // Target View-Once detected: add to processed cache to prevent re-processing
        if (msgId !== 'unknown') {
            processedViewOnceIds.add(msgId);
            if (processedViewOnceIds.size > MAX_PROCESSED_IDS) {
                const first = processedViewOnceIds.values().next().value;
                processedViewOnceIds.delete(first);
            }
        }

        logDiagnostic({
            event: 'view_once_detected',
            chatType,
            messageType,
            wrappers,
            detectionResult: 'detected_view_once',
            configStatus,
            details: `Detected View-Once ${messageType} from ${senderId ? cleanJid(senderId) : 'unknown'}`
        });

        // 4. Privacy-Safe Media Handling (Requirement 5)
        // Respect WhatsApp View-Once privacy controls:
        // Do not bypass restrictions or secretly extract/forward another person's ephemeral media.
        // Where View-Once media is encountered, handle it without secretly copying or redistributing contents.
        logDiagnostic({
            event: 'privacy_enforced',
            chatType,
            messageType,
            wrappers,
            detectionResult: 'privacy_safe_handled',
            configStatus,
            details: 'View-Once privacy controls respected; ephemeral media contents preserved without redistribution.'
        });

        // Safely notify configured recipient of the detection event without distributing ephemeral media
        const recipientJid = (isGroup && avoConfig.groups?.[chatId]?.recipient) || avoConfig.recipient;
        if (recipientJid && sock?.sendMessage) {
            try {
                const cleanRecipient = cleanJid(recipientJid);
                const senderClean = cleanJid(senderId || message.key?.participant || chatId);
                const senderTag = senderClean ? `@${senderClean.split('@')[0]}` : 'Unknown';
                const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                let chatName = isGroup ? 'Group' : 'Private Chat';
                if (isGroup && sock.groupMetadata) {
                    try {
                        const meta = await sock.groupMetadata(chatId);
                        if (meta?.subject) chatName = meta.subject;
                    } catch (_) {}
                }

                await sock.sendMessage(cleanRecipient, {
                    text: `🛡️ *ZOXER PRIVACY-SAFE ANTI-VIEWONCE*\n\n` +
                          `📍 *Source:* ${chatName}\n` +
                          `👤 *Sender:* ${senderTag}\n` +
                          `🕒 *Time:* ${timeStr}\n` +
                          `📦 *Type:* View-Once ${messageType.toUpperCase()}\n\n` +
                          `🔒 _Privacy protection active: WhatsApp View-Once ephemeral media controls are respected. Content is not redistributed._`,
                    mentions: senderClean ? [senderClean] : []
                });
            } catch (notifyErr) {
                logDiagnostic({
                    event: 'notification_error',
                    chatType,
                    messageType,
                    wrappers,
                    detectionResult: 'notification_failed',
                    configStatus,
                    error: notifyErr.message
                });
            }
        }

        return true;

    } catch (err) {
        logDiagnostic({
            event: 'handler_error',
            chatType: chatId?.endsWith('@g.us') ? 'group' : 'dm',
            messageType: 'unknown',
            wrappers: 'unknown',
            detectionResult: 'error',
            configStatus: 'unknown',
            error: err.message
        });
        return false;
    }
}

module.exports = {
    antiviewonceCommand,
    handleViewOnceDetection,
    findViewOnceMedia,
    unwrapMessage,
    inspectMediaMessage,
    logDiagnostic,
    cleanJid,
    isChatEnabled,
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

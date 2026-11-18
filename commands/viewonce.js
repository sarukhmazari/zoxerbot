const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const settings = require('../settings');
const fs = require('fs');
const path = require('path');

// Per-user VV mode storage (public vs private)
const vvMode = new Map();
const modePath = path.join(__dirname, '../data/vvMode.json');

// In-Memory ViewOnce Cache for 100% reliable extraction
// Even if WhatsApp strips media keys in quote contexts, this cache preserves the original media!
const viewOnceCache = new Map();
const MAX_CACHE_SIZE = 1000;

// Load persisted modes on startup
function loadVVMode() {
    try {
        if (fs.existsSync(modePath)) {
            const data = JSON.parse(fs.readFileSync(modePath, 'utf-8'));
            for (const [user, mode] of Object.entries(data)) {
                vvMode.set(user, mode);
            }
        }
    } catch (e) {
        console.error('Failed to load VV modes:', e.message);
    }
}

// Save modes to file
function saveVVMode() {
    try {
        const dir = path.dirname(modePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const data = {};
        for (const [user, mode] of vvMode) {
            data[user] = mode;
        }
        fs.writeFileSync(modePath, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Failed to save VV modes:', e.message);
    }
}

loadVVMode();

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
 * Checks if a string represents any variant of red heart emoji (❤️, ❤, ♥️, ♥)
 */
function isHeartCommand(text) {
    if (!text || typeof text !== 'string') return false;
    const clean = text.trim();
    return clean === '❤️' || clean === '❤' || clean === '♥️' || clean === '♥' || /^[\u2764\u2665\uFE0F\s]+$/u.test(clean);
}

/**
 * Recursively unwraps Baileys message wrappers
 */
function unwrapMessage(msg) {
    if (!msg) return null;
    let current = msg.message || msg;
    const maxDepth = 15;
    let depth = 0;

    while (current && typeof current === 'object' && depth < maxDepth) {
        depth++;
        if (current.ephemeralMessage?.message) {
            current = current.ephemeralMessage.message;
        } else if (current.viewOnceMessage?.message) {
            current = current.viewOnceMessage.message;
        } else if (current.viewOnceMessageV2?.message) {
            current = current.viewOnceMessageV2.message;
        } else if (current.viewOnceMessageV2Extension?.message) {
            current = current.viewOnceMessageV2Extension.message;
        } else if (current.documentWithCaptionMessage?.message) {
            current = current.documentWithCaptionMessage.message;
        } else if (current.editedMessage?.message) {
            const inner = current.editedMessage.message;
            current = inner?.protocolMessage?.editedMessage || inner;
        } else if (current.deviceSentMessage?.message) {
            current = current.deviceSentMessage.message;
        } else if (current.botInvokeMessage?.message) {
            current = current.botInvokeMessage.message;
        } else if (current.associatedChildMessage?.message) {
            current = current.associatedChildMessage.message;
        } else if (current.groupStatusMessage?.message) {
            current = current.groupStatusMessage.message;
        } else if (current.groupStatusMessageV2?.message) {
            current = current.groupStatusMessageV2.message;
        } else if (
            current.message &&
            typeof current.message === 'object' &&
            !current.imageMessage &&
            !current.videoMessage &&
            !current.audioMessage &&
            !current.documentMessage &&
            !current.ptvMessage
        ) {
            current = current.message;
        } else {
            break;
        }
    }

    return current;
}

/**
 * Extracts contextInfo from message regardless of wrapper layers
 */
function getContextInfo(message) {
    if (!message) return null;
    let current = message.message || message;
    let depth = 0;

    while (current && typeof current === 'object' && depth < 10) {
        depth++;
        if (current.extendedTextMessage?.contextInfo) return current.extendedTextMessage.contextInfo;
        if (current.imageMessage?.contextInfo) return current.imageMessage.contextInfo;
        if (current.videoMessage?.contextInfo) return current.videoMessage.contextInfo;
        if (current.audioMessage?.contextInfo) return current.audioMessage.contextInfo;
        if (current.documentMessage?.contextInfo) return current.documentMessage.contextInfo;
        if (current.buttonsResponseMessage?.contextInfo) return current.buttonsResponseMessage.contextInfo;
        if (current.templateButtonReplyMessage?.contextInfo) return current.templateButtonReplyMessage.contextInfo;
        if (current.interactiveResponseMessage?.contextInfo) return current.interactiveResponseMessage.contextInfo;
        if (current.contextInfo) return current.contextInfo;

        if (current.ephemeralMessage?.message) {
            current = current.ephemeralMessage.message;
        } else if (current.documentWithCaptionMessage?.message) {
            current = current.documentWithCaptionMessage.message;
        } else if (current.viewOnceMessage?.message) {
            current = current.viewOnceMessage.message;
        } else if (current.viewOnceMessageV2?.message) {
            current = current.viewOnceMessageV2.message;
        } else if (current.viewOnceMessageV2Extension?.message) {
            current = current.viewOnceMessageV2Extension.message;
        } else if (current.message) {
            current = current.message;
        } else {
            break;
        }
    }

    return null;
}

/**
 * Caches incoming view-once messages to ensure 100% extractability
 */
function cacheViewOnceMessage(message) {
    try {
        if (!message || !message.key?.id) return;
        const msgId = message.key.id;

        const unwrapped = unwrapMessage(message);
        if (!unwrapped || typeof unwrapped !== 'object') return;

        let mediaContent = null;
        let mediaType = null;
        let mimeType = null;
        let caption = '';
        let isPtt = false;

        if (unwrapped.imageMessage) {
            mediaContent = unwrapped.imageMessage;
            mediaType = 'image';
            mimeType = unwrapped.imageMessage.mimetype || 'image/jpeg';
            caption = unwrapped.imageMessage.caption || '';
        } else if (unwrapped.videoMessage) {
            mediaContent = unwrapped.videoMessage;
            mediaType = 'video';
            mimeType = unwrapped.videoMessage.mimetype || 'video/mp4';
            caption = unwrapped.videoMessage.caption || '';
        } else if (unwrapped.ptvMessage) {
            mediaContent = unwrapped.ptvMessage;
            mediaType = 'video';
            mimeType = unwrapped.ptvMessage.mimetype || 'video/mp4';
            caption = unwrapped.ptvMessage.caption || '';
        } else if (unwrapped.audioMessage) {
            mediaContent = unwrapped.audioMessage;
            mediaType = 'audio';
            mimeType = unwrapped.audioMessage.mimetype || 'audio/ogg; codecs=opus';
            caption = '';
            isPtt = Boolean(unwrapped.audioMessage.ptt);
        } else if (unwrapped.documentMessage) {
            mediaContent = unwrapped.documentMessage;
            mediaType = 'document';
            mimeType = unwrapped.documentMessage.mimetype || 'application/octet-stream';
            caption = unwrapped.documentMessage.caption || unwrapped.documentMessage.fileName || '';
        }

        if (mediaContent && (mediaContent.mediaKey || mediaContent.url || mediaContent.directPath)) {
            viewOnceCache.set(msgId, {
                rawMessage: message,
                mediaContent,
                mediaType,
                mimeType,
                caption,
                isPtt,
                timestamp: Date.now()
            });

            if (viewOnceCache.size > MAX_CACHE_SIZE) {
                const oldestKey = viewOnceCache.keys().next().value;
                viewOnceCache.delete(oldestKey);
            }
        }
    } catch (_) {}
}

/**
 * Downloads media content stream and converts into Buffer
 */
async function downloadMediaBuffer(mediaContent, mediaType) {
    if (!mediaContent) return null;
    try {
        const stream = await downloadContentFromMessage(mediaContent, mediaType);
        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        return buffer.length > 0 ? buffer : null;
    } catch (err) {
        console.error(`[VIEWONCE] Decryption error for ${mediaType}:`, err.message);
        return null;
    }
}

/**
 * REUSABLE: Extract view-once media and return buffer
 * Used by .vv command and the secret red heart (❤️) command
 * Returns: { mediaContent, mediaType, mimeType, caption, buffer, isPtt } or null
 */
async function extractViewOnceMedia(message) {
    try {
        if (!message) return null;

        const ctx = getContextInfo(message);
        const quotedRaw = ctx?.quotedMessage;
        const quotedStanzaId = ctx?.stanzaId;

        let mediaContent = null;
        let mediaType = null;
        let mimeType = null;
        let caption = '';
        let isPtt = false;
        let buffer = null;

        // 1. FIRST PRIORITY: Check in-memory ViewOnce cache using quotedStanzaId
        if (quotedStanzaId && viewOnceCache.has(quotedStanzaId)) {
            const cached = viewOnceCache.get(quotedStanzaId);
            if (cached && cached.mediaContent) {
                mediaContent = cached.mediaContent;
                mediaType = cached.mediaType;
                mimeType = cached.mimeType;
                caption = cached.caption;
                isPtt = cached.isPtt;

                buffer = await downloadMediaBuffer(mediaContent, mediaType);
                if (buffer) {
                    return { mediaContent, mediaType, mimeType, caption, buffer, isPtt };
                }
            }
        }

        // 2. SECOND PRIORITY: Extract from quoted message object
        if (quotedRaw) {
            const unwrappedQuoted = unwrapMessage(quotedRaw);
            if (unwrappedQuoted && typeof unwrappedQuoted === 'object') {
                if (unwrappedQuoted.imageMessage) {
                    mediaContent = unwrappedQuoted.imageMessage;
                    mediaType = 'image';
                    mimeType = unwrappedQuoted.imageMessage.mimetype || 'image/jpeg';
                    caption = unwrappedQuoted.imageMessage.caption || '';
                } else if (unwrappedQuoted.videoMessage) {
                    mediaContent = unwrappedQuoted.videoMessage;
                    mediaType = 'video';
                    mimeType = unwrappedQuoted.videoMessage.mimetype || 'video/mp4';
                    caption = unwrappedQuoted.videoMessage.caption || '';
                } else if (unwrappedQuoted.ptvMessage) {
                    mediaContent = unwrappedQuoted.ptvMessage;
                    mediaType = 'video';
                    mimeType = unwrappedQuoted.ptvMessage.mimetype || 'video/mp4';
                    caption = unwrappedQuoted.ptvMessage.caption || '';
                } else if (unwrappedQuoted.audioMessage) {
                    mediaContent = unwrappedQuoted.audioMessage;
                    mediaType = 'audio';
                    mimeType = unwrappedQuoted.audioMessage.mimetype || 'audio/ogg; codecs=opus';
                    caption = '';
                    isPtt = Boolean(unwrappedQuoted.audioMessage.ptt);
                } else if (unwrappedQuoted.documentMessage) {
                    mediaContent = unwrappedQuoted.documentMessage;
                    mediaType = 'document';
                    mimeType = unwrappedQuoted.documentMessage.mimetype || 'application/octet-stream';
                    caption = unwrappedQuoted.documentMessage.caption || unwrappedQuoted.documentMessage.fileName || '';
                }

                if (mediaContent) {
                    buffer = await downloadMediaBuffer(mediaContent, mediaType);
                    if (buffer) {
                        return { mediaContent, mediaType, mimeType, caption, buffer, isPtt };
                    }
                }
            }
        }

        // 3. THIRD PRIORITY: If message itself is a view-once media message
        const unwrappedSelf = unwrapMessage(message);
        if (unwrappedSelf && typeof unwrappedSelf === 'object') {
            if (unwrappedSelf.imageMessage) {
                mediaContent = unwrappedSelf.imageMessage;
                mediaType = 'image';
                mimeType = unwrappedSelf.imageMessage.mimetype || 'image/jpeg';
                caption = unwrappedSelf.imageMessage.caption || '';
            } else if (unwrappedSelf.videoMessage) {
                mediaContent = unwrappedSelf.videoMessage;
                mediaType = 'video';
                mimeType = unwrappedSelf.videoMessage.mimetype || 'video/mp4';
                caption = unwrappedSelf.videoMessage.caption || '';
            } else if (unwrappedSelf.ptvMessage) {
                mediaContent = unwrappedSelf.ptvMessage;
                mediaType = 'video';
                mimeType = unwrappedSelf.ptvMessage.mimetype || 'video/mp4';
                caption = unwrappedSelf.ptvMessage.caption || '';
            } else if (unwrappedSelf.audioMessage) {
                mediaContent = unwrappedSelf.audioMessage;
                mediaType = 'audio';
                mimeType = unwrappedSelf.audioMessage.mimetype || 'audio/ogg; codecs=opus';
                caption = '';
                isPtt = Boolean(unwrappedSelf.audioMessage.ptt);
            }

            if (mediaContent) {
                buffer = await downloadMediaBuffer(mediaContent, mediaType);
                if (buffer) {
                    return { mediaContent, mediaType, mimeType, caption, buffer, isPtt };
                }
            }
        }

        return null;
    } catch (error) {
        console.error('❌ Extract view-once error:', error.message || error);
        return null;
    }
}

/**
 * .vv command - Per-User Mode System
 * .vv private / .vv public -> Change Mode for the user
 * .vv -> Extract and Send based on user's Mode
 */
async function viewonceCommand(sock, chatId, message) {
    try {
        const rawSender = message.key.participant || message.key.remoteJid;
        const userJid = cleanJid(rawSender);
        if (!userJid) {
            console.error('No valid userJid found for VV command');
            return await sock.sendMessage(chatId, { text: '❌ Unable to identify user.' }, { quoted: message });
        }

        // Safely extract text across normal & disappearing/ephemeral messages
        const unwrapped = unwrapMessage(message);
        const text = (
            unwrapped?.conversation ||
            unwrapped?.extendedTextMessage?.text ||
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            ''
        ).trim().toLowerCase();

        const args = text.split(/\s+/);
        const subCommand = args[1];

        // 1. Handle Mode Configuration (Per User)
        if (subCommand === 'private' || subCommand === 'public') {
            const newMode = subCommand;
            vvMode.set(userJid, newMode);
            saveVVMode();

            const responseText = newMode === 'private' ?
                '🔒 *VV mode set to PRIVATE for you only.*\nFuture `.vv` extractions will be sent directly to your private chat.' :
                '🌐 *VV mode set to PUBLIC for you only.*\nFuture `.vv` extractions will be sent in the chat where you use the command.';

            return await sock.sendMessage(chatId, { text: responseText }, { quoted: message });
        }

        // 2. Extract media
        const extracted = await extractViewOnceMedia(message);
        if (!extracted) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Please reply to a view-once photo, video, or audio message!*\n\n💡 *Tip:* Reply with `.vv` or the secret `❤️` command.'
            }, { quoted: message });
        }

        const { mediaType, mimeType, caption, buffer, isPtt } = extracted;
        const mode = vvMode.get(userJid) || 'public';

        // 3. Private Mode - Send to user's private chat
        if (mode === 'private') {
            try {
                if (mediaType === 'image') {
                    await sock.sendMessage(userJid, { image: buffer, caption: caption ? `📝 *Caption:* ${caption}` : '👁️ *View-Once Photo*' });
                } else if (mediaType === 'video') {
                    await sock.sendMessage(userJid, { video: buffer, caption: caption ? `📝 *Caption:* ${caption}` : '👁️ *View-Once Video*' });
                } else if (mediaType === 'audio') {
                    await sock.sendMessage(userJid, { audio: buffer, mimetype: mimeType, ptt: Boolean(isPtt) });
                    if (caption) await sock.sendMessage(userJid, { text: `📝 *Caption:* ${caption}` });
                } else if (mediaType === 'document') {
                    await sock.sendMessage(userJid, { document: buffer, mimetype: mimeType, fileName: 'viewonce_file' });
                }

                // Friendly confirmation in the calling chat
                if (chatId !== userJid) {
                    await sock.sendMessage(chatId, { text: '✅ *View-once media has been sent secretly to your DM!*' }, { quoted: message });
                }
                return;

            } catch (e) {
                console.error('❌ Private send failed for', userJid, ':', e.message);
                return await sock.sendMessage(chatId, { text: '❌ Failed to send media to your private chat. Make sure you have messaged the bot first.' }, { quoted: message });
            }
        }

        // 4. Public Mode - Send in same chat
        const options = { quoted: message };
        if (mediaType === 'image') {
            await sock.sendMessage(chatId, { image: buffer, caption: caption || '' }, options);
        } else if (mediaType === 'video') {
            await sock.sendMessage(chatId, { video: buffer, caption: caption || '' }, options);
        } else if (mediaType === 'audio') {
            await sock.sendMessage(chatId, { audio: buffer, mimetype: mimeType, ptt: Boolean(isPtt) }, options);
            if (caption) await sock.sendMessage(chatId, { text: caption }, options);
        } else if (mediaType === 'document') {
            await sock.sendMessage(chatId, { document: buffer, mimetype: mimeType, fileName: 'viewonce_file' }, options);
        }

    } catch (error) {
        console.error('❌ Fatal error in VV command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to extract view-once media.' }, { quoted: message });
    }
}

module.exports = viewonceCommand;
module.exports.viewonceCommand = viewonceCommand;
module.exports.extractViewOnceMedia = extractViewOnceMedia;
module.exports.cacheViewOnceMessage = cacheViewOnceMessage;
module.exports.viewOnceCache = viewOnceCache;
module.exports.isHeartCommand = isHeartCommand;
module.exports.cleanJid = cleanJid;
module.exports.unwrapMessage = unwrapMessage;
module.exports.getContextInfo = getContextInfo;

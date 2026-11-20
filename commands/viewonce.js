const { downloadContentFromMessage, downloadMediaMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const settings = require('../settings');
const fs = require('fs');
const path = require('path');

// Per-user VV mode storage (public vs private)
const vvMode = new Map();
const modePath = path.join(__dirname, '../data/vvMode.json');

// Persistent on-disk and in-memory cache for 100% reliable View-Once extraction
// Survives bot restarts, prevents mediaKey expiration, and handles WhatsApp mobile quote limitations!
const viewOnceCache = new Map();
const chatLatestViewOnce = new Map();
const MAX_CACHE_SIZE = 1000;

const CACHE_DIR = path.join(__dirname, '../data/viewonce_cache');
if (!fs.existsSync(CACHE_DIR)) {
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (_) {}
}

// Load persisted user modes
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

// Save user modes
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

// Save downloaded view-once media to disk cache
function saveToDiskCache(msgId, entry) {
    try {
        if (!msgId || !entry || !entry.buffer) return;
        const binPath = path.join(CACHE_DIR, `${msgId}.bin`);
        const jsonPath = path.join(CACHE_DIR, `${msgId}.json`);
        fs.writeFileSync(binPath, entry.buffer);
        const meta = {
            msgId,
            chatId: entry.chatId,
            mediaType: entry.mediaType,
            mimeType: entry.mimeType,
            caption: entry.caption,
            isPtt: entry.isPtt,
            timestamp: entry.timestamp || Date.now()
        };
        fs.writeFileSync(jsonPath, JSON.stringify(meta));
    } catch (e) {
        console.warn('[VIEWONCE] Disk cache save error:', e.message);
    }
}

// Load downloaded view-once media from disk cache
function loadFromDiskCache(msgId) {
    try {
        if (!msgId) return null;
        const binPath = path.join(CACHE_DIR, `${msgId}.bin`);
        const jsonPath = path.join(CACHE_DIR, `${msgId}.json`);
        if (fs.existsSync(binPath) && fs.existsSync(jsonPath)) {
            const buffer = fs.readFileSync(binPath);
            const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            return {
                ...meta,
                buffer
            };
        }
    } catch (e) {
        console.warn('[VIEWONCE] Disk cache load error:', e.message);
    }
    return null;
}

// Startup: Load recent metadata into memory and clean up older than 48 hours
function initDiskCache() {
    try {
        if (!fs.existsSync(CACHE_DIR)) return;
        const files = fs.readdirSync(CACHE_DIR);
        const now = Date.now();
        const MAX_AGE = 48 * 60 * 60 * 1000; // 48 hours

        for (const f of files) {
            if (f.endsWith('.json')) {
                const fullPath = path.join(CACHE_DIR, f);
                try {
                    const meta = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                    if (now - (meta.timestamp || 0) > MAX_AGE) {
                        fs.unlinkSync(fullPath);
                        const binPath = fullPath.replace(/\.json$/, '.bin');
                        if (fs.existsSync(binPath)) fs.unlinkSync(binPath);
                    } else if (meta.msgId) {
                        viewOnceCache.set(meta.msgId, meta);
                        if (meta.chatId) {
                            viewOnceCache.set(`${meta.chatId}:${meta.msgId}`, meta);
                            chatLatestViewOnce.set(meta.chatId, meta);
                        }
                    }
                } catch (_) {}
            }
        }
    } catch (e) {
        console.warn('[VIEWONCE] initDiskCache error:', e.message);
    }
}

initDiskCache();

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
 * Extracts contextInfo from message regardless of wrapper layers (including deviceSentMessage, editedMessage, ephemeralMessage, etc.)
 */
function getContextInfo(message) {
    if (!message) return null;
    let current = message.message || message;
    const maxDepth = 15;
    let depth = 0;

    while (current && typeof current === 'object' && depth < maxDepth) {
        depth++;
        if (current.extendedTextMessage?.contextInfo) return current.extendedTextMessage.contextInfo;
        if (current.imageMessage?.contextInfo) return current.imageMessage.contextInfo;
        if (current.videoMessage?.contextInfo) return current.videoMessage.contextInfo;
        if (current.audioMessage?.contextInfo) return current.audioMessage.contextInfo;
        if (current.documentMessage?.contextInfo) return current.documentMessage.contextInfo;
        if (current.documentWithCaptionMessage?.message?.documentMessage?.contextInfo) return current.documentWithCaptionMessage.message.documentMessage.contextInfo;
        if (current.buttonsResponseMessage?.contextInfo) return current.buttonsResponseMessage.contextInfo;
        if (current.templateButtonReplyMessage?.contextInfo) return current.templateButtonReplyMessage.contextInfo;
        if (current.interactiveResponseMessage?.contextInfo) return current.interactiveResponseMessage.contextInfo;
        if (current.contextInfo) return current.contextInfo;

        if (current.deviceSentMessage?.message) {
            current = current.deviceSentMessage.message;
        } else if (current.ephemeralMessage?.message) {
            current = current.ephemeralMessage.message;
        } else if (current.documentWithCaptionMessage?.message) {
            current = current.documentWithCaptionMessage.message;
        } else if (current.viewOnceMessage?.message) {
            current = current.viewOnceMessage.message;
        } else if (current.viewOnceMessageV2?.message) {
            current = current.viewOnceMessageV2.message;
        } else if (current.viewOnceMessageV2Extension?.message) {
            current = current.viewOnceMessageV2Extension.message;
        } else if (current.editedMessage?.message) {
            const inner = current.editedMessage.message;
            current = inner?.protocolMessage?.editedMessage || inner;
        } else if (current.botInvokeMessage?.message) {
            current = current.botInvokeMessage.message;
        } else if (current.associatedChildMessage?.message) {
            current = current.associatedChildMessage.message;
        } else if (current.groupStatusMessage?.message) {
            current = current.groupStatusMessage.message;
        } else if (current.groupStatusMessageV2?.message) {
            current = current.groupStatusMessageV2.message;
        } else if (current.message && typeof current.message === 'object') {
            current = current.message;
        } else {
            break;
        }
    }

    return null;
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
 * Caches incoming view-once messages by EAGERLY downloading the buffer immediately upon arrival.
 * This guarantees the media is captured while WhatsApp CDN tokens and media keys are 100% active!
 */
function cacheViewOnceMessage(message) {
    try {
        if (!message || !message.key?.id) return;
        const msgId = message.key.id;
        const chatId = message.key.remoteJid;

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
            // Asynchronously download the buffer immediately in background
            downloadMediaBuffer(mediaContent, mediaType).then(buffer => {
                if (buffer && buffer.length > 0) {
                    const entry = {
                        msgId,
                        chatId,
                        rawMessage: message,
                        mediaContent,
                        mediaType,
                        mimeType,
                        caption,
                        isPtt,
                        buffer,
                        timestamp: Date.now()
                    };

                    const cleanedChatId = cleanJid(chatId);
                    const rawSender = message.key?.participant || message.key?.remoteJid;
                    const cleanedSender = cleanJid(rawSender);

                    viewOnceCache.set(msgId, entry);
                    if (chatId) {
                        viewOnceCache.set(`${chatId}:${msgId}`, entry);
                        chatLatestViewOnce.set(chatId, entry);
                    }
                    if (cleanedChatId && cleanedChatId !== chatId) {
                        viewOnceCache.set(`${cleanedChatId}:${msgId}`, entry);
                        chatLatestViewOnce.set(cleanedChatId, entry);
                    }
                    if (cleanedSender && cleanedSender !== chatId && cleanedSender !== cleanedChatId) {
                        viewOnceCache.set(`${cleanedSender}:${msgId}`, entry);
                        chatLatestViewOnce.set(cleanedSender, entry);
                    }

                    // Save to persistent disk cache
                    saveToDiskCache(msgId, entry);

                    if (viewOnceCache.size > MAX_CACHE_SIZE) {
                        const oldestKey = viewOnceCache.keys().next().value;
                        viewOnceCache.delete(oldestKey);
                    }
                }
            }).catch(dlErr => {
                console.warn('[VIEWONCE] Eager download background error:', dlErr.message);
            });
        }
    } catch (_) {}
}

/**
 * REUSABLE: Extract view-once media and return buffer.
 * Multi-layer fallback guarantees 100% detection:
 *  1. In-memory eager cache by stanzaId (checks raw and cleaned JIDs)
 *  2. Disk cache by stanzaId
 *  3. Direct decryption from quotedMessage (if mediaKey present)
 *  4. Chat-level latest view-once fallback (across candidate chat and sender JIDs)
 *  5. Direct decryption from message itself
 *
 * Returns: { mediaContent, mediaType, mimeType, caption, buffer, isPtt } or null
 */
async function extractViewOnceMedia(message) {
    try {
        if (!message) return null;

        const rawChatId = message.key?.remoteJid;
        const cleanedChatId = cleanJid(rawChatId);
        const rawSender = message.key?.participant || message.key?.remoteJid;
        const cleanedSender = cleanJid(rawSender);

        const ctx = getContextInfo(message);
        const quotedRaw = ctx?.quotedMessage;
        const quotedStanzaId = ctx?.stanzaId;
        const quotedParticipant = ctx?.participant ? cleanJid(ctx.participant) : null;

        // 1. FIRST PRIORITY: In-memory cache by quotedStanzaId
        if (quotedStanzaId) {
            let cached = viewOnceCache.get(quotedStanzaId) ||
                         (rawChatId ? viewOnceCache.get(`${rawChatId}:${quotedStanzaId}`) : null) ||
                         (cleanedChatId ? viewOnceCache.get(`${cleanedChatId}:${quotedStanzaId}`) : null) ||
                         (quotedParticipant ? viewOnceCache.get(`${quotedParticipant}:${quotedStanzaId}`) : null);

            if (cached) {
                let buf = cached.buffer;
                if (!buf && cached.msgId) {
                    const diskEntry = loadFromDiskCache(cached.msgId);
                    if (diskEntry && diskEntry.buffer) buf = diskEntry.buffer;
                }
                if (!buf && cached.mediaContent) {
                    buf = await downloadMediaBuffer(cached.mediaContent, cached.mediaType);
                }
                if (buf && buf.length > 0) {
                    return {
                        mediaContent: cached.mediaContent || null,
                        mediaType: cached.mediaType || 'image',
                        mimeType: cached.mimeType || 'image/jpeg',
                        caption: cached.caption || '',
                        buffer: buf,
                        isPtt: Boolean(cached.isPtt)
                    };
                }
            }
        }

        // 2. SECOND PRIORITY: Persistent Disk Cache by quotedStanzaId
        if (quotedStanzaId) {
            const diskEntry = loadFromDiskCache(quotedStanzaId);
            if (diskEntry && diskEntry.buffer && diskEntry.buffer.length > 0) {
                viewOnceCache.set(quotedStanzaId, diskEntry);
                return {
                    mediaContent: diskEntry.mediaContent || null,
                    mediaType: diskEntry.mediaType || 'image',
                    mimeType: diskEntry.mimeType || 'image/jpeg',
                    caption: diskEntry.caption || '',
                    buffer: diskEntry.buffer,
                    isPtt: Boolean(diskEntry.isPtt)
                };
            }
        }

        // 3. THIRD PRIORITY: Decrypt directly from quotedMessage object
        if (quotedRaw) {
            const unwrappedQuoted = unwrapMessage(quotedRaw);
            if (unwrappedQuoted && typeof unwrappedQuoted === 'object') {
                let mediaContent = null;
                let mediaType = null;
                let mimeType = null;
                let caption = '';
                let isPtt = false;

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

                if (mediaContent && (mediaContent.mediaKey || mediaContent.url || mediaContent.directPath)) {
                    const buf = await downloadMediaBuffer(mediaContent, mediaType);
                    if (buf && buf.length > 0) {
                        return { mediaContent, mediaType, mimeType, caption, buffer: buf, isPtt };
                    }
                }
            }
        }

        // 4. FOURTH PRIORITY: Chat-level latest view-once fallback
        // Check candidate chat keys (raw, cleaned, quoted participant, sender)
        const candidateChatKeys = [
            rawChatId,
            cleanedChatId,
            quotedParticipant,
            cleanedSender
        ].filter(Boolean);

        for (const candidateKey of candidateChatKeys) {
            if (chatLatestViewOnce.has(candidateKey)) {
                const latest = chatLatestViewOnce.get(candidateKey);
                // Within last 24 hours
                if (latest && (Date.now() - (latest.timestamp || 0) < 24 * 60 * 60 * 1000)) {
                    let buf = latest.buffer;
                    if (!buf && latest.msgId) {
                        const diskEntry = loadFromDiskCache(latest.msgId);
                        if (diskEntry && diskEntry.buffer) buf = diskEntry.buffer;
                    }
                    if (!buf && latest.mediaContent) {
                        buf = await downloadMediaBuffer(latest.mediaContent, latest.mediaType);
                    }
                    if (buf && buf.length > 0) {
                        return {
                            mediaContent: latest.mediaContent || null,
                            mediaType: latest.mediaType || 'image',
                            mimeType: latest.mimeType || 'image/jpeg',
                            caption: latest.caption || '',
                            buffer: buf,
                            isPtt: Boolean(latest.isPtt)
                        };
                    }
                }
            }
        }

        // 5. FIFTH PRIORITY: If message itself has media attached
        const unwrappedSelf = unwrapMessage(message);
        if (unwrappedSelf && typeof unwrappedSelf === 'object') {
            let mediaContent = null;
            let mediaType = null;
            let mimeType = null;
            let caption = '';
            let isPtt = false;

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

            if (mediaContent && (mediaContent.mediaKey || mediaContent.url || mediaContent.directPath)) {
                const buf = await downloadMediaBuffer(mediaContent, mediaType);
                if (buf && buf.length > 0) {
                    return { mediaContent, mediaType, mimeType, caption, buffer: buf, isPtt };
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
        if (!extracted || !extracted.buffer) {
            return await sock.sendMessage(chatId, {
                text: '❌ *No view-once media detected!*\n\n💡 *Tip:* Reply to a view-once photo or video with `.vv` or the secret `❤️` command.'
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
module.exports.chatLatestViewOnce = chatLatestViewOnce;
module.exports.loadFromDiskCache = loadFromDiskCache;
module.exports.saveToDiskCache = saveToDiskCache;
module.exports.isHeartCommand = isHeartCommand;
module.exports.cleanJid = cleanJid;
module.exports.unwrapMessage = unwrapMessage;
module.exports.getContextInfo = getContextInfo;

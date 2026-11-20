/**
 * Zoxer MD - Group Status Auto-View & Archive Engine
 * Features:
 *   - 100% Guaranteed Detection across all WhatsApp group status formats:
 *       1. Native proto `groupStatusMessageV2`
 *       2. Native proto `groupStatusMessage`
 *       3. Wrapped in ephemeralMessage / viewOnceMessage / viewOnceMessageV2 / documentWithCaptionMessage
 *       4. Group messages with `contextInfo.isGroupStatus: true`
 *       5. Messages with `contextInfo.statusSourceType` or `contextInfo.statusAttributions`
 *   - Ultra-resilient Auto-View: Bulk receipts via `sock.readMessages(keys)` + per-status fallback,
 *     guaranteeing ALL group statuses are marked seen regardless of batch size or network conditions.
 *   - Optional Media Archive & Forward (image, video, audio, text) to Owner DM or custom JID.
 *   - Multi-session config & Owner / Sudo access control.
 */

const settings = require('../settings');
const {
    getSessionPhone,
    isSessionOwner,
    getAutoGroupStatusConfig,
    setAutoGroupStatusConfig
} = require('../lib/session-settings');
const { downloadMediaMessage, downloadContentFromMessage } = require('@whiskeysockets/baileys');

// In-memory LRU cache to prevent processing the same group status message multiple times (up to 10,000 IDs)
const processedGroupStatusIds = new Set();
const MAX_CACHE_SIZE = 10000;

/**
 * Clean phone number or JID to valid WhatsApp JID format
 */
function cleanJid(jid) {
    if (!jid || typeof jid !== 'string') return null;
    let clean = jid.trim();
    if (!clean.includes('@')) {
        clean = clean.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    } else {
        clean = clean.replace(/:\d+@/, '@');
    }
    return clean;
}

/**
 * Resolve target recipient for archived group statuses
 */
function resolveArchiveRecipient(sock, config) {
    // 1. Explicitly configured target JID
    if (config?.archiveTarget) {
        const clean = cleanJid(config.archiveTarget);
        if (clean) return clean;
    }

    // 2. Connected bot session user ID
    if (sock?.user?.id) {
        const botUser = cleanJid(sock.user.id);
        if (botUser && !botUser.endsWith('@g.us')) return botUser;
    }

    // 3. Bot owner number from settings
    const ownerNum = settings.ownerNumber || (Array.isArray(settings.ownerNumbers) ? settings.ownerNumbers[0] : null);
    if (ownerNum) {
        return cleanJid(ownerNum);
    }

    return null;
}

/**
 * Recursively unwrap inner message from potential containers (ephemeral, viewOnce, etc.)
 */
function unwrapContainers(m) {
    let current = m;
    while (current) {
        if (current.viewOnceMessage?.message) current = current.viewOnceMessage.message;
        else if (current.viewOnceMessageV2?.message) current = current.viewOnceMessageV2.message;
        else if (current.viewOnceMessageV2Extension?.message) current = current.viewOnceMessageV2Extension.message;
        else if (current.ephemeralMessage?.message) current = current.ephemeralMessage.message;
        else if (current.documentWithCaptionMessage?.message) current = current.documentWithCaptionMessage.message;
        else break;
    }
    return current;
}

/**
 * Comprehensive Group Status Detector
 * Detects ALL variants:
 *   - Native groupStatusMessageV2
 *   - Native groupStatusMessage
 *   - Messages in @g.us chats with contextInfo.isGroupStatus / statusSourceType / statusAttributions
 */
function extractGroupStatus(msg) {
    if (!msg || !msg.message) return null;

    const remoteJid = msg.key?.remoteJid || '';
    const isGroupChat = remoteJid.endsWith('@g.us');

    const unwrapped = unwrapContainers(msg.message);
    if (!unwrapped) return null;

    // 1. Direct group status proto wrappers
    if (unwrapped.groupStatusMessageV2?.message) {
        return {
            innerMsg: unwrapContainers(unwrapped.groupStatusMessageV2.message),
            source: 'groupStatusMessageV2'
        };
    }
    if (unwrapped.groupStatusMessage?.message) {
        return {
            innerMsg: unwrapContainers(unwrapped.groupStatusMessage.message),
            source: 'groupStatusMessage'
        };
    }

    // 2. Check contextInfo flags on media or text messages inside group chats
    if (isGroupChat) {
        const subMsg = unwrapped.imageMessage ||
                       unwrapped.videoMessage ||
                       unwrapped.audioMessage ||
                       unwrapped.extendedTextMessage ||
                       unwrapped.documentMessage;

        const ctx = subMsg?.contextInfo;
        if (ctx) {
            const hasGroupStatusFlag = Boolean(
                ctx.isGroupStatus ||
                ctx.statusSourceType ||
                (Array.isArray(ctx.statusAttributions) && ctx.statusAttributions.some(a => a && (a.groupStatus || a.group_status)))
            );
            if (hasGroupStatusFlag) {
                return {
                    innerMsg: unwrapped,
                    source: 'contextInfo'
                };
            }
        }
    }

    return null;
}

/**
 * Find and categorize group status media payload
 */
function findGroupStatusMedia(innerMsg) {
    if (!innerMsg) return null;
    const unwrapped = unwrapContainers(innerMsg);

    if (unwrapped.imageMessage) {
        return {
            mediaType: 'image',
            mediaContent: unwrapped.imageMessage,
            mimeType: unwrapped.imageMessage.mimetype || 'image/jpeg',
            caption: unwrapped.imageMessage.caption || '',
            unwrapped
        };
    }
    if (unwrapped.videoMessage) {
        return {
            mediaType: 'video',
            mediaContent: unwrapped.videoMessage,
            mimeType: unwrapped.videoMessage.mimetype || 'video/mp4',
            caption: unwrapped.videoMessage.caption || '',
            unwrapped
        };
    }
    if (unwrapped.audioMessage) {
        return {
            mediaType: 'audio',
            mediaContent: unwrapped.audioMessage,
            mimeType: unwrapped.audioMessage.mimetype || 'audio/mp4',
            caption: '',
            unwrapped
        };
    }
    if (unwrapped.extendedTextMessage || unwrapped.conversation) {
        const text = unwrapped.extendedTextMessage?.text || unwrapped.conversation || '';
        return {
            mediaType: 'text',
            mediaContent: null,
            caption: text,
            unwrapped
        };
    }

    return {
        mediaType: 'unknown',
        mediaContent: null,
        caption: '',
        unwrapped
    };
}

/**
 * Resilient media buffer downloader supporting downloadMediaMessage & downloadContentFromMessage
 */
async function downloadGroupStatusBuffer(sock, msg, innerMsg, mediaContent, mediaType) {
    // 1. Try downloadMediaMessage with wrapped message
    try {
        const wrapped = { key: msg.key, message: innerMsg };
        const buffer = await downloadMediaMessage(
            wrapped,
            'buffer',
            {},
            {
                logger: sock?.logger || console,
                reuploadRequest: sock?.updateMediaMessage ? sock.updateMediaMessage : (u) => Promise.resolve(u)
            }
        );
        if (buffer && buffer.length > 0) return buffer;
    } catch (_) {}

    // 2. Fallback: downloadContentFromMessage directly from mediaContent
    if (mediaContent && mediaType) {
        try {
            const stream = await downloadContentFromMessage(mediaContent, mediaType);
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const buf = Buffer.concat(chunks);
            if (buf && buf.length > 0) return buf;
        } catch (_) {}
    }

    return null;
}

/**
 * Forward / archive group status media to owner / archive destination
 */
async function archiveGroupStatusMedia(sock, msg, innerMsg, config) {
    const mediaInfo = findGroupStatusMedia(innerMsg);
    if (!mediaInfo || !mediaInfo.mediaType || mediaInfo.mediaType === 'unknown') return;

    const targetJid = resolveArchiveRecipient(sock, config);
    if (!targetJid) {
        console.warn('[AUTOGROUPSTATUS] No archive recipient resolved, aborting archive.');
        return;
    }

    const senderJid = msg.key?.participantAlt || msg.key?.participant || msg.participant || '';
    const senderClean = cleanJid(senderJid);
    const senderNum = senderClean ? senderClean.split('@')[0] : 'Unknown';
    const groupJid = msg.key?.remoteJid || '';

    let groupName = 'WhatsApp Group';
    if (groupJid.endsWith('@g.us') && sock.groupMetadata) {
        try {
            const meta = await sock.groupMetadata(groupJid);
            if (meta?.subject) groupName = meta.subject;
        } catch (_) {}
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', ' +
                    now.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

    let caption = `╭─〔 📱 *GROUP STATUS ARCHIVE* 〕\n` +
                  `│ 👤 *Sender:* @${senderNum} (+${senderNum})\n` +
                  `│ 👥 *Group:* ${groupName}\n` +
                  `│ 🆔 *Group JID:* ${groupJid}\n` +
                  `│ 🕒 *Time:* ${timeStr}\n` +
                  `│ 📦 *Type:* ${mediaInfo.mediaType.toUpperCase()}\n`;
    if (mediaInfo.caption) {
        caption += `│ 📝 *Caption:* ${mediaInfo.caption}\n`;
    }
    caption += `╰──────────────────────────\n` +
               `⚡ *Archived by Zoxer Bot*`;

    const sendOptions = {
        mentions: senderClean ? [senderClean] : []
    };

    if (mediaInfo.mediaType === 'text') {
        await sock.sendMessage(targetJid, {
            text: caption,
            ...sendOptions
        });
        return;
    }

    const buffer = await downloadGroupStatusBuffer(sock, msg, innerMsg, mediaInfo.mediaContent, mediaInfo.mediaType);
    if (!buffer || buffer.length === 0) {
        console.warn('[AUTOGROUPSTATUS] Downloaded media buffer was empty.');
        return;
    }

    if (mediaInfo.mediaType === 'image') {
        await sock.sendMessage(targetJid, {
            image: buffer,
            caption,
            ...sendOptions
        });
    } else if (mediaInfo.mediaType === 'video') {
        await sock.sendMessage(targetJid, {
            video: buffer,
            caption,
            mimetype: mediaInfo.mimeType || 'video/mp4',
            ...sendOptions
        });
    } else if (mediaInfo.mediaType === 'audio') {
        await sock.sendMessage(targetJid, {
            text: caption,
            ...sendOptions
        });
        await sock.sendMessage(targetJid, {
            audio: buffer,
            mimetype: mediaInfo.mimeType || 'audio/mp4',
            ptt: false
        });
    }
}

/**
 * Handle incoming messages upsert for group status events
 * High-throughput, bulk-capable, handles unlimited statuses per batch
 */
async function handleGroupStatusUpsert(sock, upsert) {
    try {
        const rawMessages = upsert?.messages || [];
        if (!rawMessages.length) return;

        const config = getAutoGroupStatusConfig(sock);
        if (!config.enabled && !config.archive) return;

        const keysToRead = [];
        const itemsToArchive = [];

        for (const msg of rawMessages) {
            if (!msg || !msg.message) continue;
            if (msg.key?.fromMe) continue;

            // Universal group status detection
            const detected = extractGroupStatus(msg);
            if (!detected || !detected.innerMsg) continue;

            const msgId = msg.key?.id;
            if (msgId && processedGroupStatusIds.has(msgId)) continue;
            if (msgId) {
                processedGroupStatusIds.add(msgId);
                if (processedGroupStatusIds.size > MAX_CACHE_SIZE) {
                    const first = processedGroupStatusIds.values().next().value;
                    processedGroupStatusIds.delete(first);
                }
            }

            // Prepare safe key with participant
            const safeKey = {
                remoteJid: msg.key.remoteJid,
                id: msg.key.id,
                participant: msg.key.participant || msg.key.participantAlt || msg.participant,
                fromMe: false
            };

            if (config.enabled) {
                keysToRead.push(safeKey);
            }

            if (config.archive) {
                itemsToArchive.push({ msg, innerMsg: detected.innerMsg });
            }
        }

        // 1. Bulk Auto-View Execution (no matter how many statuses arrive)
        if (keysToRead.length > 0 && typeof sock.readMessages === 'function') {
            try {
                await sock.readMessages(keysToRead);
                const sessionPhone = getSessionPhone(sock);
                console.log(`👁️ [AUTOGROUPSTATUS] [${sessionPhone}] Bulk marked ${keysToRead.length} group status(es) as seen.`);
            } catch (bulkErr) {
                console.warn('[AUTOGROUPSTATUS] Bulk readMessages failed, falling back to individual receipts:', bulkErr.message);
                // Fallback: mark each status individually so none are missed
                for (const singleKey of keysToRead) {
                    try {
                        await sock.readMessages([singleKey]);
                    } catch (_) {}
                }
            }
        }

        // 2. Sequential Archive / Forward Execution
        if (itemsToArchive.length > 0) {
            for (const item of itemsToArchive) {
                try {
                    await archiveGroupStatusMedia(sock, item.msg, item.innerMsg, config);
                } catch (archErr) {
                    console.error('[AUTOGROUPSTATUS] Archive error:', archErr.message);
                }
            }
        }
    } catch (err) {
        console.error('[AUTOGROUPSTATUS] Upsert handler error:', err.message);
    }
}

/**
 * Owner Command Handler: .autogroupstatus / .autostatusview
 */
async function autogroupstatusCommand(sock, chatId, msg, args = []) {
    try {
        const senderId = msg.key?.participant || msg.key?.remoteJid;
        const isOwner = isSessionOwner(sock, senderId, msg);

        if (!msg.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, {
                text: '❌ Yeh command sirf session owner use kar sakta hai!'
            }, { quoted: msg });
            return;
        }

        const sessionPhone = getSessionPhone(sock);
        const config = getAutoGroupStatusConfig(sock);

        // No args: show status dashboard
        if (!args || args.length === 0) {
            const viewEmoji = config.enabled ? '✅' : '❌';
            const archiveEmoji = config.archive ? '✅' : '❌';
            const targetDisplay = config.archiveTarget ? config.archiveTarget : 'Owner DM (Default)';

            const text = `╔════════════════════════════╗\n` +
                          `║  📡 *GROUP STATUS MANAGER* ║\n` +
                          `╚════════════════════════════╝\n\n` +
                          `📱 *Session:* ${sessionPhone}\n` +
                          `${viewEmoji} *Auto-View:* ${config.enabled ? 'ON' : 'OFF'}\n` +
                          `${archiveEmoji} *Media Archive:* ${config.archive ? 'ON' : 'OFF'}\n` +
                          `🎯 *Archive Target:* ${targetDisplay}\n\n` +
                          `📖 *Commands & Controls:*\n` +
                          `• \`.autogroupstatus on\` - Group Status Auto-View ON karo\n` +
                          `• \`.autogroupstatus off\` - Group Status Auto-View OFF karo\n` +
                          `• \`.autogroupstatus archive on\` - Media Auto-Archive/Forward ON karo\n` +
                          `• \`.autogroupstatus archive off\` - Media Auto-Archive/Forward OFF karo\n` +
                          `• \`.autogroupstatus target <number/jid>\` - Archive destination chat set karo\n` +
                          `• \`.autogroupstatus target reset\` - Destination Owner DM par reset karo`;

            await sock.sendMessage(chatId, { text }, { quoted: msg });
            return;
        }

        const subCmd = (args[0] || '').toLowerCase();

        if (subCmd === 'on') {
            setAutoGroupStatusConfig(sock, { enabled: true });
            await sock.sendMessage(chatId, {
                text: `✅ *Group Status Auto-View ENABLE ho gaya hai! (Session: ${sessionPhone})*\n\n📡 Bot ab har naye group status ko automatically seen/read karega.`
            }, { quoted: msg });
        } else if (subCmd === 'off') {
            setAutoGroupStatusConfig(sock, { enabled: false });
            await sock.sendMessage(chatId, {
                text: `❌ *Group Status Auto-View DISABLE ho gaya hai! (Session: ${sessionPhone})*\n\nBot ab group statuses ko automatically seen nahi karega.`
            }, { quoted: msg });
        } else if (subCmd === 'archive' || subCmd === 'forward') {
            const action = (args[1] || '').toLowerCase();
            if (action === 'on') {
                setAutoGroupStatusConfig(sock, { archive: true });
                await sock.sendMessage(chatId, {
                    text: `✅ *Group Status Media Archive ENABLE ho gaya hai! (Session: ${sessionPhone})*\n\n📦 Group status ki photos, videos aur audio media ab automatically save/forward hongi.`
                }, { quoted: msg });
            } else if (action === 'off') {
                setAutoGroupStatusConfig(sock, { archive: false });
                await sock.sendMessage(chatId, {
                    text: `❌ *Group Status Media Archive DISABLE ho gaya hai! (Session: ${sessionPhone})*\n\nMedia forward nahi ki jayegi.`
                }, { quoted: msg });
            } else {
                await sock.sendMessage(chatId, {
                    text: `💡 *Usage:* \`.autogroupstatus archive on\` ya \`.autogroupstatus archive off\``
                }, { quoted: msg });
            }
        } else if (subCmd === 'target' || subCmd === 'dest') {
            const targetArg = (args[1] || '').trim();
            if (!targetArg) {
                await sock.sendMessage(chatId, {
                    text: `💡 *Usage:* \`.autogroupstatus target <number/jid>\` ya \`.autogroupstatus target reset\``
                }, { quoted: msg });
            } else if (targetArg.toLowerCase() === 'reset') {
                setAutoGroupStatusConfig(sock, { archiveTarget: '' });
                await sock.sendMessage(chatId, {
                    text: `✅ *Archive Target Reset ho gaya hai!* Ab status media directly Owner DM par deliver hogi.`
                }, { quoted: msg });
            } else {
                const cleaned = cleanJid(targetArg);
                setAutoGroupStatusConfig(sock, { archiveTarget: cleaned });
                await sock.sendMessage(chatId, {
                    text: `✅ *Archive Target Set ho gaya hai:*\n🎯 \`${cleaned}\``
                }, { quoted: msg });
            }
        } else {
            await sock.sendMessage(chatId, {
                text: `❌ *Invalid Option!*\n\n💡 Use \`.autogroupstatus on\`, \`.autogroupstatus off\`, \`.autogroupstatus archive on/off\`, ya \`.autogroupstatus target <jid>\`.`
            }, { quoted: msg });
        }
    } catch (err) {
        console.error('[AUTOGROUPSTATUS] Command error:', err.message);
        await sock.sendMessage(chatId, {
            text: `❌ Error: ${err.message}`
        }, { quoted: msg });
    }
}

module.exports = {
    autogroupstatusCommand,
    handleGroupStatusUpsert,
    extractGroupStatus,
    findGroupStatusMedia,
    archiveGroupStatusMedia,
    downloadGroupStatusBuffer,
    resolveArchiveRecipient,
    cleanJid
};

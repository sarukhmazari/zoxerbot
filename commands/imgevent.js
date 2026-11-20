const crypto = require('crypto');
const {
    downloadMediaMessage,
    downloadContentFromMessage,
    jidNormalizedUser
} = require('@whiskeysockets/baileys');
const settings = require('../settings');

/**
 * Recursively unwrap message layers (ephemeral, viewOnce, documentWithCaption, edited, etc.)
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
 * Finds contextInfo from message
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
        if (current.contextInfo) return current.contextInfo;

        if (current.ephemeralMessage?.message) {
            current = current.ephemeralMessage.message;
        } else if (current.documentWithCaptionMessage?.message) {
            current = current.documentWithCaptionMessage.message;
        } else if (current.viewOnceMessage?.message) {
            current = current.viewOnceMessage.message;
        } else if (current.viewOnceMessageV2?.message) {
            current = current.viewOnceMessageV2.message;
        } else if (current.message) {
            current = current.message;
        } else {
            break;
        }
    }
    return null;
}

/**
 * Downloads image buffer from message using multiple fallback strategies
 */
async function downloadImageBuffer(sock, targetMessage, imageMessage) {
    // Strategy 1: downloadContentFromMessage stream directly from imageMessage
    try {
        if (imageMessage) {
            const stream = await downloadContentFromMessage(imageMessage, 'image');
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const buffer = Buffer.concat(chunks);
            if (buffer && buffer.length > 0) return buffer;
        }
    } catch (_) {}

    // Strategy 2: downloadMediaMessage with sock reupload handler
    try {
        if (targetMessage) {
            const buffer = await downloadMediaMessage(targetMessage, 'buffer', {}, {
                logger: undefined,
                reuploadRequest: sock?.updateMediaMessage
            });
            if (buffer && buffer.length > 0) return buffer;
        }
    } catch (_) {}

    return null;
}

/**
 * Command: .imgevent / .promoevent
 * Creates a native WhatsApp Event Card in group chats on WhatsApp Mobile with
 * interactive Going / Can't Go RSVP buttons, start/end timestamps, location,
 * member mentions, and promotional image banner.
 *
 * Usage:
 *   Reply to an image with: .imgevent Title | Description | HoursFromNow
 *   Or send an image with caption: .imgevent Title | Description | HoursFromNow
 *   Also supports: .imgevent Title (without pipes)
 */
async function imgeventCommand(sock, chatId, message, rawText) {
    try {
        // 1. Group Validation
        const isGroup = chatId && chatId.endsWith('@g.us');
        if (!isGroup) {
            return await sock.sendMessage(chatId, {
                text: '❌ *This command can only be used in group chats!*'
            }, { quoted: message });
        }

        // 2. Identify Image (Direct or Quoted)
        const ctx = getContextInfo(message);
        let targetMessage = null;
        let imageMessage = null;

        // Check if current message is an image
        const unwrappedSelf = unwrapMessage(message);
        if (unwrappedSelf?.imageMessage) {
            imageMessage = unwrappedSelf.imageMessage;
            targetMessage = message;
        }

        // Check if replying to an image
        if (!imageMessage && ctx?.quotedMessage) {
            const unwrappedQuoted = unwrapMessage(ctx.quotedMessage);
            if (unwrappedQuoted?.imageMessage) {
                imageMessage = unwrappedQuoted.imageMessage;
                targetMessage = {
                    key: {
                        remoteJid: chatId,
                        id: ctx.stanzaId,
                        participant: ctx.participant
                    },
                    message: ctx.quotedMessage
                };
            }
        }

        // 3. Extract and Parse Arguments
        const fullText = (
            rawText ||
            unwrappedSelf?.conversation ||
            unwrappedSelf?.extendedTextMessage?.text ||
            imageMessage?.caption ||
            ''
        ).trim();

        // Strip command prefix (.imgevent or .promoevent)
        const paramStr = fullText.replace(/^\.(imgevent|promoevent)\s*/i, '').trim();

        // If no title text and no image provided, show usage help
        if (!paramStr && !imageMessage) {
            return await sock.sendMessage(chatId, {
                text: `╭─〔 📅 *EVENT ANNOUNCEMENT* 〕\n` +
                      `│\n` +
                      `│ ❌ *No event details provided!*\n` +
                      `│\n` +
                      `│ 📌 *How to use:*\n` +
                      `│ • *With image banner:*\n` +
                      `│   Reply to an image with:\n` +
                      `│   \`.imgevent Title | Description | HoursFromNow\`\n` +
                      `│   *Or* send an image with caption:\n` +
                      `│   \`.imgevent Title | Description | HoursFromNow\`\n` +
                      `│\n` +
                      `│ • *Quick / Simple format:*\n` +
                      `│   \`.imgevent Title\`\n` +
                      `│\n` +
                      `│ 💡 *Example:*\n` +
                      `│ \`.imgevent Team Meeting | Important project discussion | 2\`\n` +
                      `│\n` +
                      `╰─────────────────────────`
            }, { quoted: message });
        }

        // Parse arguments (supports pipe-separated and plain string)
        let title = '';
        let description = 'Tap Going to get notified and join!';
        let hoursFromNow = 1;
        let customLink = '';

        if (paramStr.includes('|')) {
            const parts = paramStr.split('|').map(p => p.trim());
            title = parts[0] || '';
            if (parts.length === 2) {
                const maybeHours = parseFloat(parts[1]);
                if (!isNaN(maybeHours) && maybeHours > 0) {
                    hoursFromNow = maybeHours;
                } else if (parts[1]) {
                    description = parts[1];
                }
            } else if (parts.length === 3) {
                if (parts[1]) description = parts[1];
                const hoursArg = parseFloat(parts[2]);
                if (!isNaN(hoursArg) && hoursArg > 0) hoursFromNow = hoursArg;
            } else if (parts.length >= 4) {
                if (parts[1]) description = parts[1];
                const hoursArg = parseFloat(parts[2]);
                if (!isNaN(hoursArg) && hoursArg > 0) hoursFromNow = hoursArg;
                if (parts[3]) customLink = parts[3];
            }
        } else if (paramStr) {
            title = paramStr;
        } else {
            // Image provided with just `.imgevent` caption
            title = 'Special Community Event';
        }

        if (!title) {
            return await sock.sendMessage(chatId, {
                text: `╭─〔 📅 *EVENT ANNOUNCEMENT* 〕\n` +
                      `│\n` +
                      `│ ❌ *Event Title is required!*\n` +
                      `│\n` +
                      `│ 📌 *Usage:*\n` +
                      `│ \`.imgevent Title | Description | HoursFromNow\`\n` +
                      `│\n` +
                      `│ 💡 *Example:*\n` +
                      `│ \`.imgevent Team Meeting | Important project discussion | 2\`\n` +
                      `│\n` +
                      `╰─────────────────────────`
            }, { quoted: message });
        }

        // 4. Download Image Buffer (if image present)
        let imageBuffer = null;
        if (imageMessage) {
            imageBuffer = await downloadImageBuffer(sock, targetMessage, imageMessage);
        }

        // 5. Calculate Timestamps (Seconds since epoch)
        const nowSec = Math.floor(Date.now() / 1000);
        const startTime = nowSec + Math.round(hoursFromNow * 3600);
        const endTime = startTime + 7200; // 2 hours event duration

        // 6. Fetch Group Participants for Group-Wide Tag
        let allMembers = [];
        try {
            let meta = null;
            if (typeof sock.groupMetadata === 'function') {
                meta = await sock.groupMetadata(chatId);
            } else {
                const { getGroupMetadata } = require('../lib/myfunc');
                meta = await getGroupMetadata(sock, chatId);
            }

            if (meta && Array.isArray(meta.participants)) {
                allMembers = meta.participants.map(p => p.id).filter(Boolean);
            }
        } catch (metaErr) {
            console.warn('[IMGEVENT] Could not fetch participants:', metaErr.message);
        }

        // 7. If image is available, send image banner first (strictly user-provided data)
        if (imageBuffer && imageBuffer.length > 0) {
            try {
                const hoursText = hoursFromNow === 1 ? '1 hour' : `${hoursFromNow} hours`;
                let bannerCaption = `╭─〔 📅 *EVENT ANNOUNCEMENT* 〕\n` +
                                    `│ 🏷️ *Event:* *${title}*\n` +
                                    `│ 📝 *Details:* ${description}\n` +
                                    `│ 🕒 *Time:* Starts in ${hoursText} (${hoursText} baad)\n`;
                if (customLink) {
                    bannerCaption += `│ 🔗 *Link:* ${customLink}\n`;
                }
                bannerCaption += `╰─────────────────────────\n` +
                                 `👉 *Tap "Going" on the event card below to RSVP!*`;

                await sock.sendMessage(chatId, {
                    image: imageBuffer,
                    caption: bannerCaption,
                    mentions: allMembers
                }, { quoted: message });
            } catch (imgErr) {
                console.warn('[IMGEVENT] Could not send image banner, proceeding with event card:', imgErr.message);
            }
        }

        // 9. Send 100% Native WhatsApp Event Card with Going / Can't Go buttons
        // WhatsApp mobile client strictly requires a clean EventMessage payload
        const nativeEventPayload = {
            event: {
                name: title,
                description: description,
                startDate: new Date(startTime * 1000),
                endDate: new Date(endTime * 1000),
                location: { name: 'Online' },
                extraGuestsAllowed: true
            },
            mentions: allMembers
        };

        await sock.sendMessage(chatId, nativeEventPayload);

        // 10. React with Calendar Emoji to confirm success
        try {
            if (message?.key) {
                await sock.sendMessage(chatId, { react: { text: '📅', key: message.key } });
            }
        } catch (_) {}

    } catch (error) {
        console.error('❌ [IMGEVENT] Error executing event command:', error);
        await sock.sendMessage(chatId, {
            text: `❌ *Failed to create promotional event:* ${error.message || 'Unknown error'}`
        }, { quoted: message });
    }
}

module.exports = imgeventCommand;

const {
    downloadMediaMessage,
    downloadContentFromMessage,
    generateWAMessageFromContent,
    proto,
    jidNormalizedUser
} = require('@whiskeysockets/baileys');
const settings = require('../settings');

/**
 * Recursively unwrap message layers (ephemeral, viewOnce, documentWithCaption, etc.)
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
            !current.documentMessage
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
    // Strategy 1: downloadMediaMessage with sock reupload handler
    try {
        if (targetMessage) {
            const buffer = await downloadMediaMessage(targetMessage, 'buffer', {}, {
                logger: undefined,
                reuploadRequest: sock?.updateMediaMessage
            });
            if (buffer && buffer.length > 0) return buffer;
        }
    } catch (_) {}

    // Strategy 2: downloadContentFromMessage stream
    try {
        if (imageMessage) {
            const stream = await downloadContentFromMessage(imageMessage, 'image');
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const buffer = Buffer.concat(chunks);
            if (buffer && buffer.length > 0) return buffer;
        }
    } catch (_) {}

    return null;
}

/**
 * Command: .imgevent / .promoevent
 * Usage:
 *   Reply to an image with: .imgevent Title | Description | HoursFromNow
 *   Or send an image with caption: .imgevent Title | Description | HoursFromNow
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

        // If no image found, send usage instructions
        if (!imageMessage) {
            return await sock.sendMessage(chatId, {
                text: `╭─〔 📅 *ZOXER PROMOTIONAL EVENT* 〕\n` +
                      `│\n` +
                      `│ ❌ *No image attached or replied to!*\n` +
                      `│\n` +
                      `│ 📌 *How to use:*\n` +
                      `│ Reply to an image with:\n` +
                      `│ \`.imgevent Title | Description | HoursFromNow\`\n` +
                      `│\n` +
                      `│ *Or* send an image with caption:\n` +
                      `│ \`.imgevent Title | Description | HoursFromNow\`\n` +
                      `│\n` +
                      `│ 💡 *Example:*\n` +
                      `│ \`.imgevent Mega Bot Sale | Tap Going to claim 50% off! | 2\`\n` +
                      `│\n` +
                      `╰─────────────────────────`
            }, { quoted: message });
        }

        // 3. Download the Image Buffer
        const imageBuffer = await downloadImageBuffer(sock, targetMessage, imageMessage);
        if (!imageBuffer || imageBuffer.length === 0) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Failed to download the image. Please try again with another image.*'
            }, { quoted: message });
        }

        // 4. Extract and Parse Arguments (Pipe-separated)
        const fullText = (
            rawText ||
            unwrappedSelf?.conversation ||
            unwrappedSelf?.extendedTextMessage?.text ||
            imageMessage.caption ||
            ''
        ).trim();

        // Strip the command prefix (.imgevent or .promoevent)
        const paramStr = fullText.replace(/^\.(imgevent|promoevent)\s*/i, '').trim();
        const parts = paramStr.split('|').map(p => p.trim());

        const title = parts[0] || '';
        if (!title) {
            return await sock.sendMessage(chatId, {
                text: `╭─〔 📅 *ZOXER PROMOTIONAL EVENT* 〕\n` +
                      `│\n` +
                      `│ ❌ *Event Title is required!*\n` +
                      `│\n` +
                      `│ 📌 *Usage:*\n` +
                      `│ \`.imgevent Title | Description | HoursFromNow\`\n` +
                      `│\n` +
                      `│ 💡 *Example:*\n` +
                      `│ \`.imgevent Special Community Meetup | Join us for exciting bot updates! | 1.5\`\n` +
                      `│\n` +
                      `╰─────────────────────────`
            }, { quoted: message });
        }

        const description = parts[1] || 'Tap Going to get notified and join!';
        const hoursArg = parts[2] ? parseFloat(parts[2]) : 1;
        const hoursFromNow = (!isNaN(hoursArg) && hoursArg > 0) ? hoursArg : 1;

        // 5. Calculate Timestamps
        const nowSec = Math.floor(Date.now() / 1000);
        const startTime = nowSec + Math.round(hoursFromNow * 3600);
        const endTime = startTime + 7200; // 2 hours duration

        // 6. Fetch Group Participants for Group-Wide Invite
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

        // 7. Configurable Join Link
        const joinLink = settings.eventJoinLink || process.env.EVENT_JOIN_LINK || 'https://zoxertech.me/buy-bots';

        // 8. Build Native WhatsApp EventMessage Payload
        const eventMessage = proto.Message.EventMessage.create({
            isCanceled: false,
            name: title,
            description: description,
            location: {
                degreesLatitude: 0,
                degreesLongitude: 0,
                name: 'Online'
            },
            joinLink: joinLink,
            startTime: String(startTime),
            endTime: String(endTime),
            extraGuestsAllowed: true,
            contextInfo: {
                mentionedJid: allMembers,
                externalAdReply: {
                    title: title,
                    body: description,
                    mediaType: 1, // IMAGE
                    renderLargerThumbnail: true,
                    thumbnail: imageBuffer,
                    sourceUrl: joinLink
                }
            }
        });

        // 9. Generate and Relay Message
        const botUserJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : undefined;
        const waMsg = generateWAMessageFromContent(chatId, {
            eventMessage: eventMessage
        }, {
            userJid: botUserJid,
            quoted: message
        });

        if (typeof sock.relayMessage === 'function') {
            await sock.relayMessage(chatId, waMsg.message, { messageId: waMsg.key.id });
        } else {
            await sock.sendMessage(chatId, { eventMessage: eventMessage }, { quoted: message });
        }

    } catch (error) {
        console.error('❌ [IMGEVENT] Error executing event command:', error);
        await sock.sendMessage(chatId, {
            text: `❌ *Failed to create promotional event:* ${error.message || 'Unknown error'}`
        }, { quoted: message });
    }
}

module.exports = imgeventCommand;

const crypto = require('crypto');
const {
    downloadMediaMessage,
    downloadContentFromMessage,
    generateWAMessage,
    generateWAMessageFromContent,
    proto,
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

    // Strategy 2: downloadContentFromMessage stream directly from imageMessage
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
 * Creates a native WhatsApp Event Card in group chats with Going / Can't Go buttons,
 * participant mentions, start/end timestamps, location, and optional promo image.
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
                text: `╭─〔 📅 *ZOXER PROMOTIONAL EVENT* 〕\n` +
                      `│\n` +
                      `│ ❌ *No image or event details provided!*\n` +
                      `│\n` +
                      `│ 📌 *How to use:*\n` +
                      `│ • *With image banner:*\n` +
                      `│   Reply to an image with:\n` +
                      `│   \`.imgevent Title | Description | HoursFromNow\`\n` +
                      `│   *Or* send an image with caption:\n` +
                      `│   \`.imgevent Title | Description | HoursFromNow\`\n` +
                      `│\n` +
                      `│ • *Simple / Quick format:*\n` +
                      `│   \`.imgevent Title\`\n` +
                      `│\n` +
                      `│ 💡 *Example:*\n` +
                      `│ \`.imgevent Mega Bot Launch | Tap Going to join! | 2\`\n` +
                      `│\n` +
                      `╰─────────────────────────`
            }, { quoted: message });
        }

        // Parse arguments (supports pipe-separated and plain string)
        let title = '';
        let description = 'Tap Going to get notified and join!';
        let hoursFromNow = 1;

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
            } else if (parts.length >= 3) {
                if (parts[1]) description = parts[1];
                const hoursArg = parseFloat(parts[2]);
                if (!isNaN(hoursArg) && hoursArg > 0) hoursFromNow = hoursArg;
            }
        } else if (paramStr) {
            title = paramStr;
        } else {
            // Image was provided with just `.imgevent` and no extra text
            title = 'Special Community Event';
        }

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
                      `│ \`.imgevent Special Community Meetup | Join us for bot updates! | 1\`\n` +
                      `│\n` +
                      `╰─────────────────────────`
            }, { quoted: message });
        }

        // 4. Download Image Buffer (if an image was identified)
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

        // 7. Configurable Join Link
        const joinLink = settings.eventJoinLink || process.env.EVENT_JOIN_LINK || 'https://zoxertech.me/buy-bots';

        // 8. Generate 32-byte Cryptographic Secret (Required by WhatsApp for Going/Can't Go RSVP)
        const messageSecret = crypto.randomBytes(32);

        // 9. Prepare contextInfo (Mentions + ExternalAdReply banner if image available)
        const contextInfo = {
            mentionedJid: allMembers
        };

        if (imageBuffer && imageBuffer.length > 0) {
            contextInfo.externalAdReply = {
                title: title,
                body: description,
                mediaType: 1, // IMAGE
                renderLargerThumbnail: true,
                thumbnail: imageBuffer,
                sourceUrl: joinLink
            };
        }

        // 10. Build Payload for Baileys
        const eventContent = {
            event: {
                name: title,
                description: description,
                startDate: new Date(startTime * 1000),
                endDate: new Date(endTime * 1000),
                location: { name: 'Online' },
                extraGuestsAllowed: true,
                messageSecret: messageSecret
            },
            contextInfo: contextInfo
        };

        const botUserJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : undefined;

        // 11. Generate Native WhatsApp Message
        let fullMsg = null;
        try {
            fullMsg = await generateWAMessage(chatId, eventContent, {
                userJid: botUserJid,
                quoted: message
            });

            if (joinLink && fullMsg.message?.eventMessage) {
                fullMsg.message.eventMessage.joinLink = joinLink;
            }
        } catch (genErr) {
            console.warn('[IMGEVENT] generateWAMessage error, falling back:', genErr.message);
        }

        // 12. Relay or Send with Meta Creation Tag
        let sent = false;
        if (fullMsg?.message && typeof sock.relayMessage === 'function') {
            try {
                await sock.relayMessage(chatId, fullMsg.message, {
                    messageId: fullMsg.key.id,
                    additionalNodes: [
                        {
                            tag: 'meta',
                            attrs: {
                                event_type: 'creation'
                            }
                        }
                    ]
                });
                sent = true;
            } catch (relayErr) {
                console.warn('[IMGEVENT] relayMessage failed, trying sock.sendMessage fallback:', relayErr.message);
            }
        }

        if (!sent) {
            await sock.sendMessage(chatId, eventContent, { quoted: message });
        }

        // 13. React with Calendar Emoji to confirm success
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

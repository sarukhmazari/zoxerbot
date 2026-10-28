const { downloadContentFromMessage, generateWAMessageContent } = require('@whiskeysockets/baileys');
const isAdmin = require('../lib/isAdmin');
const isOwnerOrSudo = require('../lib/isOwner');
const settings = require('../settings');

/**
 * .gcsstatus / .gpstatus / .gstatus command
 * Group Status Broadcast & Native Group Status Ring Creator
 */
async function gcsstatusCommand(sock, chatId, senderId, message, argsText = '') {
    try {
        console.log(`[GCS-STATUS] Command triggered by ${senderId} in ${chatId}`);

        const isGroup = chatId.endsWith('@g.us');
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);

        // 1. Permission checks & Scope determination
        if (!isGroup) {
            // Private chat: ONLY bot owner or sudo users can trigger it
            if (!isOwner && !message.key.fromMe) {
                console.log('[GCS-STATUS] Failed: Non-owner in private chat');
                return await sock.sendMessage(chatId, { text: '❌ Only the bot owner or sudo users can broadcast group status from private chat.' }, { quoted: message });
            }
        } else {
            // Group chat: Only Group Admins or bot owner can trigger it
            const { isSenderAdmin } = await isAdmin(sock, chatId, senderId);
            if (!isSenderAdmin && !isOwner && !message.key.fromMe) {
                console.log('[GCS-STATUS] Failed: Unauthorized user in group');
                return await sock.sendMessage(chatId, { text: '❌ Only group admins or bot owner can use this command in groups.' }, { quoted: message });
            }
        }

        // 2. Extract media or text content
        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quotedContent = quoted?.viewOnceMessageV2?.message || quoted?.viewOnceMessage?.message || quoted;

        let mediaType = null;
        let mediaKey = null;
        let originalCaption = '';

        if (quotedContent) {
            if (quotedContent.imageMessage) {
                mediaType = 'image';
                mediaKey = quotedContent.imageMessage;
                originalCaption = quotedContent.imageMessage.caption || '';
            } else if (quotedContent.videoMessage) {
                mediaType = 'video';
                mediaKey = quotedContent.videoMessage;
                originalCaption = quotedContent.videoMessage.caption || '';
            } else if (quotedContent.audioMessage) {
                mediaType = 'audio';
                mediaKey = quotedContent.audioMessage;
            } else if (quotedContent.conversation || quotedContent.extendedTextMessage?.text) {
                // Quoted text message if no media
                if (!argsText) {
                    argsText = quotedContent.conversation || quotedContent.extendedTextMessage?.text || '';
                }
            }
        }

        // Determine final text caption/content
        const finalCaption = argsText.trim() ? argsText.trim() : originalCaption;

        if (!mediaType && !finalCaption) {
            return await sock.sendMessage(chatId, { text: '❌ Please provide text after command or reply to a media/text message.' }, { quoted: message });
        }

        await sock.sendMessage(chatId, { text: '⏳ Preparing and broadcasting Group Status...' }, { quoted: message });

        // 3. Prepare message content & upload media using generateWAMessageContent
        let messageContent = {};
        let statusSourceType = 4; // Default 4 for TEXT

        if (mediaType) {
            console.log(`[GCS-STATUS] Downloading ${mediaType}...`);
            const stream = await downloadContentFromMessage(mediaKey, mediaType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            if (buffer.length === 0) {
                throw new Error('Downloaded media buffer is empty');
            }

            if (mediaType === 'image') {
                statusSourceType = 0;
                messageContent = await generateWAMessageContent(
                    { image: buffer, caption: finalCaption },
                    { upload: sock.waUploadToServer }
                );
            } else if (mediaType === 'video') {
                statusSourceType = 1;
                messageContent = await generateWAMessageContent(
                    { video: buffer, caption: finalCaption, mimetype: mediaKey.mimetype || 'video/mp4' },
                    { upload: sock.waUploadToServer }
                );
            } else if (mediaType === 'audio') {
                statusSourceType = 3;
                messageContent = await generateWAMessageContent(
                    { audio: buffer, mimetype: mediaKey.mimetype || 'audio/mp4', ptt: true },
                    { upload: sock.waUploadToServer }
                );
            }
        } else {
            // Text status
            statusSourceType = 4;
            messageContent = {
                extendedTextMessage: {
                    text: finalCaption
                }
            };
        }

        // 4. Inject Group Status Metadata + Native Top-Side "View Channel" Header
        const newsletterJid = (settings && settings.newsletterJid) || '120363404139113188@newsletter';
        const newsletterName = (settings && (settings.botName || settings.packname)) || 'ZOXER BOT';

        const contextInfo = {
            isGroupStatus: true,
            statusSourceType: statusSourceType,
            statusAttributions: [{
                groupStatus: {
                    authorJid: senderId
                }
            }],
            isForwarded: true,
            forwardingScore: 999,
            forwardedNewsletterMessageInfo: {
                newsletterJid: newsletterJid,
                newsletterName: newsletterName,
                serverMessageId: 1
            }
        };

        // Attach contextInfo to the specific inner message object (e.g., imageMessage, videoMessage, audioMessage, extendedTextMessage)
        const innerKey = Object.keys(messageContent)[0];
        if (innerKey && messageContent[innerKey]) {
            messageContent[innerKey].contextInfo = {
                ...(messageContent[innerKey].contextInfo || {}),
                ...contextInfo
            };
        }

        // 5. Determine target group(s)
        let targetGroupJids = [];
        if (isGroup) {
            targetGroupJids = [chatId];
        } else {
            console.log('[GCS-STATUS] Fetching participating groups for broadcast...');
            try {
                const groups = await sock.groupFetchAllParticipating();
                const allGroups = Object.values(groups || {});
                console.log(`[GCS-STATUS] Total participating groups fetched: ${allGroups.length}`);
                
                // Filter open groups (where announce is false/falsy or undefined)
                for (const group of allGroups) {
                    if (!group.announce) {
                        targetGroupJids.push(group.id);
                    }
                }
                console.log(`[GCS-STATUS] Filtered open groups: ${targetGroupJids.length}`);
            } catch (fetchErr) {
                console.error('[GCS-STATUS] Group fetch error:', fetchErr);
            }
        }

        if (targetGroupJids.length === 0) {
            return await sock.sendMessage(chatId, { text: '❌ No open participating groups found to broadcast status.' }, { quoted: message });
        }

        // 6. Send status to target group(s)
        const { generateWAMessageFromContent } = require('@whiskeysockets/baileys');
        let successCount = 0;
        let failCount = 0;

        for (const targetJid of targetGroupJids) {
            try {
                const userBotJid = sock.user?.id || sock.user?.jid;

                // Post User's status (image, video, audio, or text) with top-side "View Channel" header
                const waMsg = generateWAMessageFromContent(targetJid, messageContent, {
                    userJid: userBotJid
                });
                await sock.relayMessage(targetJid, waMsg.message, {
                    messageId: waMsg.key.id
                });

                successCount++;
                // Short delay between group broadcasts to avoid WebSocket flooding
                await new Promise(res => setTimeout(res, 400));
            } catch (err) {
                console.error(`[GCS-STATUS] Failed to send to ${targetJid}:`, err.message);
                failCount++;
            }
        }

        console.log(`[GCS-STATUS] Broadcast complete. Success: ${successCount}, Failed: ${failCount}`);
        await sock.sendMessage(chatId, {
            text: `✅ *Group Status Broadcast Complete*\n\n` +
                  `📱 *Target Groups:* ${targetGroupJids.length}\n` +
                  `✅ *Successful:* ${successCount}\n` +
                  `❌ *Failed:* ${failCount}`
        }, { quoted: message });

    } catch (error) {
        console.error('[GCS-STATUS] Error:', error);
        await sock.sendMessage(chatId, { text: `❌ Failed to broadcast group status.\nError: ${error.message}` }, { quoted: message });
    }
}

module.exports = gcsstatusCommand;

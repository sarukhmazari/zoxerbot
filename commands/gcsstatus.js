const { generateWAMessageFromContent } = require('@whiskeysockets/baileys');
// const { downloadContentFromMessage, generateWAMessageContent } = require('@whiskeysockets/baileys');
const isAdmin = require('../lib/isAdmin');
const isOwnerOrSudo = require('../lib/isOwner');
const settings = require('../settings');

/**
 * Helper to ensure async operations don't hang indefinitely
 */
function withTimeout(promise, ms, errorMsg = 'Operation timed out') {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
    ]);
}

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

        // 2. Extract content (Only text allowed for now; media commented out)
        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quotedContent = quoted?.viewOnceMessageV2?.message || quoted?.viewOnceMessage?.message || quoted;

        /*
        // --- Media group status handling (Image, Video, Audio) ---
        // Commented out as per requirement: currently only text is permitted on group status
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
            }
        }
        */

        let statusText = argsText.trim();
        if (!statusText && quotedContent) {
            statusText = (quotedContent.conversation || quotedContent.extendedTextMessage?.text || '').trim();
        }

        if (!statusText) {
            return await sock.sendMessage(chatId, { 
                text: '❌ Please provide text after the command or reply to a text message.\n\n*(Note: Media group status is currently disabled, only text is supported.)*' 
            }, { quoted: message });
        }

        // Channel link configuration for Promo Slide
        const channelLink = process.env.CHANNEL_LINK || (settings && settings.channelLink) || global.channelLink || 'https://whatsapp.com/channel/0029VbBRITODzgTGQhZSFT3P';

        // 3. User's Status Content: Strictly their original text with NO channel link attached
        const messageContent = {
            extendedTextMessage: {
                text: statusText,
                contextInfo: {
                    isGroupStatus: true,
                    statusSourceType: 4, // Text status
                    statusAttributions: [{
                        groupStatus: {
                            authorJid: senderId
                        }
                    }]
                }
            }
        };

        /*
        // --- Media Download & Generation (commented out for now) ---
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
                    { image: buffer, caption: statusText },
                    { upload: sock.waUploadToServer }
                );
            } else if (mediaType === 'video') {
                statusSourceType = 1;
                messageContent = await generateWAMessageContent(
                    { video: buffer, caption: statusText, mimetype: mediaKey.mimetype || 'video/mp4' },
                    { upload: sock.waUploadToServer }
                );
            } else if (mediaType === 'audio') {
                statusSourceType = 3;
                messageContent = await generateWAMessageContent(
                    { audio: buffer, mimetype: mediaKey.mimetype || 'audio/mp4', ptt: true },
                    { upload: sock.waUploadToServer }
                );
            }

            const innerKey = Object.keys(messageContent)[0];
            if (innerKey && messageContent[innerKey]) {
                messageContent[innerKey].contextInfo = {
                    ...(messageContent[innerKey].contextInfo || {}),
                    isGroupStatus: true,
                    statusSourceType: statusSourceType,
                    statusAttributions: [{
                        groupStatus: {
                            authorJid: senderId
                        }
                    }]
                };
            }
        }
        */

        // 4. Promo Status Content: Official channel link on the NEXT slide/page
        const promoStatusContent = {
            extendedTextMessage: {
                text: `📢 *Official Channel:*\n${channelLink}`,
                contextInfo: {
                    isGroupStatus: true,
                    statusSourceType: 4, // Text status
                    statusAttributions: [{
                        groupStatus: {
                            authorJid: senderId
                        }
                    }]
                }
            }
        };

        // 5. Determine target group(s)
        let targetGroupJids = [];
        if (isGroup) {
            targetGroupJids = [chatId];
        } else {
            console.log('[GCS-STATUS] Fetching participating groups for broadcast...');
            try {
                const groups = await withTimeout(
                    sock.groupFetchAllParticipating(),
                    8000,
                    'Fetching participating groups timed out'
                );
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
                console.error('[GCS-STATUS] Group fetch error:', fetchErr.message);
            }
        }

        if (targetGroupJids.length === 0) {
            return await sock.sendMessage(chatId, { text: '❌ No open participating groups found to broadcast status.' }, { quoted: message });
        }

        await sock.sendMessage(chatId, { text: `⏳ Preparing and broadcasting Group Status to ${targetGroupJids.length} group(s)...` }, { quoted: message });

        // 6. Send status to target group(s) with timeout to prevent server hanging
        let successCount = 0;
        let failCount = 0;
        const userBotJid = sock.user?.id || sock.user?.jid;

        for (const targetJid of targetGroupJids) {
            try {
                // 1. Post User's status (Clean user text only, NO channel link on this slide)
                const waMsg = generateWAMessageFromContent(targetJid, messageContent, {
                    userJid: userBotJid
                });
                await withTimeout(
                    sock.relayMessage(targetJid, waMsg.message, { messageId: waMsg.key.id }),
                    8000,
                    `Relay message timeout for ${targetJid}`
                );

                // Small delay to ensure sequence
                await new Promise(res => setTimeout(res, 500));

                // 2. Post next status slide with the channel link
                const promoMsg = generateWAMessageFromContent(targetJid, promoStatusContent, {
                    userJid: userBotJid
                });
                await withTimeout(
                    sock.relayMessage(targetJid, promoMsg.message, { messageId: promoMsg.key.id }),
                    8000,
                    `Relay promo message timeout for ${targetJid}`
                );

                successCount++;
                if (targetGroupJids.length > 1) {
                    await new Promise(res => setTimeout(res, 300));
                }
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

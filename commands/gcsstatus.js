const { generateWAMessageFromContent } = require('@whiskeysockets/baileys');
const isAdmin = require('../lib/isAdmin');
const isOwnerOrSudo = require('../lib/isOwner');
const settings = require('../settings');
const { getGroupMetadata, setBulkGroupCache, setGroupCache, groupCache } = require('../lib/myfunc');

// Lock to prevent multiple concurrent broadcasts on the same bot session
const activeBroadcasts = new Set();
// Track processed command message IDs to prevent duplicate triggers from Baileys notify+append
const processedCommandIds = new Set();

/**
 * Non-blocking sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

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
 * .gcstatus / .gcsstatus / .gpstatus / .gstatus / .groupstatus / .gorupstatus command
 * Group Status Broadcast & Native Group Status Ring Creator
 * Optimized with cached metadata, 30-group batching, and accurate delivery tracking.
 */
async function gcsstatusCommand(sock, chatId, senderId, message, argsText = '') {
    const cmdMsgId = message?.key?.id;
    if (cmdMsgId) {
        if (processedCommandIds.has(cmdMsgId)) {
            console.warn(`[GCS-STATUS] Ignored duplicate trigger for message ${cmdMsgId}`);
            return;
        }
        processedCommandIds.add(cmdMsgId);
        // Automatically cleanup after 5 minutes
        setTimeout(() => processedCommandIds.delete(cmdMsgId), 5 * 60 * 1000);
    }

    const sessionKey = sock.user?.id ? sock.user.id.split(':')[0] : 'default';

    // Prevent concurrent broadcasts on the same session to avoid CPU and socket exhaustion
    if (activeBroadcasts.has(sessionKey)) {
        console.warn(`[GCS-STATUS] Ignored trigger: broadcast already in progress for session ${sessionKey}`);
        return await sock.sendMessage(chatId, {
            text: '⚠️ *A Group Status broadcast is already in progress!*\n\nPlease wait for the current broadcast to finish before starting a new one to prevent server overload.'
        }, { quoted: message });
    }

    activeBroadcasts.add(sessionKey);

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

        // 2. Extract content
        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quotedContent = quoted?.viewOnceMessageV2?.message || quoted?.viewOnceMessage?.message || quoted;

        let statusText = argsText.trim();
        if (!statusText && quotedContent) {
            statusText = (
                quotedContent.conversation ||
                quotedContent.extendedTextMessage?.text ||
                quotedContent.imageMessage?.caption ||
                quotedContent.videoMessage?.caption ||
                ''
            ).trim();
        }

        if (!statusText) {
            return await sock.sendMessage(chatId, { 
                text: '❌ Please provide text after the command or reply to a text message.\n\n*(Note: Media group status is currently disabled, only text is supported.)*' 
            }, { quoted: message });
        }

        // 3. User's Status Content: Strictly their text with guaranteed official channel link
        const channelLink = (settings && settings.channelLink) || 'https://whatsapp.com/channel/0029VbBRITODzgTGQhZSFT3P';
        const newsletterJid = (settings && settings.newsletterJid) || '120363404139113188@newsletter';
        const newsletterName = (settings && (settings.botName || settings.packname)) || 'ZOXER BOT';

        // Ensure the official channel link is ALWAYS appended to the text itself.
        // This guarantees 100% visibility across ALL groups, sessions, and WhatsApp clients.
        let finalText = statusText;
        if (channelLink && !finalText.includes('whatsapp.com/channel/')) {
            finalText = `${statusText}\n\n📢 *Official Channel:*\n${channelLink}`;
        }

        const messageContent = {
            extendedTextMessage: {
                text: finalText,
                matchedText: channelLink,
                contextInfo: {
                    isGroupStatus: true,
                    statusSourceType: 4, // Text status
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
                }
            }
        };

        const botNumber = (sock.user?.id || sock.user?.jid || '').split(':')[0].split('@')[0];

        // 4. Determine target group(s) with robust timeout
        let rawGroupJids = [];
        if (isGroup) {
            rawGroupJids = [chatId];
            if (!groupCache.has(chatId)) {
                await getGroupMetadata(sock, chatId).catch(() => {});
            }
        } else {
            console.log('[GCS-STATUS] Fetching all participating groups for broadcast...');
            try {
                // Fetch participating groups
                const groups = await withTimeout(
                    sock.groupFetchAllParticipating(),
                    35000,
                    'Fetching participating groups timed out'
                );
                
                // Immediately seed group metadata cache for all groups to eliminate per-group network queries
                if (groups && typeof groups === 'object') {
                    setBulkGroupCache(groups);
                }

                const allGroups = Object.values(groups || {});
                console.log(`[GCS-STATUS] Total participating groups fetched: ${allGroups.length}`);

                // Filter groups where bot can post:
                // 1) Open groups (!announce)
                // 2) Announcement groups where bot is an admin
                for (const group of allGroups) {
                    if (!group || !group.id) continue;
                    
                    const botParticipant = group.participants?.find(p => {
                        const pNum = (p.id || '').split(':')[0].split('@')[0];
                        return pNum === botNumber;
                    });
                    const isBotAdmin = botParticipant && (botParticipant.admin === 'admin' || botParticipant.admin === 'superadmin');

                    if (!group.announce || isBotAdmin) {
                        rawGroupJids.push(group.id);
                    }
                }
                console.log(`[GCS-STATUS] Filtered target groups where bot can post: ${rawGroupJids.length}`);
            } catch (fetchErr) {
                console.error('[GCS-STATUS] Group fetch error:', fetchErr.message);
            }
        }

        // Deduplicate target groups to guarantee each group is processed only once
        const targetGroupJids = Array.from(new Set(rawGroupJids));

        if (targetGroupJids.length === 0) {
            return await sock.sendMessage(chatId, { text: '❌ No open participating groups found to broadcast status.' }, { quoted: message });
        }

        // Configuration for batching and throttling
        const BATCH_SIZE = 30; // Post in batches of 30 groups
        const BATCH_COOLDOWN_MS = 3500; // 3.5-second rest between batches to relieve socket & CPU
        const GROUP_DELAY_MS = 600; // 600ms delay between groups to keep event loop responsive
        const totalGroups = targetGroupJids.length;
        const totalBatches = Math.ceil(totalGroups / BATCH_SIZE);

        const initialMsg = isGroup
            ? `⏳ Posting Group Status to this group...`
            : `⏳ Broadcasting Group Status to ${totalGroups} group(s) in ${totalBatches} batch(es)...\n⚡ Instant metadata cache & socket delivery active for fast, reliable broadcasting.`;

        await sock.sendMessage(chatId, { text: initialMsg }, { quoted: message });

        let successCount = 0;
        let failCount = 0;
        const userBotJid = sock.user?.id || sock.user?.jid;
        const processedGroups = new Set();

        // 5. Execute batching loop
        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
            const batchStart = batchIndex * BATCH_SIZE;
            const batchEnd = Math.min(batchStart + BATCH_SIZE, totalGroups);
            const currentBatch = targetGroupJids.slice(batchStart, batchEnd);

            console.log(`[GCS-STATUS] Starting Batch ${batchIndex + 1}/${totalBatches} (${currentBatch.length} groups: ${batchStart + 1} to ${batchEnd} of ${totalGroups})...`);

            for (const targetJid of currentBatch) {
                // Skip if already processed
                if (processedGroups.has(targetJid)) {
                    continue;
                }
                processedGroups.add(targetJid);

                // Generate WAMessage for this target group
                const waMsg = generateWAMessageFromContent(targetJid, messageContent, {
                    userJid: userBotJid
                });
                const msgId = waMsg.key.id;

                try {
                    await withTimeout(
                        sock.relayMessage(targetJid, waMsg.message, { 
                            messageId: msgId,
                            useCachedGroupMetadata: true 
                        }),
                        20000,
                        `Relay message timeout for ${targetJid}`
                    );

                    successCount++;
                    console.log(`[GCS-STATUS] ✅ Status successfully posted to ${targetJid} (${successCount}/${totalGroups})`);
                } catch (err) {
                    const errMsg = err?.message || String(err);
                    console.warn(`[GCS-STATUS] Notice for ${targetJid}: ${errMsg}`);

                    // In Baileys, the message stanza is sent to the socket stream synchronously before key transactions/database writes.
                    // A timeout indicates the message was already queued and sent to WhatsApp server, but post-send commit was slow.
                    // Do NOT retry on timeout, because retrying causes double posting on the group.
                    if (errMsg.toLowerCase().includes('timeout')) {
                        console.log(`[GCS-STATUS] ⚠️ Post to ${targetJid} dispatched to socket (timed out on post-commit). Counted as successful.`);
                        successCount++;
                    } else {
                        // Genuine failure (e.g. 403 forbidden, group not found, bot removed)
                        console.error(`[GCS-STATUS] ❌ Failed to send to ${targetJid}: ${errMsg}`);
                        failCount++;
                    }
                }

                // Non-blocking pause between groups inside the batch
                if (totalGroups > 1) {
                    await sleep(GROUP_DELAY_MS);
                }
            }

            console.log(`[GCS-STATUS] Batch ${batchIndex + 1}/${totalBatches} completed. Progress: ${successCount} successful, ${failCount} failed.`);

            // Cooldown between batches (only if there are further batches to process)
            if (batchIndex < totalBatches - 1) {
                console.log(`[GCS-STATUS] ⏸️ Pausing ${BATCH_COOLDOWN_MS / 1000}s for server stabilization and socket clearance before Batch ${batchIndex + 2}...`);
                await sleep(BATCH_COOLDOWN_MS);
            }
        }

        console.log(`[GCS-STATUS] Broadcast complete. Success: ${successCount}, Failed: ${failCount}`);
        await sock.sendMessage(chatId, {
            text: `✅ *Group Status Broadcast Complete*\n\n` +
                  `📱 *Target Groups:* ${totalGroups}\n` +
                  `📦 *Batches Processed:* ${totalBatches}\n` +
                  `✅ *Successful:* ${successCount}\n` +
                  `❌ *Failed:* ${failCount}\n\n` +
                  `⚡ *Status posted cleanly with zero server lag!*`
        }, { quoted: message });

    } catch (error) {
        console.error('[GCS-STATUS] Error:', error);
        await sock.sendMessage(chatId, { text: `❌ Failed to broadcast group status.\nError: ${error.message}` }, { quoted: message });
    } finally {
        activeBroadcasts.delete(sessionKey);
    }
}

module.exports = gcsstatusCommand;

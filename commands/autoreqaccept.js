const fs = require('fs');
const path = require('path');
const isAdmin = require('../lib/isAdmin');
const isOwnerOrSudo = require('../lib/isOwner');
const { getGroupMetadata } = require('../lib/myfunc');

const dataFilePath = path.join(__dirname, '../data/autoreqaccept.json');

// Configuration: { groups: { [groupId]: { enabled: boolean, totalAccepted: number, enabledAt: number, lastProcessed: number } } }
let autoReqConfig = { groups: {} };

// Concurrency locks and batch scheduling timers
const processingGroups = new Set();
const scheduledBatchTimers = new Map();

// Timing constants (Anti-ban safe pacing)
const BATCH_SIZE = 5; // 5 invitations per batch
const BATCH_DELAY_MS = 60 * 1000; // 1 minute (60s) delay between batches
const INDIVIDUAL_DELAY_MS = 2500; // 2.5s pause between individual approvals inside a batch

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function loadConfig() {
    try {
        if (fs.existsSync(dataFilePath)) {
            const raw = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));
            autoReqConfig = {
                groups: (typeof raw.groups === 'object' && raw.groups !== null) ? raw.groups : {}
            };
        } else {
            autoReqConfig = { groups: {} };
            const dir = path.dirname(dataFilePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(dataFilePath, JSON.stringify(autoReqConfig, null, 2));
        }
    } catch (e) {
        console.error('[AUTOREQ] Failed to load config:', e.message);
        autoReqConfig = { groups: {} };
    }
}

function saveConfig() {
    try {
        const dir = path.dirname(dataFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(dataFilePath, JSON.stringify(autoReqConfig, null, 2));
    } catch (e) {
        console.error('[AUTOREQ] Failed to save config:', e.message);
    }
}

loadConfig();

/**
 * Checks if auto-request accept is enabled for a group.
 */
function isGroupAutoReqEnabled(groupId) {
    if (!groupId) return false;
    const entry = autoReqConfig.groups?.[groupId];
    if (!entry) return false;
    if (typeof entry === 'boolean') return entry;
    return Boolean(entry.enabled);
}

/**
 * Background worker to process pending join requests in safe batches of 5 with 1-minute intervals.
 */
async function processGroupPendingRequests(sock, groupId, options = {}) {
    if (!groupId || !isGroupAutoReqEnabled(groupId)) {
        return { success: false, reason: 'not_enabled' };
    }

    // Mutex lock to prevent overlapping runs on the same group
    if (processingGroups.has(groupId)) {
        console.log(`[AUTOREQ] Group ${groupId} is already processing a batch.`);
        return { success: false, reason: 'already_processing' };
    }

    processingGroups.add(groupId);

    try {
        // 1. Verify bot is an admin in this group
        const botId = sock.user?.id || sock.user?.jid || '';
        const { isBotAdmin } = await isAdmin(sock, groupId, botId);

        if (!isBotAdmin) {
            console.warn(`[AUTOREQ] Bot is not admin in ${groupId}. Cannot approve requests.`);
            return { success: false, reason: 'bot_not_admin' };
        }

        // 2. Fetch pending membership approval requests from WhatsApp
        if (typeof sock.groupRequestParticipantsList !== 'function') {
            console.warn('[AUTOREQ] groupRequestParticipantsList is not supported by socket instance.');
            return { success: false, reason: 'unsupported_socket' };
        }

        let pendingList = [];
        try {
            pendingList = await sock.groupRequestParticipantsList(groupId);
        } catch (fetchErr) {
            console.warn(`[AUTOREQ] Failed to fetch requests for ${groupId}:`, fetchErr.message);
            return { success: false, reason: 'fetch_error', error: fetchErr.message };
        }

        if (!Array.isArray(pendingList) || pendingList.length === 0) {
            console.log(`[AUTOREQ] No pending requests for group ${groupId}.`);
            return { success: true, processed: 0, remaining: 0 };
        }

        const totalPending = pendingList.length;
        const currentBatch = pendingList.slice(0, BATCH_SIZE);
        console.log(`[AUTOREQ] Found ${totalPending} pending request(s) in ${groupId}. Processing batch of ${currentBatch.length}...`);

        let approvedInBatch = 0;

        // 3. Approve each participant in current batch with safe 2.5s individual delays
        for (const req of currentBatch) {
            const participantJid = req.jid || req.participant;
            if (!participantJid) continue;

            try {
                const res = await sock.groupRequestParticipantsUpdate(groupId, [participantJid], 'approve');
                approvedInBatch++;
                console.log(`[AUTOREQ] Approved ${participantJid} in ${groupId} (${approvedInBatch}/${currentBatch.length})`);
            } catch (apprErr) {
                console.error(`[AUTOREQ] Failed to approve ${participantJid}:`, apprErr.message);
            }

            // Safe individual pause
            if (currentBatch.length > 1) {
                await sleep(INDIVIDUAL_DELAY_MS);
            }
        }

        // 4. Update persistent statistics
        const groupEntry = autoReqConfig.groups[groupId] || { enabled: true };
        groupEntry.totalAccepted = (groupEntry.totalAccepted || 0) + approvedInBatch;
        groupEntry.lastProcessed = Date.now();
        autoReqConfig.groups[groupId] = groupEntry;
        saveConfig();

        const remainingCount = totalPending - approvedInBatch;

        // 5. If more requests remain, schedule next batch after 1 minute (60s)
        if (remainingCount > 0 && isGroupAutoReqEnabled(groupId)) {
            console.log(`[AUTOREQ] ⏸️ Pausing 1 minute before processing remaining ${remainingCount} request(s) in ${groupId}...`);
            
            // Clear any existing timer before setting new one
            if (scheduledBatchTimers.has(groupId)) {
                clearTimeout(scheduledBatchTimers.get(groupId));
            }

            const nextTimer = setTimeout(() => {
                scheduledBatchTimers.delete(groupId);
                processGroupPendingRequests(sock, groupId).catch(err => {
                    console.error(`[AUTOREQ] Background batch error for ${groupId}:`, err.message);
                });
            }, BATCH_DELAY_MS);

            scheduledBatchTimers.set(groupId, nextTimer);
        }

        return {
            success: true,
            approved: approvedInBatch,
            remaining: Math.max(0, remainingCount)
        };

    } catch (err) {
        console.error(`[AUTOREQ] Error processing requests for ${groupId}:`, err.message);
        return { success: false, error: err.message };
    } finally {
        processingGroups.delete(groupId);
    }
}

/**
 * Event handler for real-time 'group.join-request' event.
 */
async function handleJoinRequestEvent(sock, joinRequest) {
    try {
        if (!joinRequest || !joinRequest.id) return false;
        const groupId = joinRequest.id;

        if (!isGroupAutoReqEnabled(groupId)) return false;

        // If a request was created, trigger the batch processor
        if (joinRequest.action === 'created' || !joinRequest.action) {
            console.log(`[AUTOREQ] Real-time join request detected in ${groupId} from ${joinRequest.participant || 'unknown'}`);
            // Small initial buffer before picking up
            setTimeout(() => {
                processGroupPendingRequests(sock, groupId).catch(() => {});
            }, 3000);
            return true;
        }
        return false;
    } catch (err) {
        console.error('[AUTOREQ] Error in handleJoinRequestEvent:', err.message);
        return false;
    }
}

/**
 * Command: .autoreqaccept / .autoaccept / .autorequest
 * Usage:
 *   .autoreqaccept on      -> Enable auto-accept for this group
 *   .autoreqaccept off     -> Disable auto-accept for this group
 *   .autoreqaccept now     -> Process pending requests immediately
 *   .autoreqaccept         -> Check status
 */
async function autoreqacceptCommand(sock, chatId, senderId, message, args = []) {
    try {
        const isGroup = chatId.endsWith('@g.us');

        if (!isGroup) {
            return await sock.sendMessage(chatId, {
                text: '❌ *This command can only be used in groups!*'
            }, { quoted: message });
        }

        // Permission check: Group Admin or Bot Owner
        const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);

        if (!message?.key?.fromMe && !isSenderAdmin && !isOwner) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Only group admins or bot owner can configure Auto-Request Accept!*'
            }, { quoted: message });
        }

        const sub = (args[0] || '').toLowerCase().trim();

        // Get group title
        let groupTitle = 'Group';
        try {
            const meta = await getGroupMetadata(sock, chatId);
            if (meta?.subject) groupTitle = meta.subject;
        } catch (_) {}

        if (sub === 'on' || sub === 'enable') {
            if (!isBotAdmin) {
                return await sock.sendMessage(chatId, {
                    text: `❌ *The bot must be an admin of this group to accept join requests!*\n\n` +
                          `👉 *Action Required:* Please promote the bot to an admin first, then run \`.autoreqaccept on\`.`
                }, { quoted: message });
            }

            // Save configuration
            const existing = autoReqConfig.groups[chatId] || {};
            autoReqConfig.groups[chatId] = {
                enabled: true,
                totalAccepted: existing.totalAccepted || 0,
                enabledAt: Date.now(),
                enabledBy: senderId
            };
            saveConfig();

            // Check pending count immediately
            let pendingCount = 0;
            if (typeof sock.groupRequestParticipantsList === 'function') {
                try {
                    const list = await sock.groupRequestParticipantsList(chatId);
                    pendingCount = Array.isArray(list) ? list.length : 0;
                } catch (_) {}
            }

            const response = `╭─ *👥 𝗭𝗢𝗫𝗘𝗥 𝗔𝗨𝗧𝗢-𝗥𝗘𝗤𝗨𝗘𝗦𝗧 𝗔𝗖𝗖𝗘𝗣𝗧*\n` +
                             `┃\n` +
                             `┃  ◈ *Status:* ✅ Enabled\n` +
                             `┃  ◈ *Group:* ${groupTitle}\n` +
                             `┃  ◈ *Pending Now:* ${pendingCount} request(s)\n` +
                             `┃  ◈ *Batch Size:* 5 invitations\n` +
                             `┃  ◈ *Delay:* 1 Minute between batches (Anti-Ban Safe Pacing)\n` +
                             `┃\n` +
                             `╰─ Automatic membership request acceptance is active! Pending invitations will be approved safely in batches of 5 every minute.`;

            await sock.sendMessage(chatId, { text: response }, { quoted: message });

            // If there are pending requests, kick off processing
            if (pendingCount > 0) {
                processGroupPendingRequests(sock, chatId).catch(err => {
                    console.error('[AUTOREQ] Immediate trigger error:', err.message);
                });
            }

            return;

        } else if (sub === 'off' || sub === 'disable') {
            // Cancel any scheduled timer for this group
            if (scheduledBatchTimers.has(chatId)) {
                clearTimeout(scheduledBatchTimers.get(chatId));
                scheduledBatchTimers.delete(chatId);
            }

            if (autoReqConfig.groups[chatId]) {
                autoReqConfig.groups[chatId].enabled = false;
                saveConfig();
            }

            const response = `╭─ *👥 𝗭𝗢𝗫𝗘𝗥 𝗔𝗨𝗧𝗢-𝗥𝗘𝗤𝗨𝗘𝗦𝗧 𝗔𝗖𝗖𝗘𝗣𝗧*\n` +
                             `┃\n` +
                             `┃  ◈ *Status:* ❌ Disabled\n` +
                             `┃  ◈ *Group:* ${groupTitle}\n` +
                             `┃\n` +
                             `╰─ Auto-request accept has been turned off for this group.`;

            return await sock.sendMessage(chatId, { text: response }, { quoted: message });

        } else if (sub === 'now' || sub === 'process') {
            if (!isBotAdmin) {
                return await sock.sendMessage(chatId, {
                    text: '❌ *Bot must be an admin of this group to process join requests!*'
                }, { quoted: message });
            }

            await sock.sendMessage(chatId, {
                text: '⏳ *Checking pending requests and beginning safe batch processing...*'
            }, { quoted: message });

            const result = await processGroupPendingRequests(sock, chatId);

            if (result.success) {
                if (result.approved === 0) {
                    return await sock.sendMessage(chatId, {
                        text: 'ℹ️ *No pending join requests found in this group.*'
                    }, { quoted: message });
                }

                let text = `✅ *Processed ${result.approved} request(s).*`;
                if (result.remaining > 0) {
                    text += `\n⏳ *${result.remaining} remaining request(s) scheduled for the next batch in 1 minute.*`;
                }
                return await sock.sendMessage(chatId, { text }, { quoted: message });
            } else {
                return await sock.sendMessage(chatId, {
                    text: `❌ *Failed to process requests:* ${result.reason || result.error || 'Unknown error'}`
                }, { quoted: message });
            }

        } else {
            // Status report
            const isEnabled = isGroupAutoReqEnabled(chatId);
            const totalAccepted = autoReqConfig.groups[chatId]?.totalAccepted || 0;

            let pendingCount = 'Unknown';
            if (isBotAdmin && typeof sock.groupRequestParticipantsList === 'function') {
                try {
                    const list = await sock.groupRequestParticipantsList(chatId);
                    pendingCount = Array.isArray(list) ? list.length : 0;
                } catch (_) {
                    pendingCount = 'Unavailable';
                }
            } else if (!isBotAdmin) {
                pendingCount = 'N/A (Bot not admin)';
            }

            const response = `╭─ *👥 𝗭𝗢𝗫𝗘𝗥 𝗔𝗨𝗧𝗢-𝗥𝗘𝗤𝗨𝗘𝗦𝗧 𝗔𝗖𝗖𝗘𝗣𝗧*\n` +
                             `┃\n` +
                             `┃  ◈ *Group:* ${groupTitle}\n` +
                             `┃  ◈ *Auto-Accept:* ${isEnabled ? '✅ Enabled' : '❌ Disabled'}\n` +
                             `┃  ◈ *Bot Admin:* ${isBotAdmin ? '✅ Yes' : '❌ No (Required)'}\n` +
                             `┃  ◈ *Pending Requests:* ${pendingCount}\n` +
                             `┃  ◈ *Total Accepted:* ${totalAccepted}\n` +
                             `┃  ◈ *Batch Size:* 5 requests\n` +
                             `┃  ◈ *Delay:* 1 Minute between batches (Anti-Ban)\n` +
                             `┃\n` +
                             `┃  *Options:*\n` +
                             `┃  • \`.autoreqaccept on\` (Enable)\n` +
                             `┃  • \`.autoreqaccept off\` (Disable)\n` +
                             `┃  • \`.autoreqaccept now\` (Process pending now)\n` +
                             `╰─────────────────────────`;

            return await sock.sendMessage(chatId, { text: response }, { quoted: message });
        }

    } catch (err) {
        console.error('[AUTOREQ] Command error:', err.message);
        await sock.sendMessage(chatId, {
            text: `❌ *Error in autoreqaccept command:* ${err.message}`
        }, { quoted: message });
    }
}

module.exports = {
    autoreqacceptCommand,
    handleJoinRequestEvent,
    processGroupPendingRequests,
    isGroupAutoReqEnabled,
    loadConfig,
    saveConfig,
    getConfig: () => autoReqConfig,
    setConfig: (cfg) => {
        autoReqConfig = cfg;
        saveConfig();
    },
    scheduledBatchTimers,
    processingGroups
};

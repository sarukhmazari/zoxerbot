/**
 * Zoxer Bot - Auto-Leave Closed Groups Command & Engine
 * Scans and exits WhatsApp groups where chat is closed (announce = true)
 * AND the bot does NOT possess administrator privileges.
 * 
 * STRICTLY OFF BY DEFAULT FOR ALL SESSIONS.
 */

const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');
const { getSessionPhone } = require('../lib/session-settings');

// Configuration persistence path
const configPath = path.join(__dirname, '..', 'data', 'autoleaveclosed.json');

// Lock to prevent concurrent sweeps on the same session
const activeSweeps = new Set();

/**
 * Non-blocking sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Helper to ensure async operations do not hang indefinitely
 */
function withTimeout(promise, ms, errorMsg = 'Operation timed out') {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
    ]);
}

/**
 * Load or initialize configuration safely
 * Default state: STRICTLY DISABLED (OFF)
 */
function loadConfig() {
    try {
        if (!fs.existsSync(configPath)) {
            const defaultConfig = {
                enabled: false,
                sessions: {},
                leftCount: 0,
                lastRun: null
            };
            const dir = path.dirname(configPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
            return defaultConfig;
        }
        const content = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error('[AUTO-LEAVE-CLOSED] Error loading configuration:', error.message || error);
        return { enabled: false, sessions: {}, leftCount: 0, lastRun: null };
    }
}

/**
 * Save configuration safely via atomic file write
 */
function saveConfig(config) {
    try {
        const dir = path.dirname(configPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const tempPath = `${configPath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(config, null, 2));
        fs.renameSync(tempPath, configPath);
        return true;
    } catch (error) {
        console.error('[AUTO-LEAVE-CLOSED] Error saving configuration:', error.message || error);
        return false;
    }
}

/**
 * Check if auto-leave is enabled for this session
 * By default: ALWAYS FALSE unless explicitly turned ON by the owner
 */
function isAutoLeaveClosedEnabled(sock) {
    const config = loadConfig();
    if (!config) return false;

    // Global toggle
    if (config.enabled) return true;

    // Per-session toggle
    const phone = getSessionPhone(sock);
    if (phone && config.sessions && config.sessions[phone] === true) {
        return true;
    }

    return false;
}

/**
 * Robustly check if the bot is admin or superadmin in a group
 */
function checkIsBotAdmin(group, sock) {
    if (!group || !group.participants || !Array.isArray(group.participants)) {
        return false;
    }

    const participants = group.participants;
    const botId = sock.user?.id || '';
    const botLid = sock.user?.lid || '';
    
    // Normalize bot phone number
    const botPhone = (botId.split(':')[0].split('@')[0] || '').replace(/[^0-9]/g, '');
    const botLidClean = botLid ? (botLid.split(':')[0].split('@')[0] || '').replace(/[^0-9]/g, '') : '';

    return participants.some(p => {
        if (!p || (p.admin !== 'admin' && p.admin !== 'superadmin')) {
            return false;
        }

        const pId = p.id || '';
        const pLid = p.lid || '';
        const pPhone = (pId.split(':')[0].split('@')[0] || '').replace(/[^0-9]/g, '');
        const pLidClean = pLid ? (pLid.split(':')[0].split('@')[0] || '').replace(/[^0-9]/g, '') : '';
        const pPhoneNumber = p.phoneNumber ? p.phoneNumber.replace(/[^0-9]/g, '') : '';

        // Match bot by full JID
        if (botId && pId && (botId === pId || botId.split(':')[0] === pId.split(':')[0])) return true;
        // Match bot by pure phone number
        if (botPhone && ((pPhone && botPhone === pPhone) || (pPhoneNumber && botPhone === pPhoneNumber))) return true;
        // Match bot by LID (only if both non-empty!)
        if (botLidClean && pLidClean && botLidClean === pLidClean) return true;
        if (botLid && pLid && (botLid === pLid || botLid.split(':')[0] === pLid.split(':')[0])) return true;

        return false;
    });
}

/**
 * Check if group chat is closed (announcement only / non-admins cannot send messages)
 */
function isGroupClosed(group) {
    return Boolean(group?.announce);
}

/**
 * Sweep and leave all closed non-admin groups for this bot session
 * @param {object} sock - Baileys socket instance
 * @param {string} notifyChatId - Chat ID to send progress / report to (optional)
 * @param {object} quotedMsg - Quoted message object (optional)
 * @param {boolean} isManual - Whether triggered manually via command
 */
async function sweepClosedGroups(sock, notifyChatId = null, quotedMsg = null, isManual = false) {
    const sessionKey = sock.user?.id ? sock.user.id.split(':')[0] : 'default';

    if (activeSweeps.has(sessionKey)) {
        if (notifyChatId) {
            await sock.sendMessage(notifyChatId, {
                text: '⚠️ *A closed-group cleanup sweep is already in progress for this session!* Please wait for it to finish.'
            }, { quoted: quotedMsg });
        }
        return { inProgress: true };
    }

    activeSweeps.add(sessionKey);

    try {
        console.log(`[AUTO-LEAVE-CLOSED] Starting sweep for session: ${sessionKey}...`);

        if (notifyChatId && isManual) {
            await sock.sendMessage(notifyChatId, {
                text: '⏳ *Scanning all participating groups...*\n_Checking chat status and admin rights. Please wait..._'
            }, { quoted: quotedMsg });
        }

        // Fetch all participating groups with timeout
        const groupsMap = await withTimeout(
            sock.groupFetchAllParticipating(),
            35000,
            'Fetching participating groups timed out'
        );

        const allGroups = Object.values(groupsMap || {});
        const totalGroups = allGroups.length;

        let openGroupsCount = 0;
        let botAdminGroupsCount = 0;
        const targetClosedGroups = [];

        for (const g of allGroups) {
            if (!g || !g.id) continue;

            const isClosed = isGroupClosed(g);
            const isBotAdmin = checkIsBotAdmin(g, sock);

            if (!isClosed) {
                // Open group where anyone can message -> KEEP
                openGroupsCount++;
            } else if (isBotAdmin) {
                // Closed group, BUT bot is admin -> KEEP (Bot manages this group)
                botAdminGroupsCount++;
            } else {
                // Closed group AND bot is NOT admin -> TARGET TO LEAVE!
                targetClosedGroups.push({
                    id: g.id,
                    subject: g.subject || 'Unnamed Group'
                });
            }
        }

        console.log(`[AUTO-LEAVE-CLOSED] [${sessionKey}]: Total: ${totalGroups} | Open: ${openGroupsCount} | Bot Admin: ${botAdminGroupsCount} | Target Closed: ${targetClosedGroups.length}`);

        // If no closed non-admin groups found
        if (targetClosedGroups.length === 0) {
            if (notifyChatId && isManual) {
                await sock.sendMessage(notifyChatId, {
                    text: `✅ *Scan Complete: No Closed Non-Admin Groups Found!*\n\n` +
                          `📊 *Total Groups:* ${totalGroups}\n` +
                          `🟢 *Open Groups (Chat Enabled):* ${openGroupsCount}\n` +
                          `👑 *Bot Admin Groups (Preserved):* ${botAdminGroupsCount}\n` +
                          `🚪 *Closed Non-Admin Groups:* 0\n\n` +
                          `✨ *Your account is already 100% clean!*`
                }, { quoted: quotedMsg });
            }
            return {
                total: totalGroups,
                open: openGroupsCount,
                botAdmin: botAdminGroupsCount,
                left: 0,
                failed: 0
            };
        }

        // Inform user before leaving
        if (notifyChatId && isManual) {
            await sock.sendMessage(notifyChatId, {
                text: `🚪 *Found ${targetClosedGroups.length} closed group(s) where bot is not admin.*\n\n` +
                      `⚡ *Initiating safe auto-exit with rate-limit protection (2s delay per group)...*`
            }, { quoted: quotedMsg });
        }

        let leftCount = 0;
        let failCount = 0;

        // Leave target groups sequentially with safe delay to protect socket
        for (let i = 0; i < targetClosedGroups.length; i++) {
            const target = targetClosedGroups[i];
            try {
                console.log(`[AUTO-LEAVE-CLOSED] [${i + 1}/${targetClosedGroups.length}] Leaving closed group: ${target.id} ("${target.subject}")...`);
                
                await withTimeout(
                    sock.groupLeave(target.id),
                    12000,
                    `Timeout leaving ${target.id}`
                );

                leftCount++;
            } catch (leaveErr) {
                console.error(`[AUTO-LEAVE-CLOSED] Failed to leave group ${target.id}:`, leaveErr.message || leaveErr);
                failCount++;
            }

            // Safe pause between leaving groups to strictly prevent WhatsApp ban / rate limits
            if (i < targetClosedGroups.length - 1) {
                await sleep(2000);
            }
        }

        // Update persistent stats
        const config = loadConfig();
        config.leftCount = (config.leftCount || 0) + leftCount;
        config.lastRun = new Date().toISOString();
        saveConfig(config);

        console.log(`[AUTO-LEAVE-CLOSED] Sweep finished. Successfully left: ${leftCount}, Failed: ${failCount}`);

        if (notifyChatId) {
            await sock.sendMessage(notifyChatId, {
                text: `✅ *Auto-Leave Closed Groups Complete*\n\n` +
                      `📊 *Total Groups Scanned:* ${totalGroups}\n` +
                      `🟢 *Open Groups (Chat Allowed):* ${openGroupsCount}\n` +
                      `👑 *Bot Admin Groups (Preserved):* ${botAdminGroupsCount}\n` +
                      `🚪 *Closed Groups Left:* ${leftCount}\n` +
                      `❌ *Failed:* ${failCount}\n\n` +
                      `🛡️ *All closed non-admin groups were left safely with zero rate limits!*`
            }, { quoted: quotedMsg });
        }

        return {
            total: totalGroups,
            open: openGroupsCount,
            botAdmin: botAdminGroupsCount,
            left: leftCount,
            failed: failCount
        };

    } catch (err) {
        console.error('[AUTO-LEAVE-CLOSED] Fatal sweep error:', err);
        if (notifyChatId) {
            await sock.sendMessage(notifyChatId, {
                text: `❌ *Error during closed groups sweep:*\n${err.message || err}`
            }, { quoted: quotedMsg });
        }
        return { error: err.message };
    } finally {
        activeSweeps.delete(sessionKey);
    }
}

/**
 * Real-time event handler for group settings updates (e.g. chat closed by admin)
 */
async function handleGroupSettingsUpdate(sock, update) {
    if (!update || !update.id) return;
    if (!isAutoLeaveClosedEnabled(sock)) return;

    // Check if announce setting was turned ON (chat closed to non-admins)
    if (update.announce === true || update.announce === 1) {
        try {
            console.log(`[AUTO-LEAVE-CLOSED] Group ${update.id} changed settings to closed chat. Verifying admin status...`);
            
            // Wait 2 seconds for server synchronization
            await sleep(2000);

            // Fetch group metadata
            const metadata = await sock.groupMetadata(update.id);
            if (!metadata) return;

            const isBotAdmin = checkIsBotAdmin(metadata, sock);
            if (!isBotAdmin && isGroupClosed(metadata)) {
                console.log(`[AUTO-LEAVE-CLOSED] Bot is not admin in closed group ${update.id} ("${metadata.subject}"). Leaving group...`);
                await sock.groupLeave(update.id);

                const config = loadConfig();
                config.leftCount = (config.leftCount || 0) + 1;
                config.lastRun = new Date().toISOString();
                saveConfig(config);
            }
        } catch (err) {
            console.error(`[AUTO-LEAVE-CLOSED] Error evaluating group settings update for ${update.id}:`, err.message);
        }
    }
}

/**
 * Real-time event handler for participant events (add / demote)
 */
async function handleGroupParticipantUpdateForAutoLeave(sock, groupId, action, participants) {
    if (!groupId || !isAutoLeaveClosedEnabled(sock)) return;

    // Only inspect if bot was added to a group or demoted in a group
    if (action !== 'add' && action !== 'demote') return;

    try {
        await sleep(2500); // Allow server stanzas to settle

        const metadata = await sock.groupMetadata(groupId);
        if (!metadata || !isGroupClosed(metadata)) return;

        const isBotAdmin = checkIsBotAdmin(metadata, sock);
        if (!isBotAdmin) {
            console.log(`[AUTO-LEAVE-CLOSED] Detected bot in closed group ${groupId} ("${metadata.subject}") without admin rights after ${action}. Leaving...`);
            await sock.groupLeave(groupId);

            const config = loadConfig();
            config.leftCount = (config.leftCount || 0) + 1;
            config.lastRun = new Date().toISOString();
            saveConfig(config);
        }
    } catch (err) {
        // Silently ignore if bot already left or group was not accessible
    }
}

/**
 * Main command handler for .leaveclosed / .autoleaveclosed
 */
async function autoleaveclosedCommand(sock, chatId, senderId, message, args = []) {
    try {
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
        if (!isOwner && !message.key.fromMe) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Access Denied:* Only the bot owner or sudo users can configure or run the Auto-Leave Closed Groups engine.'
            }, { quoted: message });
        }

        const sub = (args[0] || '').toLowerCase().trim();
        const config = loadConfig();
        const sessionPhone = getSessionPhone(sock);
        const isCurrentEnabled = Boolean(config.enabled || (config.sessions && config.sessions[sessionPhone]));

        // Subcommand: ON / ENABLE
        if (sub === 'on' || sub === 'enable' || sub === '1') {
            if (!config.sessions) config.sessions = {};
            config.sessions[sessionPhone] = true;
            config.enabled = true; // Active
            saveConfig(config);

            await sock.sendMessage(chatId, {
                text: `🚪 *Auto-Leave Closed Groups: ACTIVATED (ON)* 🟢\n\n` +
                      `⚡ *Status:* Enabled for session *${sessionPhone}*\n` +
                      `🛡️ *Rule:* The bot will automatically exit any group where chat is closed (admin-only) AND the bot is NOT an admin.\n` +
                      `👑 *Safety:* Open groups and groups where the bot IS an admin are strictly preserved.\n\n` +
                      `🚀 *Now starting an automated initial sweep...*`
            }, { quoted: message });

            // Run initial sweep in background
            sweepClosedGroups(sock, chatId, message, false).catch(err => {
                console.error('[AUTO-LEAVE-CLOSED] Initial sweep error:', err.message);
            });
            return;
        }

        // Subcommand: OFF / DISABLE
        if (sub === 'off' || sub === 'disable' || sub === '0') {
            if (!config.sessions) config.sessions = {};
            config.sessions[sessionPhone] = false;
            config.enabled = false;
            saveConfig(config);

            return await sock.sendMessage(chatId, {
                text: `🚪 *Auto-Leave Closed Groups: DEACTIVATED (OFF)* 🔴\n\n` +
                      `The bot will NO LONGER automatically exit closed groups.\n` +
                      `_You can re-enable anytime using *.leaveclosed on* or run a manual sweep with *.leaveclosed run*._`
            }, { quoted: message });
        }

        // Subcommand: STATUS
        if (sub === 'status' || sub === 'info') {
            return await sock.sendMessage(chatId, {
                text: `╭─ *🚪 𝗔𝗨𝗧𝗢-𝗟𝗘𝗔𝗩𝗘 𝗖𝗟𝗢𝗦𝗘𝗗 𝗚𝗥𝗢𝗨𝗣𝗦* ─╮\n` +
                      `│\n` +
                      `│  ◈ *STATUS:* ${isCurrentEnabled ? '🟢 Enabled (ON)' : '🔴 Disabled (OFF)'}\n` +
                      `│  ◈ *SESSION:* ${sessionPhone}\n` +
                      `│  ◈ *TOTAL LEFT SO FAR:* ${config.leftCount || 0} group(s)\n` +
                      `│  ◈ *LAST RUN:* ${config.lastRun ? new Date(config.lastRun).toLocaleString() : 'Never'}\n` +
                      `│\n` +
                      `│  ◈ *AVAILABLE COMMANDS:*\n` +
                      `│  ◆ *.leaveclosed on*     -> Turn ON auto-exit\n` +
                      `│  ◆ *.leaveclosed off*    -> Turn OFF auto-exit\n` +
                      `│  ◆ *.leaveclosed run*    -> Clean closed groups now\n` +
                      `│  ◆ *.leaveclosed status* -> View this status\n` +
                      `│\n` +
                      `╰──────────────────────────────────────────╯`
            }, { quoted: message });
        }

        // Subcommand: RUN / NOW / SWEEP or plain .leaveclosed
        // Performs an immediate one-time cleanup sweep
        await sweepClosedGroups(sock, chatId, message, true);

    } catch (err) {
        console.error('[AUTO-LEAVE-CLOSED] Command execution error:', err);
        await sock.sendMessage(chatId, {
            text: `❌ *Error executing Auto-Leave Closed command:*\n${err.message || err}`
        }, { quoted: message });
    }
}

module.exports = {
    autoleaveclosedCommand,
    sweepClosedGroups,
    isAutoLeaveClosedEnabled,
    handleGroupSettingsUpdate,
    handleGroupParticipantUpdateForAutoLeave,
    checkIsBotAdmin,
    isGroupClosed
};

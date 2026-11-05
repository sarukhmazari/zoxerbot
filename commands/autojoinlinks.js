/**
 * Zoxer Bot - A WhatsApp Bot
 * Autojoinlinks Command & Auto Group Join Engine (Per-Session Scoped)
 * STRICTLY OFF BY DEFAULT FOR ALL SESSIONS
 */

const fs = require('fs');
const path = require('path');
const { getSessionPhone, isSessionOwner } = require('../lib/session-settings');

// Path to configuration file
const configPath = path.join(__dirname, '..', 'data', 'autojoinlinks.json');

// In-memory cache for processed invitation codes to prevent duplicate queries/joins
const processedInviteCodes = new Map();
const MAX_PROCESSED_CODES = 2000;
const CODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Per-session cache of participating group JIDs: sessionPhone -> { jids: Set<string>, lastFetch: number }
const sessionParticipatingGroups = new Map();
const GROUP_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Concurrency lock / queue for join operations to avoid aggressive joining & rate limits
let joinQueuePromise = Promise.resolve();

/**
 * Load or initialize configuration safely
 */
function loadConfig() {
    try {
        if (!fs.existsSync(configPath)) {
            const defaultConfig = { enabled: false, sessions: {} };
            const dir = path.dirname(configPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
            return defaultConfig;
        }
        const content = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error('[AUTOJOINLINKS] Error loading configuration:', error.message || error);
        return { enabled: false, sessions: {} };
    }
}

/**
 * Save configuration safely to JSON file
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
        console.error('[AUTOJOINLINKS] Error saving configuration:', error.message || error);
        return false;
    }
}

/**
 * Check whether auto-join is enabled for this session
 * STRICTLY OFF BY DEFAULT FOR ALL SESSIONS
 */
function isAutoJoinEnabled(sessionPhone) {
    try {
        const config = loadConfig();
        if (sessionPhone && config.sessions && config.sessions[sessionPhone] && typeof config.sessions[sessionPhone].enabled === 'boolean') {
            return config.sessions[sessionPhone].enabled;
        }
        // STRICT REQUIREMENT: default is false for all sessions
        return false;
    } catch (error) {
        console.error('[AUTOJOINLINKS] Error checking enabled status:', error.message || error);
        return false;
    }
}

/**
 * Clean up old entries in processed codes map
 */
function cleanProcessedCodesCache() {
    const now = Date.now();
    for (const [code, entry] of processedInviteCodes.entries()) {
        if (now - entry.timestamp > CODE_CACHE_TTL_MS) {
            processedInviteCodes.delete(code);
        }
    }
    if (processedInviteCodes.size > MAX_PROCESSED_CODES) {
        const keys = Array.from(processedInviteCodes.keys());
        for (let i = 0; i < keys.length - MAX_PROCESSED_CODES; i++) {
            processedInviteCodes.delete(keys[i]);
        }
    }
}

/**
 * Helper to wrap promises with timeout
 */
function withTimeout(promise, ms = 12000, errorMsg = 'Operation timed out') {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
    ]);
}

/**
 * Extract WhatsApp group invitation codes from text
 */
function extractGroupInviteCodes(text) {
    if (!text || typeof text !== 'string') return [];

    const regex = /(?:https?:\/\/)?(?:www\.)?chat\.whatsapp\.com\/([a-zA-Z0-9_-]+)/gi;
    const codes = new Set();
    let match;

    while ((match = regex.exec(text)) !== null) {
        const rawPart = match[1];
        if (!rawPart) continue;

        const cleanPart = rawPart
            .split('?')[0]
            .split('#')[0]
            .replace(/[.,!?:;)"']+$/, '')
            .trim();

        if (cleanPart.length >= 10 && cleanPart.length <= 35 && /^[a-zA-Z0-9_-]+$/.test(cleanPart)) {
            codes.add(cleanPart);
        }
    }

    return Array.from(codes);
}

/**
 * Fetch and cache participating group JIDs for the bot socket
 */
async function getParticipatingGroups(sock, sessionPhone) {
    const cached = sessionParticipatingGroups.get(sessionPhone);
    const now = Date.now();

    if (cached && (now - cached.lastFetch < GROUP_CACHE_TTL_MS)) {
        return cached.jids;
    }

    try {
        if (typeof sock.groupFetchAllParticipating === 'function') {
            const groups = await withTimeout(
                sock.groupFetchAllParticipating(),
                10000,
                'groupFetchAllParticipating timed out'
            );
            const jids = new Set(Object.keys(groups || {}));
            sessionParticipatingGroups.set(sessionPhone, { jids, lastFetch: now });
            return jids;
        }
    } catch (err) {
        console.warn(`[AUTOJOINLINKS] Failed to fetch participating groups: ${err.message || err}`);
    }

    return cached?.jids || new Set();
}

/**
 * Mark a group as joined in local session cache
 */
function markGroupJoined(sessionPhone, groupJid) {
    if (!groupJid) return;
    let cached = sessionParticipatingGroups.get(sessionPhone);
    if (!cached) {
        cached = { jids: new Set(), lastFetch: Date.now() };
        sessionParticipatingGroups.set(sessionPhone, cached);
    }
    cached.jids.add(groupJid.toLowerCase());
}

/**
 * Handle a single invite code: validate, check if already member, and join
 */
async function processInviteCode(sock, code, sessionPhone) {
    cleanProcessedCodesCache();

    const existing = processedInviteCodes.get(code);
    if (existing) {
        if (existing.status === 'joined' || existing.status === 'already_member') {
            return { success: false, reason: 'already_handled', groupId: existing.groupId };
        }
        if (Date.now() - existing.timestamp < 60 * 60 * 1000) {
            return { success: false, reason: existing.status };
        }
    }

    let targetGroupId = null;
    let groupSubject = '';

    try {
        if (typeof sock.groupGetInviteInfo === 'function') {
            const inviteInfo = await withTimeout(
                sock.groupGetInviteInfo(code),
                12000,
                'groupGetInviteInfo timed out'
            );
            if (inviteInfo) {
                targetGroupId = inviteInfo.id;
                groupSubject = inviteInfo.subject || '';
            }
        }
    } catch (infoError) {
        const errorMsg = String(infoError.message || infoError).toLowerCase();
        const statusCode = infoError.output?.statusCode || infoError.status || infoError.data;

        if (statusCode === 404 || statusCode === 410 || statusCode === 401 || errorMsg.includes('not-authorized') || errorMsg.includes('gone')) {
            console.warn(`[AUTOJOINLINKS] Invite code ${code} is invalid, expired, or revoked (Status ${statusCode}).`);
            processedInviteCodes.set(code, { status: 'invalid', timestamp: Date.now() });
            return { success: false, reason: 'invalid_or_expired' };
        }

        console.warn(`[AUTOJOINLINKS] groupGetInviteInfo error for code ${code}:`, infoError.message || infoError);
    }

    const participatingJids = await getParticipatingGroups(sock, sessionPhone);
    if (targetGroupId && participatingJids.has(targetGroupId.toLowerCase())) {
        console.log(`[AUTOJOINLINKS] Bot is already a member of group: "${groupSubject}" (${targetGroupId}). Skipping.`);
        processedInviteCodes.set(code, { status: 'already_member', groupId: targetGroupId, timestamp: Date.now() });
        return { success: false, reason: 'already_member', groupId: targetGroupId, subject: groupSubject };
    }

    if (targetGroupId && typeof sock.groupMetadata === 'function') {
        try {
            const meta = await withTimeout(sock.groupMetadata(targetGroupId), 5000);
            if (meta && meta.id) {
                console.log(`[AUTOJOINLINKS] Bot is already a member of group: "${meta.subject || targetGroupId}". Skipping.`);
                markGroupJoined(sessionPhone, targetGroupId);
                processedInviteCodes.set(code, { status: 'already_member', groupId: targetGroupId, timestamp: Date.now() });
                return { success: false, reason: 'already_member', groupId: targetGroupId, subject: meta.subject };
            }
        } catch (_) {}
    }

    try {
        console.log(`[AUTOJOINLINKS] Attempting to join group "${groupSubject || code}" via code: ${code}...`);
        const joinedJid = await withTimeout(
            sock.groupAcceptInvite(code),
            15000,
            'groupAcceptInvite timed out'
        );

        const finalGroupId = joinedJid || targetGroupId;
        if (finalGroupId) {
            markGroupJoined(sessionPhone, finalGroupId);
        }
        processedInviteCodes.set(code, { status: 'joined', groupId: finalGroupId, timestamp: Date.now() });
        console.log(`[AUTOJOINLINKS] ✅ Successfully joined group "${groupSubject || finalGroupId || code}"!`);

        return { success: true, groupId: finalGroupId, subject: groupSubject };
    } catch (joinError) {
        const errorMsg = String(joinError.message || joinError).toLowerCase();
        const statusCode = joinError.output?.statusCode || joinError.status || joinError.data;

        if (statusCode === 409 || errorMsg.includes('409') || errorMsg.includes('conflict')) {
            console.log(`[AUTOJOINLINKS] Bot is already a member (Status 409) for code ${code}.`);
            if (targetGroupId) markGroupJoined(sessionPhone, targetGroupId);
            processedInviteCodes.set(code, { status: 'already_member', groupId: targetGroupId, timestamp: Date.now() });
            return { success: false, reason: 'already_member', groupId: targetGroupId };
        }

        if (statusCode === 401 || statusCode === 403 || statusCode === 404 || statusCode === 410) {
            console.warn(`[AUTOJOINLINKS] Join rejected (Status ${statusCode}) for code ${code}: ${joinError.message}`);
            processedInviteCodes.set(code, { status: 'rejected', timestamp: Date.now() });
            return { success: false, reason: 'rejected', statusCode };
        }

        console.error(`[AUTOJOINLINKS] ❌ Failed to join group via code ${code}:`, joinError.message || joinError);
        processedInviteCodes.set(code, { status: 'failed', timestamp: Date.now() });
        return { success: false, reason: 'error', error: joinError.message };
    }
}

/**
 * Handle incoming message for automatic group link detection and joining
 */
async function handleAutoJoinLinks(sock, message, rawText) {
    try {
        if (!message || !rawText || typeof rawText !== 'string') return;

        const sessionPhone = getSessionPhone(sock);

        // Check if feature is enabled for this session (strictly OFF by default)
        if (!isAutoJoinEnabled(sessionPhone)) {
            return;
        }

        if (!rawText.toLowerCase().includes('chat.whatsapp.com')) {
            return;
        }

        const trimmed = rawText.trim().toLowerCase();
        if (trimmed.startsWith('.add ') || trimmed === '.add') {
            return;
        }

        const codes = extractGroupInviteCodes(rawText);
        if (codes.length === 0) return;

        joinQueuePromise = joinQueuePromise.then(async () => {
            for (let i = 0; i < codes.length; i++) {
                const code = codes[i];
                try {
                    await processInviteCode(sock, code, sessionPhone);
                } catch (codeErr) {
                    console.error(`[AUTOJOINLINKS] Unexpected error processing code ${code}:`, codeErr.message || codeErr);
                }

                if (i + 1 < codes.length) {
                    await new Promise(resolve => setTimeout(resolve, 2500));
                }
            }
        }).catch(err => {
            console.error('[AUTOJOINLINKS] Queue processing error:', err.message || err);
        });

    } catch (error) {
        console.error('[AUTOJOINLINKS] Error in handleAutoJoinLinks:', error.message || error);
    }
}

/**
 * .autojoinlinks Command Handler (Session-Scoped)
 */
async function autojoinlinksCommand(sock, chatId, message, args = []) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const isOwner = isSessionOwner(sock, senderId, message);

        if (!message.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, {
                text: '❌ This command is only available for the session owner!'
            }, { quoted: message });
            return;
        }

        const sessionPhone = getSessionPhone(sock);
        const config = loadConfig();
        const currentStatus = isAutoJoinEnabled(sessionPhone);

        const subCommand = (args[0] || '').toLowerCase().trim();

        if (subCommand === 'on' || subCommand === 'enable') {
            config.enabled = false; // Always keep global fallback OFF
            if (!config.sessions) config.sessions = {};
            config.sessions[sessionPhone] = { enabled: true };
            saveConfig(config);

            await sock.sendMessage(chatId, {
                text: `✅ Auto Join Links has been enabled for session *${sessionPhone}*.`
            }, { quoted: message });
            return;
        }

        if (subCommand === 'off' || subCommand === 'disable') {
            config.enabled = false;
            if (!config.sessions) config.sessions = {};
            config.sessions[sessionPhone] = { enabled: false };
            saveConfig(config);

            await sock.sendMessage(chatId, {
                text: `❌ Auto Join Links has been disabled for session *${sessionPhone}*.`
            }, { quoted: message });
            return;
        }

        if (subCommand === 'status') {
            await sock.sendMessage(chatId, {
                text: `Auto Join Links for session *${sessionPhone}*: ${currentStatus ? 'ON' : 'OFF'}`
            }, { quoted: message });
            return;
        }

        // Default: display status and command usage guidance
        const reply = `Auto Join Links for session *${sessionPhone}*: ${currentStatus ? 'ON' : 'OFF'}\n\n*Usage:*\n• \`.autojoinlinks on\` — Enable automatic joining for this session\n• \`.autojoinlinks off\` — Disable automatic joining for this session\n• \`.autojoinlinks status\` — Check current status`;

        await sock.sendMessage(chatId, { text: reply }, { quoted: message });

    } catch (error) {
        console.error('[AUTOJOINLINKS] Error in autojoinlinksCommand:', error.message || error);
        await sock.sendMessage(chatId, {
            text: '❌ Error processing .autojoinlinks command.'
        }, { quoted: message });
    }
}

function clearCachesForTesting() {
    processedInviteCodes.clear();
    sessionParticipatingGroups.clear();
}

module.exports = {
    autojoinlinksCommand,
    isAutoJoinEnabled,
    extractGroupInviteCodes,
    processInviteCode,
    handleAutoJoinLinks,
    clearCachesForTesting
};

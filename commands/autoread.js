/**
 * Zoxer MD - Autoread Command & High-Throughput Engine
 * Automatically and instantly marks all incoming messages as read (Blue Ticks).
 * Optimized for 100-200+ active groups with continuous message traffic.
 */

const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');
const {
    getSessionPhone,
    getAutoReadConfig,
    setAutoReadConfig
} = require('../lib/session-settings');

// Path to configuration file
const configPath = path.join(__dirname, '..', 'data', 'autoread.json');

// In-memory fast cache to avoid disk reads on every incoming message
let _memoryConfig = null;
let _lastConfigRead = 0;
const CONFIG_CACHE_TTL = 3000; // 3 seconds refresh

/**
 * Read configuration with in-memory cache
 */
function readConfig() {
    const now = Date.now();
    if (_memoryConfig && (now - _lastConfigRead < CONFIG_CACHE_TTL)) {
        return _memoryConfig;
    }
    try {
        if (!fs.existsSync(configPath)) {
            const initial = { enabled: false, sessions: {} };
            fs.writeFileSync(configPath, JSON.stringify(initial, null, 2));
            _memoryConfig = initial;
            _lastConfigRead = now;
            return _memoryConfig;
        }
        const content = fs.readFileSync(configPath, 'utf8');
        _memoryConfig = JSON.parse(content);
        _lastConfigRead = now;
    } catch (_) {
        _memoryConfig = _memoryConfig || { enabled: false, sessions: {} };
    }
    return _memoryConfig;
}

/**
 * Invalidate memory cache immediately on setting update
 */
function invalidateCache() {
    _memoryConfig = null;
    _lastConfigRead = 0;
}

/**
 * Ultra-fast check if autoread is enabled for the given socket
 */
function isAutoreadEnabled(sock = null) {
    try {
        if (sock) {
            const sessionConfig = getAutoReadConfig(sock);
            if (sessionConfig && typeof sessionConfig.enabled === 'boolean') {
                return sessionConfig.enabled;
            }
        }
        const cfg = readConfig();
        if (sock) {
            const phone = getSessionPhone(sock);
            if (cfg.sessions && cfg.sessions[phone] && typeof cfg.sessions[phone].enabled === 'boolean') {
                return cfg.sessions[phone].enabled;
            }
        }
        return Boolean(cfg.enabled);
    } catch (e) {
        return false;
    }
}

// ⚡ Deduplication cache: keeps track of recently read message IDs to avoid sending duplicate receipts
const recentlyReadMessageIds = new Map(); // id -> timestamp
const MAX_READ_CACHE = 30000;

// Periodic cleanup of read cache every 60 seconds
setInterval(() => {
    const expiry = Date.now() - 120000; // 2 minutes retention
    for (const [id, ts] of recentlyReadMessageIds.entries()) {
        if (ts < expiry) {
            recentlyReadMessageIds.delete(id);
        }
    }
    // Safety clamp if under massive burst
    if (recentlyReadMessageIds.size > MAX_READ_CACHE) {
        const excess = recentlyReadMessageIds.size - MAX_READ_CACHE;
        let count = 0;
        for (const id of recentlyReadMessageIds.keys()) {
            recentlyReadMessageIds.delete(id);
            count++;
            if (count >= excess) break;
        }
    }
}, 60000);

/**
 * Filter: determines whether a message key is eligible for autoread
 */
function shouldAutoReadKey(key) {
    if (!key) return false;
    // Never mark our own messages as read
    if (key.fromMe) return false;
    const jid = key.remoteJid;
    if (!jid) return false;
    // Status broadcast has its own viewer in autostatus.js
    if (jid === 'status@broadcast') return false;
    // Newsletters do not support read receipts
    if (jid.endsWith('@newsletter')) return false;
    // Must have a valid message ID
    if (!key.id) return false;
    return true;
}

// Per-socket batching queue for high-throughput receipt aggregation
const socketQueues = new WeakMap();
const pendingFlushes = new WeakSet();

/**
 * Flush all queued keys for a given socket in aggregated chunks
 */
async function flushSocketQueue(sock) {
    pendingFlushes.delete(sock);
    const queue = socketQueues.get(sock);
    if (!queue || queue.length === 0) return;

    // Process all keys accumulated during this tick in chunks of up to 100
    while (queue.length > 0) {
        const chunk = queue.splice(0, 100);
        try {
            if (typeof sock.readMessages === 'function') {
                await sock.readMessages(chunk);
            } else if (typeof sock.sendReceipts === 'function') {
                await sock.sendReceipts(chunk, 'read');
            }
        } catch (err) {
            // Direct fallback if readMessages threw on privacy settings
            try {
                if (typeof sock.sendReceipts === 'function') {
                    await sock.sendReceipts(chunk, 'read');
                }
            } catch (_) {}
        }
    }
}

/**
 * Enqueue keys to the socket's microsecond flush queue
 */
function enqueueKeys(sock, keys) {
    if (!sock || !Array.isArray(keys) || keys.length === 0) return;

    let queue = socketQueues.get(sock);
    if (!queue) {
        queue = [];
        socketQueues.set(sock, queue);
    }

    queue.push(...keys);

    if (!pendingFlushes.has(sock)) {
        pendingFlushes.add(sock);
        // Immediate dispatch on next micro-tick (< 1ms delay)
        setImmediate(() => {
            flushSocketQueue(sock).catch(() => {});
        });
    }
}

/**
 * ⚡ Fast-Lane Autoread Batch:
 * Called directly at the very top of `messages.upsert` in baileys-helper.js.
 * Operates in < 1ms across 100-200 groups simultaneously.
 */
function fastAutoReadBatch(sock, rawMessages) {
    if (!sock || !Array.isArray(rawMessages) || rawMessages.length === 0) return;
    if (!isAutoreadEnabled(sock)) return;

    const now = Date.now();
    const keysToRead = [];

    for (let i = 0; i < rawMessages.length; i++) {
        const msg = rawMessages[i];
        const key = msg?.key;
        if (!shouldAutoReadKey(key)) continue;

        // Skip if already marked as read
        if (recentlyReadMessageIds.has(key.id)) continue;
        recentlyReadMessageIds.set(key.id, now);

        keysToRead.push({
            remoteJid: key.remoteJid,
            id: key.id,
            participant: key.participant,
            fromMe: false
        });
    }

    if (keysToRead.length > 0) {
        enqueueKeys(sock, keysToRead);
    }
}

/**
 * Single-message handler for main.js compatibility
 */
async function handleAutoread(sock, message) {
    if (!sock || !message?.key) return false;
    if (!isAutoreadEnabled(sock)) return false;

    const key = message.key;
    if (!shouldAutoReadKey(key)) return false;

    if (recentlyReadMessageIds.has(key.id)) return true;
    recentlyReadMessageIds.set(key.id, Date.now());

    enqueueKeys(sock, [{
        remoteJid: key.remoteJid,
        id: key.id,
        participant: key.participant,
        fromMe: false
    }]);

    return true;
}

/**
 * Command Handler: .autoread [on|off|status]
 */
async function autoreadCommand(sock, chatId, message, args = []) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);

        if (!message.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, {
                text: '❌ *Permission Denied!* This command is restricted to the bot owner.'
            }, { quoted: message });
            return;
        }

        const sessionPhone = getSessionPhone(sock);
        const currentConfig = getAutoReadConfig(sock);
        let newState = currentConfig.enabled;

        const sub = (args[0] || '').toLowerCase().trim();

        if (sub === 'on' || sub === 'enable' || sub === '1') {
            newState = true;
        } else if (sub === 'off' || sub === 'disable' || sub === '0') {
            newState = false;
        } else if (sub === 'status') {
            const statusText = `╭─ *👁️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗨𝗧𝗢-𝗥𝗘𝗔𝗗 𝗦𝗧𝗔𝗧𝗨𝗦*
┃
┃  ◈ *Session:* \`${sessionPhone}\`
┃  ◈ *Status:* ${currentConfig.enabled ? '🟢 *ENABLED (ON)*' : '🔴 *DISABLED (OFF)*'}
┃  ◈ *Performance:* ⚡ *Ultra-Fast (<1ms / Zero-Delay)*
┃  ◈ *Capacity:* 🚀 *Optimized for 200+ Active Groups*
┃  ◈ *Scope:* All Private DMs & Group Messages
┃
╰────────────────────────`;
            await sock.sendMessage(chatId, { text: statusText }, { quoted: message });
            return;
        } else {
            // Toggle
            newState = !currentConfig.enabled;
        }

        // Apply to session-settings and global config
        setAutoReadConfig(sock, newState, true);
        invalidateCache();

        const reply = `╭─ *👁️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗨𝗧𝗢-𝗥𝗘𝗔𝗗*
┃
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦:* ${newState ? '🟢 *ENABLED (ON)*' : '🔴 *DISABLED (OFF)*'}
┃  ◈ *𝗦𝗘𝗦𝗦𝗜𝗢𝗡:* \`${sessionPhone}\`
┃  ◈ *𝗠𝗢𝗗𝗘:* ⚡ *High-Throughput Millisecond Auto-Read*
┃  ◈ *𝗖𝗔𝗣𝗔𝗖𝗜𝗧𝗬:* 🚀 *Handles 200+ Simultaneous Groups*
┃  ◈ *𝗗𝗘𝗦𝗖𝗥𝗜𝗣𝗧𝗜𝗢𝗡:*
┃  ◆ Every incoming message will be immediately
┃  ◆ marked as read with blue ticks in real-time.
┃
╰────────────────────────`;

        await sock.sendMessage(chatId, { text: reply }, { quoted: message });

    } catch (error) {
        console.error('Error in autoread command:', error);
        await sock.sendMessage(chatId, {
            text: `❌ Error processing autoread command: ${error.message}`
        }, { quoted: message });
    }
}

module.exports = {
    autoreadCommand,
    isAutoreadEnabled,
    handleAutoread,
    fastAutoReadBatch,
    shouldAutoReadKey
};

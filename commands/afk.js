const fs = require('fs');
const path = require('path');

const dataFilePath = path.join(__dirname, '../data/afk.json');

// In-memory AFK store: { [userJid]: { reason: string, time: number } }
let afkData = {};

// Cooldown to prevent spamming AFK notice if someone spams tags: { "chatId:targetJid": timestamp }
const mentionCooldowns = new Map();

function loadAfk() {
    try {
        if (fs.existsSync(dataFilePath)) {
            afkData = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));
        } else {
            afkData = {};
            fs.writeFileSync(dataFilePath, JSON.stringify(afkData, null, 2));
        }
    } catch (e) {
        console.error('[AFK] Failed to load afk.json:', e);
        afkData = {};
    }
}

function saveAfk() {
    try {
        fs.writeFileSync(dataFilePath, JSON.stringify(afkData, null, 2));
    } catch (e) {
        console.error('[AFK] Failed to save afk.json:', e);
    }
}

loadAfk();

function formatDuration(ms) {
    const totalSecs = Math.floor(ms / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const seconds = totalSecs % 60;

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(' ');
}

function cleanJid(jid) {
    if (!jid) return '';
    return jid.split(':')[0].split('@')[0] + '@s.whatsapp.net';
}

/**
 * .afk command
 * Usage:
 *   .afk [reason]
 */
async function afkCommand(sock, chatId, senderId, message, args = []) {
    const normalizedSender = cleanJid(senderId || message.key.participant || chatId);
    const reason = args.join(' ').trim() || 'No reason specified';

    afkData[normalizedSender] = {
        reason,
        time: Date.now()
    };
    saveAfk();

    const senderTag = `@${normalizedSender.split('@')[0]}`;
    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    await sock.sendMessage(chatId, {
        text: `💤 *${senderTag} is now AFK!*\n\n` +
              `📝 *Reason:* ${reason}\n` +
              `🕒 *Since:* ${timeString}\n\n` +
              `_I will inform anyone who tags or mentions you._`,
        mentions: [normalizedSender]
    }, { quoted: message });
}

/**
 * Called on every incoming message to check if the sender is returning from AFK
 */
async function handleAfkReturn(sock, chatId, message, senderId) {
    try {
        const normalizedSender = cleanJid(senderId || message.key.participant || chatId);
        if (!afkData[normalizedSender]) return false;

        const info = afkData[normalizedSender];
        const elapsedMs = Date.now() - info.time;

        // If the user set AFK less than 5 seconds ago, ignore accidental immediate messages
        if (elapsedMs < 5000) return false;

        delete afkData[normalizedSender];
        saveAfk();

        const senderTag = `@${normalizedSender.split('@')[0]}`;
        const durationStr = formatDuration(elapsedMs);

        await sock.sendMessage(chatId, {
            text: `👋 *Welcome back ${senderTag}!* You are no longer AFK.\n\n` +
                  `⏱️ *You were away for:* ${durationStr}`,
            mentions: [normalizedSender]
        }, { quoted: message });

        return true;
    } catch (e) {
        console.error('[AFK] Error handling return:', e);
        return false;
    }
}

/**
 * Called on every incoming message to check if anyone tagged or quoted an AFK user
 */
async function handleAfkMentions(sock, chatId, message) {
    try {
        const msg = message.message || {};
        const contextInfo = msg.extendedTextMessage?.contextInfo ||
                            msg.imageMessage?.contextInfo ||
                            msg.videoMessage?.contextInfo ||
                            msg.stickerMessage?.contextInfo ||
                            msg.documentMessage?.contextInfo;

        const mentionedJids = contextInfo?.mentionedJid || [];
        const quotedParticipant = contextInfo?.participant;

        const targets = new Set();
        for (const jid of mentionedJids) {
            targets.add(cleanJid(jid));
        }
        if (quotedParticipant) {
            targets.add(cleanJid(quotedParticipant));
        }

        const senderNormalized = cleanJid(message.key.participant || chatId);

        for (const targetJid of targets) {
            // Don't alert if the user is quoting/tagging themselves
            if (targetJid === senderNormalized) continue;

            if (afkData[targetJid]) {
                const cooldownKey = `${chatId}:${targetJid}`;
                const lastAlert = mentionCooldowns.get(cooldownKey) || 0;
                // 25 second cooldown per chat per target to avoid spam
                if (Date.now() - lastAlert < 25000) continue;

                mentionCooldowns.set(cooldownKey, Date.now());

                const info = afkData[targetJid];
                const awayDuration = formatDuration(Date.now() - info.time);
                const targetTag = `@${targetJid.split('@')[0]}`;

                await sock.sendMessage(chatId, {
                    text: `💤 *${targetTag} is currently AFK!*\n\n` +
                          `📝 *Reason:* ${info.reason}\n` +
                          `⏱️ *Away for:* ${awayDuration} ago`,
                    mentions: [targetJid]
                }, { quoted: message });
            }
        }
    } catch (e) {
        console.error('[AFK] Error checking mentions:', e);
    }
}

module.exports = {
    afkCommand,
    handleAfkReturn,
    handleAfkMentions
};

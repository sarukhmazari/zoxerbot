/**
 * Zoxer Bot - A WhatsApp Bot
 * Antiforeign Command & Real-time Country Code Security Engine
 */

const { isJidGroup } = require('@whiskeysockets/baileys');
const { getAntiforeign, setAntiforeign, isSudo } = require('../lib/index');
const isAdmin = require('../lib/isAdmin');
const isOwnerOrSudo = require('../lib/isOwner');
const settings = require('../settings');

// Track kicked participants from join event to suppress welcome messages
const recentlyKickedJoiners = new Set();

/**
 * Clean prefix input: removes +, -, spaces, and any non-digit characters
 */
function cleanPrefix(prefix) {
    if (!prefix || typeof prefix !== 'string') return '';
    return prefix.replace(/[^0-9]/g, '');
}

/**
 * Parse a comma or space separated list of prefixes into a clean array
 */
function parsePrefixList(input) {
    if (!input || typeof input !== 'string') return [];
    return input
        .split(/[,\s]+/)
        .map(cleanPrefix)
        .filter(p => p.length >= 1 && p.length <= 8);
}

/**
 * Extract pure digits from phone number / JID
 */
function getCleanPhoneNumber(jid, participantObj) {
    if (participantObj?.phoneNumber) {
        return String(participantObj.phoneNumber).split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    }
    const raw = typeof jid === 'string' ? jid : (jid?.id || '');
    return raw.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}

/**
 * Check if a number is exempt from moderation (Bot, Owner, Sudo)
 */
function isExemptNumber(phoneNumber, senderId, sock) {
    if (!phoneNumber) return false;

    // 1. Bot itself
    const botId = (sock.user?.id || '').split(':')[0].split('@')[0].replace(/[^0-9]/g, '');
    const botLid = (sock.user?.lid || '').split(':')[0].split('@')[0].replace(/[^0-9]/g, '');
    if (phoneNumber === botId || (botLid && phoneNumber === botLid)) {
        return true;
    }

    // 2. Bot Owners
    const ownerNumbers = (settings.ownerNumbers || [settings.ownerNumber]).map(n => String(n).replace(/[^0-9]/g, ''));
    if (ownerNumbers.includes(phoneNumber)) {
        return true;
    }

    return false;
}

/**
 * Evaluate if a phone number violates the anti-foreign policy
 * Returns { isForeign: boolean, matchedPrefix: string, reason: string }
 */
function isForeignNumber(phoneNumber, config) {
    if (!phoneNumber || !config || !config.enabled) {
        return { isForeign: false };
    }

    const mode = config.mode || 'allow'; // 'allow' or 'block'
    const allowed = Array.isArray(config.allowed) && config.allowed.length > 0 ? config.allowed : ['92'];
    const blocked = Array.isArray(config.blocked) ? config.blocked : [];

    if (mode === 'allow') {
        // In ALLOW mode: only numbers starting with one of the allowed prefixes are permitted
        const matched = allowed.find(prefix => phoneNumber.startsWith(prefix));
        if (!matched) {
            // Number is foreign
            return {
                isForeign: true,
                matchedPrefix: null,
                reason: `Number does not match allowed country codes (+${allowed.join(', +')})`
            };
        }
        return { isForeign: false };
    } else {
        // In BLOCK mode: all numbers are allowed EXCEPT those starting with a blocked prefix
        const matched = blocked.find(prefix => phoneNumber.startsWith(prefix));
        if (matched) {
            return {
                isForeign: true,
                matchedPrefix: matched,
                reason: `Number matches blocked prefix (+${matched})`
            };
        }
        return { isForeign: false };
    }
}

/**
 * .antiforeign Command Handler
 * Usage:
 * - .antiforeign on
 * - .antiforeign off
 * - .antiforeign status
 * - .antiforeign set <codes> (e.g. .antiforeign set 92,971)
 * - .antiforeign block <codes> (e.g. .antiforeign block 1800,4470,234)
 * - .antiforeign mode allow / block
 * - .antiforeign scan / kickall
 */
async function antiforeignCommand(sock, chatId, senderId, message, args = []) {
    try {
        if (!isJidGroup(chatId)) {
            await sock.sendMessage(chatId, { text: '❌ This command can only be used in groups!' }, { quoted: message });
            return;
        }

        const senderIsOwner = await isOwnerOrSudo(senderId, sock, chatId);
        const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);

        if (!message.key.fromMe && !senderIsOwner && !isSenderAdmin) {
            await sock.sendMessage(chatId, { text: '❌ Only group administrators can configure the Anti-Foreign filter!' }, { quoted: message });
            return;
        }

        const subCommand = (args[0] || '').toLowerCase().trim();
        let config = (await getAntiforeign(chatId)) || {
            enabled: false,
            mode: 'allow',
            allowed: ['92'],
            blocked: ['1800', '4470', '234'],
            action: 'kick'
        };

        if (subCommand === 'on' || subCommand === 'enable') {
            config.enabled = true;
            if (!config.allowed || config.allowed.length === 0) config.allowed = ['92'];
            await setAntiforeign(chatId, config);

            const modeDesc = config.mode === 'allow'
                ? `*Allowlist:* Only numbers starting with (+${config.allowed.join(', +')}) are permitted.`
                : `*Blocklist:* Numbers starting with (+${(config.blocked || []).join(', +')}) are blocked.`;

            const reply = `╭─ *🛡️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗙𝗢𝗥𝗘𝗜𝗚𝗡*
┃
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦:* Enabled (ON)
┃  ◈ *𝗠𝗢𝗗𝗘:* ${config.mode.toUpperCase()}
┃  ◈ *𝗣𝗢𝗟𝗜𝗖𝗬:*
┃  ◆ ${modeDesc}
┃  ◈ *𝗕𝗢𝗧 𝗔𝗗𝗠𝗜𝗡:* ${isBotAdmin ? '✅ Ready' : '⚠️ Bot is not admin (cannot kick)'}
┃
╰───────────────`;
            await sock.sendMessage(chatId, { text: reply }, { quoted: message });
            return;
        }

        if (subCommand === 'off' || subCommand === 'disable') {
            config.enabled = false;
            await setAntiforeign(chatId, config);
            await sock.sendMessage(chatId, {
                text: `╭─ *🛡️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗙𝗢𝗥𝗘𝗜𝗚𝗡*\n┃\n┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦:* Disabled (OFF)\n┃  ◆ Anti-foreign protection has been deactivated.\n┃\n╰───────────────`
            }, { quoted: message });
            return;
        }

        if (subCommand === 'set' || subCommand === 'allow') {
            const rawCodes = args.slice(1).join(' ');
            const prefixes = parsePrefixList(rawCodes);

            if (prefixes.length === 0) {
                await sock.sendMessage(chatId, {
                    text: `❌ Please provide valid country codes!\n\n*Example:* \`.antiforeign set 92\` or \`.antiforeign set 92, 971, 966\``
                }, { quoted: message });
                return;
            }

            config.enabled = true;
            config.mode = 'allow';
            config.allowed = prefixes;
            await setAntiforeign(chatId, config);

            await sock.sendMessage(chatId, {
                text: `✅ *Anti-Foreign Updated (Allowlist Mode)*\n\nAllowed Country Code(s): *+${prefixes.join(', +')}*\n\nAny number outside these codes will be automatically removed.`
            }, { quoted: message });
            return;
        }

        if (subCommand === 'block') {
            const rawCodes = args.slice(1).join(' ');
            const prefixes = parsePrefixList(rawCodes);

            if (prefixes.length === 0) {
                await sock.sendMessage(chatId, {
                    text: `❌ Please provide country codes or prefixes to block!\n\n*Example:* \`.antiforeign block 1800, 4470, 234\``
                }, { quoted: message });
                return;
            }

            config.enabled = true;
            config.mode = 'block';
            config.blocked = prefixes;
            await setAntiforeign(chatId, config);

            await sock.sendMessage(chatId, {
                text: `✅ *Anti-Foreign Updated (Blocklist Mode)*\n\nBlocked Prefix(es): *+${prefixes.join(', +')}*\n\nAny number matching these prefixes will be automatically removed.`
            }, { quoted: message });
            return;
        }

        if (subCommand === 'mode') {
            const chosenMode = (args[1] || '').toLowerCase().trim();
            if (chosenMode !== 'allow' && chosenMode !== 'block') {
                await sock.sendMessage(chatId, {
                    text: `❌ Invalid mode! Use: \`.antiforeign mode allow\` or \`.antiforeign mode block\``
                }, { quoted: message });
                return;
            }

            config.mode = chosenMode;
            await setAntiforeign(chatId, config);

            await sock.sendMessage(chatId, {
                text: `✅ *Anti-Foreign Mode Updated: ${chosenMode.toUpperCase()}*\nStatus: *${config.enabled ? 'ON' : 'OFF'}*`
            }, { quoted: message });
            return;
        }

        if (subCommand === 'scan' || subCommand === 'kickall') {
            if (!isBotAdmin) {
                await sock.sendMessage(chatId, {
                    text: `❌ Please make the bot an administrator first to remove foreign members!`
                }, { quoted: message });
                return;
            }

            await sock.sendMessage(chatId, {
                text: `⏳ *Scanning group participants for foreign numbers...*`
            }, { quoted: message });

            const metadata = await sock.groupMetadata(chatId);
            const participants = metadata.participants || [];

            const toKick = [];
            for (const p of participants) {
                // Skip admins
                if (p.admin === 'admin' || p.admin === 'superadmin') continue;

                const phone = getCleanPhoneNumber(p.id, p);
                if (!phone) continue;

                if (isExemptNumber(phone, p.id, sock)) continue;
                if (await isSudo(p.id)) continue;

                const check = isForeignNumber(phone, config);
                if (check.isForeign) {
                    toKick.push({ jid: p.id, phone, reason: check.reason });
                }
            }

            if (toKick.length === 0) {
                await sock.sendMessage(chatId, {
                    text: `✅ *Group is Clean!* No unauthorized foreign numbers detected based on current settings.`
                }, { quoted: message });
                return;
            }

            await sock.sendMessage(chatId, {
                text: `🚨 Found *${toKick.length}* foreign member(s). Starting automatic removal...`
            });

            let removedCount = 0;
            for (let i = 0; i < toKick.length; i++) {
                const target = toKick[i];
                try {
                    await sock.groupParticipantsUpdate(chatId, [target.jid], 'remove');
                    removedCount++;
                } catch (err) {
                    console.error(`[ANTIFOREIGN] Failed to kick ${target.jid}:`, err.message || err);
                }

                if (i + 1 < toKick.length) {
                    await new Promise(res => setTimeout(res, 1200));
                }
            }

            await sock.sendMessage(chatId, {
                text: `🧹 *Anti-Foreign Scan Complete*\n\n✅ Successfully removed: *${removedCount}/${toKick.length}* foreign member(s).`
            });
            return;
        }

        // Default: Show status and usage guidance
        const allowedStr = (config.allowed && config.allowed.length > 0) ? `+${config.allowed.join(', +')}` : '+92';
        const blockedStr = (config.blocked && config.blocked.length > 0) ? `+${config.blocked.join(', +')}` : '+1800, +4470, +234';

        const statusReply = `╭─ *🛡️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗙𝗢𝗥𝗘𝗜𝗚𝗡*
┃
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦:* ${config.enabled ? 'Enabled (ON)' : 'Disabled (OFF)'}
┃  ◈ *𝗠𝗢𝗗𝗘:* ${config.mode ? config.mode.toUpperCase() : 'ALLOW'}
┃  ◈ *𝗔𝗟𝗟𝗢𝗪𝗘𝗗:* ${allowedStr}
┃  ◈ *𝗕𝗟𝗢𝗖𝗞𝗘𝗗:* ${blockedStr}
┃  ◈ *𝗕𝗢𝗧 𝗔𝗗𝗠𝗜𝗡:* ${isBotAdmin ? '✅ Admin' : '❌ Not Admin'}
┃
┣─〔 ◈ 𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦 〕
┃  • \`.antiforeign on / off\`
┃  • \`.antiforeign set <codes>\` (e.g. .antiforeign set 92)
┃  • \`.antiforeign block <codes>\` (e.g. .antiforeign block 1800, 4470)
┃  • \`.antiforeign mode allow / block\`
┃  • \`.antiforeign scan\` (Removes existing foreign members)
┃
╰───────────────`;

        await sock.sendMessage(chatId, { text: statusReply }, { quoted: message });

    } catch (error) {
        console.error('[ANTIFOREIGN] Command error:', error);
        await sock.sendMessage(chatId, { text: '❌ Error processing .antiforeign command.' }, { quoted: message });
    }
}

/**
 * Intercept member join events and remove violating foreign numbers immediately
 */
async function handleAntiforeignJoin(sock, groupId, participants) {
    try {
        if (!groupId || !groupId.endsWith('@g.us') || !Array.isArray(participants) || participants.length === 0) return;

        const config = await getAntiforeign(groupId);
        if (!config || !config.enabled) return;

        const { isBotAdmin } = await isAdmin(sock, groupId, sock.user?.id);

        for (const p of participants) {
            const jid = typeof p === 'string' ? p : (p.id || p.toString());
            const phone = getCleanPhoneNumber(jid, typeof p === 'object' ? p : null);
            if (!phone) continue;

            // Check exemptions
            if (isExemptNumber(phone, jid, sock) || (await isSudo(jid))) continue;

            const check = isForeignNumber(phone, config);
            if (check.isForeign) {
                console.log(`🚨 [ANTIFOREIGN] Foreign member join detected in ${groupId}: @${phone}`);
                recentlyKickedJoiners.add(jid);

                if (!isBotAdmin) {
                    await sock.sendMessage(groupId, {
                        text: `⚠️ *Anti-Foreign Alert:* @${phone} has an unauthorized country code, but the bot is not an admin to remove them.`,
                        mentions: [jid]
                    });
                    continue;
                }

                try {
                    await sock.groupParticipantsUpdate(groupId, [jid], 'remove');
                    await sock.sendMessage(groupId, {
                        text: `⛔ *@${phone}* was automatically removed.\n*Reason:* Foreign/unauthorized country code numbers are restricted in this group.`,
                        mentions: [jid]
                    });
                } catch (kickErr) {
                    console.error(`[ANTIFOREIGN] Failed to kick joining member @${phone}:`, kickErr.message || kickErr);
                }
            }
        }
    } catch (error) {
        console.error('[ANTIFOREIGN] Error in handleAntiforeignJoin:', error.message || error);
    }
}

/**
 * Intercept incoming group messages to kick existing foreign numbers on chat activity
 * Returns true if the message was handled and the user was kicked.
 */
async function handleAntiforeignMessage(sock, chatId, message, senderId) {
    try {
        if (!isJidGroup(chatId) || !senderId || message.key?.fromMe) return false;

        const config = await getAntiforeign(chatId);
        if (!config || !config.enabled) return false;

        const phone = getCleanPhoneNumber(senderId);
        if (!phone) return false;

        // Exemptions
        if (isExemptNumber(phone, senderId, sock) || (await isSudo(senderId))) return false;

        const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);
        if (isSenderAdmin) return false;

        const check = isForeignNumber(phone, config);
        if (check.isForeign && isBotAdmin) {
            console.log(`🚨 [ANTIFOREIGN] Foreign chatter detected in ${chatId}: @${phone}`);

            // Delete violating message
            try {
                await sock.sendMessage(chatId, { delete: message.key });
            } catch (_) {}

            // Kick user
            try {
                await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
                await sock.sendMessage(chatId, {
                    text: `⛔ *@${phone}* was removed from the group.\n*Reason:* Restricted country code policy violation.`,
                    mentions: [senderId]
                });
            } catch (e) {
                console.error(`[ANTIFOREIGN] Failed to kick chatter @${phone}:`, e.message || e);
            }

            return true;
        }

        return false;
    } catch (error) {
        console.error('[ANTIFOREIGN] Error in handleAntiforeignMessage:', error.message || error);
        return false;
    }
}

function wasKickedByAntiforeign(jid) {
    return recentlyKickedJoiners.has(jid);
}

module.exports = {
    antiforeignCommand,
    handleAntiforeignJoin,
    handleAntiforeignMessage,
    isForeignNumber,
    getCleanPhoneNumber,
    cleanPrefix,
    parsePrefixList,
    wasKickedByAntiforeign
};

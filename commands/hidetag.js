const isAdmin = require('../lib/isAdmin');
const { isSessionOwner, getSessionPhone, getAutoHidetagConfig, setAutoHidetagConfig } = require('../lib/session-settings');
const { getGroupMetadata } = require('../lib/myfunc');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

async function downloadMediaMessage(message, mediaType) {
    const stream = await downloadContentFromMessage(message, mediaType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    const tempDir = path.join(__dirname, '../temp/');
    if (!fs.existsSync(tempDir)) {
        try { fs.mkdirSync(tempDir, { recursive: true }); } catch (_) {}
    }
    const filePath = path.join(tempDir, `${Date.now()}.${mediaType}`);
    fs.writeFileSync(filePath, buffer);
    return filePath;
}

async function hideTagCommand(sock, chatId, senderId, messageText = '', replyMessage = null, message = null) {
    try {
        const isGroup = Boolean(chatId && chatId.endsWith('@g.us'));
        const sessionPhone = getSessionPhone(sock);
        const isOwner = isSessionOwner(sock, senderId, message);
        const isFromMe = Boolean(message?.key?.fromMe);
        const isAuthorizedOwner = isOwner || isFromMe;

        const trimmed = (messageText || '').trim();
        const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase();

        // ---------------------------------------------------------
        // 1. AUTO HIDETAG TOGGLE (.hidetag on / off / status)
        // Works in both Private DM and Group chat
        // ---------------------------------------------------------
        if (firstWord === 'on' || firstWord === 'enable') {
            if (!isAuthorizedOwner) {
                return sock.sendMessage(chatId, {
                    text: '❌ Auto Hidetag toggle is only available for the session owner!'
                }, { quoted: message });
            }
            setAutoHidetagConfig(sock, true);
            const reply = `╭─ *🥷 𝗭𝗢𝗫𝗘𝗥 𝗔𝗨𝗧𝗢 𝗛𝗜𝗗𝗘𝗧𝗔𝗚*
┃
┃  ◈ *𝗦𝗘𝗦𝗦𝗜𝗢𝗡*
┃  ◆ *${sessionPhone}*
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Enabled (ON) 🎯*
┃
┃  ✅ *Auto Hidetag is now ACTIVE!*
┃  • Whenever you send any message in any group,
┃    all members will be mentioned automatically!
┃  • Mentions are silent (no bot text or @tags displayed).
┃  • Works across all groups whether bot is admin or not.
┃
╰───────────────`;
            return sock.sendMessage(chatId, { text: reply }, { quoted: message });
        }

        if (firstWord === 'off' || firstWord === 'disable') {
            if (!isAuthorizedOwner) {
                return sock.sendMessage(chatId, {
                    text: '❌ Auto Hidetag toggle is only available for the session owner!'
                }, { quoted: message });
            }
            setAutoHidetagConfig(sock, false);
            const reply = `╭─ *🥷 𝗭𝗢𝗫𝗘𝗥 𝗔𝗨𝗧𝗢 𝗛𝗜𝗗𝗘𝗧𝗔𝗚*
┃
┃  ◈ *𝗦𝗘𝗦𝗦𝗜𝗢𝗡*
┃  ◆ *${sessionPhone}*
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Disabled (OFF) ⚪*
┃
┃  ✅ *Auto Hidetag has been turned OFF.*
┃  • Normal messaging restored.
┃
╰───────────────`;
            return sock.sendMessage(chatId, { text: reply }, { quoted: message });
        }

        if (firstWord === 'status' || (!isGroup && !trimmed)) {
            const current = getAutoHidetagConfig(sock);
            const statusText = current.enabled ? 'Enabled (ON) 🎯' : 'Disabled (OFF) ⚪';
            const reply = `╭─ *🥷 𝗭𝗢𝗫𝗘𝗥 𝗔𝗨𝗧𝗢 𝗛𝗜𝗗𝗘𝗧𝗔𝗚*
┃
┃  ◈ *𝗦𝗘𝗦𝗦𝗜𝗢𝗡*
┃  ◆ *${sessionPhone}*
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *${statusText}*
┃
┃  • \`.hidetag on\` - Turn on Auto Hidetag for all groups
┃  • \`.hidetag off\` - Turn off Auto Hidetag
┃  • \`.hidetag [text]\` - Tag all members in a group
┃
╰───────────────`;
            return sock.sendMessage(chatId, { text: reply }, { quoted: message });
        }

        // If invoked in private DM without arguments, notify user
        if (!isGroup) {
            return sock.sendMessage(chatId, {
                text: '💡 *Usage in Private Chat:* Use `.hidetag on` or `.hidetag off` to toggle Auto Hidetag for all groups.'
            }, { quoted: message });
        }

        // ---------------------------------------------------------
        // 2. MANUAL HIDETAG IN GROUP (.hidetag [text])
        // ---------------------------------------------------------
        // Permission check: Session owner, bot account itself, or group admin
        const { isSenderAdmin } = await isAdmin(sock, chatId, senderId);
        if (!isAuthorizedOwner && !isSenderAdmin) {
            return sock.sendMessage(chatId, {
                text: '❌ Only group admins or the bot owner can use .hidetag in groups.'
            }, { quoted: message });
        }

        // Fetch group participants (works whether bot is admin or not!)
        let groupMetadata = null;
        try {
            groupMetadata = await getGroupMetadata(sock, chatId);
        } catch (_) {
            try { groupMetadata = await sock.groupMetadata(chatId); } catch (_) {}
        }

        const participants = groupMetadata?.participants || [];
        if (!participants || participants.length === 0) {
            return sock.sendMessage(chatId, { text: '❌ Could not retrieve group members.' }, { quoted: message });
        }

        // Tag all members (admins + non-admins)
        const allMentions = participants.map(p => p.id || p.phoneNumber || p.lid).filter(Boolean);

        // A. If user quoted a message (image, video, document, text)
        if (replyMessage) {
            let content = null;
            if (replyMessage.imageMessage) {
                const filePath = await downloadMediaMessage(replyMessage.imageMessage, 'image');
                content = {
                    image: { url: filePath },
                    caption: trimmed || replyMessage.imageMessage.caption || '',
                    mentions: allMentions
                };
            } else if (replyMessage.videoMessage) {
                const filePath = await downloadMediaMessage(replyMessage.videoMessage, 'video');
                content = {
                    video: { url: filePath },
                    caption: trimmed || replyMessage.videoMessage.caption || '',
                    mentions: allMentions
                };
            } else if (replyMessage.documentMessage) {
                const filePath = await downloadMediaMessage(replyMessage.documentMessage, 'document');
                content = {
                    document: { url: filePath },
                    fileName: replyMessage.documentMessage.fileName || 'document',
                    caption: trimmed || replyMessage.documentMessage.caption || '',
                    mentions: allMentions
                };
            } else if (replyMessage.conversation || replyMessage.extendedTextMessage) {
                const quotedText = replyMessage.conversation || replyMessage.extendedTextMessage.text;
                content = {
                    text: trimmed ? `${trimmed}\n\n${quotedText}` : quotedText,
                    mentions: allMentions
                };
            } else {
                // Generic fallback for other quoted message types: quote with invisible text
                content = {
                    text: trimmed || '\u200E',
                    mentions: allMentions
                };
            }

            if (content) {
                return await sock.sendMessage(chatId, content);
            }
        }

        // B. If user supplied text with .hidetag <text>
        if (trimmed) {
            return await sock.sendMessage(chatId, {
                text: trimmed,
                mentions: allMentions
            });
        }

        // C. If user simply sent .hidetag with NO text and no quote:
        // Mention all members silently with zero-width invisible character!
        return await sock.sendMessage(chatId, {
            text: '\u200E',
            mentions: allMentions
        }, { quoted: message });

    } catch (err) {
        console.error('[HIDETAG] Error in hideTagCommand:', err);
        return sock.sendMessage(chatId, {
            text: '❌ Failed to execute hidetag: ' + (err.message || err)
        }, { quoted: message });
    }
}

module.exports = hideTagCommand;

const fs = require('fs');
const path = require('path');
const isAdmin = require('../lib/isAdmin');
const isOwnerOrSudo = require('../lib/isOwner');

async function linkCommand(sock, chatId, message, senderId) {
    if (!chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, { text: '❌ This command is only available in groups.' }, { quoted: message });
    }

    try {
        const { isBotAdmin } = await isAdmin(sock, chatId, senderId);
        if (!isBotAdmin) {
            return await sock.sendMessage(chatId, { text: '❌ Please make the bot an admin to fetch the invite link.' }, { quoted: message });
        }

        const code = await sock.groupInviteCode(chatId);
        const link = `https://chat.whatsapp.com/${code}`;

        const reply = `╭─ *🔗 𝗭𝗢𝗫𝗘𝗥 𝗚𝗥𝗢𝗨𝗣 𝗟𝗜𝗡𝗞*
┃
┃  ◈ *𝗜𝗡𝗩𝗜𝗧𝗘 𝗨𝗥𝗟*
┃  ◆ *${link}*
┃
╰───────────────`;
        await sock.sendMessage(chatId, { text: reply }, { quoted: message });

    } catch (err) {
        console.error('Error in linkCommand:', err);
        await sock.sendMessage(chatId, { text: `❌ Failed to fetch link: ${err.message}` }, { quoted: message });
    }
}

async function leaveCommand(sock, chatId, message, senderId) {
    if (!chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, { text: '❌ This command can only be used in groups.' }, { quoted: message });
    }

    try {
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
        const { isSenderAdmin } = await isAdmin(sock, chatId, senderId);

        if (!isOwner && !isSenderAdmin) {
            return await sock.sendMessage(chatId, { text: '❌ Only group administrators or the bot owner can instruct the bot to leave.' }, { quoted: message });
        }

        await sock.sendMessage(chatId, { text: '👋 Goodbye everyone! The bot is leaving the group now.' });
        await new Promise(resolve => setTimeout(resolve, 1000));
        await sock.groupLeave(chatId);

    } catch (err) {
        console.error('Error in leaveCommand:', err);
        await sock.sendMessage(chatId, { text: `❌ Failed to leave group: ${err.message}` }, { quoted: message });
    }
}

async function tagGhostCommand(sock, chatId, message, senderId) {
    if (!chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, { text: '❌ This command can only be used in groups.' }, { quoted: message });
    }

    try {
        const { isSenderAdmin } = await isAdmin(sock, chatId, senderId);
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);

        if (!isSenderAdmin && !isOwner) {
            return await sock.sendMessage(chatId, { text: '❌ Only group administrators can use .tagghost.' }, { quoted: message });
        }

        const groupMeta = await sock.groupMetadata(chatId);
        const participants = groupMeta.participants.map(p => p.id);

        // Read messageCount.json
        const countPath = path.join(process.cwd(), 'data', 'messageCount.json');
        let counts = {};
        if (fs.existsSync(countPath)) {
            try { counts = JSON.parse(fs.readFileSync(countPath, 'utf8')); } catch (_) {}
        }

        const groupCounts = counts[chatId] || {};
        const ghostMembers = participants.filter(id => !groupCounts[id] || groupCounts[id] === 0);

        if (ghostMembers.length === 0) {
            return await sock.sendMessage(chatId, { text: '🎉 Amazing! There are no inactive ghost members in this group.' }, { quoted: message });
        }

        let reply = `╭─ *👻 𝗭𝗢𝗫𝗘𝗥 𝗚𝗛𝗢𝗦𝗧 𝗠𝗘𝗠𝗕𝗘𝗥𝗦*
┃
┃  ◈ *𝗜𝗡𝗔𝗖𝗧𝗜𝗩𝗘 𝗖𝗢𝗨𝗡𝗧*
┃  ◆ *${ghostMembers.length} Members*
┃
┣─〔 ◈ 𝗠𝗘𝗠𝗕𝗘𝗥 𝗟𝗜𝗦𝗧 〕\n`;
        const mentions = [];
        ghostMembers.slice(0, 30).forEach((id, idx) => {
            const num = id.split('@')[0].split(':')[0];
            reply += `┃  ▸ *${idx + 1}.* @${num}\n`;
            mentions.push(id);
        });

        if (ghostMembers.length > 30) {
            reply += `┃  ▸ *...and ${ghostMembers.length - 30} more members*\n`;
        }
        reply += `┃\n╰───────────────`;

        await sock.sendMessage(chatId, { text: reply, mentions }, { quoted: message });

    } catch (err) {
        console.error('Error in tagGhostCommand:', err);
        await sock.sendMessage(chatId, { text: `❌ Failed to detect ghost members: ${err.message}` }, { quoted: message });
    }
}

module.exports = {
    linkCommand,
    leaveCommand,
    tagGhostCommand
};

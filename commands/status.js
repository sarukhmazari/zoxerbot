const { setStatusRestriction, getStatusRestriction } = require('../lib/index');
const isAdmin = require('../lib/isAdmin');

/**
 * Handles the .status on/off command.
 * Controls whether members are allowed to mention the group (by link) in their status.
 */
async function statusCommand(sock, chatId, senderId, args, message) {
    if (!chatId.endsWith('@g.us')) {
        return sock.sendMessage(chatId, { text: 'This command can only be used in groups!' }, { quoted: message });
    }

    // Admin check
    const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);
    const isOwner = message.key.fromMe;
    
    if (!isSenderAdmin && !isOwner) {
        return sock.sendMessage(chatId, { text: '❌ Only group admins can use the .status command.' }, { quoted: message });
    }

    const setting = args[0]?.toLowerCase();

    if (setting === 'on') {
        await setStatusRestriction(chatId, true);
        const reply = `╭─ *📊 𝗚𝗥𝗢𝗨𝗣 𝗦𝗧𝗔𝗧𝗨𝗦*
┃
┃  ◈ *𝗠𝗘𝗡𝗧𝗜𝗢𝗡 𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Enabled (ON)*
┃  ◈ *𝗣𝗘𝗥𝗠𝗜𝗦𝗦𝗜𝗢𝗡*
┃  ◆ *All members may mention this group in statuses.*
┃
╰───────────────`;
        await sock.sendMessage(chatId, { text: reply }, { quoted: message });
    } else if (setting === 'off') {
        await setStatusRestriction(chatId, false);
        const reply = `╭─ *📊 𝗚𝗥𝗢𝗨𝗣 𝗦𝗧𝗔𝗧𝗨𝗦*
┃
┃  ◈ *𝗠𝗘𝗡𝗧𝗜𝗢𝗡 𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Restricted (OFF)*
┃  ◈ *𝗣𝗘𝗥𝗠𝗜𝗦𝗦𝗜𝗢𝗡*
┃  ◆ *Group mentions in statuses are restricted.*
┃
╰───────────────`;
        await sock.sendMessage(chatId, { text: reply }, { quoted: message });
    } else {
        const current = await getStatusRestriction(chatId);
        const reply = `╭─ *📊 𝗚𝗥𝗢𝗨𝗣 𝗦𝗧𝗔𝗧𝗨𝗦*
┃
┃  ◈ *𝗖𝗨𝗥𝗥𝗘𝗡𝗧 𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *${current ? 'Enabled (ON)' : 'Restricted (OFF)'}*
┃  ◈ *𝗨𝗦𝗔𝗚𝗘*
┃  ◆ *.status on  |  .status off*
┃
╰───────────────`;
        await sock.sendMessage(chatId, { text: reply }, { quoted: message });
    }
}

module.exports = statusCommand;

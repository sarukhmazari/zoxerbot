const { setAntispam, getAntispam } = require('../lib/index');
const isOwnerOrSudo = require('../lib/isOwner');
const isAdmin = require('../lib/isAdmin');

async function antispamCommand(sock, chatId, senderId, args, message) {
    const isGroup = chatId.endsWith('@g.us');
    if (!isGroup) {
        await sock.sendMessage(chatId, { text: '❌ This command can only be used in groups.' }, { quoted: message });
        return;
    }

    const senderIsOwnerOrSudo = await isOwnerOrSudo(senderId, sock, chatId);
    const adminStatus = await isAdmin(sock, chatId, senderId);
    
    if (!message.key.fromMe && !senderIsOwnerOrSudo && !adminStatus.isSenderAdmin) {
        await sock.sendMessage(chatId, { text: '❌ Only group admins or bot owner can use this command.' }, { quoted: message });
        return;
    }

    const action = args[0]?.toLowerCase();
    const limit = parseInt(args[0]);

    if (!isNaN(limit) && limit > 1) {
        await setAntispam(chatId, limit);
        const text = `╭─ *🛡️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗦𝗣𝗔𝗠*
┃
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Enabled (ON)*
┃  ◈ *𝗧𝗛𝗥𝗘𝗦𝗛𝗢𝗟𝗗*
┃  ◆ *${limit} Consecutive Messages*
┃  ◈ *𝗣𝗘𝗡𝗔𝗟𝗧𝗬*
┃  ◆ *Auto-Kick on spam violation.*
┃
╰───────────────`;
        await sock.sendMessage(chatId, { text }, { quoted: message });
    } else if (action === 'on') {
        await setAntispam(chatId, true);
        const text = `╭─ *🛡️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗦𝗣𝗔𝗠*
┃
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Enabled (ON)*
┃  ◈ *𝗧𝗛𝗥𝗘𝗦𝗛𝗢𝗟𝗗*
┃  ◆ *3 Consecutive Messages*
┃  ◈ *𝗣𝗘𝗡𝗔𝗟𝗧𝗬*
┃  ◆ *Auto-Kick on spam violation.*
┃
╰───────────────`;
        await sock.sendMessage(chatId, { text }, { quoted: message });
    } else if (action === 'off') {
        await setAntispam(chatId, false);
        const text = `╭─ *🛡️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗦𝗣𝗔𝗠*
┃
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Disabled (OFF)*
┃
╰───────────────`;
        await sock.sendMessage(chatId, { text }, { quoted: message });
    } else {
        const currentLimit = await getAntispam(chatId);
        const text = `╭─ *🛡️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜-𝗦𝗣𝗔𝗠*
┃
┃  ◈ *𝗖𝗨𝗥𝗥𝗘𝗡𝗧 𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *${currentLimit ? `Enabled (Threshold: ${currentLimit})` : 'Disabled (OFF)'}*
┃  ◈ *𝗨𝗦𝗔𝗚𝗘*
┃  ◆ *.antispam on  |  .antispam off*
┃  ◆ *.antispam <limit>*
┃
╰───────────────`;
        await sock.sendMessage(chatId, { text }, { quoted: message });
    }
}

module.exports = antispamCommand;

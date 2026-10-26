const settings = require("../settings");
async function aliveCommand(sock, chatId, message) {
    try {
        const message1 = `╭─ *𝗭𝗢𝗫𝗘𝗥 𝗕𝗢𝗧*
┃
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Active & Running*
┃  ◈ *𝗩𝗘𝗥𝗦𝗜𝗢𝗡*
┃  ◆ *v${settings.version}*
┃  ◈ *𝗢𝗪𝗡𝗘𝗥*
┃  ◆ *${settings.botOwner || 'ZOXER TEAM'}*
┃  ◈ *𝗠𝗢𝗗𝗘*
┃  ◆ *${settings.workType || 'Public'}*
┃
┣─〔 ◈ 𝗤𝗨𝗜𝗖𝗞 𝗜𝗡𝗙𝗢 〕
┃  ▸ *Type .menu to view all commands*
┃  ▸ *Type .ping to check latency*
┃
╰───────────────`;

        await sock.sendMessage(chatId, {
            text: message1
        }, { quoted: message });
    } catch (error) {
        console.error('Error in alive command:', error);
        await sock.sendMessage(chatId, { text: 'Bot is alive and running!' }, { quoted: message });
    }
}

module.exports = aliveCommand;
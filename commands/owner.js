const settings = require('../settings');

async function ownerCommand(sock, chatId) {
    const ownerNumber = settings.ownerNumber || '923232391033';
    
    const ownerName = settings.botOwner || 'ZOXER TEAM';
    const cleanNumber = ownerNumber.replace(/[^0-9]/g, '');

    const vcard = `
BEGIN:VCARD
VERSION:3.0
FN:〔 𝗭𝗢𝗫𝗘𝗥 𝗧𝗘𝗔𝗠 〕
TEL;waid=${cleanNumber}:${cleanNumber}
END:VCARD`.trim();

    await sock.sendMessage(chatId, {
        contacts: { 
            displayName: "〔 𝗭𝗢𝗫𝗘𝗥 𝗧𝗘𝗔𝗠 〕", 
            contacts: [
                { vcard: vcard }
            ] 
        }
    });

    const infoCard = `╭─ *👑 𝗭𝗢𝗫𝗘𝗥 𝗢𝗪𝗡𝗘𝗥*
┃
┃  ◈ *𝗢𝗪𝗡𝗘𝗥 𝗡𝗔𝗠𝗘*
┃  ◆ *${ownerName}*
┃  ◈ *𝗖𝗢𝗡𝗧𝗔𝗖𝗧*
┃  ◆ *wa.me/${cleanNumber}*
┃  ◈ *𝗕𝗢𝗧 𝗡𝗔𝗠𝗘*
┃  ◆ *${settings.botName || 'ZOXER BOT'}*
┃
╰───────────────`;

    await sock.sendMessage(chatId, { text: infoCard });
}

module.exports = ownerCommand;

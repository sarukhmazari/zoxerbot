const settings = require('../settings');

async function ownerCommand(sock, chatId) {
    const ownerNumber = settings.ownerNumber || '923232391033';
    
    const vcard = `
BEGIN:VCARD
VERSION:3.0
FN:〔 𝗠𝗔𝗭𝗔𝗥𝗜 𝗧𝗘𝗔𝗠 〕
TEL;waid=${ownerNumber}:${ownerNumber}
END:VCARD`.trim();

    await sock.sendMessage(chatId, {
        contacts: { 
            displayName: "〔 𝗠𝗔𝗭𝗔𝗥𝗜 𝗧𝗘𝗔𝗠 〕", 
            contacts: [
                { vcard: vcard }
            ] 
        }
    });
}

module.exports = ownerCommand;

async function reactCommand(sock, chatId, message, args) {
    try {
        const emoji = args[0];
        if (!emoji) {
            return await sock.sendMessage(chatId, {
                text: '⚠️ Please provide an emoji to react.\n*Example:* Reply to a message with `.react ❤️` or `.react 🔥`'
            }, { quoted: message });
        }

        const quotedKey = message.message?.extendedTextMessage?.contextInfo?.stanzaId;
        const targetKey = quotedKey ? {
            remoteJid: chatId,
            fromMe: message.message.extendedTextMessage.contextInfo.participant ? false : true,
            id: quotedKey,
            participant: message.message.extendedTextMessage.contextInfo.participant
        } : message.key;

        await sock.sendMessage(chatId, {
            react: {
                text: emoji,
                key: targetKey
            }
        });
    } catch (err) {
        console.error('Error in reactCommand:', err);
        await sock.sendMessage(chatId, { text: `❌ Failed to react: ${err.message}` }, { quoted: message });
    }
}

module.exports = reactCommand;

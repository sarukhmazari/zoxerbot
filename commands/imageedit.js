const { downloadMediaMessage, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { Jimp } = require('jimp');

async function extractImageBuffer(sock, message) {
    let targetMessage = message;

    if (message.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        const quotedInfo = message.message.extendedTextMessage.contextInfo;
        targetMessage = {
            key: {
                remoteJid: message.key.remoteJid,
                id: quotedInfo.stanzaId || message.key.id,
                participant: quotedInfo.participant
            },
            message: quotedInfo.quotedMessage
        };
    }

    const imgMsg = targetMessage.message?.imageMessage;
    if (!imgMsg) return null;

    try {
        const buffer = await downloadMediaMessage(targetMessage, 'buffer', {}, {
            logger: undefined,
            reuploadRequest: sock.updateMediaMessage
        });
        if (buffer && buffer.length > 0) return buffer;
    } catch (_) {}

    try {
        const stream = await downloadContentFromMessage(imgMsg, 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        return buffer;
    } catch (_) {
        return null;
    }
}

async function invertCommand(sock, chatId, message) {
    try {
        const buffer = await extractImageBuffer(sock, message);
        if (!buffer) {
            return await sock.sendMessage(chatId, {
                text: '⚠️ Please reply to an *image* with *.invert*.'
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

        const image = await Jimp.read(buffer);
        image.invert();
        const outBuffer = await image.getBuffer('image/jpeg');

        const caption = `╭─ *🎨 𝗭𝗢𝗫𝗘𝗥 𝗜𝗡𝗩𝗘𝗥𝗧*
┃
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Color spectrum inverted!*
┃
╰───────────────`;

        await sock.sendMessage(chatId, {
            image: outBuffer,
            mimetype: 'image/jpeg',
            caption: caption
        }, { quoted: message });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
    } catch (err) {
        console.error('Error in invertCommand:', err);
        await sock.sendMessage(chatId, { text: `❌ Invert error: ${err.message}` }, { quoted: message });
    }
}

async function rotateCommand(sock, chatId, message, args) {
    try {
        const buffer = await extractImageBuffer(sock, message);
        if (!buffer) {
            return await sock.sendMessage(chatId, {
                text: '⚠️ Please reply to an *image* with *.rotate [degrees]* (e.g. *.rotate 90*).'
            }, { quoted: message });
        }

        const deg = parseInt(args[0], 10) || 90;

        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

        const image = await Jimp.read(buffer);
        image.rotate(deg);
        const outBuffer = await image.getBuffer('image/jpeg');

        const caption = `╭─ *🔄 𝗭𝗢𝗫𝗘𝗥 𝗥𝗢𝗧𝗔𝗧𝗘*
┃
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Rotated ${deg}° successfully!*
┃
╰───────────────`;

        await sock.sendMessage(chatId, {
            image: outBuffer,
            mimetype: 'image/jpeg',
            caption: caption
        }, { quoted: message });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
    } catch (err) {
        console.error('Error in rotateCommand:', err);
        await sock.sendMessage(chatId, { text: `❌ Rotate error: ${err.message}` }, { quoted: message });
    }
}

module.exports = {
    invertCommand,
    rotateCommand
};

const { Jimp } = require('jimp');
const { downloadMediaMessage, downloadContentFromMessage } = require('@whiskeysockets/baileys');

async function convertStickerToImage(sock, quotedMessage, chatId, message) {
    try {
        const quotedInfo = message?.message?.extendedTextMessage?.contextInfo;
        const targetMessage = {
            key: {
                remoteJid: chatId,
                id: quotedInfo?.stanzaId || message?.key?.id,
                participant: quotedInfo?.participant
            },
            message: quotedMessage || quotedInfo?.quotedMessage
        };

        const stickerMessage = targetMessage.message?.stickerMessage;
        if (!stickerMessage) {
            return await sock.sendMessage(chatId, { 
                text: '⚠️ Please reply to a *sticker* with *.simage* to convert it to an image.' 
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: '⏳', key: message?.key || targetMessage.key } });

        let buffer = null;
        try {
            buffer = await downloadMediaMessage(targetMessage, 'buffer', {}, {
                reuploadRequest: sock.updateMediaMessage
            });
        } catch (_) {}

        if (!buffer || buffer.length === 0) {
            const stream = await downloadContentFromMessage(stickerMessage, 'sticker');
            let chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            buffer = Buffer.concat(chunks);
        }

        // Process with Jimp 1.x
        const image = await Jimp.read(buffer);
        const imageBuffer = await image.getBuffer('image/png');

        const caption = `╭─ *🖼️ 𝗦𝗧𝗜𝗖𝗞𝗘𝗥 𝗧𝗢 𝗜𝗠𝗔𝗚𝗘*
┃
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Converted successfully!*
┃  ◈ *𝗙𝗢𝗥𝗠𝗔𝗧*
┃  ◆ *PNG High Definition*
┃
╰───────────────`;

        await sock.sendMessage(chatId, { 
            image: imageBuffer, 
            caption: caption,
            mimetype: 'image/png' 
        }, { quoted: message });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message?.key || targetMessage.key } });

    } catch (error) {
        console.error('Error converting sticker to image:', error);
        await sock.sendMessage(chatId, { text: `❌ Failed to convert sticker to image: ${error.message}` }, { quoted: message });
    }
}

module.exports = convertStickerToImage;

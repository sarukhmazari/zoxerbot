const { downloadMediaMessage, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { Jimp } = require('jimp');

async function extractImageBuffer(sock, message, quotedMessage) {
    let targetMessage = message;

    if (quotedMessage || message.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        const quotedInfo = message.message?.extendedTextMessage?.contextInfo;
        const qMsg = quotedMessage || quotedInfo?.quotedMessage;
        if (qMsg) {
            targetMessage = {
                key: {
                    remoteJid: message.key.remoteJid,
                    id: quotedInfo?.stanzaId || message.key.id,
                    participant: quotedInfo?.participant
                },
                message: qMsg
            };
        }
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

    // Fallback direct stream extraction
    try {
        const stream = await downloadContentFromMessage(imgMsg, 'image');
        let chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return Buffer.concat(chunks);
    } catch (_) {
        return null;
    }
}

async function blurCommand(sock, chatId, message, quotedMessage) {
    try {
        const imageBuffer = await extractImageBuffer(sock, message, quotedMessage);

        if (!imageBuffer) {
            const usage = `╭─ *🌫️ 𝗭𝗢𝗫𝗘𝗥 𝗜𝗠𝗔𝗚𝗘 𝗕𝗟𝗨𝗥*
┃
┃  ◈ *𝗨𝗦𝗔𝗚𝗘*
┃  ◆ *Reply to an image with .blur*
┃  ◆ *Or send an image with caption .blur*
┃
╰───────────────`;
            await sock.sendMessage(chatId, { text: usage }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

        // Read image with Jimp 1.x
        const image = await Jimp.read(imageBuffer);

        // Resize if excessively large to maintain high performance
        if (image.width > 1200 || image.height > 1200) {
            image.scaleToFit({ w: 1200, h: 1200 });
        }

        // Apply blur effect (radius 12)
        image.blur(12);

        // Export as JPEG buffer
        const blurredBuffer = await image.getBuffer('image/jpeg');

        const caption = `╭─ *🌫️ 𝗭𝗢𝗫𝗘𝗥 𝗜𝗠𝗔𝗚𝗘 𝗕𝗟𝗨𝗥*
┃
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Image blurred successfully!*
┃  ◈ *𝗘𝗙𝗙𝗘𝗖𝗧*
┃  ◆ *Gaussian Blur (Radius: 12)*
┃
╰───────────────`;

        await sock.sendMessage(chatId, {
            image: blurredBuffer,
            mimetype: 'image/jpeg',
            caption: caption
        }, { quoted: message });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (error) {
        console.error('Error in blur command:', error);
        await sock.sendMessage(chatId, { 
            text: `❌ Failed to blur image: ${error.message || 'Unknown error'}` 
        }, { quoted: message });
    }
}

module.exports = blurCommand;
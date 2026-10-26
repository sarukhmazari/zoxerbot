const { downloadMediaMessage, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { Jimp } = require('jimp');
const axios = require('axios');

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

function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

async function reminiCommand(sock, chatId, message, args = []) {
    try {
        let inputBuffer = null;

        // Check if an image URL was passed in args
        if (args.length > 0 && isValidUrl(args[0])) {
            try {
                await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });
                const res = await axios.get(args[0], { responseType: 'arraybuffer', timeout: 15000 });
                if (res.data && res.data.length > 0) {
                    inputBuffer = res.data;
                }
            } catch (urlErr) {
                return await sock.sendMessage(chatId, {
                    text: `❌ Could not download image from the provided URL: ${urlErr.message}`
                }, { quoted: message });
            }
        }

        // Otherwise extract from replied message or current message
        if (!inputBuffer) {
            inputBuffer = await extractImageBuffer(sock, message);
        }

        if (!inputBuffer) {
            const usage = `╭─ *✨ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗜 𝗘𝗡𝗛𝗔𝗡𝗖𝗘𝗥*
┃
┃  ◈ *𝗨𝗦𝗔𝗚𝗘*
┃  ◆ *Reply to an image with .remini*
┃  ◆ *Or send image with caption .remini*
┃  ◆ *Or type: .remini <image_url>*
┃
╰───────────────`;
            return await sock.sendMessage(chatId, { text: usage }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

        // Load image into Jimp
        const image = await Jimp.read(inputBuffer);
        const originalW = image.width;
        const originalH = image.height;

        // 1. Smart Upscaling: Double resolution if under 1600px
        let targetW = originalW;
        let targetH = originalH;
        if (originalW < 1200 && originalH < 1200) {
            targetW = Math.round(originalW * 2);
            targetH = Math.round(originalH * 2);
            image.resize({ w: targetW, h: targetH });
        }

        // 2. Crisp Contrast Enhancement
        image.contrast(0.18);

        // 3. Unsharp Masking / Texture Sharpening Kernel
        // Clarifies edges, removes blur, and brings out facial details
        const sharpenKernel = [
            [  0,  -0.5,   0  ],
            [-0.5,  3.0, -0.5 ],
            [  0,  -0.5,   0  ]
        ];
        image.convolute(sharpenKernel);

        // 4. Export as enhanced high-definition JPEG
        const enhancedBuffer = await image.getBuffer('image/jpeg');

        const caption = `╭─ *✨ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗜 𝗘𝗡𝗛𝗔𝗡𝗖𝗘𝗥*
┃
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Image enhanced successfully!*
┃  ◈ *𝗥𝗘𝗦𝗢𝗟𝗨𝗧𝗜𝗢𝗡*
┃  ◆ *${targetW}x${targetH} (HD)*
┃  ◈ *𝗙𝗜𝗟𝗧𝗘𝗥𝗦*
┃  ◆ *Edge Sharpened • Contrast Boosted • De-blurred*
┃
╰───────────────`;

        await sock.sendMessage(chatId, {
            image: enhancedBuffer,
            mimetype: 'image/jpeg',
            caption: caption
        }, { quoted: message });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (error) {
        console.error('Error in remini command:', error);
        await sock.sendMessage(chatId, { 
            text: `❌ Failed to enhance image: ${error.message || 'Image processing error'}` 
        }, { quoted: message });
    }
}

module.exports = { reminiCommand };

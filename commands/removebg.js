const axios = require('axios');
const FormData = require('form-data');
const { downloadMediaMessage, downloadContentFromMessage } = require('@whiskeysockets/baileys');

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
        let chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return Buffer.concat(chunks);
    } catch (_) {
        return null;
    }
}

module.exports = {
    name: 'removebg',
    alias: ['rmbg', 'nobg'],
    category: 'Media',
    desc: 'Remove background from image',
    async exec(sock, message, args = []) {
        const chatId = message.key.remoteJid;
        try {
            const buffer = await extractImageBuffer(sock, message);

            if (!buffer) {
                const usage = `╭─ *✂️ 𝗭𝗢𝗫𝗘𝗥 𝗥𝗘𝗠𝗢𝗩𝗘 𝗕𝗚*
┃
┃  ◈ *𝗨𝗦𝗔𝗚𝗘*
┃  ◆ *Reply to an image with .removebg*
┃  ◆ *Or send an image with caption .removebg*
┃
╰───────────────`;
                return await sock.sendMessage(chatId, { text: usage }, { quoted: message });
            }

            await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

            // Check if Remove.bg API key is configured
            const apiKey = process.env.REMOVEBG_API_KEY;
            let resultBuffer = null;

            if (apiKey) {
                try {
                    const form = new FormData();
                    form.append('image_file', buffer, { filename: 'image.jpg', contentType: 'image/jpeg' });
                    form.append('size', 'auto');

                    const response = await axios.post('https://api.remove.bg/v1.0/removebg', form, {
                        headers: { ...form.getHeaders(), 'X-Api-Key': apiKey },
                        responseType: 'arraybuffer',
                        timeout: 25000
                    });

                    if (response.status === 200 && response.data) {
                        resultBuffer = Buffer.from(response.data);
                    }
                } catch (e) {
                    console.error('remove.bg official API error:', e.message);
                }
            }

            if (!resultBuffer) {
                const notice = `╭─ *✂️ 𝗭𝗢𝗫𝗘𝗥 𝗥𝗘𝗠𝗢𝗩𝗘 𝗕𝗚*
┃
┃  ◈ *𝗡𝗢𝗧𝗜𝗖𝗘*
┃  ◆ *To use AI Background Removal, add a free API key.*
┃  ◈ *𝗦𝗘𝗧𝗨𝗣*
┃  ◆ *1. Get free key at: remove.bg/api*
┃  ◆ *2. Add to .env: REMOVEBG_API_KEY=your_key*
┃
╰───────────────`;
                return await sock.sendMessage(chatId, { text: notice }, { quoted: message });
            }

            const caption = `╭─ *✂️ 𝗭𝗢𝗫𝗘𝗥 𝗥𝗘𝗠𝗢𝗩𝗘 𝗕𝗚*
┃
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Background removed successfully!*
┃  ◈ *𝗙𝗢𝗥𝗠𝗔𝗧*
┃  ◆ *Transparent PNG*
┃
╰───────────────`;

            await sock.sendMessage(chatId, {
                image: resultBuffer,
                mimetype: 'image/png',
                caption: caption
            }, { quoted: message });

            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

        } catch (error) {
            console.error('Error in removebg command:', error);
            await sock.sendMessage(chatId, { text: `❌ Failed to remove background: ${error.message}` }, { quoted: message });
        }
    }
};

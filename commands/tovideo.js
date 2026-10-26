const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function toVideoCommand(sock, chatId, message) {
    let tempInput = null;
    let tempOutput = null;

    try {
        let targetMessage = message;
        if (message.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
            const quotedInfo = message.message.extendedTextMessage.contextInfo;
            targetMessage = {
                key: {
                    remoteJid: chatId,
                    id: quotedInfo.stanzaId,
                    participant: quotedInfo.participant
                },
                message: quotedInfo.quotedMessage
            };
        }

        const msgObj = targetMessage.message;
        const mediaMsg = msgObj?.stickerMessage || msgObj?.videoMessage;

        if (!mediaMsg) {
            return await sock.sendMessage(chatId, {
                text: '⚠️ Please reply to an *animated sticker* or *gif* with *.tovideo* or *.mp4*.'
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

        const mediaBuffer = await downloadMediaMessage(targetMessage, 'buffer', {}, {
            logger: undefined,
            reuploadRequest: sock.updateMediaMessage
        });

        if (!mediaBuffer || mediaBuffer.length === 0) {
            return await sock.sendMessage(chatId, {
                text: '❌ Could not download media. Please ensure the message is loaded.'
            }, { quoted: message });
        }

        const tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const id = crypto.randomBytes(6).toString('hex');
        tempInput = path.join(tempDir, `in_vid_${id}.webp`);
        tempOutput = path.join(tempDir, `out_vid_${id}.mp4`);

        fs.writeFileSync(tempInput, mediaBuffer);

        const cmd = `ffmpeg -y -i "${tempInput}" -c:v libx264 -pix_fmt yuv420p -movflags +faststart -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" "${tempOutput}"`;
        await new Promise((resolve, reject) => {
            exec(cmd, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        const videoBuffer = fs.readFileSync(tempOutput);

        await sock.sendMessage(chatId, {
            video: videoBuffer,
            mimetype: 'video/mp4',
            caption: '✨ Converted to Video'
        }, { quoted: message });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (err) {
        console.error('Error in toVideoCommand:', err);
        await sock.sendMessage(chatId, {
            text: `❌ Failed to convert media to video: ${err.message}`
        }, { quoted: message });
    } finally {
        try { if (tempInput && fs.existsSync(tempInput)) fs.unlinkSync(tempInput); } catch (_) {}
        try { if (tempOutput && fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput); } catch (_) {}
    }
}

module.exports = toVideoCommand;

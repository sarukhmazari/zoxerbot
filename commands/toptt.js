const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hasAudioStream(filePath) {
    return new Promise((resolve) => {
        exec(`ffprobe -v error -select_streams a -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 "${filePath}"`, (err, stdout) => {
            if (err) return resolve(true);
            resolve(stdout && stdout.trim().includes('audio'));
        });
    });
}

async function toPttCommand(sock, chatId, message) {
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
        const mediaMsg = msgObj?.audioMessage || msgObj?.videoMessage || msgObj?.documentMessage;

        if (!mediaMsg) {
            return await sock.sendMessage(chatId, {
                text: '⚠️ Please reply to an *audio* or *video* message with *.toptt* or *.vn*.'
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

        const mime = (mediaMsg.mimetype || '').toLowerCase();
        let ext = '.mp4';
        if (mime.includes('audio/ogg') || mime.includes('opus')) ext = '.ogg';
        else if (mime.includes('audio/mp4') || mime.includes('m4a')) ext = '.m4a';
        else if (mime.includes('audio/mpeg') || mime.includes('mp3')) ext = '.mp3';

        const id = crypto.randomBytes(6).toString('hex');
        tempInput = path.join(tempDir, `in_ptt_${id}${ext}`);
        tempOutput = path.join(tempDir, `out_ptt_${id}.opus`);

        fs.writeFileSync(tempInput, mediaBuffer);

        const audioExists = await hasAudioStream(tempInput);
        if (!audioExists) {
            return await sock.sendMessage(chatId, {
                text: '⚠️ The replied video has *no audio track* (it is a silent video or GIF). Please reply to media that has sound.'
            }, { quoted: message });
        }

        const cmd = `ffmpeg -y -i "${tempInput}" -c:a libopus -b:a 32k -vbr on -compression_level 10 -vn "${tempOutput}"`;
        await new Promise((resolve, reject) => {
            exec(cmd, (err, stdout, stderr) => {
                if (err) {
                    if ((err.message && err.message.includes('Output file does not contain any stream')) ||
                        (stderr && stderr.includes('Output file does not contain any stream'))) {
                        return reject(new Error('The replied video has no audio track (it is silent or a GIF).'));
                    }
                    return reject(err);
                }
                resolve();
            });
        });

        const pttBuffer = fs.readFileSync(tempOutput);

        await sock.sendMessage(chatId, {
            audio: pttBuffer,
            mimetype: 'audio/ogg; codecs=opus',
            ptt: true
        }, { quoted: message });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (err) {
        console.error('Error in toPttCommand:', err);
        const userMsg = err.message.includes('no audio track') 
            ? '⚠️ The replied video has *no audio track* (it is silent or a GIF). Please reply to a video with sound.'
            : `❌ Failed to convert to voice note: ${err.message}`;

        await sock.sendMessage(chatId, { text: userMsg }, { quoted: message });
    } finally {
        try { if (tempInput && fs.existsSync(tempInput)) fs.unlinkSync(tempInput); } catch (_) {}
        try { if (tempOutput && fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput); } catch (_) {}
    }
}

module.exports = toPttCommand;

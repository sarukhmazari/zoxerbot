const baileys = require('@whiskeysockets/baileys');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hasAudioStream(filePath) {
    return new Promise((resolve) => {
        exec(`ffprobe -v error -select_streams a -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 "${filePath}"`, (err, stdout) => {
            if (err) return resolve(true); // If ffprobe fails, let ffmpeg attempt conversion
            resolve(stdout && stdout.trim().includes('audio'));
        });
    });
}

async function robotCommand(sock, chatId, message) {
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

        let msgObj = targetMessage.message;
        if (msgObj?.viewOnceMessage?.message) msgObj = msgObj.viewOnceMessage.message;
        if (msgObj?.viewOnceMessageV2?.message) msgObj = msgObj.viewOnceMessageV2.message;
        if (msgObj?.viewOnceMessageV2Extension?.message) msgObj = msgObj.viewOnceMessageV2Extension.message;
        if (msgObj?.ephemeralMessage?.message) msgObj = msgObj.ephemeralMessage.message;
        if (msgObj?.documentWithCaptionMessage?.message) msgObj = msgObj.documentWithCaptionMessage.message;

        const mediaMsg = msgObj?.audioMessage || msgObj?.videoMessage || msgObj?.documentMessage;

        if (!mediaMsg) {
            const usageCard = `╭─ *🤖 𝗭𝗢𝗫𝗘𝗥 𝗥𝗢𝗕𝗢𝗧 𝗩𝗢𝗜𝗖𝗘*
┃
┃  Transform voice notes or audio into
┃  a futuristic robotic synthesizer!
┃
┃  ◈ *Usage:*
┃  ◆ Reply to any voice note or audio with \`.robot\`
┃  ◆ Or send audio/video with \`.robot\` caption
┃
╰───────────────`;
            return await sock.sendMessage(chatId, { text: usageCard }, { quoted: message });
        }

        targetMessage = {
            ...targetMessage,
            message: msgObj
        };

        try {
            await sock.sendMessage(chatId, { react: { text: '🤖', key: message.key } });
        } catch (_) {}

        const downloadMedia = (sock && typeof sock.downloadMediaMessage === 'function')
            ? sock.downloadMediaMessage
            : baileys.downloadMediaMessage;

        const mediaBuffer = await downloadMedia(targetMessage, 'buffer', {}, {
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
        else if (mime.includes('webm')) ext = '.webm';

        const id = crypto.randomBytes(6).toString('hex');
        tempInput = path.join(tempDir, `in_robot_${id}${ext}`);
        tempOutput = path.join(tempDir, `out_robot_${id}.opus`);

        fs.writeFileSync(tempInput, mediaBuffer);

        const audioExists = await hasAudioStream(tempInput);
        if (!audioExists) {
            return await sock.sendMessage(chatId, {
                text: '⚠️ The replied media has *no audio track*. Please reply to an audio message or video with sound.'
            }, { quoted: message });
        }

        // Apply metallic synthesizer filter for futuristic robotic voice
        const cmd = `ffmpeg -y -i "${tempInput}" -af "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75" -c:a libopus -b:a 64k -vn "${tempOutput}"`;

        await new Promise((resolve, reject) => {
            exec(cmd, (err, stdout, stderr) => {
                if (err) {
                    const errStr = `${err.message || ''} ${stderr || ''}`;
                    if (errStr.includes('Output file does not contain any stream') ||
                        errStr.includes('does not contain any stream') ||
                        errStr.includes('matches no streams')) {
                        return reject(new Error('The replied media contains no audio stream.'));
                    }
                    if (errStr.includes('not found') || errStr.includes('ENOENT')) {
                        return reject(new Error('FFmpeg is not installed on the server.'));
                    }
                    return reject(err);
                }
                resolve();
            });
        });

        const robotAudioBuffer = fs.readFileSync(tempOutput);

        await sock.sendMessage(chatId, {
            audio: robotAudioBuffer,
            mimetype: 'audio/ogg; codecs=opus',
            ptt: true
        }, { quoted: message });

        try {
            await sock.sendMessage(chatId, { react: { text: '✨', key: message.key } });
        } catch (_) {}

    } catch (err) {
        console.error('❌ [ROBOT VOICE ERROR]:', err);
        const errMsg = err?.message || String(err);
        const userMsg = (errMsg.includes('no audio') || errMsg.includes('silent'))
            ? '⚠️ The replied media has *no audio track*. Please reply to an audio or video with sound.'
            : (errMsg.includes('FFmpeg is not installed') 
                ? '⚠️ FFmpeg is not installed on the server. Please contact bot host.'
                : `❌ Failed to process robotic audio: ${errMsg}`);

        try {
            await sock.sendMessage(chatId, { react: { text: '⚠️', key: message.key } });
        } catch (_) {}
        await sock.sendMessage(chatId, { text: userMsg }, { quoted: message });
    } finally {
        try { if (tempInput && fs.existsSync(tempInput)) fs.unlinkSync(tempInput); } catch (_) {}
        try { if (tempOutput && fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput); } catch (_) {}
    }
}

module.exports = robotCommand;

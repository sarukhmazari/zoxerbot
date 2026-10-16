const gTTS = require('gtts');
const fs = require('fs');
const path = require('path');

async function ttsCommand(sock, chatId, text, message, language = 'en') {
    if (!text) {
        await sock.sendMessage(chatId, { text: 'Please provide the text for TTS conversion.' }, { quoted: message });
        return;
    }

    const fileName = `tts-${Date.now()}.mp3`;
    const filePath = path.join(__dirname, '..', 'assets', fileName);

    try {
        await new Promise((resolve, reject) => {
            const gtts = new gTTS(text, language);
            gtts.save(filePath, (err) => err ? reject(err) : resolve());
        });

        const audioBuffer = fs.readFileSync(filePath);
        await sock.sendMessage(chatId, {
            audio: audioBuffer,
            mimetype: 'audio/mpeg'
        }, { quoted: message });
    } catch (error) {
        console.error('TTS error:', error);
        await sock.sendMessage(chatId, { text: 'Error generating TTS audio.' }, { quoted: message });
    } finally {
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (e) {}
    }
}

module.exports = ttsCommand;

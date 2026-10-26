const axios = require('axios');

async function qrcodeCommand(sock, chatId, message, args) {
    try {
        const text = args.join(' ').trim();
        if (!text) {
            return await sock.sendMessage(chatId, {
                text: '⚠️ Please provide text or a URL to generate a QR code.\n*Example:* `.qr https://google.com`'
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&margin=10&data=${encodeURIComponent(text)}`;
        const response = await axios.get(qrUrl, { responseType: 'arraybuffer', timeout: 10000 });

        await sock.sendMessage(chatId, {
            image: Buffer.from(response.data),
            mimetype: 'image/png',
            caption: `📱 *QR Code Generated*\n*Content:* ${text}`
        }, { quoted: message });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (err) {
        console.error('Error in qrcodeCommand:', err);
        await sock.sendMessage(chatId, {
            text: `❌ Failed to generate QR code: ${err.message}`
        }, { quoted: message });
    }
}

module.exports = qrcodeCommand;

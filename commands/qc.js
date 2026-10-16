const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const { Jimp, loadFont, measureTextHeight } = require('jimp');
const webp = require('node-webpmux');
const settings = require('../settings');

// Helper to create EXIF metadata buffer for WhatsApp stickers
function createExif(packname, author) {
    const json = {
        'sticker-pack-id': crypto.randomBytes(32).toString('hex'),
        'sticker-pack-name': packname || settings.packname || 'ZOXER BOT',
        'sticker-pack-publisher': author || settings.author || 'ZOXER TEAM',
        'emojis': ['🤖']
    };
    const exifAttr = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
    const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
    const exif = Buffer.concat([exifAttr, jsonBuffer]);
    exif.writeUIntLE(jsonBuffer.length, 14, 4);
    return exif;
}

let cachedFontText = null;
let cachedFontName = null;

async function getFonts() {
    if (!cachedFontText) {
        try {
            const fontPath = path.join(__dirname, '../node_modules/@jimp/plugin-print/fonts/open-sans/open-sans-16-white/open-sans-16-white.fnt');
            cachedFontText = await loadFont(fontPath);
            cachedFontName = cachedFontText;
        } catch (e) {
            console.error('Failed to load bitmap fonts for QC:', e.message);
        }
    }
    return { fontText: cachedFontText, fontName: cachedFontName };
}

async function qcCommand(sock, chatId, text, message) {
    let quotedInfo = message.message?.extendedTextMessage?.contextInfo;
    let quotedMsg = quotedInfo?.quotedMessage;
    let textToQuote = text || '';

    // If it's a reply, use the replied message text instead of args
    if (quotedMsg) {
        textToQuote = quotedMsg.conversation ||
            quotedMsg.extendedTextMessage?.text ||
            quotedMsg.imageMessage?.caption ||
            quotedMsg.videoMessage?.caption || '';
    }

    if (!textToQuote) {
        await sock.sendMessage(chatId, { text: '❌ Please reply to a text message or write text after the command to create a quote sticker.' });
        return;
    }

    // React to let user know we are working on it
    try {
        await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } });
    } catch (e) { }

    const senderJid = quotedInfo?.participant || quotedInfo?.sender || message.key.participant || message.key.remoteJid;
    let senderName = message.pushName || 'User';
    if (quotedInfo && quotedInfo.participant) {
        senderName = quotedInfo.participant.split('@')[0];
    }
    if (senderName.includes('@')) {
        senderName = senderName.split('@')[0];
    }

    // Fetch profile picture if available
    let avatarImg = null;
    try {
        const profilePicUrl = await sock.profilePictureUrl(senderJid, 'image');
        if (profilePicUrl) {
            const avatarRes = await axios.get(profilePicUrl, { responseType: 'arraybuffer', timeout: 5000 });
            avatarImg = await Jimp.read(avatarRes.data);
            avatarImg.resize({ w: 56, h: 56 });
            avatarImg.circle();
        }
    } catch (e) {
        // Fallback to default avatar
    }

    if (!avatarImg) {
        avatarImg = new Jimp({ width: 56, height: 56, color: 0x3b82f6ff });
        avatarImg.circle();
    }

    try {
        await webp.Image.initLib();
        const { fontText, fontName } = await getFonts();

        if (!fontText) {
            throw new Error('Font not available');
        }

        const maxTextWidth = 320;
        const padding = 16;
        const textHeight = measureTextHeight(fontText, textToQuote, maxTextWidth);
        const nameHeight = senderName ? 24 : 0;
        const bubbleHeight = Math.max(70, padding + nameHeight + textHeight + padding);
        const bubbleWidth = Math.min(380, maxTextWidth + (padding * 2));

        // Create dark WhatsApp chat bubble
        const bubble = new Jimp({ width: bubbleWidth, height: bubbleHeight, color: 0x202c33ff });

        // Print sender name & text
        let curY = padding - 4;
        if (senderName) {
            bubble.print({ font: fontName, x: padding, y: curY, text: senderName });
            curY += 22;
        }
        bubble.print({ font: fontText, x: padding, y: curY, text: textToQuote, maxWidth: maxTextWidth });

        // Composite onto 512x512 transparent canvas
        const canvas = new Jimp({ width: 512, height: 512, color: 0x00000000 });
        const startY = Math.max(10, Math.round((512 - bubbleHeight) / 2));
        const avatarX = 20;
        const bubbleX = 86;

        canvas.composite(avatarImg, avatarX, startY);
        canvas.composite(bubble, bubbleX, startY);

        // Convert to WebP sticker with EXIF
        const emptyBuf = Buffer.from([
            0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
            0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
            0x18, 0x00, 0x00, 0x00, 0x30, 0x01, 0x00, 0x9d,
            0x01, 0x2a, 0x01, 0x00, 0x01, 0x00, 0x02, 0x00,
            0x34, 0x25, 0xa4, 0x00, 0x03, 0x70, 0x00, 0xfe,
            0xfb, 0xfd, 0x50, 0x00
        ]);

        const webpImg = new webp.Image();
        await webpImg.load(emptyBuf);
        await webpImg.setImageData(canvas.bitmap.data, { width: 512, height: 512, quality: 85 });
        webpImg.exif = createExif(settings.packname, settings.author);

        const finalBuffer = await webpImg.save(null);

        // Send Sticker
        await sock.sendMessage(chatId, { sticker: finalBuffer }, { quoted: message });

    } catch (error) {
        console.error('Error generating QC sticker:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to process sticker image.' });
    }
}

module.exports = qcCommand;

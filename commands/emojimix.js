const axios = require('axios');
const crypto = require('crypto');
const { Jimp } = require('jimp');
const webp = require('node-webpmux');
const emojiMixerMod = require('emoji-mixer');
const emojiMixer = emojiMixerMod.default || emojiMixerMod;
const settings = require('../settings');

// Helper to create EXIF metadata buffer for WhatsApp stickers
function createExif(packname, author, emojis = ['🎨']) {
    const json = {
        'sticker-pack-id': crypto.randomBytes(32).toString('hex'),
        'sticker-pack-name': packname || settings.packname || 'ZOXER BOT',
        'sticker-pack-publisher': author || settings.author || 'ZOXER TEAM',
        'emojis': Array.isArray(emojis) && emojis.length ? emojis : ['🎨']
    };
    const exifAttr = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
    const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
    const exif = Buffer.concat([exifAttr, jsonBuffer]);
    exif.writeUIntLE(jsonBuffer.length, 14, 4);
    return exif;
}

// Convert image buffer to 512x512 transparent WebP sticker
async function imageToWebp(mediaBuffer, packname, author, emojis) {
    await webp.Image.initLib();
    const image = await Jimp.read(mediaBuffer);

    // Create a 512x512 transparent canvas
    const canvas = new Jimp({ width: 512, height: 512, color: 0x00000000 });

    const w = image.width;
    const h = image.height;
    let targetW = 512, targetH = 512;
    let offsetX = 0, offsetY = 0;

    if (w > h) {
        targetW = 512;
        targetH = Math.max(1, Math.round(512 * (h / w)));
        offsetY = Math.round((512 - targetH) / 2);
    } else {
        targetH = 512;
        targetW = Math.max(1, Math.round(512 * (w / h)));
        offsetX = Math.round((512 - targetW) / 2);
    }

    image.resize({ w: targetW, h: targetH });
    canvas.composite(image, offsetX, offsetY);

    // Blank WebP frame container for node-webpmux
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
    await webpImg.setImageData(canvas.bitmap.data, { width: 512, height: 512, quality: 90 });
    webpImg.exif = createExif(packname, author, emojis);

    return await webpImg.save(null);
}

// Extract individual emojis using grapheme clusters and unicode pictographic matching
function extractEmojis(inputStr) {
    if (!inputStr || typeof inputStr !== 'string') return [];
    
    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
    const segments = [...segmenter.segment(inputStr.trim())].map(s => s.segment.trim()).filter(Boolean);
    const emojiRegex = /\p{Extended_Pictographic}/u;

    return segments.filter(s => emojiRegex.test(s));
}

module.exports = async function emojimixCommand(sock, chatId, text, message) {
    let rawInput = (text || '').trim();

    // Support replying to a message containing emojis with just .emojimix
    if (!rawInput && message?.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        const quoted = message.message.extendedTextMessage.contextInfo.quotedMessage;
        rawInput = (quoted.conversation || quoted.extendedTextMessage?.text || '').trim();
    }

    const emojis = extractEmojis(rawInput);

    if (emojis.length < 2) {
        const usageGuide = `╭─ *🎨 𝗭𝗢𝗫𝗘𝗥 𝗘𝗠𝗢𝗝𝗜𝗠𝗜𝗫*
┃
┃  Mix two emojis into a Google Emoji
┃  Kitchen custom sticker!
┃
┃  ◈ *Usage:*
┃  ◆ \`.emojimix <emoji1>+<emoji2>\`
┃
┃  ◈ *Examples:*
┃  ◆ \`.emojimix 😎+🔥\`
┃  ◆ \`.emojimix 😂+💀\`
┃  ◆ \`.emojimix 😎+🥺\`
┃  ◆ \`.emojimix 🐱+🚀\`
┃  ◆ \`.emojimix 🤡+🎈\`
┃  ◆ \`.emojimix 🍕+❤️\`
┃
╰───────────────`;
        return await sock.sendMessage(chatId, { text: usageGuide }, { quoted: message });
    }

    const emoji1 = emojis[0];
    const emoji2 = emojis[1];

    try {
        await sock.sendMessage(chatId, { react: { text: '🎨', key: message.key } });
    } catch (_) {}

    try {
        // Find Google Emoji Kitchen URL
        let kitchenUrl = null;
        try {
            kitchenUrl = emojiMixer(emoji1, emoji2) || emojiMixer(emoji2, emoji1);
        } catch (_) {}

        if (!kitchenUrl) {
            try {
                await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            } catch (_) {}

            return await sock.sendMessage(chatId, {
                text: `❌ *Combo Not Supported!*\n\nGoogle Emoji Kitchen does not have a mashup for ${emoji1} + ${emoji2}.\n\n💡 *Tip:* Try mixing face expressions, animals, or objects (e.g. \`.emojimix 😎+🔥\` or \`.emojimix 😂+💀\`).`
            }, { quoted: message });
        }

        // Fetch image PNG from CDN
        const response = await axios.get(kitchenUrl, {
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });

        if (!response.data || response.data.length === 0) {
            throw new Error('Downloaded image buffer is empty');
        }

        const packname = settings.packname || 'ZOXER BOT';
        const author = settings.author || 'ZOXER TEAM';

        const stickerBuffer = await imageToWebp(response.data, packname, author, [emoji1, emoji2]);

        await sock.sendMessage(chatId, {
            sticker: stickerBuffer
        }, { quoted: message });

        try {
            await sock.sendMessage(chatId, { react: { text: '✨', key: message.key } });
        } catch (_) {}

    } catch (err) {
        console.error('❌ [EMOJIMIX ERROR]:', err);
        try {
            await sock.sendMessage(chatId, { react: { text: '⚠️', key: message.key } });
        } catch (_) {}
        await sock.sendMessage(chatId, {
            text: `❌ *Failed to generate emoji sticker:*\n${err.message || 'Unknown error occurred.'}`
        }, { quoted: message });
    }
};

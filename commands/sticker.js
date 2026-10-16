const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');
const webp = require('node-webpmux');
const crypto = require('crypto');
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

// Convert image buffer to 512x512 WebP sticker using pure Jimp + node-webpmux
async function imageToWebpWithJimp(mediaBuffer, packname, author) {
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
    await webpImg.setImageData(canvas.bitmap.data, { width: 512, height: 512, quality: 85 });
    webpImg.exif = createExif(packname, author);

    return await webpImg.save(null);
}

// Convert video/gif to animated WebP via ffmpeg (for video clips)
async function videoToWebpWithFfmpeg(mediaBuffer, isAnimated, packname, author) {
    const tmpDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const tempInput = path.join(tmpDir, `temp_vid_${Date.now()}`);
    const tempOutput = path.join(tmpDir, `sticker_vid_${Date.now()}.webp`);
    fs.writeFileSync(tempInput, mediaBuffer);

    const ffmpegCommand = `ffmpeg -y -i "${tempInput}" -t 3 -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=12,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 50 -compression_level 6 -b:v 150k "${tempOutput}"`;

    await new Promise((resolve, reject) => {
        exec(ffmpegCommand, (error) => {
            if (error) reject(error);
            else resolve();
        });
    });

    const webpBuffer = fs.readFileSync(tempOutput);
    try { fs.unlinkSync(tempInput); } catch { }
    try { fs.unlinkSync(tempOutput); } catch { }

    const img = new webp.Image();
    await img.load(webpBuffer);
    img.exif = createExif(packname, author);
    return await img.save(null);
}

async function stickerCommand(sock, chatId, message) {
    const messageToQuote = message;
    let targetMessage = message;

    // Check if message is replying to media
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

    const mediaMessage = targetMessage.message?.imageMessage ||
        targetMessage.message?.videoMessage ||
        targetMessage.message?.stickerMessage ||
        targetMessage.message?.documentMessage;

    if (!mediaMessage) {
        await sock.sendMessage(chatId, {
            text: '⚠️ Please reply to an image or video with `.sticker` to create a sticker!'
        }, { quoted: messageToQuote });
        return;
    }

    try {
        const mediaBuffer = await downloadMediaMessage(targetMessage, 'buffer', {}, {
            logger: undefined,
            reuploadRequest: sock.updateMediaMessage
        });

        if (!mediaBuffer) {
            await sock.sendMessage(chatId, {
                text: '❌ Failed to download media. Please try again.'
            }, { quoted: messageToQuote });
            return;
        }

        const isAnimated = mediaMessage.mimetype?.includes('gif') ||
            mediaMessage.mimetype?.includes('video') ||
            (mediaMessage.seconds && mediaMessage.seconds > 0);

        let finalStickerBuffer;

        // 1. If it's already a WebP sticker, repack with our EXIF
        if (mediaMessage.mimetype?.includes('webp') || (mediaBuffer[8] === 0x57 && mediaBuffer[9] === 0x45 && mediaBuffer[10] === 0x42 && mediaBuffer[11] === 0x50)) {
            const img = new webp.Image();
            await img.load(mediaBuffer);
            img.exif = createExif(settings.packname, settings.author);
            finalStickerBuffer = await img.save(null);
        }
        // 2. If it's an animated GIF or Video, use video pipeline
        else if (isAnimated) {
            finalStickerBuffer = await videoToWebpWithFfmpeg(mediaBuffer, isAnimated, settings.packname, settings.author);
        }
        // 3. For all static images (JPEG, PNG, BMP, TIFF), use fast pure Jimp
        else {
            try {
                finalStickerBuffer = await imageToWebpWithJimp(mediaBuffer, settings.packname, settings.author);
            } catch (jimpErr) {
                console.warn('Jimp conversion failed, trying ffmpeg fallback:', jimpErr.message);
                finalStickerBuffer = await videoToWebpWithFfmpeg(mediaBuffer, false, settings.packname, settings.author);
            }
        }

        // Send the sticker
        await sock.sendMessage(chatId, {
            sticker: finalStickerBuffer
        }, { quoted: messageToQuote });

    } catch (error) {
        console.error('Error in sticker command:', error);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to create sticker! Please try again with another image.'
        }, { quoted: messageToQuote });
    }
}

module.exports = stickerCommand;

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');
const Jimp = require('jimp');

async function blurCommand(sock, chatId, message, quotedMessage) {
    try {
        // Get the image to blur
        let imageBuffer;

        if (quotedMessage) {
            // If replying to a message
            if (!quotedMessage.imageMessage) {
                await sock.sendMessage(chatId, {
                    text: '❌ Please reply to an image message'
                }, { quoted: message });
                return;
            }

            const quoted = {
                message: {
                    imageMessage: quotedMessage.imageMessage
                }
            };

            imageBuffer = await downloadMediaMessage(
                quoted,
                'buffer',
                {},
                {}
            );
        } else if (message.message?.imageMessage) {
            // If image is in current message
            imageBuffer = await downloadMediaMessage(
                message,
                'buffer',
                {},
                {}
            );
        } else {
            await sock.sendMessage(chatId, {
                text: '❌ Please reply to an image or send an image with caption .blur'
            }, { quoted: message });
            return;
        }

        // Read image with Jimp
        const image = await Jimp.read(imageBuffer);

        // Resize and apply blur effect
        const blurredImageBuffer = await image
            .scaleToFit(800, 800) // Resize to max 800x800
            .blur(10) // Blur radius of 10
            .getBufferAsync(Jimp.MIME_JPEG);

        // Send the blurred image
        await sock.sendMessage(chatId, {
            image: blurredImageBuffer,
            caption: '*[ ✔ ] Image Blurred Successfully*'
        }, { quoted: message });

    } catch (error) {
        console.error('Error in blur command:', error);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to blur image. Please try again later.'
        }, { quoted: message });
    }
}

module.exports = blurCommand; 
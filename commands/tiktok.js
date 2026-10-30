const axios = require('axios');
const { fetchMediaFromApi } = require('../lib/mediaApi');

// Store processed message IDs to prevent duplicates
const processedMessages = new Set();

async function tiktokCommand(sock, chatId, message) {
    try {
        // Check if message has already been processed
        if (processedMessages.has(message.key.id)) {
            return;
        }

        // Add message ID to processed set
        processedMessages.add(message.key.id);

        // Clean up old message IDs after 5 minutes
        setTimeout(() => {
            processedMessages.delete(message.key.id);
        }, 5 * 60 * 1000);

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text;

        if (!text) {
            return await sock.sendMessage(chatId, {
                text: "Please provide a TikTok link for the video.\nExample: .tiktok https://vt.tiktok.com/..."
            }, { quoted: message });
        }

        // Extract URL from command
        const url = text.split(/\s+/).slice(1).join(' ').trim();

        if (!url) {
            return await sock.sendMessage(chatId, {
                text: "Please provide a TikTok link for the video.\nExample: .tiktok https://vt.tiktok.com/..."
            }, { quoted: message });
        }

        // Check for various TikTok URL formats
        const tiktokPatterns = [
            /https?:\/\/(?:www\.)?tiktok\.com\//i,
            /https?:\/\/(?:vm\.)?tiktok\.com\//i,
            /https?:\/\/(?:vt\.)?tiktok\.com\//i,
            /https?:\/\/(?:m\.)?tiktok\.com\//i,
            /https?:\/\/(?:www\.)?tiktok\.com\/@/i,
            /https?:\/\/(?:www\.)?tiktok\.com\/t\//i
        ];

        const isValidUrl = tiktokPatterns.some(pattern => pattern.test(url));

        if (!isValidUrl) {
            return await sock.sendMessage(chatId, {
                text: "❌ That is not a valid TikTok link. Please provide a valid TikTok video link."
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, {
            react: { text: '🔄', key: message.key }
        });

        try {
            // Call private Cloudflare Workers Media API
            const media = await fetchMediaFromApi(url, 'video');
            const downloadUrl = media.downloadUrl;
            const title = media.title || 'TikTok Video';

            const caption = `🎬 *${title}*\n\n⚡ *Downloaded by ZoxerBot*`;

            try {
                // Try sending direct URL
                await sock.sendMessage(chatId, {
                    video: { url: downloadUrl },
                    caption: caption,
                    ...global.channelInfo
                }, { quoted: message });
            } catch (streamError) {
                console.warn('[TIKTOK] Direct URL stream failed, attempting buffer fallback:', streamError.message);
                // Fallback to downloading buffer if direct stream encounters network/CDN issues
                const res = await axios.get(downloadUrl, {
                    responseType: 'arraybuffer',
                    timeout: 60000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                await sock.sendMessage(chatId, {
                    video: Buffer.from(res.data),
                    mimetype: 'video/mp4',
                    caption: caption,
                    ...global.channelInfo
                }, { quoted: message });
            }

            await sock.sendMessage(chatId, {
                react: { text: '✅', key: message.key }
            });

        } catch (downloadErr) {
            console.error('[TIKTOK] Download error:', downloadErr.message || downloadErr);
            await sock.sendMessage(chatId, {
                react: { text: '❌', key: message.key }
            });
            await sock.sendMessage(chatId, {
                text: `❌ *Failed to download TikTok video.*\n\n*Error:* ${downloadErr.message || 'Please check the link and try again.'}`
            }, { quoted: message });
        }

    } catch (error) {
        console.error('Error in TikTok command:', error);
        await sock.sendMessage(chatId, {
            text: "An error occurred while processing the request. Please try again later."
        }, { quoted: message });
    }
}

module.exports = tiktokCommand;
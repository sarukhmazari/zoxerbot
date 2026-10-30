const axios = require('axios');
const { fetchMediaFromApi } = require('../lib/mediaApi');

// Store processed message IDs to prevent duplicate handling
const processedMessages = new Set();

async function instagramCommand(sock, chatId, message) {
    try {
        // Prevent duplicate processing
        if (processedMessages.has(message.key.id)) return;
        processedMessages.add(message.key.id);
        setTimeout(() => processedMessages.delete(message.key.id), 5 * 60 * 1000);

        const text = (
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            ''
        );

        // Extract the URL from the message text
        const urlArg = text.trim().split(/\s+/).slice(1).join(' ').trim();

        if (!urlArg) {
            return await sock.sendMessage(chatId, {
                text: "📥 *Please provide an Instagram post or reel link!*\n\n*Example:* `.igd https://www.instagram.com/reel/...`"
            }, { quoted: message });
        }

        // Validate Instagram URL patterns
        const instagramPatterns = [
            /https?:\/\/(?:www\.)?instagram\.com\/p\//i,
            /https?:\/\/(?:www\.)?instagram\.com\/reel\//i,
            /https?:\/\/(?:www\.)?instagram\.com\/reels\//i,
            /https?:\/\/(?:www\.)?instagram\.com\/tv\//i,
            /https?:\/\/(?:www\.)?instagram\.com\/share\//i,
            /https?:\/\/(?:www\.)?instagr\.am\//i,
        ];

        const isValidUrl = instagramPatterns.some(pattern => pattern.test(urlArg));

        if (!isValidUrl) {
            return await sock.sendMessage(chatId, {
                text: "❌ *Invalid Instagram URL!*\nPlease provide a valid Instagram post, reel, or TV link.\n\n*Example:* `.igd https://www.instagram.com/reel/...`"
            }, { quoted: message });
        }

        // React with loading
        await sock.sendMessage(chatId, {
            react: { text: '🔄', key: message.key }
        });

        try {
            // Call private Cloudflare Workers Media API
            const media = await fetchMediaFromApi(urlArg, 'video');
            const downloadUrl = media.downloadUrl;
            const title = media.title || 'Instagram Media';
            const caption = `📸 *${title}*\n\n⚡ *Downloaded by ZoxerBot*`;
            const isVideo = media.type === 'video' || /\.mp4(\?|$)/i.test(downloadUrl) || media.format === 'mp4';

            if (isVideo) {
                try {
                    await sock.sendMessage(chatId, {
                        video: { url: downloadUrl },
                        caption: caption,
                        ...global.channelInfo
                    }, { quoted: message });
                } catch (streamError) {
                    console.warn('[INSTAGRAM] Direct URL stream failed, attempting buffer fallback:', streamError.message);
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
            } else {
                try {
                    await sock.sendMessage(chatId, {
                        image: { url: downloadUrl },
                        caption: caption,
                        ...global.channelInfo
                    }, { quoted: message });
                } catch (streamError) {
                    console.warn('[INSTAGRAM] Direct image stream failed, attempting buffer fallback:', streamError.message);
                    const res = await axios.get(downloadUrl, {
                        responseType: 'arraybuffer',
                        timeout: 30000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });
                    await sock.sendMessage(chatId, {
                        image: Buffer.from(res.data),
                        caption: caption,
                        ...global.channelInfo
                    }, { quoted: message });
                }
            }

            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

        } catch (downloadErr) {
            console.error('[INSTAGRAM] Error:', downloadErr.message || downloadErr);
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            await sock.sendMessage(chatId, {
                text: `❌ *Failed to download Instagram media.*\n\n*Error:* ${downloadErr.message || 'Post may be private or unavailable.'}`
            }, { quoted: message });
        }

    } catch (error) {
        console.error('Error in Instagram command handler:', error);
        try {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            await sock.sendMessage(chatId, {
                text: "❌ An error occurred while processing your Instagram request."
            }, { quoted: message });
        } catch (_) {}
    }
}

module.exports = instagramCommand;

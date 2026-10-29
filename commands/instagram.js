const { igdl } = require("ruhend-scraper");
const axios = require('axios');
const settings = require('../settings');

// Store processed message IDs to prevent duplicate handling
const processedMessages = new Set();

// Download media as buffer to reduce bot load — no direct URL streaming
async function downloadMediaBuffer(url) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000,
        maxContentLength: 100 * 1024 * 1024, // 100MB max
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': '*/*',
        },
        validateStatus: s => s >= 200 && s < 300,
    });
    return Buffer.from(res.data);
}

// Simple deduplication by URL
function extractUniqueMedia(mediaData) {
    const uniqueMedia = [];
    const seenUrls = new Set();

    for (const media of mediaData) {
        if (!media.url) continue;
        if (!seenUrls.has(media.url)) {
            seenUrls.add(media.url);
            uniqueMedia.push(media);
        }
    }

    return uniqueMedia;
}

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
                text: "📥 Instagram post/reel ka link den.\nExample: .igd https://www.instagram.com/reel/..."
            }, { quoted: message });
        }

        // Validate Instagram URL patterns
        const instagramPatterns = [
            /https?:\/\/(?:www\.)?instagram\.com\/p\//,
            /https?:\/\/(?:www\.)?instagram\.com\/reel\//,
            /https?:\/\/(?:www\.)?instagram\.com\/reels\//,
            /https?:\/\/(?:www\.)?instagram\.com\/tv\//,
            /https?:\/\/(?:www\.)?instagr\.am\//,
        ];

        const isValidUrl = instagramPatterns.some(pattern => pattern.test(urlArg));

        if (!isValidUrl) {
            return await sock.sendMessage(chatId, {
                text: "❌ Ye valid Instagram link nahi hai.\nSirf post, reel ya IGTV ka link den.\n\nExample: .igd https://www.instagram.com/reel/..."
            }, { quoted: message });
        }

        // React with loading
        await sock.sendMessage(chatId, {
            react: { text: '🔄', key: message.key }
        });

        let downloadData = { data: [] };

        // 1. Try KnightBot API first
        const kbApiKey = process.env.KNIGHTBOT_API_KEY || (settings && settings.knightBotApiKey) || 'knight';
        try {
            const kbUrl = `https://knightbotapi.stream/api/download/instagram?apikey=${encodeURIComponent(kbApiKey)}&url=${encodeURIComponent(urlArg)}`;
            const kbRes = await axios.get(kbUrl, {
                timeout: 7000,
                headers: {
                    'accept': '*/*',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                validateStatus: s => s >= 200 && s < 500
            });

            if (kbRes.data?.success && kbRes.data?.result) {
                const r = kbRes.data.result;
                if (Array.isArray(r.media) && r.media.length > 0) {
                    for (const item of r.media) {
                        const mUrl = item.download || item.url;
                        if (mUrl) {
                            downloadData.data.push({
                                url: mUrl,
                                type: item.type || (/\.mp4/i.test(mUrl) ? 'video' : 'image')
                            });
                        }
                    }
                } else {
                    const directUrl = r.download || r.url || r.video || r.image;
                    if (directUrl && typeof directUrl === 'string' && directUrl.startsWith('http')) {
                        downloadData.data.push({
                            url: directUrl,
                            type: r.type || (/\.mp4/i.test(directUrl) ? 'video' : 'image')
                        });
                    }
                }
                if (downloadData.data.length > 0) {
                    console.log(`[INSTAGRAM] Successfully fetched ${downloadData.data.length} media from KnightBot API`);
                }
            }
        } catch (kbErr) {
            // Proceed to next fallback
        }

        // 2. Fallback to ruhend-scraper igdl if KnightBot returned no media
        if (!downloadData.data || downloadData.data.length === 0) {
            try {
                const fallbackData = await igdl(urlArg);
                if (fallbackData && fallbackData.data && fallbackData.data.length > 0) {
                    downloadData = fallbackData;
                }
            } catch (scrapeErr) {
                console.error('IGDL scraper error:', scrapeErr?.message || scrapeErr);
            }
        }

        if (!downloadData || !downloadData.data || downloadData.data.length === 0) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return await sock.sendMessage(chatId, {
                text: "❌ Instagram se download nahi ho saka. Post private ho sakti hai ya link expire ho gaya."
            }, { quoted: message });
        }

        // Deduplicate and limit
        const uniqueMedia = extractUniqueMedia(downloadData.data);
        const mediaToDownload = uniqueMedia.slice(0, 10); // Max 10 items to keep bot light

        if (mediaToDownload.length === 0) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return await sock.sendMessage(chatId, {
                text: "❌ Koi downloadable media nahi mila."
            }, { quoted: message });
        }

        let successCount = 0;

        for (let i = 0; i < mediaToDownload.length; i++) {
            try {
                const media = mediaToDownload[i];
                const mediaUrl = media.url;

                // Download as buffer first to avoid streaming issues
                const buffer = await downloadMediaBuffer(mediaUrl);

                // Determine if video or image
                const isVideo = /\.(mp4|mov|avi|mkv|webm)/i.test(mediaUrl) ||
                    media.type === 'video' ||
                    urlArg.includes('/reel/') ||
                    urlArg.includes('/tv/');

                const caption = i === 0 ? '𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗗 𝗕𝗬 𝗠𝗔𝗭𝗔𝗥𝗜 𝗕𝗢𝗧' : '';

                if (isVideo) {
                    await sock.sendMessage(chatId, {
                        video: buffer,
                        mimetype: "video/mp4",
                        caption,
                        ...global.channelInfo
                    }, { quoted: message });
                } else {
                    await sock.sendMessage(chatId, {
                        image: buffer,
                        caption,
                        ...global.channelInfo
                    }, { quoted: message });
                }

                successCount++;

                // Small delay between multiple media items
                if (i < mediaToDownload.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }

            } catch (mediaError) {
                console.error(`IG download media ${i + 1} error:`, mediaError?.message || mediaError);
                // Continue with next item silently
            }
        }

        if (successCount > 0) {
            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
        } else {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            await sock.sendMessage(chatId, {
                text: "❌ Media download fail ho gaya. Thori dair baad try kren."
            }, { quoted: message });
        }

    } catch (error) {
        console.error('Error in Instagram download command:', error);
        try {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            await sock.sendMessage(chatId, {
                text: "❌ Instagram request process karne mein error aya. Dobara try kren."
            }, { quoted: message });
        } catch (_) {
            // Silently ignore send errors in error handler
        }
    }
}

module.exports = instagramCommand;

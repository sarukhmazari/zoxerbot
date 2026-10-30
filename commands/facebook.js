const axios = require('axios');
const fs = require('fs');
const path = require('path');
const settings = require('../settings');
const { fetchMediaFromApi } = require('../lib/mediaApi');

async function facebookCommand(sock, chatId, message) {
    try {
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        const url = text ? text.split(/\s+/).slice(1).join(' ').trim() : '';

        if (!url) {
            return await sock.sendMessage(chatId, {
                text: "Please provide a Facebook video URL.\nExample: .fb https://www.facebook.com/..."
            }, { quoted: message });
        }

        // Validate Facebook URL
        const fbPatterns = [
            /https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\//i,
            /https?:\/\/fb\.watch\//i,
            /https?:\/\/(?:www\.)?fb\.com\//i
        ];

        const isValidFb = fbPatterns.some(p => p.test(url));
        if (!isValidFb) {
            return await sock.sendMessage(chatId, {
                text: "That is not a valid Facebook link."
            }, { quoted: message });
        }

        // Send loading reaction
        await sock.sendMessage(chatId, {
            react: { text: '🔄', key: message.key }
        });

        // 1. Primary: Call private Cloudflare Workers Media API
        try {
            const media = await fetchMediaFromApi(url, 'video');
            const downloadUrl = media.downloadUrl;
            const title = media.title || 'Facebook Video';
            const caption = `🎬 *${title}*\n\n⚡ *Downloaded by ZoxerBot*`;

            try {
                await sock.sendMessage(chatId, {
                    video: { url: downloadUrl },
                    caption: caption,
                    ...global.channelInfo
                }, { quoted: message });
            } catch (streamError) {
                console.warn('[FB-DOWNLOAD] Direct URL stream failed, attempting buffer fallback:', streamError.message);
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

            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
            return;
        } catch (apiError) {
            console.warn('[FB-DOWNLOAD] Private Media API returned:', apiError.message, '- trying fallback scrapers...');
        }

        // 2. Fallback: Resolve redirect and try KnightBot / Hanggts if private API fails
        let resolvedUrl = url;
        try {
            const res = await axios.get(url, { timeout: 15000, maxRedirects: 10, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const possible = res?.request?.res?.responseUrl;
            if (possible && typeof possible === 'string') {
                resolvedUrl = possible;
            }
        } catch (_) {}

        let fbvid = null;
        let title = 'Facebook Video';

        // Try KnightBot API fallback
        const kbApiKey = process.env.KNIGHTBOT_API_KEY || (settings && settings.knightBotApiKey) || 'knight';
        const urlsToTest = resolvedUrl !== url ? [resolvedUrl, url] : [url];
        for (const testUrl of urlsToTest) {
            if (fbvid) break;
            try {
                const kbUrl = `https://knightbotapi.stream/api/download/facebook?apikey=${encodeURIComponent(kbApiKey)}&url=${encodeURIComponent(testUrl)}`;
                const kbRes = await axios.get(kbUrl, {
                    timeout: 7000,
                    headers: { 'accept': '*/*', 'User-Agent': 'Mozilla/5.0' },
                    validateStatus: s => s >= 200 && s < 500
                });

                if (kbRes.data?.success && kbRes.data?.result) {
                    const r = kbRes.data.result;
                    const directVid = r.download || r.video_hd || r.video_sd || r.url || r.video;
                    if (directVid && typeof directVid === 'string' && directVid.startsWith('http')) {
                        fbvid = directVid;
                        title = r.title || 'Facebook Video';
                        break;
                    }
                }
            } catch (_) {}
        }

        // Try Hanggts API fallback if still not found
        if (!fbvid) {
            for (const testUrl of urlsToTest) {
                if (fbvid) break;
                try {
                    const hRes = await axios.get(`https://api.hanggts.xyz/download/facebook?url=${encodeURIComponent(testUrl)}`, {
                        timeout: 15000,
                        headers: { 'accept': '*/*', 'User-Agent': 'Mozilla/5.0' }
                    });
                    const d = hRes.data;
                    const directVid = d?.result?.media?.video_hd || d?.result?.media?.video_sd || d?.result?.url || d?.data?.url || d?.url;
                    if (directVid && typeof directVid === 'string' && directVid.startsWith('http')) {
                        fbvid = directVid;
                        title = d?.result?.info?.title || d?.result?.title || 'Facebook Video';
                        break;
                    }
                } catch (_) {}
            }
        }

        if (!fbvid) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return await sock.sendMessage(chatId, {
                text: '❌ Failed to download video from Facebook.\n\nPossible reasons:\n• Video is private or deleted\n• Link is invalid\n\nPlease try a different Facebook video link.'
            }, { quoted: message });
        }

        const caption = `🎬 *${title}*\n\n⚡ *Downloaded by ZoxerBot*`;
        await sock.sendMessage(chatId, {
            video: { url: fbvid },
            mimetype: 'video/mp4',
            caption: caption,
            ...global.channelInfo
        }, { quoted: message });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (error) {
        console.error('Error in Facebook command:', error);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, {
            text: "❌ An error occurred while downloading the Facebook video."
        }, { quoted: message });
    }
}

module.exports = facebookCommand;
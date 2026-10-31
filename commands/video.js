const axios = require('axios');
const yts = require('yt-search');

let settings = null;
try {
    settings = require('../settings');
} catch (_) {}

const API_BASE = (settings && settings.zoxerMediaApiUrl) || process.env.ZOXER_MEDIA_API_URL || 'https://zoxer-media-api.sarukhmazari1.workers.dev';
const API_KEY = (settings && settings.zoxerMediaApiKey) || process.env.ZOXER_MEDIA_API_KEY || 'zoxer_e4b5054d63fc1ed506cdafc9be5c858410b5f17e97a8a5da';

async function videoCommand(sock, chatId, message, queryText = '') {
    const rawInput = queryText || (
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        message.message?.imageMessage?.caption ||
        message.message?.videoMessage?.caption ||
        ''
    );
    const text = rawInput.replace(/^\.(video|ytmp4|ytvideo)\s*/i, '').trim();

    if (!text) {
        return await sock.sendMessage(chatId, {
            text: '🎬 *Please provide a video name or YouTube link!*\n\n*Usage:* `.video <video name>`\n*Example:* `.video Believer Imagine Dragons`\n*Direct link:* `.video https://youtu.be/...`'
        }, { quoted: message });
    }

    await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

    try {
        let targetUrl = text;
        let title = text;
        let author = 'YouTube';

        const isUrl = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?|shorts\/|v\/|embed\/)|youtu\.be\/)/i.test(text);

        // 1. Resolve query via yt-search if not already a link
        if (!isUrl) {
            const search = await yts(text);
            const video = search?.videos?.[0];
            if (!video) throw new Error('No video found for this search.');
            targetUrl = video.url;
            title = video.title;
            author = video.author?.name || 'YouTube';
        }

        // 2. Request direct download URL from Cloudflare Worker (with automatic retry)
        let res;
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                res = await axios.post(`${API_BASE}/api/v1/download`, {
                    url: targetUrl,
                    format: 'video'
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${API_KEY}`
                    },
                    timeout: 35000
                });
                if (res.data?.success && res.data?.data?.media?.download_url) {
                    break;
                }
            } catch (postErr) {
                if (attempt === 2) throw postErr;
                await new Promise(r => setTimeout(r, 1200));
            }
        }

        const downloadUrl = res?.data?.data?.media?.download_url;
        if (!res?.data?.success || !downloadUrl) {
            throw new Error(res?.data?.error?.message || 'Media extraction failed.');
        }

        const videoTitle = res.data.data.title || title;
        const channel = res.data.data.author?.name || author;
        const safeFileName = `${(videoTitle || 'video').replace(/[\\/:*?"<>|]/g, '_')}.mp4`;
        const caption = `🎬 *${videoTitle}*\n📺 *Channel:* ${channel}\n\n⚡ *Downloaded by ZoxerBot*`;

        // 3. Send video to WhatsApp
        try {
            await sock.sendMessage(chatId, {
                video: { url: downloadUrl },
                mimetype: 'video/mp4',
                fileName: safeFileName,
                caption: caption
            }, { quoted: message });
        } catch (streamErr) {
            const bufferRes = await axios.get(downloadUrl, {
                responseType: 'arraybuffer',
                timeout: 90000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });

            await sock.sendMessage(chatId, {
                video: Buffer.from(bufferRes.data),
                mimetype: 'video/mp4',
                fileName: safeFileName,
                caption: caption
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (err) {
        console.error('[VIDEO ERROR]:', err.message);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, {
            text: `❌ *Video Download Failed*\n\n*Error:* ${err.response?.data?.error?.message || err.message}`
        }, { quoted: message });
    }
}

module.exports = videoCommand;

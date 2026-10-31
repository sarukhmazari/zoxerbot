const axios = require('axios');
const yts = require('yt-search');
const btch = require('btch-downloader');
const rahad = require('rahad-all-downloader-v2');

let settings = null;
try {
    settings = require('../settings');
} catch (_) {}

const API_BASE = (settings && settings.zoxerMediaApiUrl) || process.env.ZOXER_MEDIA_API_URL || 'https://zoxer-media-api.sarukhmazari1.workers.dev';
const API_KEY = (settings && settings.zoxerMediaApiKey) || process.env.ZOXER_MEDIA_API_KEY || 'zoxer_e4b5054d63fc1ed506cdafc9be5c858410b5f17e97a8a5da';

function extractYouTubeId(input) {
    if (!input || typeof input !== 'string') return null;
    const match = input.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?.*?v=|shorts\/|embed\/|v\/))([a-zA-Z0-9_-]{11})/i);
    return match ? match[1] : null;
}

async function resolveVideo(input) {
    let targetUrl = input;
    let title = input;
    let author = 'YouTube';
    let thumbnail = 'https://i.ibb.co/vzr5K2W/music.png';

    const isUrl = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?|shorts\/|v\/|embed\/)|youtu\.be\/)/i.test(input);
    let videoId = extractYouTubeId(input);

    if (!isUrl || !videoId) {
        const search = await yts(input);
        const video = search?.videos?.[0];
        if (!video) throw new Error('No video found for this search.');
        videoId = video.videoId || extractYouTubeId(video.url);
        title = video.title || title;
        author = video.author?.name || author;
        thumbnail = video.thumbnail || thumbnail;
    }

    if (!videoId) {
        throw new Error('Unable to resolve YouTube video ID.');
    }

    targetUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // 1. Cloudflare Worker Edge API
    try {
        const res = await axios.post(`${API_BASE}/api/v1/download`, {
            url: targetUrl,
            format: 'video'
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            timeout: 15000
        });

        if (res.data?.success && res.data?.data?.media?.download_url) {
            return {
                downloadUrl: res.data.data.media.download_url,
                title: res.data.data.title || title,
                author: res.data.data.author?.name || author,
                thumbnail: res.data.data.thumbnail || thumbnail,
                targetUrl
            };
        }
    } catch (cfErr) {
        console.warn('[VIDEO] Cloudflare Worker failed, trying BTCH fallback:', cfErr.response?.data?.error?.message || cfErr.message);
    }

    // 2. BTCH Downloader Fallback
    try {
        const bRes = await btch.youtube(targetUrl);
        const dl = bRes.mp4 || bRes.mp3;
        if (dl) {
            return {
                downloadUrl: dl,
                title: bRes.title || title,
                author: bRes.author || author,
                thumbnail: bRes.thumbnail || thumbnail,
                targetUrl
            };
        }
    } catch (bErr) {
        console.warn('[VIDEO] BTCH fallback failed, trying Rahad fallback:', bErr.message);
    }

    // 3. Rahad All Downloader Fallback
    try {
        const rRes = await rahad.alldl(targetUrl);
        const dl = rRes.data?.download?.video || rRes.data?.download?.audio;
        if (dl) {
            return {
                downloadUrl: dl,
                title: rRes.data?.title || title,
                author: author,
                thumbnail: thumbnail,
                targetUrl
            };
        }
    } catch (rErr) {
        console.warn('[VIDEO] Rahad fallback failed:', rErr.message);
    }

    throw new Error('Video extraction failed. Please retry in a few moments.');
}

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
        const media = await resolveVideo(text);
        const videoTitle = media.title;
        const channel = media.author;
        const safeFileName = `${(videoTitle || 'video').replace(/[\\/:*?"<>|]/g, '_')}.mp4`;
        const caption = `🎬 *${videoTitle}*\n📺 *Channel:* ${channel}\n\n⚡ *Downloaded by ZoxerBot*`;

        try {
            await sock.sendMessage(chatId, {
                video: { url: media.downloadUrl },
                mimetype: 'video/mp4',
                fileName: safeFileName,
                caption: caption
            }, { quoted: message });
        } catch (streamErr) {
            const bufferRes = await axios.get(media.downloadUrl, {
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

const axios = require('axios');
const yts = require('yt-search');

let settings = null;
try {
    settings = require('../settings');
} catch (_) {}

const API_BASE = (settings && settings.zoxerMediaApiUrl) || process.env.ZOXER_MEDIA_API_URL || 'https://zoxer-media-api.sarukhmazari1.workers.dev';
const API_KEY = (settings && settings.zoxerMediaApiKey) || process.env.ZOXER_MEDIA_API_KEY || 'zoxer_e4b5054d63fc1ed506cdafc9be5c858410b5f17e97a8a5da';

async function songCommand(sock, chatId, message, queryText = '') {
    const rawInput = queryText || (
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        message.message?.imageMessage?.caption ||
        message.message?.videoMessage?.caption ||
        ''
    );
    const text = rawInput.replace(/^\.(song|play|mp3)\s*/i, '').trim();

    if (!text) {
        return await sock.sendMessage(chatId, {
            text: '🎵 *Please provide a song name or YouTube link!*\n\n*Usage:* `.song <song name>`\n*Example:* `.song Believer`\n*Direct link:* `.song https://youtu.be/...`'
        }, { quoted: message });
    }

    await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

    try {
        let targetUrl = text;
        let title = text;
        let author = 'YouTube Music';
        let thumbnail = 'https://i.ibb.co/vzr5K2W/music.png';

        const isUrl = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?|shorts\/|v\/|embed\/)|youtu\.be\/)/i.test(text);

        // 1. Resolve query via yt-search if not already a link
        if (!isUrl) {
            const search = await yts(text);
            const video = search?.videos?.[0];
            if (!video) throw new Error('No song found for this search.');
            targetUrl = video.url;
            title = video.title;
            author = video.author?.name || 'Artist';
            thumbnail = video.thumbnail || thumbnail;
        }

        // 2. Request direct download URL from Cloudflare Worker (with automatic retry)
        let res;
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                res = await axios.post(`${API_BASE}/api/v1/download`, {
                    url: targetUrl,
                    format: 'audio'
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

        const songTitle = res.data.data.title || title;
        const songArtist = res.data.data.author?.name || author;
        const songThumb = res.data.data.thumbnail || thumbnail;
        const safeFileName = `${(songTitle || 'song').replace(/[\\/:*?"<>|]/g, '_')}.mp3`;

        // 3. Send audio to WhatsApp
        try {
            await sock.sendMessage(chatId, {
                audio: { url: downloadUrl },
                mimetype: 'audio/mpeg',
                fileName: safeFileName,
                contextInfo: {
                    externalAdReply: {
                        title: songTitle.slice(0, 60),
                        body: songArtist.slice(0, 60),
                        mediaType: 2,
                        thumbnailUrl: songThumb,
                        sourceUrl: targetUrl,
                        renderLargerThumbnail: true
                    }
                }
            }, { quoted: message });
        } catch (streamErr) {
            // Buffer fallback in case of direct stream error
            const bufferRes = await axios.get(downloadUrl, {
                responseType: 'arraybuffer',
                timeout: 60000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });

            await sock.sendMessage(chatId, {
                audio: Buffer.from(bufferRes.data),
                mimetype: 'audio/mpeg',
                fileName: safeFileName,
                contextInfo: {
                    externalAdReply: {
                        title: songTitle.slice(0, 60),
                        body: songArtist.slice(0, 60),
                        mediaType: 2,
                        thumbnailUrl: songThumb,
                        sourceUrl: targetUrl,
                        renderLargerThumbnail: true
                    }
                }
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (err) {
        console.error('[SONG ERROR]:', err.message);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, {
            text: `❌ *Song Download Failed*\n\n*Error:* ${err.response?.data?.error?.message || err.message}`
        }, { quoted: message });
    }
}

module.exports = songCommand;

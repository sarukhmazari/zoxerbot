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

async function resolveAudio(input) {
    let targetUrl = input;
    let title = input;
    let author = 'YouTube Music';
    let thumbnail = 'https://i.ibb.co/vzr5K2W/music.png';

    const isUrl = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?|shorts\/|v\/|embed\/)|youtu\.be\/)/i.test(input);
    let videoId = extractYouTubeId(input);

    if (!isUrl || !videoId) {
        const search = await yts(input);
        const video = search?.videos?.[0];
        if (!video) throw new Error('No song found for this search.');
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
            format: 'audio'
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
        console.warn('[SONG] Cloudflare Worker failed, trying BTCH fallback:', cfErr.response?.data?.error?.message || cfErr.message);
    }

    // 2. BTCH Downloader Fallback
    try {
        const bRes = await btch.youtube(targetUrl);
        const dl = bRes.mp3 || bRes.mp4;
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
        console.warn('[SONG] BTCH fallback failed, trying Rahad fallback:', bErr.message);
    }

    // 3. Rahad All Downloader Fallback
    try {
        const rRes = await rahad.alldl(targetUrl);
        const dl = rRes.data?.download?.audio || rRes.data?.download?.video;
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
        console.warn('[SONG] Rahad fallback failed:', rErr.message);
    }

    throw new Error('Audio extraction failed. Please retry in a few moments.');
}

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
        const media = await resolveAudio(text);
        const songTitle = media.title;
        const songArtist = media.author;
        const songThumb = media.thumbnail;
        const safeFileName = `${(songTitle || 'song').replace(/[\\/:*?"<>|]/g, '_')}.mp3`;

        try {
            await sock.sendMessage(chatId, {
                audio: { url: media.downloadUrl },
                mimetype: 'audio/mpeg',
                fileName: safeFileName,
                contextInfo: {
                    externalAdReply: {
                        title: songTitle.slice(0, 60),
                        body: songArtist.slice(0, 60),
                        mediaType: 2,
                        thumbnailUrl: songThumb,
                        sourceUrl: media.targetUrl,
                        renderLargerThumbnail: true
                    }
                }
            }, { quoted: message });
        } catch (streamErr) {
            // Buffer fallback in case of direct stream error
            const bufferRes = await axios.get(media.downloadUrl, {
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
                        sourceUrl: media.targetUrl,
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

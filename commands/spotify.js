const axios = require('axios');
const fs = require('fs');
const path = require('path');
const yts = require('yt-search');
const { downloadMp3 } = require('../lib/ytdlp-helper');

let settings = null;
try {
    settings = require('../settings');
} catch (_) {}

const API_KEY = (settings && settings.zoxerMediaApiKey) || process.env.ZOXER_MEDIA_API_KEY || 'zoxer_e4b5054d63fc1ed506cdafc9be5c858410b5f17e97a8a5da';

const RAW_CANDIDATES = [
    settings && settings.zoxerMediaApiUrl,
    process.env.ZOXER_MEDIA_API_URL,
    'https://zoxer-media-api.sarukhmazari1.workers.dev',
    process.env.MEDIA_ENGINE_API_URL,
    'http://127.0.0.1:5050'
].filter(Boolean);

const API_CANDIDATES = [...new Set(RAW_CANDIDATES)];

const AUTH_HEADERS = {
    'Authorization': `Bearer ${API_KEY}`,
    'x-api-key': API_KEY,
    'Content-Type': 'application/json'
};

/**
 * Call Spotify endpoint or unified endpoint with API keys
 */
async function callSpotifyApi(query) {
    let lastError = null;

    for (const base of API_CANDIDATES) {
        const cleanBase = base.replace(/\/+$/, '');

        // 1. Dedicated GET /api/spotify?q=...
        try {
            const res = await axios.get(`${cleanBase}/api/spotify`, {
                params: { q: query },
                headers: AUTH_HEADERS,
                timeout: 25000
            });
            if (res.data && res.data.success && res.data.download_url) {
                return res.data;
            }
        } catch (e1) {
            lastError = e1.response?.data?.error?.message || e1.response?.data?.message || e1.message;
        }

        // 2. Dedicated POST /api/spotify
        try {
            const resPost = await axios.post(`${cleanBase}/api/spotify`, {
                q: query
            }, {
                headers: AUTH_HEADERS,
                timeout: 25000
            });
            if (resPost.data && resPost.data.success && resPost.data.download_url) {
                return resPost.data;
            }
        } catch (_) {}

        // 3. Unified POST /api/v1/download
        try {
            const resV1 = await axios.post(`${cleanBase}/api/v1/download`, {
                url: query,
                format: 'spotify'
            }, {
                headers: AUTH_HEADERS,
                timeout: 25000
            });
            if (resV1.data && resV1.data.success && resV1.data.data?.media?.download_url) {
                return {
                    success: true,
                    title: resV1.data.data.title,
                    author: resV1.data.data.author?.name || 'Spotify Artist',
                    thumbnail: resV1.data.data.thumbnail,
                    download_url: resV1.data.data.media.download_url,
                    spotify_url: query
                };
            }
        } catch (_) {}

        // 4. Unified POST /api/media
        try {
            const resMedia = await axios.post(`${cleanBase}/api/media`, {
                url: query,
                format: 'spotify'
            }, {
                headers: AUTH_HEADERS,
                timeout: 25000
            });
            if (resMedia.data && resMedia.data.success && resMedia.data.data?.media?.download_url) {
                return {
                    success: true,
                    title: resMedia.data.data.title,
                    author: resMedia.data.data.author?.name || 'Spotify Artist',
                    thumbnail: resMedia.data.data.thumbnail,
                    download_url: resMedia.data.data.media.download_url,
                    spotify_url: query
                };
            }
        } catch (_) {}
    }

    throw new Error(lastError || 'All Spotify API endpoints timed out or failed.');
}

/**
 * Fallback resolver using local search & yt-dlp
 */
async function fallbackSpotifyResolve(query) {
    let cleanQuery = query.trim();
    let isSpotify = /open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/([a-zA-Z0-9]+)/i.test(cleanQuery);
    let title = cleanQuery;
    let author = 'Spotify Artist';
    let thumbnail = 'https://open.spotify.com/favicon.ico';

    if (isSpotify) {
        const match = cleanQuery.match(/track\/([a-zA-Z0-9]+)/i);
        const trackId = match ? match[1] : '';
        try {
            const oRes = await axios.get(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`, { timeout: 8000 });
            if (oRes.data) {
                title = oRes.data.title || title;
                thumbnail = oRes.data.thumbnail_url || thumbnail;
                cleanQuery = title;
            }
        } catch (_) {}
    }

    const searchResult = await yts(cleanQuery);
    const firstVideo = searchResult?.videos?.[0];
    if (!firstVideo) {
        throw new Error('Could not find matching song on media network.');
    }

    const fileId = `sp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const downloadedPath = await downloadMp3(firstVideo.url, fileId);

    return {
        isLocalFile: true,
        filePath: downloadedPath,
        title: firstVideo.title || title,
        author: firstVideo.author?.name || author,
        thumbnail: firstVideo.thumbnail || thumbnail,
        spotify_url: isSpotify ? query : `https://open.spotify.com/search/${encodeURIComponent(cleanQuery)}`
    };
}

async function spotifyCommand(sock, chatId, message, queryText = '') {
    const raw = (
        queryText ||
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        ''
    ).replace(/^\.(spotify|sp)\s*/i, '').trim();

    if (!raw) {
        return await sock.sendMessage(chatId, {
            text: '🟢 *Please provide a Spotify link or song title!*\n\n*Usage:* `.spotify <song name or track link>`\n*Examples:*\n• `.spotify Faded Alan Walker`\n• `.spotify https://open.spotify.com/track/...`'
        }, { quoted: message });
    }

    await sock.sendMessage(chatId, { react: { text: '🎵', key: message.key } });

    let tempLocalFile = null;

    try {
        let media = null;

        // Try API first
        try {
            media = await callSpotifyApi(raw);
        } catch (apiErr) {
            console.warn('[SPOTIFY] API call failed, using internal fallback:', apiErr.message);
            media = await fallbackSpotifyResolve(raw);
        }

        const title = media.title || 'Spotify Track';
        const author = media.author || 'Spotify Artist';
        const cover = media.thumbnail || 'https://open.spotify.com/favicon.ico';
        const safeName = `${title.replace(/[\\/:*?"<>|]/g, '_')}.mp3`;

        let audioContent = null;
        if (media.isLocalFile && media.filePath) {
            tempLocalFile = media.filePath;
            audioContent = fs.readFileSync(media.filePath);
        } else if (media.download_url) {
            const audioRes = await axios.get(media.download_url, {
                responseType: 'arraybuffer',
                timeout: 60000,
                headers: AUTH_HEADERS
            });
            audioContent = Buffer.from(audioRes.data);
        } else {
            throw new Error('No valid audio stream received.');
        }

        await sock.sendMessage(chatId, {
            audio: audioContent,
            mimetype: 'audio/mpeg',
            fileName: safeName,
            contextInfo: {
                externalAdReply: {
                    title: title.slice(0, 60),
                    body: `Spotify • ${author}`.slice(0, 60),
                    mediaType: 2,
                    thumbnailUrl: cover,
                    sourceUrl: media.spotify_url || (raw.startsWith('http') ? raw : 'https://open.spotify.com'),
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: message });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (err) {
        console.error('[SPOTIFY ERROR]:', err.message);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, {
            text: `❌ *Spotify Download Failed*\n\n*Error:* ${err.message || 'Media Engine could not process this track.'}\n\n*Tip:* Check that either the Cloudflare API or local engine is reachable.`
        }, { quoted: message });
    } finally {
        if (tempLocalFile && fs.existsSync(tempLocalFile)) {
            try { fs.unlinkSync(tempLocalFile); } catch (_) {}
        }
    }
}

module.exports = spotifyCommand;

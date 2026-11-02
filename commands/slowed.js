const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const yts = require('yt-search');
const { downloadMp3, tmpDir } = require('../lib/ytdlp-helper');

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
 * Call Slowed endpoint or unified endpoint with API keys
 */
async function callSlowedApi(query) {
    let lastError = null;

    for (const base of API_CANDIDATES) {
        const cleanBase = base.replace(/\/+$/, '');

        // 1. Dedicated GET /api/slowed?q=...
        try {
            const res = await axios.get(`${cleanBase}/api/slowed`, {
                params: { q: query },
                headers: AUTH_HEADERS,
                timeout: 30000
            });
            if (res.data && res.data.success && res.data.download_url) {
                return res.data;
            }
        } catch (e1) {
            lastError = e1.response?.data?.error?.message || e1.response?.data?.message || e1.message;
        }

        // 2. Dedicated POST /api/slowed
        try {
            const resPost = await axios.post(`${cleanBase}/api/slowed`, {
                q: query
            }, {
                headers: AUTH_HEADERS,
                timeout: 30000
            });
            if (resPost.data && resPost.data.success && resPost.data.download_url) {
                return resPost.data;
            }
        } catch (_) {}

        // 3. Unified POST /api/v1/download
        try {
            const resV1 = await axios.post(`${cleanBase}/api/v1/download`, {
                url: query,
                format: 'slowed'
            }, {
                headers: AUTH_HEADERS,
                timeout: 30000
            });
            if (resV1.data && resV1.data.success && resV1.data.data?.media?.download_url) {
                return {
                    success: true,
                    title: resV1.data.data.title,
                    author: resV1.data.data.author?.name || 'Artist',
                    thumbnail: resV1.data.data.thumbnail,
                    download_url: resV1.data.data.media.download_url
                };
            }
        } catch (_) {}

        // 4. Unified POST /api/media
        try {
            const resMedia = await axios.post(`${cleanBase}/api/media`, {
                url: query,
                format: 'slowed'
            }, {
                headers: AUTH_HEADERS,
                timeout: 30000
            });
            if (resMedia.data && resMedia.data.success && resMedia.data.data?.media?.download_url) {
                return {
                    success: true,
                    title: resMedia.data.data.title,
                    author: resMedia.data.data.author?.name || 'Artist',
                    thumbnail: resMedia.data.data.thumbnail,
                    download_url: resMedia.data.data.media.download_url
                };
            }
        } catch (_) {}
    }

    throw new Error(lastError || 'All Slowed API endpoints timed out or failed.');
}

/**
 * Fallback resolver using local yt-dlp and FFmpeg acoustic filter
 */
async function fallbackSlowedResolve(query) {
    const cleanQuery = query.trim();
    let isUrl = /^https?:\/\//i.test(cleanQuery);
    let targetUrl = cleanQuery;
    let title = `${cleanQuery} (Slowed + Reverb)`;
    let author = 'Artist';
    let thumbnail = 'https://i.ibb.co/vzr5K2W/music.png';

    if (!isUrl) {
        const searchResult = await yts(cleanQuery);
        const first = searchResult?.videos?.[0];
        if (!first) throw new Error('No song found for this search.');
        targetUrl = first.url;
        title = `${first.title} (Slowed + Reverb)`;
        author = first.author?.name || author;
        thumbnail = first.thumbnail || thumbnail;
    }

    const fileId = `slow_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const baseAudioPath = await downloadMp3(targetUrl, fileId);
    const slowedOutputPath = path.join(tmpDir, `slowed_processed_${fileId}.mp3`);

    // Run FFmpeg acoustic filter chain
    await new Promise((resolve, reject) => {
        execFile('ffmpeg', [
            '-y',
            '-i', baseAudioPath,
            '-af', 'asetrate=44100*0.88,aresample=44100,aecho=0.8:0.88:60:0.4',
            '-b:a', '192k',
            slowedOutputPath
        ], (err) => {
            try { fs.unlinkSync(baseAudioPath); } catch (_) {}
            if (err) return reject(new Error('Local FFmpeg Slowed filter failed: ' + err.message));
            resolve(slowedOutputPath);
        });
    });

    return {
        isLocalFile: true,
        filePath: slowedOutputPath,
        title,
        author,
        thumbnail,
        webpage_url: targetUrl
    };
}

async function slowedCommand(sock, chatId, message, queryText = '') {
    const raw = (
        queryText ||
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        ''
    ).replace(/^\.(slowed|slow)\s*/i, '').trim();

    if (!raw) {
        return await sock.sendMessage(chatId, {
            text: '🌌 *Please provide a song name or YouTube/Spotify link!*\n\n*Usage:* `.slowed <song name or URL>`\n*Examples:*\n• `.slowed Starboy The Weeknd`\n• `.slowed https://youtu.be/...`\n• `.slowed https://open.spotify.com/track/...`'
        }, { quoted: message });
    }

    await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

    let tempLocalFile = null;

    try {
        let media = null;

        // Try API first
        try {
            media = await callSlowedApi(raw);
        } catch (apiErr) {
            console.warn('[SLOWED] API call failed, using internal fallback:', apiErr.message);
            media = await fallbackSlowedResolve(raw);
        }

        const title = media.title || `${raw} (Slowed + Reverb)`;
        const author = media.author || 'Artist';
        const cover = media.thumbnail || 'https://i.ibb.co/vzr5K2W/music.png';
        let audioContent = null;
        let finalTitle = title;
        let finalAuthor = author;
        let finalCover = cover;

        if (media.isLocalFile && media.filePath) {
            tempLocalFile = media.filePath;
            audioContent = fs.readFileSync(media.filePath);
        } else if (media.download_url) {
            try {
                const audioRes = await axios.get(media.download_url, {
                    responseType: 'arraybuffer',
                    timeout: 45000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                audioContent = Buffer.from(audioRes.data);
            } catch (dlErr) {
                console.warn('[SLOWED] Direct stream URL download failed (' + dlErr.message + '), executing local FFmpeg fallback...');
                const fb = await fallbackSlowedResolve(raw);
                if (fb && fb.filePath) {
                    tempLocalFile = fb.filePath;
                    audioContent = fs.readFileSync(fb.filePath);
                    if (fb.title) finalTitle = fb.title;
                    if (fb.author) finalAuthor = fb.author;
                    if (fb.thumbnail) finalCover = fb.thumbnail;
                }
            }
        }

        if (!audioContent) {
            const fb = await fallbackSlowedResolve(raw);
            if (fb && fb.filePath) {
                tempLocalFile = fb.filePath;
                audioContent = fs.readFileSync(fb.filePath);
                if (fb.title) finalTitle = fb.title;
                if (fb.author) finalAuthor = fb.author;
                if (fb.thumbnail) finalCover = fb.thumbnail;
            } else {
                throw new Error('Unable to generate slowed audio bytes from any stream source.');
            }
        }

        const safeName = `${finalTitle.replace(/[\\/:*?"<>|]/g, '_')}.mp3`;

        await sock.sendMessage(chatId, {
            audio: audioContent,
            mimetype: 'audio/mpeg',
            fileName: safeName,
            contextInfo: {
                externalAdReply: {
                    title: title.slice(0, 60),
                    body: `Slowed + Reverb • ${author}`.slice(0, 60),
                    mediaType: 2,
                    thumbnailUrl: cover,
                    sourceUrl: media.webpage_url || (raw.startsWith('http') ? raw : 'https://youtube.com'),
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: message });

        await sock.sendMessage(chatId, { react: { text: '✨', key: message.key } });

    } catch (err) {
        console.error('[SLOWED ERROR]:', err.message);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, {
            text: `❌ *Slowed + Reverb Processing Failed*\n\n*Error:* ${err.message || 'Media Engine failed to generate slowed audio.'}\n\n*Tip:* Check that either the Cloudflare API or local engine is reachable.`
        }, { quoted: message });
    } finally {
        if (tempLocalFile && fs.existsSync(tempLocalFile)) {
            try { fs.unlinkSync(tempLocalFile); } catch (_) {}
        }
    }
}

module.exports = slowedCommand;

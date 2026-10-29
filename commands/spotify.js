const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const settings = require('../settings');

const tmpDir = path.join(process.cwd(), 'tmp');
if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
}

function runYtDlp(args, timeout = 70000) {
    return new Promise((resolve, reject) => {
        execFile('yt-dlp', args, { timeout }, (err, stdout, stderr) => {
            if (err) return reject(new Error(stderr || err.message));
            resolve(stdout.trim());
        });
    });
}

async function getSpotifyOEmbed(spotifyUrl) {
    const res = await axios.get(`https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`, {
        timeout: 10000,
        validateStatus: () => true
    });
    if (res.data && res.data.title) {
        return {
            title: res.data.title,
            author: res.data.author_name || 'Spotify Artist',
            thumbnail: res.data.thumbnail_url || 'https://open.spotify.com/favicon.ico'
        };
    }
    return null;
}

async function downloadMp3WithYtDlp(searchQuery, outputFileBase) {
    const outTemplate = path.join(tmpDir, `${outputFileBase}.%(ext)s`);
    const args = [
        '--no-update',
        '--extractor-args', 'youtube:player_client=android',
        '--no-playlist',
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '-o', outTemplate,
        `ytsearch1:${searchQuery} audio`
    ];

    await runYtDlp(args, 90000);
    const expectedPath = path.join(tmpDir, `${outputFileBase}.mp3`);
    if (fs.existsSync(expectedPath)) return expectedPath;

    const matched = fs.readdirSync(tmpDir).find(f => f.startsWith(outputFileBase) && f.endsWith('.mp3'));
    if (matched) return path.join(tmpDir, matched);
    throw new Error('Downloaded Spotify MP3 file not found on disk');
}

async function fallbackKnightBotSpotify(spotifyUrl) {
    const kbApiKey = process.env.KNIGHTBOT_API_KEY || (settings && settings.knightBotApiKey) || 'knight';
    const apiUrl = `https://knightbotapi.stream/api/spotify?apikey=${encodeURIComponent(kbApiKey)}&url=${encodeURIComponent(spotifyUrl)}`;
    const res = await axios.get(apiUrl, { timeout: 12000, validateStatus: () => true });
    if (res.data?.success && res.data?.result) {
        const r = res.data.result;
        const dlUrl = r.download || r.url || r.dl_url;
        if (dlUrl && typeof dlUrl === 'string' && dlUrl.startsWith('http')) {
            return {
                title: r.title || 'Spotify Song',
                author: r.artist || 'Spotify',
                thumbnail: r.thumbnail || '',
                downloadUrl: dlUrl
            };
        }
    }
    throw new Error('KnightBot Spotify fallback failed');
}

async function spotifyCommand(sock, chatId, message, queryText = '') {
    const raw = queryText || (
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        ''
    ).replace(/^\.(spotify|sp)\s*/i, '').trim();

    if (!raw) {
        return await sock.sendMessage(chatId, {
            text: '🟢 *Please provide a Spotify link or song title!*\n\n*Usage:* `.spotify <track link or song title>`\n*Example:* `.spotify https://open.spotify.com/track/...`'
        }, { quoted: message });
    }

    await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } });

    const isSpotifyUrl = /spotify\.com\/track\/[a-zA-Z0-9]+/i.test(raw);
    let trackInfo = {
        title: raw,
        author: 'Spotify',
        thumbnail: 'https://open.spotify.com/favicon.ico'
    };

    if (isSpotifyUrl) {
        try {
            const oembed = await getSpotifyOEmbed(raw);
            if (oembed) trackInfo = oembed;
        } catch (_) {}
    }

    await sock.sendMessage(chatId, {
        text: `⏳ *Fetching from Spotify:* "${trackInfo.title}"...`
    }, { quoted: message });

    const fileId = `spotify_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    let downloadedFilePath = null;

    try {
        const searchQuery = `${trackInfo.title} ${trackInfo.author || ''}`.trim();

        // 1. Download via yt-dlp 320kbps audio extraction
        try {
            downloadedFilePath = await downloadMp3WithYtDlp(searchQuery, fileId);
        } catch (ytDlpErr) {
            console.error('[SPOTIFY] yt-dlp error, attempting KnightBot fallback...', ytDlpErr.message);
            if (isSpotifyUrl) {
                const fb = await fallbackKnightBotSpotify(raw);
                const dlRes = await axios.get(fb.downloadUrl, { responseType: 'arraybuffer', timeout: 60000 });
                downloadedFilePath = path.join(tmpDir, `${fileId}.mp3`);
                fs.writeFileSync(downloadedFilePath, Buffer.from(dlRes.data));
            } else {
                throw ytDlpErr;
            }
        }

        const audioBuffer = fs.readFileSync(downloadedFilePath);

        await sock.sendMessage(chatId, {
            audio: audioBuffer,
            mimetype: 'audio/mpeg',
            fileName: `${trackInfo.title.replace(/[\\/:*?"<>|]/g, '_')}.mp3`,
            contextInfo: {
                externalAdReply: {
                    title: `Spotify • ${trackInfo.title}`.slice(0, 60),
                    body: `${trackInfo.author}`.slice(0, 60),
                    mediaType: 2,
                    thumbnailUrl: trackInfo.thumbnail || 'https://open.spotify.com/favicon.ico',
                    sourceUrl: isSpotifyUrl ? raw : 'https://spotify.com',
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: message });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (err) {
        console.error('[SPOTIFY] Error in spotifyCommand:', err);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, {
            text: `❌ *Failed to download Spotify track.*\n\n*Error:* ${err.message || 'Track not found.'}`
        }, { quoted: message });
    } finally {
        if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
            try { fs.unlinkSync(downloadedFilePath); } catch (_) {}
        }
    }
}

module.exports = spotifyCommand;

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const settings = require('../settings');

const tmpDir = path.join(process.cwd(), 'tmp');
if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
}

function runYtDlp(args, timeout = 60000) {
    return new Promise((resolve, reject) => {
        execFile('yt-dlp', args, { timeout }, (err, stdout, stderr) => {
            if (err) return reject(new Error(stderr || err.message));
            resolve(stdout.trim());
        });
    });
}

async function getMetaFromYtDlp(queryOrUrl) {
    const isUrl = /^https?:\/\//i.test(queryOrUrl);
    const target = isUrl ? queryOrUrl : `ytsearch1:${queryOrUrl}`;
    const args = [
        '--no-update',
        '--extractor-args', 'youtube:player_client=android',
        '--no-playlist',
        '--print', '%(title)s|||%(uploader)s|||%(duration_string)s|||%(thumbnail)s|||%(webpage_url)s|||%(id)s',
        target
    ];
    const out = await runYtDlp(args, 20000);
    const [title, uploader, duration, thumbnail, url, id] = out.split('|||').map(s => s?.trim());
    return { title, uploader, duration, thumbnail, url, id };
}

async function downloadMp3WithYtDlp(targetUrlOrQuery, outputFileBase) {
    const isUrl = /^https?:\/\//i.test(targetUrlOrQuery);
    const target = isUrl ? targetUrlOrQuery : `ytsearch1:${targetUrlOrQuery}`;
    const outTemplate = path.join(tmpDir, `${outputFileBase}.%(ext)s`);

    const args = [
        '--no-update',
        '--extractor-args', 'youtube:player_client=android',
        '--no-playlist',
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '-o', outTemplate,
        target
    ];

    await runYtDlp(args, 90000);
    const expectedPath = path.join(tmpDir, `${outputFileBase}.mp3`);
    if (fs.existsSync(expectedPath)) {
        return expectedPath;
    }
    // Search directory for matching file
    const matched = fs.readdirSync(tmpDir).find(f => f.startsWith(outputFileBase) && f.endsWith('.mp3'));
    if (matched) return path.join(tmpDir, matched);
    throw new Error('Downloaded MP3 file not found on disk');
}

async function fallbackKnightBot(queryOrUrl) {
    const kbApiKey = process.env.KNIGHTBOT_API_KEY || (settings && settings.knightBotApiKey) || 'knight';
    const isUrl = /^https?:\/\//i.test(queryOrUrl);
    const apiUrl = isUrl
        ? `https://knightbotapi.stream/api/download/ytaudio?apikey=${encodeURIComponent(kbApiKey)}&url=${encodeURIComponent(queryOrUrl)}`
        : `https://knightbotapi.stream/api/ytmp3?apikey=${encodeURIComponent(kbApiKey)}&query=${encodeURIComponent(queryOrUrl)}`;

    const res = await axios.get(apiUrl, { timeout: 12000, validateStatus: () => true });
    if (res.data?.success && res.data?.result) {
        const r = res.data.result;
        const dlUrl = r.download || r.url || r.dl_url;
        if (dlUrl && typeof dlUrl === 'string' && dlUrl.startsWith('http')) {
            return {
                title: r.title || 'Song',
                uploader: r.author || r.artist || 'YouTube',
                duration: r.duration || '',
                thumbnail: r.thumbnail || '',
                downloadUrl: dlUrl
            };
        }
    }
    throw new Error('KnightBot fallback failed');
}

async function songCommand(sock, chatId, message, queryText = '') {
    const text = queryText || (
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        ''
    ).replace(/^\.(song|play|mp3)\s*/i, '').trim();

    if (!text) {
        return await sock.sendMessage(chatId, {
            text: '🎵 *Please provide a song name or YouTube link!*\n\n*Usage:* `.song <song name>`\n*Example:* `.song Believer`\n*Or direct link:* `.song https://youtu.be/...`'
        }, { quoted: message });
    }

    await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } });
    const waitMsg = await sock.sendMessage(chatId, {
        text: `⏳ *Searching & processing song:* "${text}"...`
    }, { quoted: message });

    const fileId = `song_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    let downloadedFilePath = null;

    try {
        let meta = null;
        try {
            meta = await getMetaFromYtDlp(text);
        } catch (_) {}

        // Download using yt-dlp
        try {
            const target = meta?.url || text;
            downloadedFilePath = await downloadMp3WithYtDlp(target, fileId);
        } catch (ytDlpErr) {
            console.error('[SONG] yt-dlp failed, trying fallback...', ytDlpErr.message);
            // Fallback to KnightBot API
            const fallback = await fallbackKnightBot(text);
            const dlRes = await axios.get(fallback.downloadUrl, { responseType: 'arraybuffer', timeout: 60000 });
            downloadedFilePath = path.join(tmpDir, `${fileId}.mp3`);
            fs.writeFileSync(downloadedFilePath, Buffer.from(dlRes.data));
            if (!meta) meta = fallback;
        }

        const songTitle = meta?.title || text;
        const songUploader = meta?.uploader || 'YouTube Music';
        const songDuration = meta?.duration ? ` • ⏱️ ${meta.duration}` : '';
        const songThumb = meta?.thumbnail || null;

        const audioBuffer = fs.readFileSync(downloadedFilePath);

        await sock.sendMessage(chatId, {
            audio: audioBuffer,
            mimetype: 'audio/mpeg',
            fileName: `${songTitle.replace(/[\\/:*?"<>|]/g, '_')}.mp3`,
            contextInfo: {
                externalAdReply: {
                    title: songTitle.slice(0, 60),
                    body: `${songUploader}${songDuration}`.slice(0, 60),
                    mediaType: 2,
                    thumbnailUrl: songThumb || 'https://i.ibb.co/vzr5K2W/music.png',
                    sourceUrl: meta?.url || 'https://youtube.com',
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: message });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (err) {
        console.error('[SONG] Error in songCommand:', err);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, {
            text: `❌ *Failed to download song.*\n\n*Reason:* ${err.message || 'Video unavailable or restricted.'}`
        }, { quoted: message });
    } finally {
        if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
            try { fs.unlinkSync(downloadedFilePath); } catch (_) {}
        }
    }
}

module.exports = songCommand;

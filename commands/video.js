const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const settings = require('../settings');

const tmpDir = path.join(process.cwd(), 'tmp');
if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
}

function runYtDlp(args, timeout = 90000) {
    return new Promise((resolve, reject) => {
        execFile('yt-dlp', args, { timeout }, (err, stdout, stderr) => {
            if (err) return reject(new Error(stderr || err.message));
            resolve(stdout.trim());
        });
    });
}

async function getVideoMeta(queryOrUrl) {
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

async function downloadMp4WithYtDlp(targetUrlOrQuery, outputFileBase) {
    const isUrl = /^https?:\/\//i.test(targetUrlOrQuery);
    const target = isUrl ? targetUrlOrQuery : `ytsearch1:${targetUrlOrQuery}`;
    const outTemplate = path.join(tmpDir, `${outputFileBase}.%(ext)s`);

    const args = [
        '--no-update',
        '--extractor-args', 'youtube:player_client=android',
        '--no-playlist',
        '-f', 'bv*[ext=mp4][height<=720]+ba[ext=m4a]/b[ext=mp4][height<=720]/best[ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '-o', outTemplate,
        target
    ];

    await runYtDlp(args, 120000);
    const expectedPath = path.join(tmpDir, `${outputFileBase}.mp4`);
    if (fs.existsSync(expectedPath)) return expectedPath;

    const matched = fs.readdirSync(tmpDir).find(f => f.startsWith(outputFileBase) && f.endsWith('.mp4'));
    if (matched) return path.join(tmpDir, matched);
    throw new Error('Downloaded MP4 video file not found on disk');
}

async function fallbackKnightBotVideo(queryOrUrl) {
    const kbApiKey = process.env.KNIGHTBOT_API_KEY || (settings && settings.knightBotApiKey) || 'knight';
    const isUrl = /^https?:\/\//i.test(queryOrUrl);
    const apiUrl = isUrl
        ? `https://knightbotapi.stream/api/download/ytmp4?apikey=${encodeURIComponent(kbApiKey)}&url=${encodeURIComponent(queryOrUrl)}&format=480p`
        : `https://knightbotapi.stream/api/ytmp4?apikey=${encodeURIComponent(kbApiKey)}&query=${encodeURIComponent(queryOrUrl)}`;

    const res = await axios.get(apiUrl, { timeout: 15000, validateStatus: () => true });
    if (res.data?.success && res.data?.result) {
        const r = res.data.result;
        const dlUrl = r.download || r.url || r.video || r.dl_url;
        if (dlUrl && typeof dlUrl === 'string' && dlUrl.startsWith('http')) {
            return {
                title: r.title || 'YouTube Video',
                uploader: r.author || r.uploader || 'YouTube',
                duration: r.duration || '',
                thumbnail: r.thumbnail || '',
                downloadUrl: dlUrl
            };
        }
    }
    throw new Error('KnightBot video fallback failed');
}

async function videoCommand(sock, chatId, message, queryText = '') {
    const text = queryText || (
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        ''
    ).replace(/^\.(video|ytmp4|ytvideo)\s*/i, '').trim();

    if (!text) {
        return await sock.sendMessage(chatId, {
            text: '🎬 *Please provide a video name or YouTube link!*\n\n*Usage:* `.video <name or link>`\n*Example:* `.video Alan Walker Faded`\n*Or direct link:* `.video https://youtu.be/...`'
        }, { quoted: message });
    }

    await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } });
    await sock.sendMessage(chatId, {
        text: `⏳ *Searching & processing video:* "${text}"...`
    }, { quoted: message });

    const fileId = `video_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    let downloadedFilePath = null;

    try {
        let meta = null;
        try {
            meta = await getVideoMeta(text);
        } catch (_) {}

        // 1. Download via yt-dlp
        try {
            const target = meta?.url || text;
            downloadedFilePath = await downloadMp4WithYtDlp(target, fileId);
        } catch (ytDlpErr) {
            console.error('[VIDEO] yt-dlp failed, trying fallback...', ytDlpErr.message);
            const fb = await fallbackKnightBotVideo(text);
            const dlRes = await axios.get(fb.downloadUrl, { responseType: 'arraybuffer', timeout: 90000 });
            downloadedFilePath = path.join(tmpDir, `${fileId}.mp4`);
            fs.writeFileSync(downloadedFilePath, Buffer.from(dlRes.data));
            if (!meta) meta = fb;
        }

        const vidTitle = meta?.title || text;
        const vidUploader = meta?.uploader || 'YouTube';
        const vidDuration = meta?.duration || 'Unknown';

        const stats = fs.statSync(downloadedFilePath);
        const fileSizeMB = stats.size / (1024 * 1024);

        if (fileSizeMB > 100) {
            // Send as Document if above 100MB WhatsApp video limit
            await sock.sendMessage(chatId, {
                document: fs.readFileSync(downloadedFilePath),
                mimetype: 'video/mp4',
                fileName: `${vidTitle.replace(/[\\/:*?"<>|]/g, '_')}.mp4`,
                caption: `🎬 *${vidTitle}*\n👤 *Channel:* ${vidUploader}\n⏱️ *Duration:* ${vidDuration}\n📦 *Size:* ${fileSizeMB.toFixed(1)} MB\n\n_Sent as document due to file size._`,
                ...global.channelInfo
            }, { quoted: message });
        } else {
            // Send as native playable Video
            await sock.sendMessage(chatId, {
                video: fs.readFileSync(downloadedFilePath),
                mimetype: 'video/mp4',
                caption: `🎬 *${vidTitle}*\n👤 *Channel:* ${vidUploader}\n⏱️ *Duration:* ${vidDuration}`,
                ...global.channelInfo
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (err) {
        console.error('[VIDEO] Error in videoCommand:', err);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, {
            text: `❌ *Failed to download video.*\n\n*Error:* ${err.message || 'Video not found or restricted.'}`
        }, { quoted: message });
    } finally {
        if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
            try { fs.unlinkSync(downloadedFilePath); } catch (_) {}
        }
    }
}

module.exports = videoCommand;

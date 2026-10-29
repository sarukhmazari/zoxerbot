const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

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
    const out = await runYtDlp(args, 25000);
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
    const matched = fs.readdirSync(tmpDir).find(f => f.startsWith(outputFileBase) && f.endsWith('.mp3'));
    if (matched) return path.join(tmpDir, matched);
    throw new Error('Downloaded MP3 file not found on disk');
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
    await sock.sendMessage(chatId, {
        text: `⏳ *Searching & downloading audio:* "${text}"...`
    }, { quoted: message });

    const fileId = `song_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    let downloadedFilePath = null;

    try {
        let meta = null;
        try {
            meta = await getMetaFromYtDlp(text);
        } catch (_) {}

        const target = meta?.url || text;
        downloadedFilePath = await downloadMp3WithYtDlp(target, fileId);

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
            text: `❌ *Failed to download song.*\n\n*Error:* ${err.message || 'Audio could not be downloaded.'}`
        }, { quoted: message });
    } finally {
        if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
            try { fs.unlinkSync(downloadedFilePath); } catch (_) {}
        }
    }
}

module.exports = songCommand;

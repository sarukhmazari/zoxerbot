const path = require('path');
const fs = require('fs');
const { getYtDlpMeta, downloadMp3, getCookiesPath } = require('../lib/ytdlp-helper');

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
            meta = await getYtDlpMeta(text);
        } catch (mErr) {
            // If it's a bot block error during metadata fetch, fail fast with helpful message
            if (mErr.isBotBlocked) throw mErr;
        }

        const target = meta?.url || text;
        downloadedFilePath = await downloadMp3(target, fileId);

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
        console.error('[SONG] Error in songCommand:', err.message || err);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, {
            text: err.isBotBlocked
                ? err.message
                : `❌ *Failed to download song.*\n\n*Error:* ${err.message || 'Audio could not be downloaded.'}`
        }, { quoted: message });
    } finally {
        if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
            try { fs.unlinkSync(downloadedFilePath); } catch (_) {}
        }
    }
}

module.exports = songCommand;

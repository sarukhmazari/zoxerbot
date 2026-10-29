const path = require('path');
const fs = require('fs');
const { getYtDlpMeta, downloadMp4 } = require('../lib/ytdlp-helper');

async function videoCommand(sock, chatId, message, queryText = '') {
    const text = queryText || (
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        ''
    ).replace(/^\.(video|ytmp4|ytvideo)\s*/i, '').trim();

    if (!text) {
        return await sock.sendMessage(chatId, {
            text: '🎬 *Please provide a video name or YouTube link!*\n\n*Usage:* `.video <video name>`\n*Example:* `.video Believer Imagine Dragons`\n*Or direct link:* `.video https://youtu.be/...`'
        }, { quoted: message });
    }

    await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } });
    await sock.sendMessage(chatId, {
        text: `⏳ *Searching & downloading video:* "${text}"...`
    }, { quoted: message });

    const fileId = `video_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    let downloadedFilePath = null;

    try {
        let meta = null;
        try {
            meta = await getYtDlpMeta(text);
        } catch (mErr) {
            if (mErr.isBotBlocked) throw mErr;
        }

        const target = meta?.url || text;
        downloadedFilePath = await downloadMp4(target, fileId);

        const videoTitle = meta?.title || text;
        const videoUploader = meta?.uploader || 'YouTube';
        const videoDuration = meta?.duration ? ` • ⏱️ ${meta.duration}` : '';

        const videoBuffer = fs.readFileSync(downloadedFilePath);

        await sock.sendMessage(chatId, {
            video: videoBuffer,
            mimetype: 'video/mp4',
            fileName: `${videoTitle.replace(/[\\/:*?"<>|]/g, '_')}.mp4`,
            caption: `🎬 *${videoTitle}*\n📺 *Channel:* ${videoUploader}${videoDuration}\n\n⚡ *Downloaded by ZoxerBot*`
        }, { quoted: message });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (err) {
        console.error('[VIDEO] Error in videoCommand:', err.message || err);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, {
            text: err.isBotBlocked
                ? err.message
                : `❌ *Failed to download video.*\n\n*Error:* ${err.message || 'Video could not be downloaded.'}`
        }, { quoted: message });
    } finally {
        if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
            try { fs.unlinkSync(downloadedFilePath); } catch (_) {}
        }
    }
}

module.exports = videoCommand;

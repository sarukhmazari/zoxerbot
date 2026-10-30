const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { getYtDlpMeta, downloadMp4 } = require('../lib/ytdlp-helper');
const { fetchMediaFromApi } = require('../lib/mediaApi');

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

    const isYoutubeUrl = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?|shorts\/|v\/|embed\/)|youtu\.be\/)/i.test(text);

    // 1. Direct YouTube URL: Call private Cloudflare Workers Media API
    if (isYoutubeUrl) {
        try {
            const media = await fetchMediaFromApi(text, 'video');
            const videoTitle = media.title || 'YouTube Video';
            const channel = media.author || 'YouTube';
            const caption = `🎬 *${videoTitle}*\n📺 *Channel:* ${channel}\n\n⚡ *Downloaded by ZoxerBot*`;

            try {
                await sock.sendMessage(chatId, {
                    video: { url: media.downloadUrl },
                    mimetype: 'video/mp4',
                    fileName: `${videoTitle.replace(/[\\/:*?"<>|]/g, '_')}.mp4`,
                    caption: caption
                }, { quoted: message });
            } catch (streamErr) {
                console.warn('[VIDEO] Direct stream failed, downloading buffer:', streamErr.message);
                const res = await axios.get(media.downloadUrl, {
                    responseType: 'arraybuffer',
                    timeout: 60000,
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                });
                await sock.sendMessage(chatId, {
                    video: Buffer.from(res.data),
                    mimetype: 'video/mp4',
                    fileName: `${videoTitle.replace(/[\\/:*?"<>|]/g, '_')}.mp4`,
                    caption: caption
                }, { quoted: message });
            }

            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
            return;
        } catch (apiErr) {
            console.warn('[VIDEO] Private API failed for direct URL, falling back to yt-dlp:', apiErr.message);
        }
    }

    // 2. Query search or fallback to yt-dlp
    const fileId = `video_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    let downloadedFilePath = null;

    try {
        let meta = null;
        try {
            meta = await getYtDlpMeta(text);
        } catch (mErr) {
            if (mErr.isBotBlocked) throw mErr;
        }

        // Try Private Media API if meta returned a YouTube URL
        if (meta?.url) {
            try {
                const media = await fetchMediaFromApi(meta.url, 'video');
                const videoTitle = media.title || meta.title || text;
                const videoUploader = media.author || meta.uploader || 'YouTube';
                const videoDuration = meta?.duration ? ` • ⏱️ ${meta.duration}` : '';
                const caption = `🎬 *${videoTitle}*\n📺 *Channel:* ${videoUploader}${videoDuration}\n\n⚡ *Downloaded by ZoxerBot*`;

                try {
                    await sock.sendMessage(chatId, {
                        video: { url: media.downloadUrl },
                        mimetype: 'video/mp4',
                        fileName: `${videoTitle.replace(/[\\/:*?"<>|]/g, '_')}.mp4`,
                        caption: caption
                    }, { quoted: message });
                } catch (streamErr) {
                    const res = await axios.get(media.downloadUrl, {
                        responseType: 'arraybuffer',
                        timeout: 60000,
                        headers: { 'User-Agent': 'Mozilla/5.0' }
                    });
                    await sock.sendMessage(chatId, {
                        video: Buffer.from(res.data),
                        mimetype: 'video/mp4',
                        fileName: `${videoTitle.replace(/[\\/:*?"<>|]/g, '_')}.mp4`,
                        caption: caption
                    }, { quoted: message });
                }

                await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
                return;
            } catch (queryApiErr) {
                console.warn('[VIDEO] Private API query resolution failed, using yt-dlp local downloader:', queryApiErr.message);
            }
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

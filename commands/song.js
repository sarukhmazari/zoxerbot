const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { getYtDlpMeta, downloadMp3 } = require('../lib/ytdlp-helper');
const { fetchMediaFromApi } = require('../lib/mediaApi');

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

    const isYoutubeUrl = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?|shorts\/|v\/|embed\/)|youtu\.be\/)/i.test(text);

    // 1. Direct YouTube URL: Call private Cloudflare Workers Media API
    if (isYoutubeUrl) {
        try {
            const media = await fetchMediaFromApi(text, 'audio');
            const songTitle = media.title || 'YouTube Audio';
            const songUploader = media.author || 'YouTube Music';
            const songThumb = media.thumbnail || 'https://i.ibb.co/vzr5K2W/music.png';

            try {
                await sock.sendMessage(chatId, {
                    audio: { url: media.downloadUrl },
                    mimetype: 'audio/mpeg',
                    fileName: `${songTitle.replace(/[\\/:*?"<>|]/g, '_')}.mp3`,
                    contextInfo: {
                        externalAdReply: {
                            title: songTitle.slice(0, 60),
                            body: songUploader.slice(0, 60),
                            mediaType: 2,
                            thumbnailUrl: songThumb,
                            sourceUrl: text,
                            renderLargerThumbnail: true
                        }
                    }
                }, { quoted: message });
            } catch (streamErr) {
                console.warn('[SONG] Direct stream failed, downloading buffer:', streamErr.message);
                const res = await axios.get(media.downloadUrl, {
                    responseType: 'arraybuffer',
                    timeout: 60000,
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                });
                await sock.sendMessage(chatId, {
                    audio: Buffer.from(res.data),
                    mimetype: 'audio/mpeg',
                    fileName: `${songTitle.replace(/[\\/:*?"<>|]/g, '_')}.mp3`,
                    contextInfo: {
                        externalAdReply: {
                            title: songTitle.slice(0, 60),
                            body: songUploader.slice(0, 60),
                            mediaType: 2,
                            thumbnailUrl: songThumb,
                            sourceUrl: text,
                            renderLargerThumbnail: true
                        }
                    }
                }, { quoted: message });
            }

            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
            return;
        } catch (apiErr) {
            console.warn('[SONG] Private API failed for direct URL, falling back to yt-dlp:', apiErr.message);
        }
    }

    // 2. Query search or fallback to yt-dlp
    const fileId = `song_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
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
                const media = await fetchMediaFromApi(meta.url, 'audio');
                const songTitle = media.title || meta.title || text;
                const songUploader = media.author || meta.uploader || 'YouTube Music';
                const songThumb = media.thumbnail || meta.thumbnail || 'https://i.ibb.co/vzr5K2W/music.png';

                try {
                    await sock.sendMessage(chatId, {
                        audio: { url: media.downloadUrl },
                        mimetype: 'audio/mpeg',
                        fileName: `${songTitle.replace(/[\\/:*?"<>|]/g, '_')}.mp3`,
                        contextInfo: {
                            externalAdReply: {
                                title: songTitle.slice(0, 60),
                                body: songUploader.slice(0, 60),
                                mediaType: 2,
                                thumbnailUrl: songThumb,
                                sourceUrl: meta.url,
                                renderLargerThumbnail: true
                            }
                        }
                    }, { quoted: message });
                } catch (streamErr) {
                    const res = await axios.get(media.downloadUrl, {
                        responseType: 'arraybuffer',
                        timeout: 60000,
                        headers: { 'User-Agent': 'Mozilla/5.0' }
                    });
                    await sock.sendMessage(chatId, {
                        audio: Buffer.from(res.data),
                        mimetype: 'audio/mpeg',
                        fileName: `${songTitle.replace(/[\\/:*?"<>|]/g, '_')}.mp3`,
                        contextInfo: {
                            externalAdReply: {
                                title: songTitle.slice(0, 60),
                                body: songUploader.slice(0, 60),
                                mediaType: 2,
                                thumbnailUrl: songThumb,
                                sourceUrl: meta.url,
                                renderLargerThumbnail: true
                            }
                        }
                    }, { quoted: message });
                }

                await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
                return;
            } catch (queryApiErr) {
                console.warn('[SONG] Private API query resolution failed, using yt-dlp local downloader:', queryApiErr.message);
            }
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

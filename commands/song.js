const fs = require('fs');
const path = require('path');
const axios = require('axios');
const yts = require('yt-search');
const { downloadMp3, getYtDlpMeta, getCookiesPath, tmpDir } = require('../lib/ytdlp-helper');

let settings = null;
try {
    settings = require('../settings');
} catch (_) {}

const API_BASE = (settings && settings.zoxerMediaApiUrl) || process.env.ZOXER_MEDIA_API_URL || 'https://zoxer-media-api.sarukhmazari1.workers.dev';
const API_KEY = (settings && settings.zoxerMediaApiKey) || process.env.ZOXER_MEDIA_API_KEY || 'zoxer_e4b5054d63fc1ed506cdafc9be5c858410b5f17e97a8a5da';

function extractYouTubeId(input) {
    if (!input || typeof input !== 'string') return null;
    const match = input.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?.*?v=|shorts\/|embed\/|v\/))([a-zA-Z0-9_-]{11})/i);
    return match ? match[1] : null;
}

function getBotChallengeMessage() {
    const hasCookies = !!getCookiesPath();
    let msg = '⚠️ *YouTube Bot Challenge (Server IP Blocked)*\n\n';
    if (hasCookies) {
        msg += 'Your `cookies.txt` on the server has expired or is invalid.\n\n';
    } else {
        msg += 'YouTube blocks automated audio streams from cloud VPS servers (AWS Lightsail) without cookies.\n\n';
    }
    msg += '*How to enable HD song downloads in 1 minute:*\n';
    msg += '1. In Chrome/Edge/Firefox, install *"Get cookies.txt LOCALLY"* extension.\n';
    msg += '2. Open YouTube while logged into Google, click the extension, and export `cookies.txt`.\n';
    msg += '3. Send the `cookies.txt` document to this bot in WhatsApp with the caption *.setcookies*!\n\n';
    msg += '⚡ The bot will immediately activate full HD music and video downloads.';
    return msg;
}

async function resolveAudio(input) {
    let targetUrl = input;
    let title = input;
    let author = 'YouTube Music';
    let thumbnail = 'https://i.ibb.co/vzr5K2W/music.png';

    const isUrl = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?|shorts\/|v\/|embed\/)|youtu\.be\/)/i.test(input);
    let videoId = extractYouTubeId(input);

    if (!isUrl || !videoId) {
        const search = await yts(input);
        const video = search?.videos?.[0];
        if (!video) throw new Error('No song found for this search.');
        videoId = video.videoId || extractYouTubeId(video.url);
        title = video.title || title;
        author = video.author?.name || author;
        thumbnail = video.thumbnail || thumbnail;
    }

    if (!videoId) {
        throw new Error('Unable to resolve YouTube song ID.');
    }

    targetUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // 1. Cloudflare Worker Edge API
    try {
        const res = await axios.post(`${API_BASE}/api/v1/download`, {
            url: targetUrl,
            format: 'audio'
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            timeout: 15000
        });

        if (res.data?.success && res.data?.data?.media?.download_url) {
            return {
                downloadUrl: res.data.data.media.download_url,
                title: res.data.data.title || title,
                author: res.data.data.author?.name || author,
                thumbnail: res.data.data.thumbnail || thumbnail,
                targetUrl
            };
        }
    } catch (cfErr) {
        console.warn('[SONG] Cloudflare Worker failed, trying next method:', cfErr.response?.data?.error?.message || cfErr.message);
    }

    return {
        downloadUrl: null,
        title,
        author,
        thumbnail,
        targetUrl
    };
}

async function songCommand(sock, chatId, message, queryText = '') {
    const rawInput = queryText || (
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        message.message?.imageMessage?.caption ||
        message.message?.videoMessage?.caption ||
        ''
    );
    const text = rawInput.replace(/^\.(song|play|mp3)\s*/i, '').trim();

    if (!text) {
        return await sock.sendMessage(chatId, {
            text: '🎵 *Please provide a song name or YouTube link!*\n\n*Usage:* `.song <song name>`\n*Example:* `.song Believer`\n*Direct link:* `.song https://youtu.be/...`'
        }, { quoted: message });
    }

    await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

    let downloadedFilePath = null;
    const fileId = `song_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    try {
        const media = await resolveAudio(text);
        const songTitle = media.title;
        const songArtist = media.author;
        const songThumb = media.thumbnail;
        const safeFileName = `${(songTitle || 'song').replace(/[\\/:*?"<>|]/g, '_')}.mp3`;

        let sent = false;

        // Try direct stream if Cloudflare Worker provided a valid link
        if (media.downloadUrl) {
            try {
                await sock.sendMessage(chatId, {
                    audio: { url: media.downloadUrl },
                    mimetype: 'audio/mpeg',
                    fileName: safeFileName,
                    contextInfo: {
                        externalAdReply: {
                            title: songTitle.slice(0, 60),
                            body: songArtist.slice(0, 60),
                            mediaType: 2,
                            thumbnailUrl: songThumb,
                            sourceUrl: media.targetUrl,
                            renderLargerThumbnail: true
                        }
                    }
                }, { quoted: message });
                sent = true;
            } catch (streamErr) {
                console.warn('[SONG] Direct stream failed, falling back to local downloader:', streamErr.message);
            }
        }

        // Use local yt-dlp downloader with cookie support
        if (!sent) {
            downloadedFilePath = await downloadMp3(media.targetUrl, fileId);
            const audioBuffer = fs.readFileSync(downloadedFilePath);

            await sock.sendMessage(chatId, {
                audio: audioBuffer,
                mimetype: 'audio/mpeg',
                fileName: safeFileName,
                contextInfo: {
                    externalAdReply: {
                        title: songTitle.slice(0, 60),
                        body: songArtist.slice(0, 60),
                        mediaType: 2,
                        thumbnailUrl: songThumb,
                        sourceUrl: media.targetUrl,
                        renderLargerThumbnail: true
                    }
                }
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (err) {
        console.error('[SONG ERROR]:', err.message);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });

        const is403 = /status code 403/i.test(err.message) || /Forbidden/i.test(err.message);
        if (err.isBotBlocked || is403) {
            await sock.sendMessage(chatId, {
                text: getBotChallengeMessage()
            }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, {
                text: `❌ *Song Download Failed*\n\n*Error:* ${err.message || 'Unable to download song'}\n\nPlease verify the song link or try another search!`
            }, { quoted: message });
        }
    } finally {
        if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
            try { fs.unlinkSync(downloadedFilePath); } catch (_) {}
        }
    }
}

module.exports = songCommand;

const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { downloadMp3, getYtDlpMeta } = require('../lib/ytdlp-helper');

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
    await sock.sendMessage(chatId, {
        text: `⏳ *Fetching Spotify track & converting audio:* "${raw}"...`
    }, { quoted: message });

    const fileId = `spotify_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    let downloadedFilePath = null;

    try {
        let trackTitle = raw;
        let artistName = 'Spotify';
        let albumArt = null;

        const isSpotifyUrl = /open\.spotify\.com\/track\/([a-zA-Z0-9]+)/i.test(raw);
        if (isSpotifyUrl) {
            const oembed = await getSpotifyOEmbed(raw);
            if (oembed) {
                trackTitle = oembed.title;
                artistName = oembed.author;
                albumArt = oembed.thumbnail;
            }
        }

        const searchQuery = `${trackTitle} ${artistName !== 'Spotify' ? artistName : ''}`.trim();
        downloadedFilePath = await downloadMp3(searchQuery, fileId);

        const audioBuffer = fs.readFileSync(downloadedFilePath);

        await sock.sendMessage(chatId, {
            audio: audioBuffer,
            mimetype: 'audio/mpeg',
            fileName: `${trackTitle.replace(/[\\/:*?"<>|]/g, '_')}.mp3`,
            contextInfo: {
                externalAdReply: {
                    title: trackTitle.slice(0, 60),
                    body: `Spotify • ${artistName}`.slice(0, 60),
                    mediaType: 2,
                    thumbnailUrl: albumArt || 'https://open.spotify.com/favicon.ico',
                    sourceUrl: isSpotifyUrl ? raw : 'https://open.spotify.com',
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: message });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (err) {
        console.error('[SPOTIFY] Error in spotifyCommand:', err.message || err);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, {
            text: err.isBotBlocked
                ? err.message
                : `❌ *Failed to download Spotify audio.*\n\n*Error:* ${err.message || 'Audio could not be downloaded.'}`
        }, { quoted: message });
    } finally {
        if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
            try { fs.unlinkSync(downloadedFilePath); } catch (_) {}
        }
    }
}

module.exports = spotifyCommand;

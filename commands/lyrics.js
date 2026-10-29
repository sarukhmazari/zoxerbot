const axios = require('axios');
const settings = require('../settings');

async function lyricsCommand(sock, chatId, songTitle, message) {
    const query = songTitle || (
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        ''
    ).replace(/^\.(lyrics|lyric)\s*/i, '').trim();

    if (!query) {
        return await sock.sendMessage(chatId, { 
            text: '🔍 *Please enter the song name to get lyrics!*\n\n*Usage:* `.lyrics <song name>`\n*Example:* `.lyrics Believer Imagine Dragons`'
        }, { quoted: message });
    }

    await sock.sendMessage(chatId, { react: { text: '🔍', key: message.key } });

    let result = null;

    // 1. Primary Engine: LRCLIB (Rich, accurate, includes artist and album)
    try {
        const lrclibRes = await axios.get(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, {
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0' },
            validateStatus: () => true
        });

        if (Array.isArray(lrclibRes.data) && lrclibRes.data.length > 0) {
            const hit = lrclibRes.data.find(h => h.plainLyrics) || lrclibRes.data[0];
            if (hit && hit.plainLyrics) {
                const durationMin = hit.duration ? `${Math.floor(hit.duration / 60)}:${String(Math.floor(hit.duration % 60)).padStart(2, '0')}` : '';
                result = {
                    title: hit.trackName || query,
                    artist: hit.artistName || 'Unknown Artist',
                    album: hit.albumName || 'Single / Unknown Album',
                    duration: durationMin,
                    lyrics: hit.plainLyrics.trim()
                };
            }
        }
    } catch (e) {
        // Fallback
    }

    // 2. Secondary Engine: KnightBot Lyrics API
    if (!result) {
        try {
            const kbApiKey = process.env.KNIGHTBOT_API_KEY || (settings && settings.knightBotApiKey) || 'knight';
            const kbRes = await axios.get(`https://knightbotapi.stream/api/lyrics?apikey=${encodeURIComponent(kbApiKey)}&query=${encodeURIComponent(query)}`, {
                timeout: 10000,
                validateStatus: () => true
            });

            if (kbRes.data?.success && kbRes.data?.result) {
                const r = kbRes.data.result;
                const lyricText = r.lyrics || r.text;
                if (lyricText) {
                    result = {
                        title: r.title || query,
                        artist: r.artist || r.author || 'Artist',
                        album: r.album || 'Official Release',
                        duration: '',
                        lyrics: lyricText.trim()
                    };
                }
            }
        } catch (e) {
            // Fallback
        }
    }

    // 3. Tertiary Engine: lyricsapi.fly.dev
    if (!result) {
        try {
            const flyRes = await axios.get(`https://lyricsapi.fly.dev/api/lyrics?q=${encodeURIComponent(query)}`, {
                timeout: 10000,
                validateStatus: () => true
            });
            if (flyRes.data?.result?.lyrics) {
                result = {
                    title: query,
                    artist: flyRes.data.result.artist || 'Unknown',
                    album: '',
                    duration: '',
                    lyrics: flyRes.data.result.lyrics.trim()
                };
            }
        } catch (e) {}
    }

    if (!result || !result.lyrics) {
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        return await sock.sendMessage(chatId, {
            text: `❌ *Sorry, could not find any lyrics for "${query}".*\n\nTry including the artist name: e.g. \`.lyrics ${query} <artist>\``
        }, { quoted: message });
    }

    const maxChars = 3900;
    const truncatedLyrics = result.lyrics.length > maxChars
        ? result.lyrics.slice(0, maxChars) + '\n\n...[Lyrics truncated due to WhatsApp character limit]'
        : result.lyrics;

    let caption = `🎵 *LYRICS SEARCH*\n\n` +
                  `🎶 *Track:* ${result.title}\n` +
                  `👤 *Artist:* ${result.artist}\n`;
    if (result.album) caption += `💿 *Album:* ${result.album}\n`;
    if (result.duration) caption += `⏱️ *Duration:* ${result.duration}\n`;
    caption += `\n──────────────────────\n\n${truncatedLyrics}\n\n──────────────────────`;

    await sock.sendMessage(chatId, { text: caption }, { quoted: message });
    await sock.sendMessage(chatId, { react: { text: '🎶', key: message.key } });
}

module.exports = { lyricsCommand };

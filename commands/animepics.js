const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// Local fallback quotes in case the external API is offline
const LOCAL_QUOTES = [
    {
        quote: "If you don't like your destiny, don't accept it. Instead have the courage to change it the way you want it to be!",
        character: "Naruto Uzumaki",
        anime: "Naruto"
    },
    {
        quote: "Fear is not evil. It tells you what your weakness is. And once you know your weakness, you can become stronger as well as kinder.",
        character: "Gildarts Clive",
        anime: "Fairy Tail"
    },
    {
        quote: "Whatever you lose, you'll find it again. But what you throw away you'll never get back.",
        character: "Kenshin Himura",
        anime: "Rurouni Kenshin"
    },
    {
        quote: "It's not the face that makes someone a monster, it's the choices they make with their lives.",
        character: "Naruto Uzumaki",
        anime: "Naruto"
    },
    {
        quote: "If you want to make people dream, you've gotta start by believing in that dream yourself!",
        character: "Seiya Kanie",
        anime: "Amagi Brilliant Park"
    },
    {
        quote: "Power comes in response to a need, not a desire. You have to create that need.",
        character: "Goku",
        anime: "Dragon Ball Z"
    },
    {
        quote: "Even if things are painful and tough, people should appreciate what it means to be alive at all.",
        character: "Yato",
        anime: "Noragami"
    },
    {
        quote: "You should enjoy the little detours to the utmost. Because that's where you'll find the things more important than what you want.",
        character: "Ging Freecss",
        anime: "Hunter x Hunter"
    }
];

/**
 * High-speed multi-tier anime image resolver.
 * Priority 1: nekos.best (fast, 100% free, direct CDN)
 * Priority 2: nekos.life (fast, reliable)
 * Priority 3: pic.re (direct binary CDN)
 * Priority 4: waifu.pics / waifu.im
 */
async function fetchAnimeMedia(type) {
    const cleanType = (type || 'waifu').toLowerCase();

    // Mapping for nekos.best
    const nekosBestMap = {
        waifu: 'waifu',
        neko: 'neko',
        kitsune: 'kitsune',
        husbando: 'husbando',
        maid: 'waifu',
        uniform: 'waifu',
        shinobu: 'waifu',
        megumin: 'waifu',
        anime: 'waifu'
    };

    // 1. Primary: nekos.best
    if (nekosBestMap[cleanType]) {
        try {
            const target = nekosBestMap[cleanType];
            const res = await axios.get(`https://nekos.best/api/v2/${target}`, {
                timeout: 7000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            const item = res.data?.results?.[0];
            if (item?.url) {
                return {
                    url: item.url,
                    animeName: item.anime_name || '',
                    source: 'nekos.best'
                };
            }
        } catch (_) {}
    }

    // 2. Secondary: nekos.life
    const nekosLifeMap = {
        waifu: 'waifu',
        neko: 'neko',
        kitsune: 'fox_girl',
        foxgirl: 'fox_girl',
        wallpaper: 'wallpaper',
        animewallpaper: 'wallpaper',
        avatar: 'avatar'
    };

    if (nekosLifeMap[cleanType] || cleanType === 'wallpaper' || cleanType === 'animewallpaper') {
        try {
            const target = nekosLifeMap[cleanType] || 'wallpaper';
            const res = await axios.get(`https://nekos.life/api/v2/img/${target}`, {
                timeout: 7000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            if (res.data?.url) {
                return {
                    url: res.data.url,
                    animeName: '',
                    source: 'nekos.life'
                };
            }
        } catch (_) {}
    }

    // 3. Tertiary: waifu.im or waifu.pics
    try {
        const res = await axios.get(`https://api.waifu.pics/sfw/${cleanType}`, {
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (res.data?.url) {
            return {
                url: res.data.url,
                animeName: '',
                source: 'waifu.pics'
            };
        }
    } catch (_) {}

    // 4. Fallback: pic.re (random anime art direct URL)
    return {
        url: 'https://pic.re/image',
        animeName: '',
        source: 'pic.re'
    };
}

/**
 * Command: .waifu, .neko, .maid, .uniform, .husbando, .kitsune, .shinobu, .megumin, .wallpaper, .anime
 */
async function animePicsCommand(sock, chatId, message, type) {
    try {
        await sock.sendMessage(chatId, { react: { text: '🔍', key: message.key } });

        const resolved = await fetchAnimeMedia(type);

        if (resolved && resolved.url) {
            const senderId = message.key?.participant || message.key?.remoteJid || '';
            const senderTag = senderId ? `@${senderId.split('@')[0].split(':')[0]}` : '';
            const displayType = type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Waifu';

            let caption = `╭─ *🌸 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗜𝗠𝗘 𝗚𝗔𝗟𝗟𝗘𝗥𝗬*\n` +
                          `┃\n` +
                          `┃  ◈ *Type:* ${displayType}\n`;

            if (resolved.animeName) {
                caption += `┃  ◈ *Anime:* ${resolved.animeName}\n`;
            }

            caption += `┃  ◈ *Source:* ${resolved.source}\n` +
                       (senderTag ? `┃  ◈ *Requested by:* ${senderTag}\n` : '') +
                       `┃\n` +
                       `╰─────────────────────────`;

            await sock.sendMessage(chatId, {
                image: { url: resolved.url },
                caption: caption,
                mentions: senderId ? [senderId] : []
            }, { quoted: message });

            await sock.sendMessage(chatId, { react: { text: '💖', key: message.key } });
            return;
        }

        // Offline mode fallback
        const localCandidates = [
            './assets/images/logo.png',
            './zoxer.jfif'
        ];
        const localPath = localCandidates.find(p => fs.existsSync(p));
        if (localPath) {
            const buffer = fs.readFileSync(localPath);
            await sock.sendMessage(chatId, {
                image: buffer,
                caption: `⚠️ *[Offline Mode]* Could not connect to anime servers. Displaying default graphic.\n\n© ZOXER BOT`
            }, { quoted: message });
            await sock.sendMessage(chatId, { react: { text: '⚠️', key: message.key } });
        } else {
            await sock.sendMessage(chatId, {
                text: `❌ Could not fetch anime image for *.${type}*. Please try again later.`
            }, { quoted: message });
        }

    } catch (error) {
        console.error(`Error in animePicsCommand (${type}):`, error.message);
        await sock.sendMessage(chatId, {
            text: `❌ Failed to fetch anime image for *.${type}*. Please try again later.`
        }, { quoted: message });
    }
}

/**
 * Command: .animequote
 */
async function animeQuoteCommand(sock, chatId, message) {
    try {
        await sock.sendMessage(chatId, { react: { text: '📜', key: message.key } });

        let quoteData = null;

        try {
            const res = await axios.get('https://animechan.xyz/api/random', {
                timeout: 5000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            if (res.data?.quote) {
                quoteData = {
                    quote: res.data.quote,
                    character: res.data.character,
                    anime: res.data.anime
                };
            }
        } catch (_) {}

        if (!quoteData) {
            quoteData = LOCAL_QUOTES[Math.floor(Math.random() * LOCAL_QUOTES.length)];
        }

        const formattedQuote = `╭─ *📜 𝗔𝗡𝗜𝗠𝗘 𝗤𝗨𝗢𝗧𝗘*\n` +
                              `┃\n` +
                              `┃  "${quoteData.quote}"\n` +
                              `┃\n` +
                              `┃  ◈ *Character:* ${quoteData.character}\n` +
                              `┃  ◈ *Anime:* ${quoteData.anime}\n` +
                              `╰─────────────────────────`;

        await sock.sendMessage(chatId, { text: formattedQuote }, { quoted: message });
        await sock.sendMessage(chatId, { react: { text: '✨', key: message.key } });

    } catch (error) {
        console.error('Error in animeQuoteCommand:', error);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to fetch anime quote. Please try again later.'
        }, { quoted: message });
    }
}

/**
 * Command: .whatanime / .trace
 * Reverse anime search from an image using trace.moe
 */
async function whatAnimeCommand(sock, chatId, message) {
    try {
        // 1. Find target image: quoted message or direct message
        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const targetMsg = quoted || message.message;
        const imageMsg = targetMsg?.imageMessage;

        if (!imageMsg) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Please reply to an anime screenshot or image with* `.whatanime` *to identify it!*'
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: '🔍', key: message.key } });

        // 2. Download image buffer
        const stream = await downloadContentFromMessage(imageMsg, 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        if (!buffer || buffer.length === 0) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Failed to download the image for analysis.*'
            }, { quoted: message });
        }

        // 3. Search via trace.moe API
        const res = await axios.post('https://api.trace.moe/search', buffer, {
            headers: { 'Content-Type': 'image/jpeg' },
            timeout: 20000
        });

        const results = res.data?.result;
        if (!results || results.length === 0) {
            return await sock.sendMessage(chatId, {
                text: '🔍 *No matching anime found for this scene.*'
            }, { quoted: message });
        }

        const top = results[0];
        const similarity = (top.similarity * 100).toFixed(1);
        const episode = top.episode !== null && top.episode !== undefined ? top.episode : 'Movie / OVA';
        const fromSec = Math.floor(top.from || 0);
        const minutes = Math.floor(fromSec / 60);
        const seconds = fromSec % 60;
        const timeStr = `${minutes}m ${seconds}s`;

        // Clean filename for title
        let title = top.filename || 'Unknown Anime';
        title = title.replace(/\.[a-zA-Z0-9]+$/, '').replace(/\[.*?\]|\(.*?\)/g, '').trim();
        if (!title) title = top.filename;

        const caption = `╭─ *🎬 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗜𝗠𝗘 𝗙𝗜𝗡𝗗𝗘𝗥*\n` +
                        `┃\n` +
                        `┃  ◈ *Anime:* ${title}\n` +
                        `┃  ◈ *Episode:* ${episode}\n` +
                        `┃  ◈ *Timestamp:* ${timeStr}\n` +
                        `┃  ◈ *Confidence:* ${similarity}%\n` +
                        `┃\n` +
                        `╰─ Identified using trace.moe`;

        // If trace.moe returned a video preview clip, send it with caption!
        if (top.video) {
            try {
                await sock.sendMessage(chatId, {
                    video: { url: top.video },
                    caption: caption
                }, { quoted: message });
                await sock.sendMessage(chatId, { react: { text: '🎯', key: message.key } });
                return;
            } catch (_) {}
        }

        // Fallback: send as text or image preview
        if (top.image) {
            await sock.sendMessage(chatId, {
                image: { url: top.image },
                caption: caption
            }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, { text: caption }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: '🎯', key: message.key } });

    } catch (err) {
        console.error('Error in whatAnimeCommand:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ *An error occurred while identifying the anime. Please try again with a clearer screenshot.*'
        }, { quoted: message });
    }
}

module.exports = {
    animePicsCommand,
    animeQuoteCommand,
    whatAnimeCommand,
    fetchAnimeMedia
};

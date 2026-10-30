const axios = require('axios');

// Supported reaction types mapping for nekos.best
const REACTION_ACTIONS = {
    hug: { verb: 'warmly hugged', emoji: '🤗' },
    kiss: { verb: 'gave a sweet kiss to', emoji: '💋' },
    pat: { verb: 'gently patted', emoji: '🐾' },
    slap: { verb: 'slapped', emoji: '💥' },
    poke: { verb: 'poked', emoji: '👉' },
    bite: { verb: 'playfully bit', emoji: '🦷' },
    cuddle: { verb: 'cuddled up with', emoji: '🧸' },
    feed: { verb: 'fed delicious treats to', emoji: '🍰' },
    bonk: { verb: 'bonked', emoji: '🔨' },
    smug: { verb: 'smugged at', emoji: '😏' },
    blush: { verb: 'blushed around', emoji: '😳' },
    dance: { verb: 'danced with', emoji: '💃' },
    wave: { verb: 'waved at', emoji: '👋' },
    wink: { verb: 'winked at', emoji: '😉' },
    nom: { verb: 'nommed on', emoji: '😋' },
    cry: { verb: 'cried on', emoji: '😭' },
    yeet: { verb: 'yeeted', emoji: '🚀' },
    punch: { verb: 'punched', emoji: '👊' },
    stare: { verb: 'stared intensely at', emoji: '👀' },
    highfive: { verb: 'gave a high five to', emoji: '🙌' },
    handhold: { verb: 'held hands with', emoji: '🤝' },
    tickle: { verb: 'tickled', emoji: '😹' },
    'face-palm': { verb: 'facepalmed at', emoji: '🤦' }
};

function normalizeType(input) {
    const lower = (input || '').toLowerCase().trim();
    if (lower === 'facepalm' || lower === 'face_palm') return 'face-palm';
    return lower;
}

/**
 * Resolves reaction GIF/image from nekos.best, nekos.life, or waifu.pics
 */
async function fetchReactionMedia(type) {
    const cleanType = type === 'face-palm' ? 'facepalm' : type;

    // 1. Primary: nekos.best
    try {
        const nekosType = type === 'face-palm' ? 'facepalm' : type;
        const res = await axios.get(`https://nekos.best/api/v2/${nekosType}`, {
            timeout: 7000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const item = res.data?.results?.[0];
        if (item?.url) {
            return {
                url: item.url,
                anime: item.anime_name || '',
                source: 'nekos.best'
            };
        }
    } catch (_) {}

    // 2. Fallback: nekos.life
    try {
        const res = await axios.get(`https://nekos.life/api/v2/img/${cleanType}`, {
            timeout: 6000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (res.data?.url) {
            return {
                url: res.data.url,
                anime: '',
                source: 'nekos.life'
            };
        }
    } catch (_) {}

    // 3. Fallback: waifu.pics
    try {
        const res = await axios.get(`https://api.waifu.pics/sfw/${cleanType}`, {
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (res.data?.url) {
            return {
                url: res.data.url,
                anime: '',
                source: 'waifu.pics'
            };
        }
    } catch (_) {}

    return null;
}

/**
 * Handles sending the reaction with proper mentions and anime caption
 */
async function sendAnimu(sock, chatId, message, type) {
    const cleanType = normalizeType(type);

    try {
        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

        const media = await fetchReactionMedia(cleanType);
        if (!media || !media.url) {
            return await sock.sendMessage(
                chatId,
                { text: `❌ Sorry, anime reaction for *${type}* is temporarily unavailable.` },
                { quoted: message }
            );
        }

        const senderId = message.key?.participant || message.key?.remoteJid || '';
        const senderTag = senderId ? `@${senderId.split('@')[0].split(':')[0]}` : 'Someone';

        // Check if there is a target (quoted message or mentioned JID)
        const quotedParticipant = message.message?.extendedTextMessage?.contextInfo?.participant;
        const mentionedJids = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const targetId = mentionedJids[0] || quotedParticipant;

        const mentions = [senderId];
        if (targetId && targetId !== senderId) {
            mentions.push(targetId);
        }

        const actionConfig = REACTION_ACTIONS[cleanType] || { verb: cleanType, emoji: '✨' };

        let captionText = '';
        if (targetId && targetId !== senderId) {
            const targetTag = `@${targetId.split('@')[0].split(':')[0]}`;
            captionText = `${senderTag} ${actionConfig.verb} ${targetTag}! ${actionConfig.emoji}`;
        } else {
            captionText = `${senderTag} is doing *${cleanType}* ${actionConfig.emoji}`;
        }

        if (media.anime) {
            captionText += `\n📺 *Anime:* _${media.anime}_`;
        }

        // Send GIF/image
        const isGif = media.url.endsWith('.gif');
        if (isGif) {
            await sock.sendMessage(
                chatId,
                {
                    video: { url: media.url },
                    gifPlayback: true,
                    caption: captionText,
                    mentions
                },
                { quoted: message }
            );
        } else {
            await sock.sendMessage(
                chatId,
                {
                    image: { url: media.url },
                    caption: captionText,
                    mentions
                },
                { quoted: message }
            );
        }

        const reactEmoji = actionConfig.emoji || '💖';
        await sock.sendMessage(chatId, { react: { text: reactEmoji, key: message.key } });

    } catch (err) {
        console.error(`Error in sendAnimu (${type}):`, err.message);
        await sock.sendMessage(
            chatId,
            { text: `❌ Failed to send anime reaction for *${type}*.` },
            { quoted: message }
        );
    }
}

/**
 * Main command router for .anime / .animu
 */
async function animeCommand(sock, chatId, message, args) {
    const subArg = args && args[0] ? args[0] : '';
    const sub = normalizeType(subArg);

    const supported = Object.keys(REACTION_ACTIONS);

    try {
        if (!sub) {
            const listFormatted = supported.map(t => `• .${t}`).join('\n');
            await sock.sendMessage(chatId, {
                text: `╭─ *🎭 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗜𝗠𝗘 𝗥𝗘𝗔𝗖𝗧𝗜𝗢𝗡𝗦*\n` +
                      `┃\n` +
                      `┃ *Usage:* \`.anime <reaction>\` or directly \`.hug @user\`\n` +
                      `┃\n` +
                      `┃ *Available Reactions:*\n` +
                      `┃ ${supported.join(', ')}\n` +
                      `┃\n` +
                      `╰─ Tag or reply to a friend to react together!`
            }, { quoted: message });
            return;
        }

        await sendAnimu(sock, chatId, message, sub);
    } catch (err) {
        console.error('Error in anime command:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ An error occurred while fetching anime reaction.'
        }, { quoted: message });
    }
}

module.exports = {
    animeCommand,
    sendAnimu,
    REACTION_ACTIONS
};

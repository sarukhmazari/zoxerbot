const axios = require('axios');

async function memeCommand(sock, chatId, message) {
    try {
        const response = await axios.get('https://meme-api.com/gimme', {
            timeout: 8000,
            headers: { 'Accept-Encoding': 'identity', 'User-Agent': 'Mozilla/5.0' }
        });

        const data = response.data;
        if (!data || !data.url) {
            throw new Error('No meme image returned');
        }

        const caption = `╭─ *🎭 𝗭𝗢𝗫𝗘𝗥 𝗠𝗘𝗠𝗘*
┃
┃  ◈ *𝗧𝗜𝗧𝗟𝗘*
┃  ◆ *${data.title || 'Meme'}*
┃  ◈ *𝗦𝗨𝗕𝗥𝗘𝗗𝗗𝗜𝗧*
┃  ◆ *r/${data.subreddit || 'memes'}*
┃
╰───────────────`;

        await sock.sendMessage(chatId, {
            image: { url: data.url },
            caption: caption
        }, { quoted: message });

    } catch (error) {
        console.error('Error in meme command:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ Failed to fetch meme. Please try again later.'
        }, { quoted: message });
    }
}

module.exports = memeCommand;

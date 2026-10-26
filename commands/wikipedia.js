const axios = require('axios');

async function wikipediaCommand(sock, chatId, message, args) {
    try {
        const query = args.join(' ').trim();
        if (!query) {
            return await sock.sendMessage(chatId, {
                text: '⚠️ Please provide a topic to search on Wikipedia.\n*Example:* `.wiki Artificial Intelligence`'
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'WhatsAppBot/1.0 (contact: admin)' },
            timeout: 10000
        });

        const data = response.data;
        if (!data || data.type === 'disambiguation' || !data.extract) {
            return await sock.sendMessage(chatId, {
                text: `❌ No direct article found for *"${query}"*. Please try a more specific title.`
            }, { quoted: message });
        }

        let reply = `╭─ *📚 𝗪𝗜𝗞𝗜𝗣𝗘𝗗𝗜𝗔*
┃
┃  ◈ *𝗧𝗜𝗧𝗟𝗘*
┃  ◆ *${data.title}*
┃
┣─〔 ◈ 𝗦𝗨𝗠𝗠𝗔𝗥𝗬 〕
┃  ${data.extract.replace(/\n+/g, ' ').slice(0, 500)}
┃
┣─〔 ◈ 𝗦𝗢𝗨𝗥𝗖𝗘 〕
┃  ▸ *${data.content_urls?.desktop?.page || 'Wikipedia'}*
┃
╰───────────────`;

        if (data.thumbnail?.source) {
            await sock.sendMessage(chatId, {
                image: { url: data.thumbnail.source },
                caption: reply
            }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, { text: reply }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (err) {
        if (err.response?.status === 404) {
            await sock.sendMessage(chatId, {
                text: `❌ Topic not found on Wikipedia. Check spelling and try again.`
            }, { quoted: message });
        } else {
            console.error('Error in wikipediaCommand:', err);
            await sock.sendMessage(chatId, {
                text: `❌ Failed to fetch Wikipedia article: ${err.message}`
            }, { quoted: message });
        }
    }
}

module.exports = wikipediaCommand;

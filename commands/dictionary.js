const axios = require('axios');

async function dictionaryCommand(sock, chatId, message, args) {
    try {
        const word = args[0]?.trim();
        if (!word) {
            return await sock.sendMessage(chatId, {
                text: '⚠️ Please provide a word to look up.\n*Example:* `.dict serendipity`'
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

        const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=d&max=1`;
        const response = await axios.get(url, { timeout: 8000 });

        const entry = response.data?.[0];
        if (!entry || !entry.defs || entry.defs.length === 0) {
            return await sock.sendMessage(chatId, {
                text: `❌ No definitions found for *"${word}"*. Check spelling and try again.`
            }, { quoted: message });
        }

        let output = `╭─ *📖 𝗭𝗢𝗫𝗘𝗥 𝗗𝗜𝗖𝗧𝗜𝗢𝗡𝗔𝗥𝗬*
┃
┃  ◈ *𝗪𝗢𝗥𝗗*
┃  ◆ *${entry.word.toUpperCase()}*
┃
┣─〔 ◈ 𝗗𝗘𝗙𝗜𝗡𝗜𝗧𝗜𝗢𝗡𝗦 〕\n`;
        entry.defs.slice(0, 3).forEach((def, index) => {
            const parts = def.split('\t');
            const pos = parts[0] === 'n' ? 'Noun' : (parts[0] === 'v' ? 'Verb' : (parts[0] === 'adj' ? 'Adjective' : ''));
            const text = parts[1] || parts[0];
            output += `┃  ▸ *${index + 1}.* ${pos ? `*(${pos})* ` : ''}${text.trim()}\n`;
        });
        output += `┃\n╰───────────────`;

        await sock.sendMessage(chatId, { text: output.trim() }, { quoted: message });
        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (err) {
        console.error('Error in dictionaryCommand:', err);
        await sock.sendMessage(chatId, { text: `❌ Dictionary error: ${err.message}` }, { quoted: message });
    }
}

module.exports = dictionaryCommand;

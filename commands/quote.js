const axios = require('axios');

const fallbackQuotes = [
    { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
    { text: "Life is what happens when you're busy making other plans.", author: "John Lennon" },
    { text: "Get busy living or get busy dying.", author: "Stephen King" },
    { text: "You only live once, but if you do it right, once is enough.", author: "Mae West" },
    { text: "In the middle of every difficulty lies opportunity.", author: "Albert Einstein" },
    { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
    { text: "Everything you've ever wanted is on the other side of fear.", author: "George Addair" },
    { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
    { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
    { text: "Your time is limited, don't waste it living someone else's life.", author: "Steve Jobs" }
];

module.exports = async function quoteCommand(sock, chatId, message) {
    let quoteText = '';
    let authorName = 'Inspiration';

    try {
        const res = await axios.get('https://shizoapi.onrender.com/api/texts/quotes?apikey=shizo', {
            timeout: 3000,
            headers: { 'Accept-Encoding': 'identity', 'User-Agent': 'Mozilla/5.0' }
        });
        if (res.data && res.data.result && typeof res.data.result === 'string') {
            quoteText = res.data.result.trim();
        }
    } catch (_) {}

    if (!quoteText) {
        const item = fallbackQuotes[Math.floor(Math.random() * fallbackQuotes.length)];
        quoteText = item.text;
        authorName = item.author;
    }

    const reply = `╭─ *💡 𝗭𝗢𝗫𝗘𝗥 𝗤𝗨𝗢𝗧𝗘*
┃
┃  ◈ *𝗤𝗨𝗢𝗧𝗘*
┃  ◆ "${quoteText}"
┃
┃  ◈ *𝗔𝗨𝗧𝗛𝗢𝗥*
┃  ◆ *${authorName}*
┃
╰───────────────`;

    await sock.sendMessage(chatId, { text: reply }, { quoted: message });
};

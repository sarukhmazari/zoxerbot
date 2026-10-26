const axios = require('axios');

const fallbackFlirts = [
    "Are you a magician? Because whenever I look at you, everyone else disappears.",
    "Do you have a map? Because I just keep getting lost in your eyes.",
    "If you were a vegetable, you'd be a cute-cumber.",
    "Is your name Google? Because you have everything I’ve been searching for.",
    "Do you believe in love at first sight, or should I walk by again?",
    "Are you a campfire? Because you're hot and I want s'more.",
    "If beauty were time, you’d definitely be an eternity.",
    "I must be a snowflake, because I've fallen for you."
];

async function flirtCommand(sock, chatId, message) {
    let flirtText = '';

    try {
        const res = await axios.get('https://shizoapi.onrender.com/api/texts/flirt?apikey=shizo', {
            timeout: 3000,
            headers: { 'Accept-Encoding': 'identity', 'User-Agent': 'Mozilla/5.0' }
        });
        if (res.data && res.data.result && typeof res.data.result === 'string') {
            flirtText = res.data.result.trim();
        }
    } catch (_) {}

    if (!flirtText) {
        flirtText = fallbackFlirts[Math.floor(Math.random() * fallbackFlirts.length)];
    }

    const reply = `╭─ *💘 𝗭𝗢𝗫𝗘𝗥 𝗙𝗟𝗜𝗥𝗧*
┃
┃  ◈ *𝗠𝗘𝗦𝗦𝗔𝗚𝗘*
┃  ◆ *"${flirtText}"*
┃
╰───────────────`;

    await sock.sendMessage(chatId, { text: reply }, { quoted: message });
}

module.exports = { flirtCommand };
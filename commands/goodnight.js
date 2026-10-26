const axios = require('axios');

const fallbackNights = [
    "May your dreams be sweeter than honey and softer than moonlight. Good night!",
    "Close your eyes, clear your mind, and let the gentle stars guide you into peaceful sleep. Good night!",
    "Wishing you restful sleep and beautiful dreams. Tomorrow is a brand new blessing!",
    "As the day turns into night, keep your worries out of sight. Sleep tight and sweet dreams!",
    "The stars are shining just for you tonight. Sleep peacefully and wake up energized!"
];

async function goodnightCommand(sock, chatId, message) {
    let nightText = '';

    try {
        const res = await axios.get('https://shizoapi.onrender.com/api/texts/lovenight?apikey=shizo', {
            timeout: 3000,
            headers: { 'Accept-Encoding': 'identity', 'User-Agent': 'Mozilla/5.0' }
        });
        if (res.data && res.data.result && typeof res.data.result === 'string') {
            nightText = res.data.result.trim();
        }
    } catch (_) {}

    if (!nightText) {
        nightText = fallbackNights[Math.floor(Math.random() * fallbackNights.length)];
    }

    const reply = `╭─ *🌙 𝗭𝗢𝗫𝗘𝗥 𝗚𝗢𝗢𝗗𝗡𝗜𝗚𝗛𝗧*
┃
┃  ◈ *𝗪𝗜𝗦𝗛*
┃  ◆ *"${nightText}"*
┃
╰───────────────`;

    await sock.sendMessage(chatId, { text: reply }, { quoted: message });
}

module.exports = { goodnightCommand };
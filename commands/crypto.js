const axios = require('axios');

async function cryptoCommand(sock, chatId, message, args) {
    try {
        const query = (args[0] || '').toLowerCase().trim();
        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

        const defaultCoins = ['bitcoin', 'ethereum', 'binancecoin', 'solana', 'ripple', 'dogecoin', 'cardano'];
        const targets = query ? [query] : defaultCoins;

        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(targets.join(','))}&vs_currencies=usd&include_24hr_change=true`;
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 8000
        });

        const data = response.data;
        if (!data || Object.keys(data).length === 0) {
            return await sock.sendMessage(chatId, {
                text: `❌ Cryptocurrency *"${query}"* not found. Try standard names like bitcoin, ethereum, solana.`
            }, { quoted: message });
        }

        let output = `╭─ *💰 𝗭𝗢𝗫𝗘𝗥 𝗖𝗥𝗬𝗣𝗧𝗢*
┃
┃  ◈ *𝗠𝗔𝗥𝗞𝗘𝗧 𝗣𝗥𝗜𝗖𝗘𝗦 (𝗨𝗦𝗗)*\n`;
        for (const [coin, details] of Object.entries(data)) {
            const price = details.usd ? `$${details.usd.toLocaleString()}` : 'N/A';
            const change = typeof details.usd_24h_change === 'number' 
                ? `${details.usd_24h_change >= 0 ? '+' : ''}${details.usd_24h_change.toFixed(2)}%`
                : 'N/A';
            const icon = (details.usd_24h_change || 0) >= 0 ? '📈' : '📉';
            output += `┃  ◆ *${coin.toUpperCase()}*: ${price} (${icon} ${change})\n`;
        }
        output += `┃\n╰───────────────`;
        await sock.sendMessage(chatId, { text: output }, { quoted: message });
        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (err) {
        console.error('Error in cryptoCommand:', err);
        await sock.sendMessage(chatId, { text: `❌ Crypto lookup failed: ${err.message}` }, { quoted: message });
    }
}

module.exports = cryptoCommand;

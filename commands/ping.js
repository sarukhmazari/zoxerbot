const os = require('os');
const settings = require('../settings.js');

function formatTime(seconds) {
    const days = Math.floor(seconds / (24 * 60 * 60));
    seconds = seconds % (24 * 60 * 60);
    const hours = Math.floor(seconds / (60 * 60));
    seconds = seconds % (60 * 60);
    const minutes = Math.floor(seconds / 60);
    seconds = Math.floor(seconds % 60);

    let time = '';
    if (days > 0) time += `${days}d `;
    if (hours > 0) time += `${hours}h `;
    if (minutes > 0) time += `${minutes}m `;
    if (seconds > 0 || time === '') time += `${seconds}s`;

    return time.trim();
}

async function pingCommand(sock, chatId, message) {
    try {
        const start = Date.now();
        const uptimeInSeconds = process.uptime();
        const uptimeFormatted = formatTime(uptimeInSeconds);

        const speed = Math.round((Date.now() - start) / 2);
        const botInfo = `╭─ *𝗭𝗢𝗫𝗘𝗥 𝗣𝗜𝗡𝗚*
┃
┃  ◈ *𝗦𝗣𝗘𝗘𝗗*
┃  ◆ *${speed} ms*
┃  ◈ *𝗨𝗣𝗧𝗜𝗠𝗘*
┃  ◆ *${uptimeFormatted}*
┃  ◈ *𝗩𝗘𝗥𝗦𝗜𝗢𝗡*
┃  ◆ *v${settings.version}*
┃
╰───────────────`;

        // Reply with the detailed bot info only
        await sock.sendMessage(chatId, { text: botInfo }, { quoted: message });

    } catch (error) {
        console.error('Error in ping command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to get bot status.' });
    }
}

module.exports = pingCommand;

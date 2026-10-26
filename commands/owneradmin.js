const isOwnerOrSudo = require('../lib/isOwner');

async function restartCommand(sock, chatId, message, senderId) {
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
    if (!isOwner && !message.key.fromMe) {
        return await sock.sendMessage(chatId, { text: '❌ This command is restricted to the bot owner.' }, { quoted: message });
    }

    await sock.sendMessage(chatId, { text: '🔄 *Bot is restarting now...* Please allow 5-10 seconds.' }, { quoted: message });
    setTimeout(() => {
        process.exit(0);
    }, 1500);
}

async function broadcastCommand(sock, chatId, message, args, senderId) {
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
    if (!isOwner && !message.key.fromMe) {
        return await sock.sendMessage(chatId, { text: '❌ This command is restricted to the bot owner.' }, { quoted: message });
    }

    const broadcastText = args.join(' ').trim();
    if (!broadcastText) {
        return await sock.sendMessage(chatId, {
            text: '⚠️ Please provide an announcement text to broadcast.\n*Example:* `.broadcast Important update scheduled tonight.`'
        }, { quoted: message });
    }

    try {
        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

        const groups = await sock.groupFetchAllParticipating();
        const groupIds = Object.keys(groups);

        const announcement = `📢 *OFFICIAL BOT BROADCAST*\n\n` +
            `${broadcastText}\n\n` +
            `_— ZOXER BOT Team_`;

        let success = 0;
        let failed = 0;

        for (const gid of groupIds) {
            try {
                await sock.sendMessage(gid, { text: announcement });
                success++;
                await new Promise(resolve => setTimeout(resolve, 800)); // Respect rate limits
            } catch (_) {
                failed++;
            }
        }

        await sock.sendMessage(chatId, {
            text: `✅ *Broadcast Finished!*\n\n• *Sent successfully:* ${success} groups\n• *Failed:* ${failed} groups`
        }, { quoted: message });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (err) {
        console.error('Error in broadcastCommand:', err);
        await sock.sendMessage(chatId, { text: `❌ Broadcast failed: ${err.message}` }, { quoted: message });
    }
}

module.exports = {
    restartCommand,
    broadcastCommand
};

const isOwnerOrSudo = require('../lib/isOwner');

async function getBioCommand(sock, chatId, message, args) {
    try {
        let target = null;
        if (args[0]) {
            const clean = args[0].replace(/[^0-9]/g, '');
            if (clean) target = clean + '@s.whatsapp.net';
        }

        if (!target) {
            const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid;
            if (mentioned && mentioned.length > 0) target = mentioned[0];
        }

        if (!target) {
            const quoted = message.message?.extendedTextMessage?.contextInfo?.participant;
            if (quoted) target = quoted;
        }

        if (!target) {
            target = message.key.participant || chatId;
        }

        const statusData = await sock.fetchStatus(target).catch(() => null);
        const userClean = target.split('@')[0].split(':')[0];

        if (!statusData || !statusData.status) {
            return await sock.sendMessage(chatId, {
                text: `ℹ️ No public About/Bio found for @${userClean} (or privacy settings restrict viewing).`,
                mentions: [target]
            }, { quoted: message });
        }

        const dateStr = statusData.setAt ? new Date(statusData.setAt).toLocaleDateString() : 'Unknown';

        const reply = `╭─ *👤 𝗭𝗢𝗫𝗘𝗥 𝗨𝗦𝗘𝗥 𝗕𝗜𝗢*
┃
┃  ◈ *𝗨𝗦𝗘𝗥*
┃  ◆ *@${userClean}*
┃  ◈ *𝗔𝗕𝗢𝗨𝗧*
┃  ◆ *${statusData.status}*
┃  ◈ *𝗨𝗣𝗗𝗔𝗧𝗘𝗗*
┃  ◆ *${dateStr}*
┃
╰───────────────`;

        await sock.sendMessage(chatId, { text: reply, mentions: [target] }, { quoted: message });

    } catch (err) {
        console.error('Error in getBioCommand:', err);
        await sock.sendMessage(chatId, { text: `❌ Could not fetch bio: ${err.message}` }, { quoted: message });
    }
}

async function blockCommand(sock, chatId, message, args, senderId) {
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
    if (!isOwner && !message.key.fromMe) {
        return await sock.sendMessage(chatId, { text: '❌ This command is restricted to the bot owner.' }, { quoted: message });
    }

    try {
        let target = null;
        if (args[0]) {
            const clean = args[0].replace(/[^0-9]/g, '');
            if (clean) target = clean + '@s.whatsapp.net';
        }

        if (!target) {
            const quoted = message.message?.extendedTextMessage?.contextInfo?.participant;
            if (quoted) target = quoted;
        }

        if (!target && !chatId.endsWith('@g.us')) {
            target = chatId;
        }

        if (!target) {
            return await sock.sendMessage(chatId, { text: '⚠️ Please mention or specify the user to block: `.block 923xxxxxxxxx`' }, { quoted: message });
        }

        await sock.updateBlockStatus(target, 'block');
        const num = target.split('@')[0].split(':')[0];
        await sock.sendMessage(chatId, { text: `✅ Contact @${num} has been blocked.`, mentions: [target] }, { quoted: message });

    } catch (err) {
        console.error('Error in blockCommand:', err);
        await sock.sendMessage(chatId, { text: `❌ Failed to block: ${err.message}` }, { quoted: message });
    }
}

async function unblockCommand(sock, chatId, message, args, senderId) {
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
    if (!isOwner && !message.key.fromMe) {
        return await sock.sendMessage(chatId, { text: '❌ This command is restricted to the bot owner.' }, { quoted: message });
    }

    try {
        let target = null;
        if (args[0]) {
            const clean = args[0].replace(/[^0-9]/g, '');
            if (clean) target = clean + '@s.whatsapp.net';
        }

        if (!target) {
            const quoted = message.message?.extendedTextMessage?.contextInfo?.participant;
            if (quoted) target = quoted;
        }

        if (!target && !chatId.endsWith('@g.us')) {
            target = chatId;
        }

        if (!target) {
            return await sock.sendMessage(chatId, { text: '⚠️ Please mention or specify the user to unblock: `.unblock 923xxxxxxxxx`' }, { quoted: message });
        }

        await sock.updateBlockStatus(target, 'unblock');
        const num = target.split('@')[0].split(':')[0];
        await sock.sendMessage(chatId, { text: `✅ Contact @${num} has been unblocked.`, mentions: [target] }, { quoted: message });

    } catch (err) {
        console.error('Error in unblockCommand:', err);
        await sock.sendMessage(chatId, { text: `❌ Failed to unblock: ${err.message}` }, { quoted: message });
    }
}

async function setNameCommand(sock, chatId, message, args, senderId) {
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
    if (!isOwner && !message.key.fromMe) {
        return await sock.sendMessage(chatId, { text: '❌ This command is restricted to the bot owner.' }, { quoted: message });
    }

    const name = args.join(' ').trim();
    if (!name) {
        return await sock.sendMessage(chatId, { text: '⚠️ Provide a new bot name: `.setname ZOXER BOT`' }, { quoted: message });
    }

    try {
        await sock.updateProfileName(name);
        await sock.sendMessage(chatId, { text: `✅ Bot profile name updated to: *${name}*` }, { quoted: message });
    } catch (err) {
        console.error('Error in setNameCommand:', err);
        await sock.sendMessage(chatId, { text: `❌ Failed to update name: ${err.message}` }, { quoted: message });
    }
}

async function setBioCommand(sock, chatId, message, args, senderId) {
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
    if (!isOwner && !message.key.fromMe) {
        return await sock.sendMessage(chatId, { text: '❌ This command is restricted to the bot owner.' }, { quoted: message });
    }

    const bio = args.join(' ').trim();
    if (!bio) {
        return await sock.sendMessage(chatId, { text: '⚠️ Provide a new status/bio: `.setbio Active 24/7`' }, { quoted: message });
    }

    try {
        await sock.updateProfileStatus(bio);
        await sock.sendMessage(chatId, { text: `✅ Bot WhatsApp About updated to: *${bio}*` }, { quoted: message });
    } catch (err) {
        console.error('Error in setBioCommand:', err);
        await sock.sendMessage(chatId, { text: `❌ Failed to update bio: ${err.message}` }, { quoted: message });
    }
}

module.exports = {
    getBioCommand,
    blockCommand,
    unblockCommand,
    setNameCommand,
    setBioCommand
};

/**
 * Zoxer Bot - WhatsApp Bot
 * Stealth Mode Command (.stealth on / off / status)
 */

const { isSessionOwner, getSessionPhone, getStealthConfig, setStealthConfig } = require('../lib/session-settings');

async function stealthCommand(sock, chatId, message, args = []) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const isOwner = isSessionOwner(sock, senderId, message);

        if (!message.key.fromMe && !isOwner) {
            return sock.sendMessage(chatId, {
                text: '❌ This command is only for the session owner!'
            }, { quoted: message });
        }

        const sessionPhone = getSessionPhone(sock);
        const action = args.length > 0 ? args[0].toLowerCase() : null;
        const current = getStealthConfig(sock);

        if (!action || action === 'status') {
            const statusText = current.enabled ? 'Enabled (ON)' : 'Disabled (OFF)';
            const reply = `╭─ *🥷 𝗭𝗢𝗫𝗘𝗥 𝗦𝗧𝗘𝗔𝗟𝗧𝗛 𝗠𝗢𝗗𝗘*
┃
┃  ◈ *𝗦𝗘𝗦𝗦𝗜𝗢𝗡*
┃  ◆ *${sessionPhone}*
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *${statusText}*
┃
┃  • \`.stealth on\` - Enable stealth mode for this session
┃  • \`.stealth off\` - Disable stealth mode for this session
┃
╰───────────────`;
            return sock.sendMessage(chatId, { text: reply }, { quoted: message });
        }

        if (action === 'on' || action === 'enable') {
            setStealthConfig(sock, true);
            const reply = `╭─ *🥷 𝗭𝗢𝗫𝗘𝗥 𝗦𝗧𝗘𝗔𝗟𝗧𝗛 𝗠𝗢𝗗𝗘*
┃
┃  ◈ *𝗦𝗘𝗦𝗦𝗜𝗢𝗡*
┃  ◆ *${sessionPhone}*
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Enabled (ON)*
┃
╰───────────────`;
            return sock.sendMessage(chatId, { text: reply }, { quoted: message });
        }

        if (action === 'off' || action === 'disable') {
            setStealthConfig(sock, false);
            const reply = `╭─ *🥷 𝗭𝗢𝗫𝗘𝗥 𝗦𝗧𝗘𝗔𝗟𝗧𝗛 𝗠𝗢𝗗𝗘*
┃
┃  ◈ *𝗦𝗘𝗦𝗦𝗜𝗢𝗡*
┃  ◆ *${sessionPhone}*
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Disabled (OFF)*
┃
╰───────────────`;
            return sock.sendMessage(chatId, { text: reply }, { quoted: message });
        }

        return sock.sendMessage(chatId, {
            text: '❌ Usage: `.stealth on`, `.stealth off`, or `.stealth status`'
        }, { quoted: message });

    } catch (err) {
        console.error('[STEALTH] Error in stealthCommand:', err);
        return sock.sendMessage(chatId, { text: '❌ Error executing .stealth command.' }, { quoted: message });
    }
}

module.exports = {
    stealthCommand
};

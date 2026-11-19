/**
 * Zoxer Bot - WhatsApp Bot
 * Single Tick Command (.singletick on / off / status)
 * Permanent Single Tick (Suppresses WhatsApp Delivery Receipts)
 */

const { isSessionOwner, getSessionPhone, getSingleTickConfig, setSingleTickConfig } = require('../lib/session-settings');

async function singletickCommand(sock, chatId, message, args = []) {
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
        const current = getSingleTickConfig(sock);

        if (!action || action === 'status') {
            const statusText = current.enabled ? 'Enabled (ON) 🎯' : 'Disabled (OFF) ⚪';
            const reply = `╭─ *🎯 𝗭𝗢𝗫𝗘𝗥 𝗦𝗜𝗡𝗚𝗟𝗘 𝗧𝗜𝗖𝗞 𝗠𝗢𝗗𝗘*
┃
┃  ◈ *𝗦𝗘𝗦𝗦𝗜𝗢𝗡*
┃  ◆ *${sessionPhone}*
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *${statusText}*
┃
┃  • \`.singletick on\` - Always show single tick to senders
┃  • \`.singletick off\` - Restore normal double ticks
┃  • \`.singletick status\` - Check current status
┃
┃  ℹ️ *How it works:*
┃  When enabled, Baileys blocks delivery receipts.
┃  The sender will permanently see a Single Tick (✓)
┃  even when you are online, reading, or in chat!
╰───────────────`;
            return sock.sendMessage(chatId, { text: reply }, { quoted: message });
        }

        if (action === 'on' || action === 'enable') {
            setSingleTickConfig(sock, true);
            const reply = `╭─ *🎯 𝗭𝗢𝗫𝗘𝗥 𝗦𝗜𝗡𝗚𝗟𝗘 𝗧𝗜𝗖𝗞 𝗠𝗢𝗗𝗘*
┃
┃  ◈ *𝗦𝗘𝗦𝗦𝗜𝗢𝗡*
┃  ◆ *${sessionPhone}*
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Enabled (ON) 🎯*
┃
┃  ✅ *Single Tick is now ACTIVE!*
┃  • Delivery receipts are strictly suppressed.
┃  • Senders will only see a Single Tick (✓).
┃  • Read receipts & online presence are hidden.
┃
╰───────────────`;
            return sock.sendMessage(chatId, { text: reply }, { quoted: message });
        }

        if (action === 'off' || action === 'disable') {
            setSingleTickConfig(sock, false);
            const reply = `╭─ *🎯 𝗭𝗢𝗫𝗘𝗥 𝗦𝗜𝗡𝗚𝗟𝗘 𝗧𝗜𝗖𝗞 𝗠𝗢𝗗𝗘*
┃
┃  ◈ *𝗦𝗘𝗦𝗦𝗜𝗢𝗡*
┃  ◆ *${sessionPhone}*
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Disabled (OFF) ⚪*
┃
┃  ✅ *Single Tick is now DEACTIVATED!*
┃  • Normal delivery receipts restored.
┃
╰───────────────`;
            return sock.sendMessage(chatId, { text: reply }, { quoted: message });
        }

        return sock.sendMessage(chatId, {
            text: '❌ Usage: `.singletick on`, `.singletick off`, or `.singletick status`'
        }, { quoted: message });

    } catch (err) {
        console.error('[SINGLETICK] Error in singletickCommand:', err);
        return sock.sendMessage(chatId, { text: '❌ Error executing .singletick command.' }, { quoted: message });
    }
}

module.exports = {
    singletickCommand
};

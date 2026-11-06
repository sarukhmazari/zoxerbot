/**
 * Zoxer Bot - WhatsApp Bot
 * Multi-device pairing command
 */

const { channelInfo } = require('../lib/messageConfig');
const isOwnerOrSudo = require('../lib/isOwner');

/**
 * Handle .pair command
 * @param {object} sock - Baileys socket instance
 * @param {string} chatId - Target chat JID
 * @param {object} message - Incoming Baileys message object
 * @param {string[]|string} args - Phone number argument(s)
 */
async function pairCommand(sock, chatId, message, args = []) {
    try {
        const rawInput = (Array.isArray(args) ? args.join(' ') : String(args || '')).trim();
        const phoneNumber = rawInput.replace(/[^0-9]/g, '');

        if (!phoneNumber) {
            return await sock.sendMessage(chatId, {
                text: '⚠️ *Please provide a WhatsApp phone number with country code.*\n\n*Usage:* `.pair <number>`\n*Example:* `.pair 923232391033`',
                ...channelInfo
            }, { quoted: message });
        }

        if (phoneNumber.length < 10 || phoneNumber.length > 15) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Invalid phone number length!* Please enter your full number including country code (10-15 digits).\n\n*Example:* `.pair 923232391033`',
                ...channelInfo
            }, { quoted: message });
        }

        // Verify if number exists on WhatsApp
        try {
            const check = await sock.onWhatsApp(phoneNumber + '@s.whatsapp.net');
            if (check && check.length > 0 && !check[0]?.exists) {
                return await sock.sendMessage(chatId, {
                    text: `❌ *The number +${phoneNumber} is not registered on WhatsApp!* Please verify the number and try again.`,
                    ...channelInfo
                }, { quoted: message });
            }
        } catch (e) {
            // Ignore onWhatsApp check error if network glitch
        }

        // Send initial progress message
        await sock.sendMessage(chatId, {
            text: `⏳ *Requesting pairing code for +${phoneNumber}...*\nPlease wait a few seconds.`,
            ...channelInfo
        }, { quoted: message });

        const senderId = message.key.participant || message.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);

        const { requestPairingCode, pairingCodesStore, sessionStates } = require('../lib/baileys-helper');

        // Reset any existing pairing code in store
        pairingCodesStore.delete(phoneNumber);

        // Check if session is already active
        if (sessionStates.get(phoneNumber) === 'CONNECTED') {
            return await sock.sendMessage(chatId, {
                text: `✅ *The number +${phoneNumber} is already connected and active!*`,
                ...channelInfo
            }, { quoted: message });
        }

        // Initiate pairing code request
        await requestPairingCode(phoneNumber, isOwner);

        // Poll for pairing code with a 20-second timeout
        let realCode = null;
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 1000));
            realCode = pairingCodesStore.get(phoneNumber);
            if (realCode || sessionStates.get(phoneNumber) === 'CONNECTED') break;
        }

        if (realCode) {
            const formattedMsg =
                `┏━━〔 *PAIRING CODE* 〕━━┓
┃ 📱 *Number:* +${phoneNumber}
┃ 🔑 *Code:* *${realCode}*
┗━━━━━━━━━━━━━━━━━┛

*How to Link:*
1. Open WhatsApp on *+${phoneNumber}*
2. Tap *Settings* > *Linked Devices*
3. Tap *Link with phone number instead*
4. Enter the code *${realCode}* above.

⏱️ _This code will expire in 2 minutes._`;

            return await sock.sendMessage(chatId, {
                text: formattedMsg,
                ...channelInfo
            }, { quoted: message });
        } else if (sessionStates.get(phoneNumber) === 'CONNECTED') {
            return await sock.sendMessage(chatId, {
                text: `✅ *Successfully connected +${phoneNumber}!*`,
                ...channelInfo
            }, { quoted: message });
        } else {
            throw new Error('Timed out waiting for pairing code from WhatsApp. Please try again.');
        }

    } catch (error) {
        console.error('❌ [PAIR COMMAND ERROR]:', error);
        await sock.sendMessage(chatId, {
            text: `❌ *Pairing Failed:* ${error.message || 'An error occurred. Please try again.'}`,
            ...channelInfo
        }, { quoted: message });
    }
}

module.exports = pairCommand;

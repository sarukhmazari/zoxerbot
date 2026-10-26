const { setAntilink, getAntilink, removeAntilink } = require('../lib/index');

const prefix = '.';

// Matches http(s):// links, www. links, and bare domains with common TLDs
// (also when attached to text, e.g. "helloinstagram.comworld")
const LINK_REGEX = new RegExp(
    '(?:https?:\\/\\/|www\\.)\\S+' +
    '|\\b[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:com|net|org|io|me|co|in|pk|info|xyz|site|online|app|dev|link|live|shop|store|tv|gg|ly|to|cc|us|uk|ru|top|club|vip|biz|ai|fun|tk|ml|ga|cf|gq|bio|page|cloud|click|ws|im)\\b(?:\\/\\S*)?',
    'i'
);

const num = (jid = '') => String(jid).split('@')[0].split(':')[0];

async function getAdminInfo(sock, chatId, senderId) {
    const meta = await sock.groupMetadata(chatId);
    const botIds = [sock.user?.id, sock.user?.lid].filter(Boolean).map(num);
    const senderNum = num(senderId);

    let isSenderAdmin = false;
    let isBotAdmin = false;

    for (const p of meta.participants) {
        if (!p.admin) continue;
        const ids = [p.id, p.jid, p.lid].filter(Boolean).map(num);
        if (ids.includes(senderNum)) isSenderAdmin = true;
        if (ids.some(i => botIds.includes(i))) isBotAdmin = true;
    }
    return { isSenderAdmin, isBotAdmin };
}

function extractText(message, userMessage) {
    const m = message?.message || {};
    const parts = [
        userMessage,
        m.conversation,
        m.extendedTextMessage?.text,
        m.extendedTextMessage?.matchedText,
        m.imageMessage?.caption,
        m.videoMessage?.caption,
        m.documentMessage?.caption,
    ];
    return parts.filter(Boolean).join(' ');
}

async function handleAntilinkCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message) {
    try {
        if (!isSenderAdmin) {
            await sock.sendMessage(chatId, { text: '```For Group Admins Only!```' }, { quoted: message });
            return;
        }

        const args = userMessage.slice(9).toLowerCase().trim().split(/\s+/);
        const action = args[0];

        if (!action) {
            const usage = `╭─ *🛡️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞*
┃
┃  ◈ *𝗧𝗨𝗥𝗡 𝗢𝗡*
┃  ◆ *.antilink on*
┃  ◈ *𝗧𝗨𝗥𝗡 𝗢𝗙𝗙*
┃  ◆ *.antilink off*
┃  ◈ *𝗦𝗘𝗧 𝗔𝗖𝗧𝗜𝗢𝗡*
┃  ◆ *.antilink set delete | kick | warn*
┃  ◈ *𝗩𝗜𝗘𝗪 𝗖𝗢𝗡𝗙𝗜𝗚*
┃  ◆ *.antilink get*
┃
╰───────────────`;
            await sock.sendMessage(chatId, { text: usage }, { quoted: message });
            return;
        }

        switch (action) {
            case 'on': {
                const existing = await getAntilink(chatId, 'on');
                if (existing?.enabled) {
                    await sock.sendMessage(chatId, { text: '*_Antilink is already on_*' }, { quoted: message });
                    return;
                }
                // Default action = kick (link aate hi user remove)
                const result = await setAntilink(chatId, 'on', 'kick');
                await sock.sendMessage(chatId, {
                    text: result
                        ? '*_Antilink has been turned ON (action: kick)_*'
                        : '*_Failed to turn on Antilink_*'
                }, { quoted: message });
                break;
            }

            case 'off':
                await removeAntilink(chatId, 'on');
                await sock.sendMessage(chatId, { text: '*_Antilink has been turned OFF_*' }, { quoted: message });
                break;

            case 'set': {
                if (args.length < 2) {
                    await sock.sendMessage(chatId, {
                        text: `*_Please specify an action: ${prefix}antilink set delete | kick | warn_*`
                    }, { quoted: message });
                    return;
                }
                const setAction = args[1];
                if (!['delete', 'kick', 'warn'].includes(setAction)) {
                    await sock.sendMessage(chatId, {
                        text: '*_Invalid action. Choose delete, kick, or warn._*'
                    }, { quoted: message });
                    return;
                }
                const setResult = await setAntilink(chatId, 'on', setAction);
                await sock.sendMessage(chatId, {
                    text: setResult
                        ? `*_Antilink action set to ${setAction}_*`
                        : '*_Failed to set Antilink action_*'
                }, { quoted: message });
                break;
            }

            case 'get': {
                const config = await getAntilink(chatId, 'on');
                const reply = `╭─ *🛡️ 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞*
┃
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *${config?.enabled ? 'Enabled (ON)' : 'Disabled (OFF)'}*
┃  ◈ *𝗔𝗖𝗧𝗜𝗢𝗡*
┃  ◆ *${(config?.action || 'delete').toUpperCase()}*
┃
╰───────────────`;
                await sock.sendMessage(chatId, { text: reply }, { quoted: message });
                break;
            }

            default:
                await sock.sendMessage(chatId, { text: `*_Use ${prefix}antilink for usage._*` }, { quoted: message });
        }
    } catch (error) {
        console.error('Error in antilink command:', error);
        await sock.sendMessage(chatId, { text: '*_Error processing antilink command_*' });
    }
}

async function handleLinkDetection(sock, chatId, message, userMessage, senderId) {
    try {
        if (!chatId.endsWith('@g.us')) return;          // sirf groups
        if (message?.key?.fromMe) return;               // bot ke apne messages

        const config = await getAntilink(chatId, 'on');
        if (!config?.enabled) return;

        const text = extractText(message, userMessage);
        if (!text || !LINK_REGEX.test(text)) return;

        const { isSenderAdmin, isBotAdmin } = await getAdminInfo(sock, chatId, senderId);

        if (isSenderAdmin) return;                      // admins ko allow
        if (!isBotAdmin) {
            console.log(`Antilink: bot is not admin in ${chatId}, cannot act.`);
            return;
        }

        const mention = { mentions: [senderId] };
        const tag = `@${num(senderId)}`;
        const act = config.action || 'kick';

        // 1) Hamesha link wala message delete
        try {
            await sock.sendMessage(chatId, {
                delete: {
                    remoteJid: chatId,
                    fromMe: false,
                    id: message.key.id,
                    participant: message.key.participant || senderId,
                },
            });
        } catch (err) {
            console.error('Antilink: failed to delete message:', err);
        }

        // 2) Action
        if (act === 'kick') {
            try {
                await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
                const kickAlert = `╭─ *🚨 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞 𝗔𝗟𝗘𝗥𝗧*
┃
┃  ◈ *𝗨𝗦𝗘𝗥 𝗥𝗘𝗠𝗢𝗩𝗘𝗗*
┃  ◆ *${tag}*
┃  ◈ *𝗩𝗜𝗢𝗟𝗔𝗧𝗜𝗢𝗡*
┃  ◆ *Posting prohibited links.*
┃
╰───────────────`;
                await sock.sendMessage(chatId, {
                    text: kickAlert,
                    ...mention,
                });
            } catch (err) {
                console.error('Antilink: failed to kick user:', err);
            }
        } else {
            // delete / warn
            const warnAlert = `╭─ *⚠️ 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞 𝗪𝗔𝗥𝗡𝗜𝗡𝗚*
┃
┃  ◈ *𝗪𝗔𝗥𝗡𝗘𝗗 𝗨𝗦𝗘𝗥*
┃  ◆ *${tag}*
┃  ◈ *𝗩𝗜𝗢𝗟𝗔𝗧𝗜𝗢𝗡*
┃  ◆ *Sharing links is strictly prohibited in this group.*
┃
╰───────────────`;
            await sock.sendMessage(chatId, {
                text: warnAlert,
                ...mention,
            });
        }
    } catch (error) {
        console.error('Error in handleLinkDetection:', error);
    }
}

module.exports = {
    handleAntilinkCommand,
    handleLinkDetection,
};
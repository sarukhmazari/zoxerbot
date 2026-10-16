const { jidNormalizedUser } = require('@whiskeysockets/baileys');

async function resolveProfileJid(sock, message) {
    const context = message.message?.extendedTextMessage?.contextInfo || {};
    const directJid = context.participant || context.mentionedJid?.[0] || message.key?.participant || message.key?.remoteJid;
    if (!directJid) return null;

    const normalized = jidNormalizedUser(directJid);
    if (!normalized) return null;

    const candidates = new Set([
        normalized,
        normalized.replace(/@lid$/i, '@s.whatsapp.net'),
        normalized.replace(/@s\.whatsapp\.net$/i, '@lid'),
        normalized.includes('@') ? normalized : `${normalized}@s.whatsapp.net`
    ]);

    for (const candidate of candidates) {
        if (candidate && candidate.includes('@')) return candidate;
    }
    return normalized;
}

async function dpCommand(sock, chatId, message) {
    try {
        const jid = await resolveProfileJid(sock, message);
        if (!jid) {
            return await sock.sendMessage(chatId, { text: '❌ Could not determine user JID.' }, { quoted: message });
        }

        let ppUrl = null;
        const profileFetchers = [
            () => sock.profilePictureUrl?.(jid, 'image'),
            () => sock.profilePictureUrl?.(jid),
            () => sock.getProfilePicture?.(jid),
            () => sock.getUserProfilePicture?.(jid)
        ];

        for (const fetcher of profileFetchers) {
            try {
                ppUrl = await fetcher();
                if (ppUrl) break;
            } catch (e) {
                ppUrl = null;
            }
        }

        if (!ppUrl) {
            return await sock.sendMessage(chatId, {
                text: '❌ This user does not have a profile picture or their privacy settings prevent me from seeing it.'
            }, { quoted: message });
        }

        const imageResponse = await fetch(ppUrl);
        if (!imageResponse.ok) {
            throw new Error(`Profile fetch failed with status ${imageResponse.status}`);
        }

        const buffer = Buffer.from(await imageResponse.arrayBuffer());
        await sock.sendMessage(chatId, {
            image: buffer,
            caption: `📸 Profile Picture of @${jid.split('@')[0]}`,
            contextInfo: {
                ...(global.channelInfo?.contextInfo || {}),
                mentionedJid: [jid]
            }
        }, { quoted: message });

    } catch (error) {
        console.error('DP Command Error:', error);
        await sock.sendMessage(chatId, { text: '❌ Could not fetch profile picture. It might be private or the user has no DP.' }, { quoted: message });
    }
}

module.exports = dpCommand;

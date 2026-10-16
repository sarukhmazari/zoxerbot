const { isJidGroup } = require('@whiskeysockets/baileys');
const { getAntilink, incrementWarningCount, resetWarningCount, isSudo } = require('../lib/index');
const settings = require('../settings');

const WARN_LIMIT = 3;
const URL_REGEX = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s]*)?/i;

function extractText(message) {
    let content = message?.message || {};
    while (
        content.ephemeralMessage?.message ||
        content.viewOnceMessage?.message ||
        content.viewOnceMessageV2?.message ||
        content.viewOnceMessageV2Extension?.message ||
        content.documentWithCaptionMessage?.message
    ) {
        content = content.ephemeralMessage?.message ||
                  content.viewOnceMessage?.message ||
                  content.viewOnceMessageV2?.message ||
                  content.viewOnceMessageV2Extension?.message ||
                  content.documentWithCaptionMessage?.message || {};
    }

    return content.conversation ||
           content.extendedTextMessage?.text ||
           content.imageMessage?.caption ||
           content.videoMessage?.caption ||
           content.documentMessage?.caption || '';
}

function participantIds(participant) {
    return [participant?.id, participant?.jid, participant?.lid, participant?.phoneNumber]
        .filter(Boolean)
        .map(value => String(value).split('@')[0].split(':')[0]);
}

function matchesParticipant(participant, identifiers) {
    return participantIds(participant).some(id => identifiers.has(id));
}

function isAdmin(participant) {
    return participant?.admin === 'admin' || participant?.admin === 'superadmin';
}

function isBotOwner(senderId) {
    const ownerNumbers = settings.ownerNumbers || [settings.ownerNumber];
    const senderNumber = String(senderId || '').split(':')[0].split('@')[0];
    return ownerNumbers.some(number => String(number || '').replace(/[^0-9]/g, '') === senderNumber);
}

async function Antilink(message, sock) {
    try {
        const chatId = message?.key?.remoteJid;
        if (!chatId || !isJidGroup(chatId) || message.key.fromMe) return;

        const text = extractText(message);
        if (!text || !URL_REGEX.test(text)) return;

        const sender = message.key.participant || chatId;
        if (!sender || isBotOwner(sender) || await isSudo(sender)) return;

        const config = await getAntilink(chatId, 'on');
        if (!config?.enabled) return;

        const metadata = await sock.groupMetadata(chatId);
        const participants = metadata.participants || [];
        const botIds = new Set(participantIds({ id: sock.user?.id, lid: sock.user?.lid }));
        const senderIds = new Set(participantIds({ id: sender }));
        const bot = participants.find(participant => matchesParticipant(participant, botIds));
        const senderParticipant = participants.find(participant => matchesParticipant(participant, senderIds));

        if (isAdmin(senderParticipant) || !isAdmin(bot)) return;

        try {
            await sock.sendMessage(chatId, { delete: message.key });
        } catch (error) {
            console.error('Antilink: failed to delete message:', error.message || error);
        }

        const senderTag = `@${String(sender).split('@')[0]}`;
        const mentions = [sender];
        const action = config.action || 'delete';

        if (action === 'kick') {
            try {
                await sock.groupParticipantsUpdate(chatId, [sender], 'remove');
                await sock.sendMessage(chatId, {
                    text: `⛔ ${senderTag} removed for posting a link.`,
                    mentions
                });
            } catch (error) {
                console.error('Antilink: failed to kick user:', error.message || error);
            }
            return;
        }

        if (action === 'warn') {
            const warnings = await incrementWarningCount(chatId, sender);
            if (warnings >= WARN_LIMIT) {
                try {
                    await sock.groupParticipantsUpdate(chatId, [sender], 'remove');
                    await resetWarningCount(chatId, sender);
                    await sock.sendMessage(chatId, {
                        text: `⛔ ${senderTag} removed after ${WARN_LIMIT} link warnings.`,
                        mentions
                    });
                } catch (error) {
                    console.error('Antilink: failed to kick user after warnings:', error.message || error);
                }
                return;
            }

            await sock.sendMessage(chatId, {
                text: `⚠️ ${senderTag} links are not allowed. Warning ${warnings}/${WARN_LIMIT}.`,
                mentions
            });
            return;
        }

        await sock.sendMessage(chatId, {
            text: `⚠️ ${senderTag} links are not allowed.`,
            mentions
        });
    } catch (error) {
        console.error('Antilink error:', error.message || error);
    }
}

module.exports = { Antilink };
const { setAdminlock, getAdminlock } = require('../lib/index');
const settings = require('../settings');
const fs = require('fs');
const path = require('path');

async function adminlockCommand(sock, chatId, senderId, args, message) {
    try {
        const ownerNumbers = settings.ownerNumbers || [settings.ownerNumber];
        const senderNumber = senderId.split('@')[0].split(':')[0];
        const isOwner = ownerNumbers.some(num => num.replace(/[^0-9]/g, '') === senderNumber.replace(/[^0-9]/g, ''));

        if (!isOwner && !message.key.fromMe) {
            await sock.sendMessage(chatId, { text: '❌ This command can only be used by the Bot Owner.' }, { quoted: message });
            return;
        }

        const action = args[0]?.toLowerCase();
        if (action === 'on') {
            await setAdminlock(chatId, true);
            const text = `╭─ *🛡️ 𝗔𝗗𝗠𝗜𝗡 𝗟𝗢𝗖𝗞*
┃
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Enabled (ON)*
┃  ◈ *𝗣𝗥𝗢𝗧𝗘𝗖𝗧𝗜𝗢𝗡*
┃  ◆ *Active: Unauthorized promotions will be reversed immediately.*
┃
╰───────────────`;
            await sock.sendMessage(chatId, { text }, { quoted: message });
        } else if (action === 'off') {
            await setAdminlock(chatId, false);
            const text = `╭─ *🛡️ 𝗔𝗗𝗠𝗜𝗡 𝗟𝗢𝗖𝗞*
┃
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Disabled (OFF)*
┃  ◈ *𝗣𝗥𝗢𝗧𝗘𝗖𝗧𝗜𝗢𝗡*
┃  ◆ *Inactive: Promotion restrictions are turned off.*
┃
╰───────────────`;
            await sock.sendMessage(chatId, { text }, { quoted: message });
        } else {
            const status = await getAdminlock(chatId);
            const text = `╭─ *🛡️ 𝗔𝗗𝗠𝗜𝗡 𝗟𝗢𝗖𝗞*
┃
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *${status ? 'Enabled (ON)' : 'Disabled (OFF)'}*
┃  ◈ *𝗨𝗦𝗔𝗚𝗘*
┃  ◆ *.adminlock on  |  .adminlock off*
┃
╰───────────────`;
            await sock.sendMessage(chatId, { text }, { quoted: message });
        }
    } catch (error) {
        console.error('Error in adminlock command:', error);
    }
}

async function handleAdminlockPromotion(sock, groupId, participants, author) {
    try {
        const isEnabled = await getAdminlock(groupId);
        if (!isEnabled) return;

        const normalizeJid = (jid) => {
            if (!jid) return "";
            if (typeof jid === 'string') return jid.split(':')[0];
            return (jid.id || jid.toString() || "").split(':')[0];
        };

        const authorJid = normalizeJid(author);
        if (!authorJid) return;

        const getPhone = (jid) => {
            const jidStr = normalizeJid(jid);
            if (!jidStr) return "";
            return jidStr.split('@')[0].replace(/[^0-9]/g, '');
        };

        const authorPhone = getPhone(authorJid);

        // Build Authorized Numbers
        const authorized = new Set();
        authorized.add(settings.ownerNumber.replace(/[^0-9]/g, ''));
        if (Array.isArray(settings.ownerNumbers)) {
            settings.ownerNumbers.forEach(n => authorized.add(n.replace(/[^0-9]/g, '')));
        }
        
        // Add current bot instance IDs
        authorized.add(getPhone(sock.user.id));
        if (sock.user.lid) authorized.add(getPhone(sock.user.lid));
        
        try {
            const meta = await sock.groupMetadata(groupId);
            authorized.add(getPhone(meta.owner || meta.subjectOwner));
        } catch (e) {}

        // IF PROMOTER IS AUTHORIZED -> EXIT (No demotion)
        // We check phone match AND explicit JID match for bot safety
        if (authorized.has(authorPhone) || authorJid === normalizeJid(sock.user.id) || (sock.user.lid && authorJid === normalizeJid(sock.user.lid))) {
            return;
        }

        const demoteSet = new Set();
        
        // 1. Promoter (author)
        demoteSet.add(authorJid);

        // 2. Targets (participants)
        participants.forEach(p => {
            const targetJid = normalizeJid(p);
            if (targetJid && !authorized.has(getPhone(targetJid))) {
                demoteSet.add(targetJid);
            }
        });

        // Final Filter: Hard protection for bot/owners
        const demoteList = Array.from(demoteSet).filter(jid => {
            if (!jid) return false;
            const phone = getPhone(jid);
            if (authorized.has(phone)) return false; // Never demote phone-recognized owner
            if (jid === normalizeJid(sock.user.id)) return false; // Never demote bot JID
            if (sock.user.lid && jid === normalizeJid(sock.user.lid)) return false; // Never demote bot LID
            return jid.length > 5;
        });

        if (demoteList.length > 0) {
            console.log(`🚨 [ADMINLOCK] Demoting (Author: ${authorJid}):`, demoteList);
            
            await sock.groupParticipantsUpdate(groupId, demoteList, 'demote');
            
            const alertText = `╭─ *🚨 𝗔𝗗𝗠𝗜𝗡 𝗟𝗢𝗖𝗞 𝗔𝗟𝗘𝗥𝗧*
┃
┃  ◈ *𝗩𝗜𝗢𝗟𝗔𝗧𝗜𝗢𝗡*
┃  ◆ *Unauthorized promotion detected!*
┃  ◈ *𝗔𝗖𝗧𝗜𝗢𝗡 𝗧𝗔𝗞𝗘𝗡*
┃  ◆ *Promoter @${authorPhone} and targets demoted.*
┃
╰───────────────`;
            await sock.sendMessage(groupId, { 
                text: alertText,
                mentions: demoteList.filter(j => j.includes('@'))
            });
        }
    } catch (error) {
        console.error('Error in handleAdminlockPromotion:', error);
    }
}

module.exports = { adminlockCommand, handleAdminlockPromotion };

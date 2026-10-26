const { setAntiBadword, getAntiBadword, removeAntiBadword, incrementWarningCount, resetWarningCount } = require('../lib/index');

function getParticipantIds(participant) {
    return [participant?.id, participant?.lid, participant?.phoneNumber]
        .filter(Boolean)
        .map(jid => String(jid).split('@')[0].split(':')[0]);
}

function participantMatches(participant, identifiers) {
    const participantIds = getParticipantIds(participant);
    return participantIds.some(id => identifiers.has(id));
}

async function handleAntiBadwordCommand(sock, chatId, message, match) {
    if (!match) {
        const usage = `╭─ *🤬 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜𝗕𝗔𝗗𝗪𝗢𝗥𝗗*
┃
┃  ◈ *𝗧𝗨𝗥𝗡 𝗢𝗡*
┃  ◆ *.antibadword on*
┃  ◈ *𝗧𝗨𝗥𝗡 𝗢𝗙𝗙*
┃  ◆ *.antibadword off*
┃  ◈ *𝗦𝗘𝗧 𝗔𝗖𝗧𝗜𝗢𝗡*
┃  ◆ *.antibadword set delete | kick | warn*
┃
╰───────────────`;
        return sock.sendMessage(chatId, { text: usage }, { quoted: message });
    }

    if (match === 'on') {
        const existingConfig = await getAntiBadword(chatId, 'on');
        if (existingConfig?.enabled) {
            return sock.sendMessage(chatId, { text: '*AntiBadword is already enabled for this group*' });
        }
        await setAntiBadword(chatId, 'on', 'delete');
        const text = `╭─ *🤬 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜𝗕𝗔𝗗𝗪𝗢𝗥𝗗*
┃
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Enabled (ON)*
┃  ◈ *𝗔𝗖𝗧𝗜𝗢𝗡*
┃  ◆ *DELETE (Default)*
┃  ◈ *𝗖𝗨𝗦𝗧𝗢𝗠𝗜𝗭𝗘*
┃  ◆ *.antibadword set delete | kick | warn*
┃
╰───────────────`;
        return sock.sendMessage(chatId, { text }, { quoted: message });
    }

    if (match === 'off') {
        const config = await getAntiBadword(chatId, 'on');
        if (!config?.enabled) {
            return sock.sendMessage(chatId, { text: '*AntiBadword is already disabled for this group*' }, { quoted: message } );
        }
        await removeAntiBadword(chatId);
        const text = `╭─ *🤬 𝗭𝗢𝗫𝗘𝗥 𝗔𝗡𝗧𝗜𝗕𝗔𝗗𝗪𝗢𝗥𝗗*
┃
┃  ◈ *𝗦𝗧𝗔𝗧𝗨𝗦*
┃  ◆ *Disabled (OFF)*
┃
╰───────────────`;
        return sock.sendMessage(chatId, { text }, { quoted: message } );
    }

    if (match.startsWith('set')) {
        const action = match.split(' ')[1];
        if (!action || !['delete', 'kick', 'warn'].includes(action)) {
            return sock.sendMessage(chatId, { text: '*Invalid action. Choose: delete, kick, or warn*' }, { quoted: message } );
        }
        await setAntiBadword(chatId, 'on', action);
        return sock.sendMessage(chatId, { text: `*AntiBadword action set to: ${action}*` }, { quoted: message } );
    }

    return sock.sendMessage(chatId, { text: '*Invalid command. Use .antibadword to see usage*' }, { quoted: message } );
}

async function handleBadwordDetection(sock, chatId, message, userMessage, senderId) {
    // Skip if not group
    if (!chatId?.endsWith('@g.us')) return false;

    // Skip if message is from bot
    if (message.key.fromMe) return false;

    // Get antibadword config first
    const antiBadwordConfig = await getAntiBadword(chatId, 'on');
    if (!antiBadwordConfig?.enabled) {
        return false;
    }

    // Convert message to lowercase and clean it
    const cleanMessage = userMessage.toLowerCase()
        .replace(/[^\w\s]/g, ' ')  // Replace special chars with space
        .replace(/\s+/g, ' ')      // Replace multiple spaces with single space
        .trim();

    // List of bad words
    const badWords = [
        'gandu', 'madarchod', 'bhosdike', 'bsdk', 'fucker', 'bhosda', 
        'lauda', 'laude', 'betichod', 'chutiya', 'maa ki chut', 'behenchod', 
        'behen ki chut', 'tatto ke saudagar', 'machar ki jhant', 'jhant ka baal', 
        'randi', 'chuchi', 'boobs', 'boobies', 'tits', 'idiot', 'nigga', 'fuck', 
        'dick', 'bitch', 'bastard', 'asshole', 'asu', 'awyu', 'teri ma ki chut', 
        'teri maa ki', 'lund', 'lund ke baal', 'mc', 'lodu', 'benchod',
    
        // Additional offensive words
        'shit', 'damn', 'hell', 'piss', 'crap', 'bastard', 'slut', 'whore', 'prick',
        'motherfucker', 'cock', 'cunt', 'pussy', 'twat', 'wanker', 'douchebag', 'jackass', 
        'moron', 'retard', 'scumbag', 'skank', 'slutty', 'arse', 'bugger', 'sod off',
    
        'chut', 'laude ka baal', 'madar', 'behen ke lode', 'chodne', 'sala kutta',
        'harami', 'randi ki aulad', 'gaand mara', 'chodu', 'lund le', 'gandu saala',
        'kameena', 'haramzada', 'chamiya', 'chodne wala', 'chudai', 'chutiye ke baap',
    
        'fck', 'fckr', 'fcker', 'fuk', 'fukk', 'fcuk', 'btch', 'bch', 'bsdk', 'f*ck','assclown',
        'a**hole', 'f@ck', 'b!tch', 'd!ck', 'n!gga', 'f***er', 's***head', 'a$$', 'l0du', 'lund69',
    
        'spic', 'chink', 'cracker', 'towelhead', 'gook', 'kike', 'paki', 'honky', 
        'wetback', 'raghead', 'jungle bunny', 'sand nigger', 'beaner',
    
        'blowjob', 'handjob', 'cum', 'cumshot', 'jizz', 'deepthroat', 'fap', 
        'hentai', 'MILF', 'anal', 'orgasm', 'dildo', 'vibrator', 'gangbang', 
        'threesome', 'porn', 'sex', 'xxx',
    
        'fag', 'faggot', 'dyke', 'tranny', 'homo', 'sissy', 'fairy', 'lesbo',
    
        'weed', 'pot', 'coke', 'heroin', 'meth', 'crack', 'dope', 'bong', 'kush', 
        'hash', 'trip', 'rolling'
    ];
    
    // Split message into words
    const messageWords = cleanMessage.split(' ');
    let containsBadWord = false;

    // Check for exact word matches only
    for (const word of messageWords) {
        // Skip empty words or very short words
        if (word.length < 2) continue;

        // Check if this word exactly matches any bad word
        if (badWords.includes(word)) {
            containsBadWord = true;
            break;
        }

        // Also check for multi-word bad words
        for (const badWord of badWords) {
            if (badWord.includes(' ')) {  // Multi-word bad phrase
                if (cleanMessage.includes(badWord)) {
                    containsBadWord = true;
                    break;
                }
            }
        }
        if (containsBadWord) break;
    }

    if (!containsBadWord) return false;

   // console.log('Bad word detected in:', userMessage);

    // Check if bot is admin before taking action
    const groupMetadata = await sock.groupMetadata(chatId);
    const participants = groupMetadata.participants || [];
    const botIdentifiers = new Set(getParticipantIds({ id: sock.user?.id, lid: sock.user?.lid }));
    const bot = participants.find(participant => participantMatches(participant, botIdentifiers));
    if (bot?.admin !== 'admin' && bot?.admin !== 'superadmin') return false;

    const senderIdentifiers = new Set(getParticipantIds({ id: senderId }));
    const participant = participants.find(item => participantMatches(item, senderIdentifiers));
    if (participant?.admin === 'admin' || participant?.admin === 'superadmin') return false;

    // Delete message immediately
    try {
        await sock.sendMessage(chatId, { 
            delete: message.key
        });
        //console.log('Message deleted successfully');
    } catch (err) {
        console.error('Error deleting message:', err);
        return false;
    }

    // Take action based on config
    switch (antiBadwordConfig.action) {
        case 'delete':
            await sock.sendMessage(chatId, {
                text: `*@${senderId.split('@')[0]} bad words are not allowed here*`,
                mentions: [senderId]
            });
            break;

        case 'kick':
            try {
                await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
                await sock.sendMessage(chatId, {
                    text: `*@${senderId.split('@')[0]} has been kicked for using bad words*`,
                    mentions: [senderId]
                });
            } catch (error) {
                console.error('Error kicking user:', error);
            }
            break;

        case 'warn':
            const warningCount = await incrementWarningCount(chatId, senderId);
            if (warningCount >= 3) {
                try {
                    await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
                    await resetWarningCount(chatId, senderId);
                    await sock.sendMessage(chatId, {
                        text: `*@${senderId.split('@')[0]} has been kicked after 3 warnings*`,
                        mentions: [senderId]
                    });
                } catch (error) {
                    console.error('Error kicking user after warnings:', error);
                }
            } else {
                await sock.sendMessage(chatId, {
                    text: `*@${senderId.split('@')[0]} warning ${warningCount}/3 for using bad words*`,
                    mentions: [senderId]
                });
            }
            break;
    }

    return true;
}

module.exports = {
    handleAntiBadwordCommand,
    handleBadwordDetection
}; 
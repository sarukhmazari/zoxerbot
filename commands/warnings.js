const fs = require('fs');
const path = require('path');

const warningsFilePath = path.join(__dirname, '../data/warnings.json');

function loadWarnings() {
    if (!fs.existsSync(warningsFilePath)) {
        fs.writeFileSync(warningsFilePath, JSON.stringify({}), 'utf8');
    }
    const data = fs.readFileSync(warningsFilePath, 'utf8');
    return JSON.parse(data);
}

async function warningsCommand(sock, chatId, mentionedJidList) {
    const warnings = loadWarnings();

    if (mentionedJidList.length === 0) {
        await sock.sendMessage(chatId, { text: 'Please mention a user to check warnings.' });
        return;
    }

    const userToCheck = mentionedJidList[0];
    const userClean = userToCheck.split('@')[0].split(':')[0];
    const warningCount = warnings[userToCheck] || 0;

    const reply = `╭─ *⚠️ 𝗨𝗦𝗘𝗥 𝗪𝗔𝗥𝗡𝗜𝗡𝗚𝗦*
┃
┃  ◈ *𝗨𝗦𝗘𝗥*
┃  ◆ *@${userClean}*
┃  ◈ *𝗦𝗧𝗥𝗜𝗞𝗘𝗦*
┃  ◆ *${warningCount} / 3*
┃
╰───────────────`;

    await sock.sendMessage(chatId, { text: reply, mentions: [userToCheck] });
}

module.exports = warningsCommand;

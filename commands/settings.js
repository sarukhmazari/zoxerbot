const fs = require('fs');

function readJsonSafe(path, fallback) {
    try {
        const txt = fs.readFileSync(path, 'utf8');
        return JSON.parse(txt);
    } catch (_) {
        return fallback;
    }
}

const {
    getSessionPhone,
    isSessionOwner,
    getBotMode,
    getAutoStatusConfig,
    getAutoReactConfig,
    getStealthConfig,
    getAutoJoinLinksConfig,
    getAutoReadConfig,
    getAutoTypingConfig,
    getAntiCallConfig,
    getPmBlockerConfig
} = require('../lib/session-settings');

async function settingsCommand(sock, chatId, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const isOwner = isSessionOwner(sock, senderId, message);
        
        if (!message.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, { text: 'Only session owner can use this command!' }, { quoted: message });
            return;
        }

        const isGroup = chatId.endsWith('@g.us');
        const sessionPhone = getSessionPhone(sock);
        const dataDir = './data';

        const mode = getBotMode(sock);
        const autoStatus = getAutoStatusConfig(sock);
        const autoReact = getAutoReactConfig(sock);
        const stealth = getStealthConfig(sock);
        const autojoinlinks = getAutoJoinLinksConfig(sock);
        const autoread = getAutoReadConfig(sock);
        const autotyping = getAutoTypingConfig(sock);
        const pmblocker = getPmBlockerConfig(sock);
        const anticall = getAntiCallConfig(sock);

        const userGroupData = readJsonSafe(`${dataDir}/userGroupData.json`, {
            antilink: {}, antibadword: {}, welcome: {}, goodbye: {}, chatbot: {}, antitag: {}
        });

        // Per-group features
        const groupId = isGroup ? chatId : null;
        const antilinkOn = groupId ? Boolean(userGroupData.antilink && userGroupData.antilink[groupId]) : false;
        const antibadwordOn = groupId ? Boolean(userGroupData.antibadword && userGroupData.antibadword[groupId]) : false;
        const welcomeOn = groupId ? Boolean(userGroupData.welcome && userGroupData.welcome[groupId]) : false;
        const goodbyeOn = groupId ? Boolean(userGroupData.goodbye && userGroupData.goodbye[groupId]) : false;
        const chatbotOn = groupId ? Boolean(userGroupData.chatbot && userGroupData.chatbot[groupId]) : false;
        const antitagCfg = groupId ? (userGroupData.antitag && userGroupData.antitag[groupId]) : null;
        const antiforeignCfg = groupId ? (userGroupData.antiforeign && userGroupData.antiforeign[groupId]) : null;

        const lines = [];
        lines.push('╭─ *⚙️ 𝗭𝗢𝗫𝗘𝗥 𝗦𝗘𝗧𝗧𝗜𝗡𝗚𝗦*');
        lines.push('┃');
        lines.push(`┣─〔 ◈ 𝗦𝗘𝗦𝗦𝗜𝗢𝗡: ${sessionPhone} 〕`);
        lines.push(`┃  ◈ *Mode:* ${mode.isPublic ? 'Public' : 'Private (Default)'}`);
        lines.push(`┃  ◈ *Auto Status:* ${autoStatus.enabled ? 'ON' : 'OFF (Default)'}`);
        lines.push(`┃  ◈ *Auto React:* ${(autoReact.autoreact_dm || autoReact.enabledGroups.length > 0) ? 'ON' : 'OFF (Default)'}`);
        lines.push(`┃  ◈ *Stealth Mode:* ${stealth.enabled ? 'ON' : 'OFF (Default)'}`);
        lines.push(`┃  ◈ *Auto Join Links:* ${autojoinlinks.enabled ? 'ON' : 'OFF (Default)'}`);
        lines.push(`┃  ◈ *Autoread:* ${autoread.enabled ? 'ON' : 'OFF'}`);
        lines.push(`┃  ◈ *Autotyping:* ${autotyping.enabled ? 'ON' : 'OFF'}`);
        lines.push(`┃  ◈ *PM Blocker:* ${pmblocker.enabled ? 'ON' : 'OFF'}`);
        lines.push(`┃  ◈ *Anticall:* ${anticall.enabled ? 'ON' : 'OFF'}`);
        if (groupId) {
            lines.push('┃');
            lines.push('┣─〔 ◈ 𝗚𝗥𝗢𝗨𝗣 𝗖𝗢𝗡𝗙𝗜𝗚 〕');
            if (antilinkOn) {
                const al = userGroupData.antilink[groupId];
                lines.push(`┃  ◈ *Antilink:* ON (${al.action || 'delete'})`);
            } else {
                lines.push('┃  ◈ *Antilink:* OFF');
            }
            if (antibadwordOn) {
                const ab = userGroupData.antibadword[groupId];
                lines.push(`┃  ◈ *Antibadword:* ON (${ab.action || 'delete'})`);
            } else {
                lines.push('┃  ◈ *Antibadword:* OFF');
            }
            lines.push(`┃  ◈ *Welcome:* ${welcomeOn ? 'ON' : 'OFF'}`);
            lines.push(`┃  ◈ *Goodbye:* ${goodbyeOn ? 'ON' : 'OFF'}`);
            lines.push(`┃  ◈ *Chatbot:* ${chatbotOn ? 'ON' : 'OFF'}`);
            if (antitagCfg && antitagCfg.enabled) {
                lines.push(`┃  ◈ *Antitag:* ON (${antitagCfg.action || 'delete'})`);
            } else {
                lines.push('┃  ◈ *Antitag:* OFF');
            }
            if (antiforeignCfg && antiforeignCfg.enabled) {
                const fMode = (antiforeignCfg.mode || 'allow').toUpperCase();
                const fCodes = fMode === 'ALLOW' ? (antiforeignCfg.allowed || ['92']).join(',') : (antiforeignCfg.blocked || []).join(',');
                lines.push(`┃  ◈ *Antiforeign:* ON (${fMode}: +${fCodes})`);
            } else {
                lines.push('┃  ◈ *Antiforeign:* OFF');
            }
        }
        lines.push('┃');
        lines.push('╰───────────────');

        await sock.sendMessage(chatId, { text: lines.join('\n') }, { quoted: message });
    } catch (error) {
        console.error('Error in settings command:', error);
        await sock.sendMessage(chatId, { text: 'Failed to read settings.' }, { quoted: message });
    }
}

module.exports = settingsCommand;



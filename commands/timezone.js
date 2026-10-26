const moment = require('moment-timezone');

async function timezoneCommand(sock, chatId, message, args) {
    try {
        const query = args.join(' ').trim().toLowerCase();

        // Common city to timezone mappings
        const cityMap = {
            'karachi': 'Asia/Karachi',
            'lahore': 'Asia/Karachi',
            'islamabad': 'Asia/Karachi',
            'dubai': 'Asia/Dubai',
            'riyadh': 'Asia/Riyadh',
            'london': 'Europe/London',
            'new york': 'America/New_York',
            'los angeles': 'America/Los_Angeles',
            'tokyo': 'Asia/Tokyo',
            'delhi': 'Asia/Kolkata',
            'mumbai': 'Asia/Kolkata',
            'sydney': 'Australia/Sydney',
            'paris': 'Europe/Paris',
            'berlin': 'Europe/Berlin',
            'toronto': 'America/Toronto',
            'singapore': 'Asia/Singapore'
        };

        let targetZone = null;

        if (!query) {
            targetZone = 'Asia/Karachi'; // Default to bot's base time
        } else if (cityMap[query]) {
            targetZone = cityMap[query];
        } else {
            // Search all available moment timezones
            const zones = moment.tz.names();
            targetZone = zones.find(z => z.toLowerCase().includes(query.replace(/\s+/g, '_')));
        }

        if (!targetZone) {
            return await sock.sendMessage(chatId, {
                text: `❌ Timezone or city *"${args.join(' ')}"* not found.\n*Examples:* \`.time Karachi\`, \`.time London\`, \`.time New York\``
            }, { quoted: message });
        }

        const now = moment().tz(targetZone);
        const timeStr = now.format('hh:mm:ss A');
        const dateStr = now.format('dddd, MMMM Do YYYY');
        const offset = now.format('Z');

        const reply = `╭─ *🕒 𝗭𝗢𝗫𝗘𝗥 𝗪𝗢𝗥𝗟𝗗 𝗖𝗟𝗢𝗖𝗞*
┃
┃  ◈ *𝗟𝗢𝗖𝗔𝗧𝗜𝗢𝗡*
┃  ◆ *${targetZone.replace('_', ' ')}*
┃  ◈ *𝗧𝗜𝗠𝗘*
┃  ◆ *${timeStr}*
┃  ◈ *𝗗𝗔𝗧𝗘*
┃  ◆ *${dateStr}*
┃  ◈ *𝗨𝗧𝗖 𝗢𝗙𝗙𝗦𝗘𝗧*
┃  ◆ *UTC ${offset}*
┃
╰───────────────`;

        await sock.sendMessage(chatId, { text: reply }, { quoted: message });

    } catch (err) {
        console.error('Error in timezoneCommand:', err);
        await sock.sendMessage(chatId, { text: `❌ Time lookup failed: ${err.message}` }, { quoted: message });
    }
}

module.exports = timezoneCommand;

async function calcCommand(sock, chatId, message, args) {
    try {
        const expression = args.join(' ').trim();
        if (!expression) {
            return await sock.sendMessage(chatId, {
                text: '⚠️ Please provide a math expression to evaluate.\n*Example:* `.calc (15 * 4) + 25`'
            }, { quoted: message });
        }

        // Strictly sanitize: only allow digits, arithmetic symbols, spaces, dots, parentheses
        const sanitized = expression.replace(/×/g, '*').replace(/÷/g, '/');
        if (!/^[0-9+\-*/().%^ ]+$/.test(sanitized)) {
            return await sock.sendMessage(chatId, {
                text: '❌ Invalid expression. Only numbers and basic arithmetic operators (+, -, *, /, %, ^) are permitted.'
            }, { quoted: message });
        }

        // Safe parser/evaluator using Function constructor with no global scope exposure
        const normalized = sanitized.replace(/\^/g, '**');
        const calculate = new Function(`'use strict'; return (${normalized})`);
        const result = calculate();

        if (typeof result !== 'number' || isNaN(result)) {
            return await sock.sendMessage(chatId, { text: '❌ Could not calculate a valid numeric result.' }, { quoted: message });
        }

        const formattedResult = Number.isInteger(result) ? result : result.toFixed(4);
        const reply = `╭─ *𝗭𝗢𝗫𝗘𝗥 𝗖𝗔𝗟𝗖𝗨𝗟𝗔𝗧𝗢𝗥*
┃
┃  ◈ *𝗘𝗫𝗣𝗥𝗘𝗦𝗦𝗜𝗢𝗡*
┃  ◆ *${expression}*
┃  ◈ *𝗥𝗘𝗦𝗨𝗟𝗧*
┃  ◆ *${formattedResult}*
┃
╰───────────────`;

        await sock.sendMessage(chatId, { text: reply }, { quoted: message });

    } catch (err) {
        await sock.sendMessage(chatId, { text: `❌ Math error: ${err.message}` }, { quoted: message });
    }
}

module.exports = calcCommand;

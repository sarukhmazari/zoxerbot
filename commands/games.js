// Local games & randomization entertainment

const riddles = [
    { q: "I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?", a: "An echo" },
    { q: "You measure my life in hours and I serve you by expiring. I'm quick when I'm thin and slow when I'm fat. The wind is my enemy. What am I?", a: "A candle" },
    { q: "I have cities, but no houses. I have mountains, but no trees. I have water, but no fish. What am I?", a: "A map" },
    { q: "What is seen in the middle of March and April that can't be seen at the beginning or end of either month?", a: "The letter 'R'" },
    { q: "You see a boat filled with people. It has not sunk, but when you look again you don't see a single person on the boat. Why?", a: "All the people were married" },
    { q: "What has many keys but can't open a single lock?", a: "A piano" },
    { q: "The more of this there is, the less you see. What is it?", a: "Darkness" },
    { q: "What has to be broken before you can use it?", a: "An egg" }
];

async function rollCommand(sock, chatId, message, args) {
    const sides = parseInt(args[0], 10) || 6;
    const result = Math.floor(Math.random() * sides) + 1;
    const text = `╭─ *🎲 𝗭𝗢𝗫𝗘𝗥 𝗗𝗜𝗖𝗘 𝗥𝗢𝗟𝗟*
┃
┃  ◈ *𝗗𝗜𝗖𝗘 𝗧𝗬𝗣𝗘*
┃  ◆ *D${sides} (1-${sides})*
┃  ◈ *𝗥𝗘𝗦𝗨𝗟𝗧*
┃  ◆ *${result}*
┃
╰───────────────`;
    await sock.sendMessage(chatId, { text }, { quoted: message });
}

async function flipCoinCommand(sock, chatId, message) {
    const isHeads = Math.random() < 0.5;
    const outcome = isHeads ? 'HEADS 🪙' : 'TAILS 🪙';
    const text = `╭─ *🪙 𝗭𝗢𝗫𝗘𝗥 𝗖𝗢𝗜𝗡 𝗙𝗟𝗜𝗣*
┃
┃  ◈ *𝗢𝗨𝗧𝗖𝗢𝗠𝗘*
┃  ◆ *${outcome}*
┃
╰───────────────`;
    await sock.sendMessage(chatId, { text }, { quoted: message });
}

async function slotsCommand(sock, chatId, message) {
    const symbols = ['🍒', '🍋', '🍇', '🍉', '⭐', '💎', '7️⃣'];
    const s1 = symbols[Math.floor(Math.random() * symbols.length)];
    const s2 = symbols[Math.floor(Math.random() * symbols.length)];
    const s3 = symbols[Math.floor(Math.random() * symbols.length)];

    const won = s1 === s2 && s2 === s3;
    const partial = s1 === s2 || s2 === s3 || s1 === s3;

    let resultMsg = won ? '🎉 JACKPOT! YOU WON! 🎉' : (partial ? '✨ Match 2! Almost there!' : '😢 Better luck next time!');

    const output = `╭─ *🎰 𝗭𝗢𝗫𝗘𝗥 𝗦𝗟𝗢𝗧𝗦*
┃
┃  ◈ *𝗥𝗘𝗘𝗟𝗦*
┃  ◆  [  ${s1}  |  ${s2}  |  ${s3}  ]
┃  ◈ *𝗥𝗘𝗦𝗨𝗟𝗧*
┃  ◆ *${resultMsg}*
┃
╰───────────────`;

    await sock.sendMessage(chatId, { text: output }, { quoted: message });
}

async function riddleCommand(sock, chatId, message) {
    const item = riddles[Math.floor(Math.random() * riddles.length)];
    const readMore = String.fromCharCode(8206).repeat(4001);

    const reply = `╭─ *🧩 𝗭𝗢𝗫𝗘𝗥 𝗥𝗜𝗗𝗗𝗟𝗘*
┃
┃  ◈ *𝗤𝗨𝗘𝗦𝗧𝗜𝗢𝗡*
┃  ◆ *${item.q}*
┃
┣─〔 ◈ 𝗔𝗡𝗦𝗪𝗘𝗥 〕
┃  ${readMore}▸ *${item.a}*
┃
╰───────────────`;

    await sock.sendMessage(chatId, { text: reply }, { quoted: message });
}

async function pickCommand(sock, chatId, message, args) {
    const input = args.join(' ').trim();
    if (!input || !input.includes(',')) {
        return await sock.sendMessage(chatId, {
            text: '⚠️ Please provide choices separated by commas.\n*Example:* `.pick Pizza, Burger, Pasta`'
        }, { quoted: message });
    }

    const options = input.split(',').map(s => s.trim()).filter(Boolean);
    if (options.length < 2) {
        return await sock.sendMessage(chatId, { text: '⚠️ Please provide at least 2 distinct choices.' }, { quoted: message });
    }

    const choice = options[Math.floor(Math.random() * options.length)];
    const text = `╭─ *🎯 𝗭𝗢𝗫𝗘𝗥 𝗣𝗜𝗖𝗞𝗘𝗥*
┃
┃  ◈ *𝗖𝗛𝗢𝗜𝗖𝗘𝗦*
┃  ◆ *${options.join('  •  ')}*
┃  ◈ *𝗦𝗘𝗟𝗘𝗖𝗧𝗜𝗢𝗡*
┃  ◆ *${choice}*
┃
╰───────────────`;
    await sock.sendMessage(chatId, { text }, { quoted: message });
}

module.exports = {
    rollCommand,
    flipCoinCommand,
    slotsCommand,
    riddleCommand,
    pickCommand
};

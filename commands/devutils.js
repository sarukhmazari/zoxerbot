const crypto = require('crypto');

async function base64Command(sock, chatId, message, args) {
    const text = args.join(' ').trim();
    if (!text) {
        return await sock.sendMessage(chatId, {
            text: '⚠️ Provide text to encode or base64 string to decode.\n*Example:* `.base64 hello` or `.base64 aGVsbG8=`'
        }, { quoted: message });
    }

    const isBase64 = /^[A-Za-z0-9+/=]+$/.test(text) && text.length % 4 === 0;
    if (isBase64) {
        try {
            const decoded = Buffer.from(text, 'base64').toString('utf8');
            const reply = `╭─ *🔓 𝗭𝗢𝗫𝗘𝗥 𝗕𝗔𝗦𝗘𝟲𝟰*
┃
┃  ◈ *𝗧𝗬𝗣𝗘*
┃  ◆ *Decoded Plain Text*
┃  ◈ *𝗢𝗨𝗧𝗣𝗨𝗧*
┃  ◆ *${decoded}*
┃
╰───────────────`;
            return await sock.sendMessage(chatId, { text: reply }, { quoted: message });
        } catch (_) {}
    }

    const encoded = Buffer.from(text, 'utf8').toString('base64');
    const reply = `╭─ *🔒 𝗭𝗢𝗫𝗘𝗥 𝗕𝗔𝗦𝗘𝟲𝟰*
┃
┃  ◈ *𝗧𝗬𝗣𝗘*
┃  ◆ *Encoded Base64 String*
┃  ◈ *𝗢𝗨𝗧𝗣𝗨𝗧*
┃  ◆ \`${encoded}\`
┃
╰───────────────`;
    await sock.sendMessage(chatId, { text: reply }, { quoted: message });
}

async function binaryCommand(sock, chatId, message, args) {
    const text = args.join(' ').trim();
    if (!text) {
        return await sock.sendMessage(chatId, {
            text: '⚠️ Provide text to encode or binary string to decode.\n*Example:* `.binary hello`'
        }, { quoted: message });
    }

    const isBinary = /^[01\s]+$/.test(text);
    if (isBinary) {
        const decoded = text.split(/\s+/).map(bin => String.fromCharCode(parseInt(bin, 2))).join('');
        const reply = `╭─ *⚙️ 𝗭𝗢𝗫𝗘𝗥 𝗕𝗜𝗡𝗔𝗥𝗬*
┃
┃  ◈ *𝗧𝗬𝗣𝗘*
┃  ◆ *Decoded Text*
┃  ◈ *𝗢𝗨𝗧𝗣𝗨𝗧*
┃  ◆ *${decoded}*
┃
╰───────────────`;
        return await sock.sendMessage(chatId, { text: reply }, { quoted: message });
    }

    const encoded = text.split('').map(c => c.charCodeAt(0).toString(2).padStart(8, '0')).join(' ');
    const reply = `╭─ *⚙️ 𝗭𝗢𝗫𝗘𝗥 𝗕𝗜𝗡𝗔𝗥𝗬*
┃
┃  ◈ *𝗧𝗬𝗣𝗘*
┃  ◆ *Encoded Binary Sequence*
┃  ◈ *𝗢𝗨𝗧𝗣𝗨𝗧*
┃  ◆ \`${encoded}\`
┃
╰───────────────`;
    await sock.sendMessage(chatId, { text: reply }, { quoted: message });
}

async function hashCommand(sock, chatId, message, args) {
    const text = args.join(' ').trim();
    if (!text) {
        return await sock.sendMessage(chatId, { text: '⚠️ Provide text to generate hashes: `.hash hello`' }, { quoted: message });
    }

    const md5 = crypto.createHash('md5').update(text).digest('hex');
    const sha1 = crypto.createHash('sha1').update(text).digest('hex');
    const sha256 = crypto.createHash('sha256').update(text).digest('hex');

    const reply = `╭─ *🔐 𝗭𝗢𝗫𝗘𝗥 𝗖𝗥𝗬𝗣𝗧𝗢 𝗛𝗔𝗦𝗛*
┃
┃  ◈ *𝗜𝗡𝗣𝗨𝗧*
┃  ◆ *${text}*
┃  ◈ *𝗠𝗗𝟱*
┃  ◆ \`${md5}\`
┃  ◈ *𝗦𝗛𝗔-𝟭*
┃  ◆ \`${sha1}\`
┃  ◈ *𝗦𝗛𝗔-𝟮𝟱𝟲*
┃  ◆ \`${sha256}\`
┃
╰───────────────`;

    await sock.sendMessage(chatId, { text: reply }, { quoted: message });
}

module.exports = {
    base64Command,
    binaryCommand,
    hashCommand
};

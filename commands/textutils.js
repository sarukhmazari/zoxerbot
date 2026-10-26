// Local text manipulation and styling utilities

const fancyFonts = {
    bold: (text) => {
        const offsetUpper = 0x1D400 - 65;
        const offsetLower = 0x1D41A - 97;
        const offsetDigit = 0x1D7CE - 48;
        return text.split('').map(c => {
            const code = c.charCodeAt(0);
            if (code >= 65 && code <= 90) return String.fromCodePoint(code + offsetUpper);
            if (code >= 97 && code <= 122) return String.fromCodePoint(code + offsetLower);
            if (code >= 48 && code <= 57) return String.fromCodePoint(code + offsetDigit);
            return c;
        }).join('');
    },
    gothic: (text) => {
        const offsetUpper = 0x1D504 - 65;
        const offsetLower = 0x1D51E - 97;
        return text.split('').map(c => {
            const code = c.charCodeAt(0);
            if (code >= 65 && code <= 90) return String.fromCodePoint(code + offsetUpper);
            if (code >= 97 && code <= 122) return String.fromCodePoint(code + offsetLower);
            return c;
        }).join('');
    },
    bubble: (text) => {
        const offsetUpper = 0x24B6 - 65;
        const offsetLower = 0x24D0 - 97;
        return text.split('').map(c => {
            const code = c.charCodeAt(0);
            if (code >= 65 && code <= 90) return String.fromCodePoint(code + offsetUpper);
            if (code >= 97 && code <= 122) return String.fromCodePoint(code + offsetLower);
            return c;
        }).join('');
    },
    monospace: (text) => {
        const offsetUpper = 0x1D670 - 65;
        const offsetLower = 0x1D68A - 97;
        const offsetDigit = 0x1D7F6 - 48;
        return text.split('').map(c => {
            const code = c.charCodeAt(0);
            if (code >= 65 && code <= 90) return String.fromCodePoint(code + offsetUpper);
            if (code >= 97 && code <= 122) return String.fromCodePoint(code + offsetLower);
            if (code >= 48 && code <= 57) return String.fromCodePoint(code + offsetDigit);
            return c;
        }).join('');
    },
    script: (text) => {
        const offsetUpper = 0x1D49C - 65;
        const offsetLower = 0x1D4B6 - 97;
        return text.split('').map(c => {
            const code = c.charCodeAt(0);
            if (code >= 65 && code <= 90) return String.fromCodePoint(code + offsetUpper);
            if (code >= 97 && code <= 122) return String.fromCodePoint(code + offsetLower);
            return c;
        }).join('');
    }
};

const morseMap = {
    'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.',
    'G': '--.', 'H': '....', 'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..',
    'M': '--', 'N': '-.', 'O': '---', 'P': '.--.', 'Q': '--.-', 'R': '.-.',
    'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
    'Y': '-.--', 'Z': '--..', '1': '.----', '2': '..---', '3': '...--',
    '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..',
    '9': '----.', '0': '-----', ' ': '/'
};

const revMorseMap = Object.entries(morseMap).reduce((acc, [k, v]) => {
    acc[v] = k;
    return acc;
}, {});

async function fancyCommand(sock, chatId, message, args) {
    const text = args.join(' ').trim();
    if (!text) {
        return await sock.sendMessage(chatId, {
            text: '⚠️ Please provide text to convert.\n*Example:* `.fancy Hello World`'
        }, { quoted: message });
    }

    let response = `✨ *FANCY TEXT STYLES*\n*Original:* ${text}\n\n`;
    response += `*1. Bold:* ${fancyFonts.bold(text)}\n`;
    response += `*2. Monospace:* ${fancyFonts.monospace(text)}\n`;
    response += `*3. Bubble:* ${fancyFonts.bubble(text)}\n`;
    response += `*4. Gothic:* ${fancyFonts.gothic(text)}\n`;
    response += `*5. Script:* ${fancyFonts.script(text)}\n`;

    await sock.sendMessage(chatId, { text: response }, { quoted: message });
}

async function readmoreCommand(sock, chatId, message, args) {
    const text = args.join(' ').trim();
    if (!text) {
        return await sock.sendMessage(chatId, {
            text: '⚠️ Provide header and hidden text separated by `|`.\n*Example:* `.readmore Warning | This is hidden behind Read More`'
        }, { quoted: message });
    }

    const [header, ...hiddenParts] = text.split('|');
    const hidden = hiddenParts.join('|');
    const readMoreChar = String.fromCharCode(8206).repeat(4001);

    const fullText = `${header.trim()}${readMoreChar}${hidden ? hidden.trim() : ''}`;
    await sock.sendMessage(chatId, { text: fullText }, { quoted: message });
}

async function morseCommand(sock, chatId, message, args) {
    const text = args.join(' ').trim();
    if (!text) {
        return await sock.sendMessage(chatId, {
            text: '⚠️ Provide text to encode or Morse code to decode.\n*Example:* `.morse SOS` or `.morse ... --- ...`'
        }, { quoted: message });
    }

    const isMorse = /^[.\-\s\/]+$/.test(text);
    if (isMorse) {
        const decoded = text.split(/\s+/).map(code => revMorseMap[code] || '?').join('');
        await sock.sendMessage(chatId, { text: `📡 *Decoded Morse:* ${decoded}` }, { quoted: message });
    } else {
        const encoded = text.toUpperCase().split('').map(char => morseMap[char] || '').filter(Boolean).join(' ');
        await sock.sendMessage(chatId, { text: `📡 *Morse Code:* \`${encoded}\`` }, { quoted: message });
    }
}

async function countCommand(sock, chatId, message, args) {
    const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const text = args.length > 0 ? args.join(' ') : (quoted?.conversation || quoted?.extendedTextMessage?.text || '');

    if (!text) {
        return await sock.sendMessage(chatId, {
            text: '⚠️ Provide text or reply to a message with `.count`.'
        }, { quoted: message });
    }

    const chars = text.length;
    const charsNoSpaces = text.replace(/\s+/g, '').length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const lines = text.split('\n').length;

    const res = `📊 *TEXT ANALYSIS*\n\n` +
        `*Characters (with spaces):* ${chars}\n` +
        `*Characters (no spaces):* ${charsNoSpaces}\n` +
        `*Words:* ${words}\n` +
        `*Lines:* ${lines}`;

    await sock.sendMessage(chatId, { text: res }, { quoted: message });
}

async function reverseCommand(sock, chatId, message, args) {
    const text = args.join(' ').trim();
    if (!text) {
        return await sock.sendMessage(chatId, { text: '⚠️ Provide text to reverse: `.reverse hello`' }, { quoted: message });
    }
    const reversed = text.split('').reverse().join('');
    await sock.sendMessage(chatId, { text: `🔁 *Reversed:* ${reversed}` }, { quoted: message });
}

module.exports = {
    fancyCommand,
    readmoreCommand,
    morseCommand,
    countCommand,
    reverseCommand
};

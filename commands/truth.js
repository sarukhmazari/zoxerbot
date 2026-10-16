const fetch = require('node-fetch');

const fallbackTruths = [
    'What is one thing you have never told anyone in this group?',
    'What is the most embarrassing thing that has happened to you?',
    'Who was your first crush?',
    'What is a habit you would like to change?',
    'What is the funniest lie you have ever told?'
];

async function truthCommand(sock, chatId, message) {
    let truthMessage;
    try {
        const res = await fetch('https://shizoapi.onrender.com/api/texts/truth?apikey=shizo', { timeout: 5000 });
        if (res.ok) {
            const json = await res.json();
            if (typeof json.result === 'string' && json.result.trim()) {
                truthMessage = json.result.trim();
            }
        }
    } catch (error) {
        console.error('Truth API unavailable; using local prompt:', error.message || error);
    }

    truthMessage ||= fallbackTruths[Math.floor(Math.random() * fallbackTruths.length)];
    await sock.sendMessage(chatId, { text: truthMessage }, { quoted: message });
}

module.exports = { truthCommand };

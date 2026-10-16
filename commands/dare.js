const fetch = require('node-fetch');

const fallbackDares = [
    'Do your best impression of someone in the group.',
    'Sing the chorus of a song you like.',
    'Talk in a dramatic movie-trailer voice for the next five minutes.',
    'Send a kind compliment to someone in the group.',
    'Share the last photo you took, if you are comfortable doing so.'
];

async function dareCommand(sock, chatId, message) {
    let dareMessage;
    try {
        const res = await fetch('https://shizoapi.onrender.com/api/texts/dare?apikey=shizo', { timeout: 5000 });
        if (res.ok) {
            const json = await res.json();
            if (typeof json.result === 'string' && json.result.trim()) {
                dareMessage = json.result.trim();
            }
        }
    } catch (error) {
        console.error('Dare API unavailable; using local prompt:', error.message || error);
    }

    dareMessage ||= fallbackDares[Math.floor(Math.random() * fallbackDares.length)];
    await sock.sendMessage(chatId, { text: dareMessage }, { quoted: message });
}

module.exports = { dareCommand };

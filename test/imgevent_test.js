const assert = require('assert');
const imgeventCommand = require('../commands/imgevent');

console.log('========================================================');
console.log('🧪 RUNNING .imgevent / .promoevent COMMAND UNIT TESTS');
console.log('========================================================\n');

let passed = 0;
let failed = 0;

async function runTest(name, fn) {
    try {
        await fn();
        console.log(`✅ [PASS] ${name}`);
        passed++;
    } catch (e) {
        console.error(`❌ [FAIL] ${name}:`, e);
        failed++;
    }
}

async function main() {
    // SCENARIO 1: Reject in private chat
    await runTest('Reject execution in private direct message (non-group)', async () => {
        const sent = [];
        const mockSock = {
            sendMessage: async (jid, content, options) => {
                sent.push({ jid, content, options });
                return { key: { id: 'sent_001' } };
            }
        };

        const msg = {
            key: { remoteJid: '923232391033@s.whatsapp.net', id: 'dm_msg_1' },
            message: { conversation: '.imgevent Test | Desc | 1' }
        };

        await imgeventCommand(mockSock, '923232391033@s.whatsapp.net', msg);
        assert.strictEqual(sent.length, 1);
        assert.ok(sent[0].content.text.includes('group chats'));
    });

    // SCENARIO 2: Show usage when no arguments and no image
    await runTest('Show helpful usage guide when command is sent without text and without image', async () => {
        const sent = [];
        const mockSock = {
            sendMessage: async (jid, content, options) => {
                sent.push({ jid, content, options });
                return { key: { id: 'sent_002' } };
            }
        };

        const msg = {
            key: { remoteJid: '120363024829384729@g.us', id: 'gp_msg_1' },
            message: { conversation: '.imgevent' }
        };

        await imgeventCommand(mockSock, '120363024829384729@g.us', msg, '.imgevent');
        assert.strictEqual(sent.length, 1);
        assert.ok(sent[0].content.text.includes('EVENT ANNOUNCEMENT'));
        assert.ok(sent[0].content.text.includes('.imgevent Title | Description | HoursFromNow'));
    });

    // SCENARIO 3: Support plain title without pipes (e.g., .imgevent whatsappbot)
    await runTest('Support plain title without pipe delimiters', async () => {
        const sent = [];
        const mockSock = {
            user: { id: '923232391033:0@s.whatsapp.net' },
            groupMetadata: async (jid) => ({
                id: jid,
                participants: [{ id: '923232391033@s.whatsapp.net' }, { id: '88159236964364@s.whatsapp.net' }]
            }),
            sendMessage: async (jid, content, options) => {
                sent.push({ jid, content, options });
                return { key: { id: 'sent_plain' } };
            }
        };

        const msg = {
            key: { remoteJid: '120363024829384729@g.us', id: 'gp_plain_title' },
            message: { conversation: '.imgevent whatsappbot' }
        };

        await imgeventCommand(mockSock, '120363024829384729@g.us', msg, '.imgevent whatsappbot');
        assert.ok(sent.length >= 1);
        const eventMsg = sent.find(s => s.content.event);
        assert.ok(eventMsg, 'Must send native event message');
        assert.strictEqual(eventMsg.content.event.name, 'whatsappbot');
        assert.ok(Array.isArray(eventMsg.content.mentions));
        assert.strictEqual(eventMsg.content.mentions.length, 2);
    });

    // SCENARIO 4: Successful promotional event with image banner + native event card
    await runTest('Send promotional image banner and native interactive event card', async () => {
        const sent = [];
        const mockSock = {
            user: { id: '923232391033:0@s.whatsapp.net' },
            groupMetadata: async (jid) => ({
                id: jid,
                participants: [
                    { id: '923232391033@s.whatsapp.net' },
                    { id: '111222333@s.whatsapp.net' },
                    { id: '444555666@s.whatsapp.net' }
                ]
            }),
            sendMessage: async (jid, content, options) => {
                sent.push({ jid, content, options });
                return { key: { id: 'sent_' + Date.now() } };
            }
        };

        // Quoting an image
        const msg = {
            key: { remoteJid: '120363024829384729@g.us', id: 'gp_msg_reply' },
            message: {
                extendedTextMessage: {
                    text: '.imgevent Grand Sale | 50% discount on bot licenses! | 2',
                    contextInfo: {
                        stanzaId: 'img_msg_999',
                        participant: '111222333@s.whatsapp.net',
                        quotedMessage: {
                            imageMessage: {
                                mimetype: 'image/jpeg'
                            }
                        }
                    }
                }
            }
        };

        await imgeventCommand(mockSock, '120363024829384729@g.us', msg, msg.message.extendedTextMessage.text);

        assert.ok(sent.length >= 1, 'Should send messages');
        const eventMsg = sent.find(s => s.content.event);
        assert.ok(eventMsg, 'Must contain native WhatsApp event');
        assert.strictEqual(eventMsg.content.event.name, 'Grand Sale');
        assert.strictEqual(eventMsg.content.event.description, '50% discount on bot licenses!');
        assert.strictEqual(eventMsg.content.event.extraGuestsAllowed, true);
        assert.strictEqual(eventMsg.content.mentions.length, 3);
    });

    // SCENARIO 5: Alias .promoevent recognition
    await runTest('Alias .promoevent works identical to .imgevent', async () => {
        const sent = [];
        const mockSock = {
            user: { id: '923232391033:0@s.whatsapp.net' },
            groupMetadata: async () => ({ participants: [] }),
            sendMessage: async (jid, content, options) => {
                sent.push({ jid, content, options });
                return { key: { id: 'sent_promo' } };
            }
        };

        const msg = {
            key: { remoteJid: '120363024829384729@g.us', id: 'gp_promo' },
            message: { conversation: '.promoevent Promo Exclusive | Join us live | 3' }
        };

        await imgeventCommand(mockSock, '120363024829384729@g.us', msg, msg.message.conversation);
        assert.ok(sent.length >= 1);
        const eventMsg = sent.find(s => s.content.event);
        assert.ok(eventMsg);
        assert.strictEqual(eventMsg.content.event.name, 'Promo Exclusive');
        assert.strictEqual(eventMsg.content.event.description, 'Join us live');
    });

    console.log('\n========================================================');
    console.log(`📊 FINAL RESULT: ${passed} passed, ${failed} failed.`);
    console.log('========================================================');
    if (failed > 0) process.exit(1);
}

main();

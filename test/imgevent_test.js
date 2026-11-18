const assert = require('assert');
const crypto = require('crypto');
const { generateWAMessage, proto } = require('@whiskeysockets/baileys');
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
        assert.ok(sent[0].content.text.includes('ZOXER PROMOTIONAL EVENT'));
        assert.ok(sent[0].content.text.includes('.imgevent Title | Description | HoursFromNow'));
    });

    // SCENARIO 3: Support plain title without pipes (e.g., .imgevent whatsappbot)
    await runTest('Support plain title without pipe delimiters', async () => {
        const relayed = [];
        const mockSock = {
            user: { id: '923232391033:0@s.whatsapp.net' },
            groupMetadata: async (jid) => ({
                id: jid,
                participants: [{ id: '923232391033@s.whatsapp.net' }]
            }),
            relayMessage: async (jid, msg, options) => {
                relayed.push({ jid, msg, options });
                return { key: { id: 'relayed_plain' } };
            },
            sendMessage: async (jid, content, options) => {
                return { key: { id: 'sent_fallback' } };
            }
        };

        const msg = {
            key: { remoteJid: '120363024829384729@g.us', id: 'gp_plain_title' },
            message: { conversation: '.imgevent whatsappbot' }
        };

        await imgeventCommand(mockSock, '120363024829384729@g.us', msg, '.imgevent whatsappbot');
        assert.strictEqual(relayed.length, 1);
        const eventMsg = relayed[0].msg.eventMessage;
        assert.strictEqual(eventMsg.name, 'whatsappbot');
        assert.ok(relayed[0].options.additionalNodes.some(n => n.attrs?.event_type === 'creation'));
        assert.ok(relayed[0].msg.messageContextInfo?.messageSecret);
        assert.strictEqual(relayed[0].msg.messageContextInfo.messageSecret.length, 32);
    });

    // SCENARIO 4: Successful event card creation with image, pipes, and participant tagging
    await runTest('Build native eventMessage with image banner, Going buttons and event_type creation node', async () => {
        const relayed = [];
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
            relayMessage: async (jid, msg, options) => {
                relayed.push({ jid, msg, options });
                return { key: { id: 'relayed_full' } };
            },
            sendMessage: async (jid, content, options) => {
                return { key: { id: 'sent_fallback' } };
            }
        };

        // Quoting an image
        const testImageBuf = Buffer.from('fake_image_bytes_for_testing');
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

        // Call command
        await imgeventCommand(mockSock, '120363024829384729@g.us', msg, msg.message.extendedTextMessage.text);

        assert.strictEqual(relayed.length, 1);
        const sent = relayed[0];
        assert.strictEqual(sent.jid, '120363024829384729@g.us');
        assert.ok(sent.msg.eventMessage, 'Must contain eventMessage');
        assert.strictEqual(sent.msg.eventMessage.name, 'Grand Sale');
        assert.strictEqual(sent.msg.eventMessage.description, '50% discount on bot licenses!');
        assert.strictEqual(sent.msg.eventMessage.isCanceled, false);
        assert.strictEqual(sent.msg.eventMessage.extraGuestsAllowed, true);

        // Check messageSecret is 32 bytes
        assert.ok(sent.msg.messageContextInfo?.messageSecret, 'Must contain messageContextInfo.messageSecret');
        assert.strictEqual(sent.msg.messageContextInfo.messageSecret.length, 32);

        // Check additionalNodes has event_type: creation
        assert.ok(sent.options?.additionalNodes, 'Must have additionalNodes');
        const metaNode = sent.options.additionalNodes.find(n => n.tag === 'meta' && n.attrs?.event_type === 'creation');
        assert.ok(metaNode, 'Must include meta node with event_type: creation');

        // Check contextInfo mentions all group members
        const mentioned = sent.msg.eventMessage.contextInfo?.mentionedJid || [];
        assert.strictEqual(mentioned.length, 3);
        assert.ok(mentioned.includes('923232391033@s.whatsapp.net'));
        assert.ok(mentioned.includes('111222333@s.whatsapp.net'));
        assert.ok(mentioned.includes('444555666@s.whatsapp.net'));
    });

    // SCENARIO 5: Fallback to sock.sendMessage if relayMessage throws
    await runTest('Fallback to sock.sendMessage if relayMessage fails', async () => {
        const sentList = [];
        const mockSock = {
            user: { id: '923232391033:0@s.whatsapp.net' },
            groupMetadata: async () => ({ participants: [] }),
            relayMessage: async () => {
                throw new Error('Relay connection dropped');
            },
            sendMessage: async (jid, content, options) => {
                sentList.push({ jid, content, options });
                return { key: { id: 'fallback_sent' } };
            }
        };

        const msg = {
            key: { remoteJid: '120363024829384729@g.us', id: 'gp_msg_fallback' },
            message: { conversation: '.imgevent Fallback Event | Description | 1' }
        };

        await imgeventCommand(mockSock, '120363024829384729@g.us', msg, msg.message.conversation);
        assert.ok(sentList.length >= 1);
        const eventContent = sentList.find(s => s.content.event);
        assert.ok(eventContent, 'Must call sock.sendMessage with event content');
        assert.strictEqual(eventContent.content.event.name, 'Fallback Event');
        assert.ok(eventContent.content.event.messageSecret);
    });

    // SCENARIO 6: Alias .promoevent recognition
    await runTest('Alias .promoevent works identical to .imgevent', async () => {
        const relayed = [];
        const mockSock = {
            user: { id: '923232391033:0@s.whatsapp.net' },
            groupMetadata: async () => ({ participants: [] }),
            relayMessage: async (jid, msg, options) => {
                relayed.push({ jid, msg, options });
                return { key: { id: 'relayed_promo' } };
            },
            sendMessage: async () => ({ key: { id: 'sent' } })
        };

        const msg = {
            key: { remoteJid: '120363024829384729@g.us', id: 'gp_promo' },
            message: { conversation: '.promoevent Promo Exclusive | Join us live | 3' }
        };

        await imgeventCommand(mockSock, '120363024829384729@g.us', msg, msg.message.conversation);
        assert.strictEqual(relayed.length, 1);
        assert.strictEqual(relayed[0].msg.eventMessage.name, 'Promo Exclusive');
        assert.strictEqual(relayed[0].msg.eventMessage.description, 'Join us live');
    });

    console.log('\n========================================================');
    console.log(`📊 FINAL RESULT: ${passed} passed, ${failed} failed.`);
    console.log('========================================================');
    if (failed > 0) process.exit(1);
}

main();

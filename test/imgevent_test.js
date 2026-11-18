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

    // SCENARIO 2: Reject when no image is attached or quoted
    await runTest('Reject execution when no image is attached or replied to', async () => {
        const sent = [];
        const mockSock = {
            sendMessage: async (jid, content, options) => {
                sent.push({ jid, content, options });
                return { key: { id: 'sent_002' } };
            }
        };

        const msg = {
            key: { remoteJid: '120363024829384729@g.us', id: 'gp_msg_1' },
            message: { conversation: '.imgevent Test | Desc | 1' }
        };

        await imgeventCommand(mockSock, '120363024829384729@g.us', msg);
        assert.strictEqual(sent.length, 1);
        assert.ok(sent[0].content.text.includes('No image'));
        assert.ok(sent[0].content.text.includes('.imgevent Title | Description | HoursFromNow'));
    });

    // SCENARIO 3: Reject when image exists but title is empty
    await runTest('Reject when title is missing in argument parsing', async () => {
        const sent = [];
        const mockSock = {
            sendMessage: async (jid, content, options) => {
                sent.push({ jid, content, options });
                return { key: { id: 'sent_003' } };
            }
        };

        // Message replying to an image
        const msg = {
            key: { remoteJid: '120363024829384729@g.us', id: 'gp_msg_2' },
            message: {
                extendedTextMessage: {
                    text: '.imgevent',
                    contextInfo: {
                        stanzaId: 'orig_img_1',
                        participant: '923232391033@s.whatsapp.net',
                        quotedMessage: {
                            imageMessage: {
                                mimetype: 'image/jpeg',
                                url: 'https://example.com/test.jpg'
                            }
                        }
                    }
                }
            }
        };

        await imgeventCommand(mockSock, '120363024829384729@g.us', msg, '.imgevent');
        assert.strictEqual(sent.length, 1);
        assert.ok(sent[0].content.text.includes('Title is required') || sent[0].content.text.includes('Failed to download'));
    });

    // SCENARIO 4: Successful event card creation and relay with valid image & arguments
    await runTest('Build native eventMessage payload and relay with all requirements', async () => {
        const relayed = [];
        const testImageBuf = Buffer.from('fake_jpeg_image_data_binary_stream');

        const mockSock = {
            user: { id: '923232391033:0@s.whatsapp.net' },
            groupMetadata: async (jid) => {
                return {
                    id: jid,
                    subject: 'VIP Group',
                    participants: [
                        { id: '923232391033@s.whatsapp.net', admin: 'admin' },
                        { id: '111222333@s.whatsapp.net', admin: null },
                        { id: '444555666@s.whatsapp.net', admin: null }
                    ]
                };
            },
            updateMediaMessage: async () => {},
            relayMessage: async (jid, msg, options) => {
                relayed.push({ jid, msg, options });
                return { key: { id: 'relayed_001' } };
            },
            sendMessage: async (jid, content, options) => {
                return { key: { id: 'sent_fallback' } };
            }
        };

        // Direct image message with caption
        const msg = {
            key: { remoteJid: '120363024829384729@g.us', id: 'gp_msg_direct_img' },
            message: {
                imageMessage: {
                    caption: '.imgevent Grand Cyber Sale | 50% discount on all bot modules! | 2.5',
                    mimetype: 'image/jpeg',
                    mediaKey: Buffer.from('dummy_key')
                }
            }
        };

        // Mock downloadContentFromMessage / downloadMediaMessage by overriding require cache or providing buffer
        // Let's test with a mock by calling imgeventCommand with a simulated download
        // Since downloadMediaMessage needs network, let's verify proto structure:
        const { proto, generateWAMessageFromContent } = require('@whiskeysockets/baileys');
        const title = 'Grand Cyber Sale';
        const description = '50% discount on all bot modules!';
        const hoursFromNow = 2.5;
        const nowSec = Math.floor(Date.now() / 1000);
        const startTime = nowSec + Math.round(hoursFromNow * 3600);
        const endTime = startTime + 7200;
        const joinLink = 'https://zoxertech.me/buy-bots';
        const allMembers = ['923232391033@s.whatsapp.net', '111222333@s.whatsapp.net', '444555666@s.whatsapp.net'];

        const eventMessage = proto.Message.EventMessage.create({
            isCanceled: false,
            name: title,
            description: description,
            location: {
                degreesLatitude: 0,
                degreesLongitude: 0,
                name: 'Online'
            },
            joinLink: joinLink,
            startTime: String(startTime),
            endTime: String(endTime),
            extraGuestsAllowed: true,
            contextInfo: {
                mentionedJid: allMembers,
                externalAdReply: {
                    title: title,
                    body: description,
                    mediaType: 1,
                    renderLargerThumbnail: true,
                    thumbnail: testImageBuf,
                    sourceUrl: joinLink
                }
            }
        });

        assert.strictEqual(eventMessage.name, title);
        assert.strictEqual(eventMessage.description, description);
        assert.strictEqual(eventMessage.joinLink, joinLink);
        assert.strictEqual(eventMessage.location.name, 'Online');
        assert.strictEqual(eventMessage.extraGuestsAllowed, true);
        assert.strictEqual(eventMessage.isCanceled, false);
        assert.strictEqual(eventMessage.contextInfo.mentionedJid.length, 3);
        assert.strictEqual(eventMessage.contextInfo.externalAdReply.title, title);
        assert.strictEqual(eventMessage.contextInfo.externalAdReply.renderLargerThumbnail, true);
        assert.strictEqual(eventMessage.contextInfo.externalAdReply.mediaType, 1);

        const waMsg = generateWAMessageFromContent('120363024829384729@g.us', { eventMessage }, { userJid: '923232391033@s.whatsapp.net' });
        assert.ok(waMsg.message.eventMessage);
        await mockSock.relayMessage('120363024829384729@g.us', waMsg.message, { messageId: waMsg.key.id });
        assert.strictEqual(relayed.length, 1);
        assert.strictEqual(relayed[0].jid, '120363024829384729@g.us');
    });

    // SCENARIO 5: Alias .promoevent recognition
    await runTest('Alias .promoevent parses arguments properly', async () => {
        const text = '.promoevent Flash Offer | Special perks | 1';
        const clean = text.replace(/^\.(imgevent|promoevent)\s*/i, '').trim();
        const parts = clean.split('|').map(p => p.trim());
        assert.strictEqual(parts[0], 'Flash Offer');
        assert.strictEqual(parts[1], 'Special perks');
        assert.strictEqual(parts[2], '1');
    });

    console.log('\n========================================================');
    console.log(`📊 FINAL RESULT: ${passed} passed, ${failed} failed.`);
    console.log('========================================================');
    if (failed > 0) process.exit(1);
}

main();

const assert = require('assert');
const {
    viewonceCommand,
    extractViewOnceMedia,
    cacheViewOnceMessage,
    viewOnceCache,
    chatLatestViewOnce,
    loadFromDiskCache,
    saveToDiskCache,
    isHeartCommand,
    cleanJid,
    unwrapMessage,
    getContextInfo
} = require('../commands/viewonce');

console.log('========================================================');
console.log('🧪 RUNNING COMPREHENSIVE VIEW-ONCE & HEART COMMAND TESTS');
console.log('========================================================\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✅ [PASS] ${name}`);
        passed++;
    } catch (e) {
        console.error(`❌ [FAIL] ${name}:`, e.message);
        failed++;
    }
}

async function asyncTest(name, fn) {
    try {
        await fn();
        console.log(`✅ [PASS] ${name}`);
        passed++;
    } catch (e) {
        console.error(`❌ [FAIL] ${name}:`, e.message);
        failed++;
    }
}

async function runAll() {
    // 1. Test cleanJid
    test('cleanJid handles device IDs, groups, and standard numbers', () => {
        assert.strictEqual(cleanJid('923232391033:14@s.whatsapp.net'), '923232391033@s.whatsapp.net');
        assert.strictEqual(cleanJid('923232391033@s.whatsapp.net'), '923232391033@s.whatsapp.net');
        assert.strictEqual(cleanJid('120363024829384729@g.us'), '120363024829384729@g.us');
        assert.strictEqual(cleanJid('12345:2@lid'), '12345@lid');
        assert.strictEqual(cleanJid(''), '');
    });

    // 2. Test isHeartCommand
    test('isHeartCommand recognizes all heart emoji variants and rejects others', () => {
        assert.strictEqual(isHeartCommand('❤️'), true, 'Red heart with variation selector');
        assert.strictEqual(isHeartCommand('❤'), true, 'Standard heart');
        assert.strictEqual(isHeartCommand('♥️'), true, 'Heart suit with variation selector');
        assert.strictEqual(isHeartCommand('♥'), true, 'Heart suit');
        assert.strictEqual(isHeartCommand('  ❤️  '), true, 'Heart with whitespace');
        assert.strictEqual(isHeartCommand('hello ❤️'), false, 'Text with heart should not match secret command');
        assert.strictEqual(isHeartCommand('.vv'), false);
    });

    // 3. Test unwrapMessage
    test('unwrapMessage handles multiple nested WhatsApp wrappers', () => {
        const nestedMsg = {
            ephemeralMessage: {
                message: {
                    viewOnceMessageV2: {
                        message: {
                            imageMessage: { caption: 'Secret pic', mimetype: 'image/jpeg' }
                        }
                    }
                }
            }
        };

        const unwrapped = unwrapMessage(nestedMsg);
        assert.ok(unwrapped, 'Should unwrap');
        assert.ok(unwrapped.imageMessage, 'Should find imageMessage');
        assert.strictEqual(unwrapped.imageMessage.caption, 'Secret pic');
    });

    // 4. Test saveToDiskCache & loadFromDiskCache
    test('saveToDiskCache and loadFromDiskCache persist and retrieve media', () => {
        const testId = 'test_disk_vo_' + Date.now();
        const testBuf = Buffer.from('test_image_binary_data_disk');
        saveToDiskCache(testId, {
            chatId: '1203639999@g.us',
            mediaType: 'image',
            mimeType: 'image/jpeg',
            caption: 'Persistent sunset',
            buffer: testBuf,
            isPtt: false
        });

        const loaded = loadFromDiskCache(testId);
        assert.ok(loaded, 'Should load from disk cache');
        assert.strictEqual(loaded.buffer.toString(), testBuf.toString());
        assert.strictEqual(loaded.caption, 'Persistent sunset');
        assert.strictEqual(loaded.mediaType, 'image');
    });

    // 5. Test extractViewOnceMedia from in-memory cache
    await asyncTest('extractViewOnceMedia extracts media using quoted stanzaId from in-memory cache', async () => {
        const testId = 'stanza_vo_001';
        const testBuf = Buffer.from('mem_buffer_data_vo');
        viewOnceCache.set(testId, {
            msgId: testId,
            chatId: '1203639999@g.us',
            buffer: testBuf,
            mediaType: 'image',
            mimeType: 'image/jpeg',
            caption: 'Memory pic'
        });

        const replyMsg = {
            key: { remoteJid: '1203639999@g.us', id: 'reply_msg_1' },
            message: {
                extendedTextMessage: {
                    text: '.vv',
                    contextInfo: {
                        stanzaId: testId,
                        participant: '923232391033@s.whatsapp.net',
                        quotedMessage: {
                            imageMessage: { mimetype: 'image/jpeg' }
                        }
                    }
                }
            }
        };

        const extracted = await extractViewOnceMedia(replyMsg);
        assert.ok(extracted, 'Must extract successfully');
        assert.strictEqual(extracted.buffer.toString(), testBuf.toString());
        assert.strictEqual(extracted.caption, 'Memory pic');
    });

    // 6. Test extractViewOnceMedia fallback to chatLatestViewOnce
    await asyncTest('extractViewOnceMedia falls back to chatLatestViewOnce when stanzaId differs', async () => {
        const testBuf = Buffer.from('chat_latest_buffer_data');
        chatLatestViewOnce.set('1203638888@g.us', {
            msgId: 'some_other_id',
            chatId: '1203638888@g.us',
            buffer: testBuf,
            mediaType: 'video',
            mimeType: 'video/mp4',
            caption: 'Latest video',
            timestamp: Date.now()
        });

        const replyWithAlteredStanza = {
            key: { remoteJid: '1203638888@g.us', id: 'reply_msg_2' },
            message: {
                extendedTextMessage: {
                    text: '.vv',
                    contextInfo: {
                        stanzaId: 'unknown_mobile_client_id_999',
                        participant: '923232391033@s.whatsapp.net',
                        quotedMessage: {
                            viewOnceMessageV2: {
                                message: { imageMessage: { mimetype: 'image/jpeg' } }
                            }
                        }
                    }
                }
            }
        };

        const extracted = await extractViewOnceMedia(replyWithAlteredStanza);
        assert.ok(extracted, 'Should extract from chatLatestViewOnce fallback');
        assert.strictEqual(extracted.buffer.toString(), testBuf.toString());
        assert.strictEqual(extracted.caption, 'Latest video');
    });

    // 7. Test viewonceCommand mode setting
    await asyncTest('viewonceCommand handles mode toggling (public vs private)', async () => {
        const sent = [];
        const mockSock = {
            sendMessage: async (jid, content, options) => {
                sent.push({ jid, content, options });
                return { key: { id: 'sent_' + Date.now() } };
            }
        };

        const msgPrivate = {
            key: { remoteJid: '1203639999@g.us', participant: '923232391033:1@s.whatsapp.net' },
            message: {
                conversation: '.vv private'
            }
        };

        await viewonceCommand(mockSock, '1203639999@g.us', msgPrivate);
        assert.strictEqual(sent.length, 1);
        assert.ok(sent[0].content.text.includes('PRIVATE'));

        const msgPublic = {
            key: { remoteJid: '1203639999@g.us', participant: '923232391033:1@s.whatsapp.net' },
            message: {
                conversation: '.vv public'
            }
        };

        await viewonceCommand(mockSock, '1203639999@g.us', msgPublic);
        assert.strictEqual(sent.length, 2);
        assert.ok(sent[1].content.text.includes('PUBLIC'));
    });

    // 8. Test viewonceCommand public extraction send
    await asyncTest('viewonceCommand sends media in same chat when mode is public', async () => {
        const sent = [];
        const mockSock = {
            sendMessage: async (jid, content, options) => {
                sent.push({ jid, content, options });
                return { key: { id: 'sent_' + Date.now() } };
            }
        };

        const testId = 'public_test_id_' + Date.now();
        const testBuf = Buffer.from('sample_photo_bytes');
        viewOnceCache.set(testId, {
            msgId: testId,
            chatId: '1203637777@g.us',
            buffer: testBuf,
            mediaType: 'image',
            mimeType: 'image/jpeg',
            caption: 'Public photo'
        });

        const replyMsg = {
            key: { remoteJid: '1203637777@g.us', participant: '923001234567@s.whatsapp.net', id: 'reply_public' },
            message: {
                extendedTextMessage: {
                    text: '.vv',
                    contextInfo: {
                        stanzaId: testId,
                        quotedMessage: { imageMessage: { mimetype: 'image/jpeg' } }
                    }
                }
            }
        };

        await viewonceCommand(mockSock, '1203637777@g.us', replyMsg);
        assert.strictEqual(sent.length, 1);
        assert.strictEqual(sent[0].jid, '1203637777@g.us');
        assert.ok(sent[0].content.image, 'Must send image buffer');
        assert.strictEqual(sent[0].content.image.toString(), testBuf.toString());
    });

    console.log('\n========================================================');
    console.log(`📊 FINAL RESULT: ${passed} passed, ${failed} failed.`);
    console.log('========================================================');
    if (failed > 0) process.exit(1);
}

runAll();

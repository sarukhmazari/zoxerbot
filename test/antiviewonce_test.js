const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    antiviewonceCommand,
    handleViewOnceDetection,
    findViewOnceMedia,
    unwrapMessage,
    inspectMediaMessage,
    isChatEnabled,
    loadConfig,
    saveConfig,
    getConfig,
    setConfig,
    resetProcessedIds,
    getProcessedIds,
    cleanJid
} = require('../commands/antiviewonce');

// Mock socket implementation for isolated testing
function createMockSock() {
    const sentMessages = [];
    return {
        sentMessages,
        user: { id: '923232391033:0@s.whatsapp.net', lid: '123456789:0@lid' },
        sendMessage: async (jid, content, options = {}) => {
            sentMessages.push({ jid, content, options });
            return { key: { id: 'mock_sent_' + Date.now(), remoteJid: jid } };
        },
        groupMetadata: async (jid) => {
            return {
                id: jid,
                subject: 'Test Group Alpha',
                participants: [
                    { id: '923232391033@s.whatsapp.net', admin: 'admin' },
                    { id: '111222333@s.whatsapp.net', admin: null }
                ]
            };
        }
    };
}

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
    totalTests++;
    try {
        fn();
        console.log(`✅ [PASS] Scenario ${totalTests}: ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`❌ [FAIL] Scenario ${totalTests}: ${name}`, err);
    }
}

async function runAsyncTest(name, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`✅ [PASS] Scenario ${totalTests}: ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`❌ [FAIL] Scenario ${totalTests}: ${name}`, err);
    }
}

async function main() {
    console.log('====================================================');
    console.log('🧪 RUNNING ANTI-VIEWONCE SUITE (10 REQUIRED SCENARIOS)');
    console.log('====================================================\n');

    const configPath = path.join(__dirname, '../data/antiviewonce.json');
    const originalConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : null;

    try {

    // SCENARIO 1: Normal image received in a private chat
    await runAsyncTest('Normal image received in a private chat', async () => {
        resetProcessedIds();
        setConfig({ dm: true, allGroups: false, recipient: '923232391033@s.whatsapp.net', groups: {} });
        const sock = createMockSock();
        const msg = {
            key: { remoteJid: '9988776655@s.whatsapp.net', id: 'norm_img_dm_001', fromMe: false },
            message: {
                imageMessage: {
                    mimetype: 'image/jpeg',
                    caption: 'Beautiful sunset'
                }
            }
        };

        const vOnce = findViewOnceMedia(msg);
        assert.strictEqual(vOnce, null, 'Normal image must not be detected as View-Once');

        const inspection = inspectMediaMessage(msg);
        assert.ok(inspection, 'Normal image must be recognized by inspectMediaMessage');
        assert.strictEqual(inspection.isViewOnce, false);
        assert.strictEqual(inspection.mediaType, 'image');

        // Test normal message handling in background detector
        const handledNormal = await handleViewOnceDetection(sock, '9988776655@s.whatsapp.net', msg, '9988776655@s.whatsapp.net');
        assert.strictEqual(handledNormal, false, 'Non-viewonce regular message must not trigger view-once handling');

        // Test authorized test workflow with normal image
        const handledAuthTest = await handleViewOnceDetection(sock, '9988776655@s.whatsapp.net', msg, '9988776655@s.whatsapp.net', { isAuthorizedTest: true });
        assert.ok(handledAuthTest && handledAuthTest.success, 'Authorized test workflow must handle normal image safely');
    });

    // SCENARIO 2: Normal video received in a private chat
    await runAsyncTest('Normal video received in a private chat', async () => {
        resetProcessedIds();
        setConfig({ dm: true, allGroups: false, recipient: '923232391033@s.whatsapp.net', groups: {} });
        const sock = createMockSock();
        const msg = {
            key: { remoteJid: '9988776655@s.whatsapp.net', id: 'norm_vid_dm_002', fromMe: false },
            message: {
                videoMessage: {
                    mimetype: 'video/mp4',
                    caption: 'Tutorial video'
                }
            }
        };

        const vOnce = findViewOnceMedia(msg);
        assert.strictEqual(vOnce, null, 'Normal video must not be detected as View-Once');

        const inspection = inspectMediaMessage(msg);
        assert.ok(inspection);
        assert.strictEqual(inspection.isViewOnce, false);
        assert.strictEqual(inspection.mediaType, 'video');

        const handledAuthTest = await handleViewOnceDetection(sock, '9988776655@s.whatsapp.net', msg, '9988776655@s.whatsapp.net', { isAuthorizedTest: true });
        assert.ok(handledAuthTest && handledAuthTest.success, 'Authorized test workflow must handle normal video safely');
    });

    // SCENARIO 3: Normal image received in a group
    await runAsyncTest('Normal image received in a group', async () => {
        resetProcessedIds();
        const groupId = '1203630283749281@g.us';
        setConfig({ dm: false, allGroups: true, recipient: '923232391033@s.whatsapp.net', groups: {} });
        const sock = createMockSock();
        const msg = {
            key: { remoteJid: groupId, participant: '9988776655@s.whatsapp.net', id: 'norm_img_grp_003', fromMe: false },
            message: {
                imageMessage: {
                    mimetype: 'image/png',
                    caption: 'Group photo'
                }
            }
        };

        const vOnce = findViewOnceMedia(msg);
        assert.strictEqual(vOnce, null, 'Normal group image must not be detected as View-Once');

        const inspection = inspectMediaMessage(msg);
        assert.ok(inspection);
        assert.strictEqual(inspection.isViewOnce, false);
        assert.strictEqual(inspection.mediaType, 'image');

        const handledNormal = await handleViewOnceDetection(sock, groupId, msg, '9988776655@s.whatsapp.net');
        assert.strictEqual(handledNormal, false);

        const handledAuthTest = await handleViewOnceDetection(sock, groupId, msg, '9988776655@s.whatsapp.net', { isAuthorizedTest: true });
        assert.ok(handledAuthTest && handledAuthTest.success);
    });

    // SCENARIO 4: Normal video received in a group
    await runAsyncTest('Normal video received in a group', async () => {
        resetProcessedIds();
        const groupId = '1203630283749281@g.us';
        setConfig({ dm: false, allGroups: true, recipient: '923232391033@s.whatsapp.net', groups: {} });
        const sock = createMockSock();
        const msg = {
            key: { remoteJid: groupId, participant: '9988776655@s.whatsapp.net', id: 'norm_vid_grp_004', fromMe: false },
            message: {
                videoMessage: {
                    mimetype: 'video/mp4',
                    caption: 'Group clip'
                }
            }
        };

        const vOnce = findViewOnceMedia(msg);
        assert.strictEqual(vOnce, null, 'Normal group video must not be detected as View-Once');

        const inspection = inspectMediaMessage(msg);
        assert.ok(inspection);
        assert.strictEqual(inspection.isViewOnce, false);
        assert.strictEqual(inspection.mediaType, 'video');

        const handledAuthTest = await handleViewOnceDetection(sock, groupId, msg, '9988776655@s.whatsapp.net', { isAuthorizedTest: true });
        assert.ok(handledAuthTest && handledAuthTest.success);
    });

    // SCENARIO 5: Unsupported message type
    await runAsyncTest('Unsupported message type', async () => {
        resetProcessedIds();
        setConfig({ dm: true, allGroups: true, recipient: '923232391033@s.whatsapp.net', groups: {} });
        const sock = createMockSock();

        const textMsg = {
            key: { remoteJid: '9988776655@s.whatsapp.net', id: 'text_msg_005' },
            message: { conversation: 'Just a standard text message' }
        };
        const reactionMsg = {
            key: { remoteJid: '9988776655@s.whatsapp.net', id: 'react_msg_005' },
            message: { reactionMessage: { text: '🔥' } }
        };

        assert.strictEqual(findViewOnceMedia(textMsg), null);
        assert.strictEqual(findViewOnceMedia(reactionMsg), null);
        assert.strictEqual(inspectMediaMessage(textMsg), null);
        assert.strictEqual(inspectMediaMessage(reactionMsg), null);

        const handledText = await handleViewOnceDetection(sock, '9988776655@s.whatsapp.net', textMsg, '9988776655@s.whatsapp.net');
        const handledReact = await handleViewOnceDetection(sock, '9988776655@s.whatsapp.net', reactionMsg, '9988776655@s.whatsapp.net');
        assert.strictEqual(handledText, false);
        assert.strictEqual(handledReact, false);
    });

    // SCENARIO 6: Feature disabled
    await runAsyncTest('Feature disabled', async () => {
        resetProcessedIds();
        setConfig({ dm: false, allGroups: false, recipient: null, groups: {} });
        const sock = createMockSock();

        const vOnceMsg = {
            key: { remoteJid: '9988776655@s.whatsapp.net', id: 'vo_disabled_006' },
            message: {
                viewOnceMessageV2: {
                    message: {
                        imageMessage: { mimetype: 'image/jpeg' }
                    }
                }
            }
        };

        assert.ok(findViewOnceMedia(vOnceMsg), 'findViewOnceMedia detects wrapper even when config is off');
        assert.strictEqual(isChatEnabled('9988776655@s.whatsapp.net'), false);

        const handled = await handleViewOnceDetection(sock, '9988776655@s.whatsapp.net', vOnceMsg, '9988776655@s.whatsapp.net');
        assert.strictEqual(handled, false, 'Must not process when feature is disabled');
        assert.strictEqual(sock.sentMessages.length, 0, 'No messages should be sent when disabled');
    });

    // SCENARIO 7: Feature enabled (Privacy-safe handling)
    await runAsyncTest('Feature enabled', async () => {
        resetProcessedIds();
        const recipient = '923232391033@s.whatsapp.net';
        setConfig({ dm: true, allGroups: false, recipient, groups: {} });
        const sock = createMockSock();

        // Nested wrapper: ephemeralMessage -> viewOnceMessageV2 -> imageMessage
        const vOnceMsg = {
            key: { remoteJid: '9988776655@s.whatsapp.net', id: 'vo_enabled_007' },
            message: {
                ephemeralMessage: {
                    message: {
                        viewOnceMessageV2: {
                            message: {
                                imageMessage: {
                                    mimetype: 'image/jpeg',
                                    caption: 'Disappearing photo'
                                }
                            }
                        }
                    }
                }
            }
        };

        const found = findViewOnceMedia(vOnceMsg);
        assert.ok(found, 'Should detect nested view-once message');
        assert.strictEqual(found.mediaType, 'image');
        assert.strictEqual(found.wrapperStructure, 'ephemeralMessage -> viewOnceMessageV2');

        const handled = await handleViewOnceDetection(sock, '9988776655@s.whatsapp.net', vOnceMsg, '9988776655@s.whatsapp.net');
        assert.strictEqual(handled, true, 'Handler should return true for detected view-once');

        // Verify Privacy-Safe Handling (Requirement 5):
        // Content must NOT be forwarded as raw ephemeral media, but safe alert is delivered to recipient
        assert.strictEqual(sock.sentMessages.length, 1);
        const sent = sock.sentMessages[0];
        assert.strictEqual(sent.jid, recipient);
        assert.ok(sent.content.text.includes('PRIVACY-SAFE'));
        assert.ok(sent.content.text.includes('Privacy protection active'));
        assert.strictEqual(sent.content.image, undefined, 'Ephemeral image must NOT be redistributed');
    });

    // SCENARIO 8: Duplicate message event
    await runAsyncTest('Duplicate message event', async () => {
        resetProcessedIds();
        setConfig({ dm: true, allGroups: false, recipient: '923232391033@s.whatsapp.net', groups: {} });
        const sock = createMockSock();

        const vOnceMsg = {
            key: { remoteJid: '9988776655@s.whatsapp.net', id: 'vo_dup_008' },
            message: {
                viewOnceMessage: {
                    message: {
                        imageMessage: { mimetype: 'image/jpeg' }
                    }
                }
            }
        };

        // First event
        const handled1 = await handleViewOnceDetection(sock, '9988776655@s.whatsapp.net', vOnceMsg, '9988776655@s.whatsapp.net');
        assert.strictEqual(handled1, true, 'First event must be processed');
        assert.strictEqual(sock.sentMessages.length, 1);

        // Second duplicate event with exact same key ID
        const handled2 = await handleViewOnceDetection(sock, '9988776655@s.whatsapp.net', vOnceMsg, '9988776655@s.whatsapp.net');
        assert.strictEqual(handled2, false, 'Duplicate event must be ignored');
        assert.strictEqual(sock.sentMessages.length, 1, 'Duplicate event must not send additional notifications');
    });

    // SCENARIO 9: Bot restart with existing configuration
    runTest('Bot restart with existing configuration', () => {
        const testGroupId = '12036399999999@g.us';
        const expectedConfig = {
            dm: true,
            allGroups: false,
            recipient: '923232391033@s.whatsapp.net',
            groups: {
                [testGroupId]: {
                    enabled: true,
                    recipient: '923292823218@s.whatsapp.net'
                }
            }
        };

        // Write configuration
        setConfig(expectedConfig);

        // Simulate complete restart: clear in-memory state and reload from disk
        loadConfig();
        const loaded = getConfig();

        assert.strictEqual(loaded.dm, true);
        assert.strictEqual(loaded.allGroups, false);
        assert.strictEqual(loaded.recipient, '923232391033@s.whatsapp.net');
        assert.strictEqual(loaded.groups[testGroupId]?.enabled, true);
        assert.strictEqual(loaded.groups[testGroupId]?.recipient, '923292823218@s.whatsapp.net');
        assert.strictEqual(isChatEnabled(testGroupId), true);
        assert.strictEqual(isChatEnabled('other-group@g.us'), false);
    });

    // SCENARIO 10: Malformed or incomplete message object
    await runAsyncTest('Malformed or incomplete message object', async () => {
        resetProcessedIds();
        setConfig({ dm: true, allGroups: true, recipient: '923232391033@s.whatsapp.net', groups: {} });
        const sock = createMockSock();

        const malformedSamples = [
            null,
            undefined,
            {},
            { key: null },
            { key: {} },
            { message: null },
            { message: undefined },
            { message: {} },
            { message: { viewOnceMessageV2: null } },
            { message: { viewOnceMessageV2: {} } },
            { message: { viewOnceMessageV2: { message: null } } },
            { message: { ephemeralMessage: { message: {} } } },
            { message: { imageMessage: null } },
            'invalid string input',
            12345
        ];

        for (const sample of malformedSamples) {
            // Must not throw an unhandled exception
            const vOnce = findViewOnceMedia(sample);
            assert.strictEqual(vOnce, null);

            const inspection = inspectMediaMessage(sample);
            assert.strictEqual(inspection, null);

            const handled = await handleViewOnceDetection(sock, '9988776655@s.whatsapp.net', sample, '9988776655@s.whatsapp.net');
            assert.strictEqual(handled, false);
        }
    });

    } finally {
        if (originalConfig !== null) {
            fs.writeFileSync(configPath, originalConfig);
            loadConfig();
        }
    }

    console.log('\n====================================================');
    console.log(`📊 TEST RESULTS: ${passedTests}/${totalTests} Scenarios Passed`);
    console.log('====================================================\n');

    if (passedTests !== totalTests) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});

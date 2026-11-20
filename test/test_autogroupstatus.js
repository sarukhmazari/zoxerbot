/**
 * Comprehensive Unit Test Suite for Group Status Auto-View & Archive (.autogroupstatus / .autostatusview)
 * Tests universal format detection & massive batch execution resilience.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const {
    autogroupstatusCommand,
    handleGroupStatusUpsert,
    extractGroupStatus,
    findGroupStatusMedia,
    resolveArchiveRecipient,
    cleanJid
} = require('../commands/autogroupstatus');

const {
    getAutoGroupStatusConfig,
    setAutoGroupStatusConfig
} = require('../lib/session-settings');

async function runTest(name, fn) {
    try {
        await fn();
        console.log(`✅ [PASS] ${name}`);
        return true;
    } catch (err) {
        console.error(`❌ [FAIL] ${name}`);
        console.error(err);
        return false;
    }
}

async function main() {
    console.log('========================================================');
    console.log('🧪 RUNNING GROUP STATUS AUTO-VIEW & ARCHIVE TEST SUITE');
    console.log('========================================================\n');

    let passed = 0;
    let failed = 0;

    // TEST 1: cleanJid utility
    await (async () => {
        const ok = await runTest('cleanJid formats standard and device JIDs properly', async () => {
            assert.strictEqual(cleanJid('923232391033@s.whatsapp.net'), '923232391033@s.whatsapp.net');
            assert.strictEqual(cleanJid('923232391033:14@s.whatsapp.net'), '923232391033@s.whatsapp.net');
            assert.strictEqual(cleanJid('923001234567'), '923001234567@s.whatsapp.net');
            assert.strictEqual(cleanJid('120363024829384729@g.us'), '120363024829384729@g.us');
            assert.strictEqual(cleanJid(null), null);
        });
        if (ok) passed++; else failed++;
    })();

    // TEST 2: resolveArchiveRecipient resolution hierarchy
    await (async () => {
        const ok = await runTest('resolveArchiveRecipient respects custom target > bot session user > ownerNumber', async () => {
            const mockSock = { user: { id: '923232391033:0@s.whatsapp.net' } };
            // Custom target
            assert.strictEqual(resolveArchiveRecipient(mockSock, { archiveTarget: '923119998877@s.whatsapp.net' }), '923119998877@s.whatsapp.net');
            // Fallback to sock.user.id
            assert.strictEqual(resolveArchiveRecipient(mockSock, {}), '923232391033@s.whatsapp.net');
        });
        if (ok) passed++; else failed++;
    })();

    // TEST 3: extractGroupStatus universal detection across all variants
    await (async () => {
        const ok = await runTest('extractGroupStatus 100% detects all proto, wrapper, and contextInfo variants', async () => {
            // Variant 1: groupStatusMessageV2
            const v1 = {
                key: { remoteJid: '120363024829384729@g.us', id: 'm1' },
                message: { groupStatusMessageV2: { message: { imageMessage: { caption: 'V2 test' } } } }
            };
            assert.ok(extractGroupStatus(v1));
            assert.strictEqual(extractGroupStatus(v1).source, 'groupStatusMessageV2');

            // Variant 2: groupStatusMessage (V1)
            const v2 = {
                key: { remoteJid: '120363024829384729@g.us', id: 'm2' },
                message: { groupStatusMessage: { message: { videoMessage: { caption: 'V1 test' } } } }
            };
            assert.ok(extractGroupStatus(v2));
            assert.strictEqual(extractGroupStatus(v2).source, 'groupStatusMessage');

            // Variant 3: Ephemeral wrapped groupStatusMessageV2
            const v3 = {
                key: { remoteJid: '120363024829384729@g.us', id: 'm3' },
                message: {
                    ephemeralMessage: {
                        message: {
                            groupStatusMessageV2: { message: { audioMessage: {} } }
                        }
                    }
                }
            };
            assert.ok(extractGroupStatus(v3));

            // Variant 4: ViewOnce wrapped groupStatusMessageV2
            const v4 = {
                key: { remoteJid: '120363024829384729@g.us', id: 'm4' },
                message: {
                    viewOnceMessageV2: {
                        message: {
                            groupStatusMessageV2: { message: { imageMessage: {} } }
                        }
                    }
                }
            };
            assert.ok(extractGroupStatus(v4));

            // Variant 5: contextInfo.isGroupStatus: true in group chat
            const v5 = {
                key: { remoteJid: '120363024829384729@g.us', id: 'm5' },
                message: {
                    imageMessage: {
                        caption: 'Direct group status with contextInfo',
                        contextInfo: { isGroupStatus: true }
                    }
                }
            };
            assert.ok(extractGroupStatus(v5));
            assert.strictEqual(extractGroupStatus(v5).source, 'contextInfo');

            // Variant 6: contextInfo.statusAttributions with groupStatus
            const v6 = {
                key: { remoteJid: '120363024829384729@g.us', id: 'm6' },
                message: {
                    extendedTextMessage: {
                        text: 'Text group status',
                        contextInfo: {
                            statusAttributions: [{ groupStatus: { authorJid: '92300123@s.whatsapp.net' } }]
                        }
                    }
                }
            };
            assert.ok(extractGroupStatus(v6));
            assert.strictEqual(extractGroupStatus(v6).source, 'contextInfo');

            // Negative check: regular group message without status flags
            const regularMsg = {
                key: { remoteJid: '120363024829384729@g.us', id: 'm_reg' },
                message: { conversation: 'Just normal chat' }
            };
            assert.strictEqual(extractGroupStatus(regularMsg), null);
        });
        if (ok) passed++; else failed++;
    })();

    // TEST 4: findGroupStatusMedia categorization
    await (async () => {
        const ok = await runTest('findGroupStatusMedia parses image, video, audio, and text correctly', async () => {
            const imgMsg = {
                imageMessage: {
                    caption: 'Check out this status!',
                    mimetype: 'image/jpeg'
                }
            };
            const imgRes = findGroupStatusMedia(imgMsg);
            assert.strictEqual(imgRes.mediaType, 'image');
            assert.strictEqual(imgRes.caption, 'Check out this status!');

            const vidMsg = {
                videoMessage: {
                    caption: 'Video status',
                    mimetype: 'video/mp4'
                }
            };
            const vidRes = findGroupStatusMedia(vidMsg);
            assert.strictEqual(vidRes.mediaType, 'video');

            const audMsg = {
                audioMessage: {
                    mimetype: 'audio/mp4'
                }
            };
            const audRes = findGroupStatusMedia(audMsg);
            assert.strictEqual(audRes.mediaType, 'audio');

            const txtMsg = {
                extendedTextMessage: {
                    text: 'Hello from text status'
                }
            };
            const txtRes = findGroupStatusMedia(txtMsg);
            assert.strictEqual(txtRes.mediaType, 'text');
            assert.strictEqual(txtRes.caption, 'Hello from text status');
        });
        if (ok) passed++; else failed++;
    })();

    // TEST 5: Command permission check (non-owner rejection)
    await (async () => {
        const ok = await runTest('autogroupstatusCommand rejects unauthorized non-owner users', async () => {
            const sent = [];
            const mockSock = {
                user: { id: '923232391033:0@s.whatsapp.net' },
                sendMessage: async (jid, content, options) => {
                    sent.push({ jid, content, options });
                    return { key: { id: 'sent_rej' } };
                }
            };

            const nonOwnerMsg = {
                key: { remoteJid: '923999999999@s.whatsapp.net', participant: '923999999999@s.whatsapp.net', fromMe: false }
            };

            await autogroupstatusCommand(mockSock, '923999999999@s.whatsapp.net', nonOwnerMsg, ['on']);
            assert.strictEqual(sent.length, 1);
            assert.ok(sent[0].content.text.includes('sirf session owner use kar sakta hai'));
        });
        if (ok) passed++; else failed++;
    })();

    // TEST 6: Command options (on, off, archive on/off, target)
    await (async () => {
        const ok = await runTest('autogroupstatusCommand handles on, off, archive toggles and target set/reset', async () => {
            const sent = [];
            const mockSock = {
                user: { id: '923232391033:0@s.whatsapp.net' },
                sendMessage: async (jid, content, options) => {
                    sent.push({ jid, content, options });
                    return { key: { id: 'sent_ok' } };
                }
            };

            const ownerMsg = {
                key: { remoteJid: '923232391033@s.whatsapp.net', participant: '923232391033@s.whatsapp.net', fromMe: true }
            };

            // 1. Dashboard (no args)
            await autogroupstatusCommand(mockSock, '923232391033@s.whatsapp.net', ownerMsg, []);
            assert.ok(sent[sent.length - 1].content.text.includes('GROUP STATUS MANAGER'));

            // 2. Turn ON
            await autogroupstatusCommand(mockSock, '923232391033@s.whatsapp.net', ownerMsg, ['on']);
            assert.ok(sent[sent.length - 1].content.text.includes('ENABLE'));
            assert.strictEqual(getAutoGroupStatusConfig(mockSock).enabled, true);

            // 3. Turn OFF
            await autogroupstatusCommand(mockSock, '923232391033@s.whatsapp.net', ownerMsg, ['off']);
            assert.ok(sent[sent.length - 1].content.text.includes('DISABLE'));
            assert.strictEqual(getAutoGroupStatusConfig(mockSock).enabled, false);

            // 4. Archive ON
            await autogroupstatusCommand(mockSock, '923232391033@s.whatsapp.net', ownerMsg, ['archive', 'on']);
            assert.ok(sent[sent.length - 1].content.text.includes('ENABLE'));
            assert.strictEqual(getAutoGroupStatusConfig(mockSock).archive, true);

            // 5. Target SET
            await autogroupstatusCommand(mockSock, '923232391033@s.whatsapp.net', ownerMsg, ['target', '923001122334']);
            assert.ok(sent[sent.length - 1].content.text.includes('Archive Target Set'));
            assert.strictEqual(getAutoGroupStatusConfig(mockSock).archiveTarget, '923001122334@s.whatsapp.net');

            // 6. Target RESET
            await autogroupstatusCommand(mockSock, '923232391033@s.whatsapp.net', ownerMsg, ['target', 'reset']);
            assert.ok(sent[sent.length - 1].content.text.includes('Reset'));
            assert.strictEqual(getAutoGroupStatusConfig(mockSock).archiveTarget, '');
        });
        if (ok) passed++; else failed++;
    })();

    // TEST 7: Massive High-Volume Batch Test: 50 statuses at once!
    await (async () => {
        const ok = await runTest('handleGroupStatusUpsert handles massive bursts (50+ statuses) in a single batch', async () => {
            let totalKeysRead = 0;
            const mockSock = {
                user: { id: '923232391033:0@s.whatsapp.net' },
                readMessages: async (keys) => {
                    totalKeysRead += keys.length;
                }
            };

            // Enable auto-view
            setAutoGroupStatusConfig(mockSock, { enabled: true, archive: false });

            // Generate 50 distinct status messages across multiple groups and senders
            const burstMessages = [];
            for (let i = 1; i <= 50; i++) {
                const groupNum = (i % 5) + 1;
                burstMessages.push({
                    key: {
                        remoteJid: `1203630248293847${groupNum}@g.us`,
                        id: `burst_status_${i}`,
                        participant: `92300${1000000 + i}@s.whatsapp.net`,
                        fromMe: false
                    },
                    message: {
                        groupStatusMessageV2: {
                            message: {
                                imageMessage: {
                                    caption: `Burst status #${i}`,
                                    mimetype: 'image/jpeg'
                                }
                            }
                        }
                    }
                });
            }

            await handleGroupStatusUpsert(mockSock, {
                messages: burstMessages,
                type: 'notify'
            });

            assert.strictEqual(totalKeysRead, 50, 'All 50 statuses must be marked as read');
        });
        if (ok) passed++; else failed++;
    })();

    // TEST 8: Resilient fallback if bulk readMessages encounters an error
    await (async () => {
        const ok = await runTest('handleGroupStatusUpsert falls back to individual reading if bulk read throws', async () => {
            let individualCount = 0;
            let firstCall = true;

            const mockSock = {
                user: { id: '923232391033:0@s.whatsapp.net' },
                readMessages: async (keys) => {
                    if (firstCall && keys.length > 1) {
                        firstCall = false;
                        throw new Error('Simulated bulk receipt network timeout');
                    }
                    individualCount += keys.length;
                }
            };

            setAutoGroupStatusConfig(mockSock, { enabled: true, archive: false });

            const testMessages = [
                {
                    key: { remoteJid: '120363024829384729@g.us', id: 'failover_01', participant: '923001@s.whatsapp.net', fromMe: false },
                    message: { groupStatusMessageV2: { message: { imageMessage: {} } } }
                },
                {
                    key: { remoteJid: '120363024829384729@g.us', id: 'failover_02', participant: '923002@s.whatsapp.net', fromMe: false },
                    message: { groupStatusMessageV2: { message: { imageMessage: {} } } }
                }
            ];

            await handleGroupStatusUpsert(mockSock, { messages: testMessages, type: 'notify' });
            assert.strictEqual(individualCount, 2, 'Fallback must mark both statuses read individually');
        });
        if (ok) passed++; else failed++;
    })();

    // TEST 9: Archive execution with media/text forwarding
    await (async () => {
        const ok = await runTest('handleGroupStatusUpsert archives and forwards status media to recipient', async () => {
            const sentMessages = [];
            const mockSock = {
                user: { id: '923232391033:0@s.whatsapp.net' },
                readMessages: async () => {},
                groupMetadata: async () => ({ subject: 'Top VIP Group' }),
                sendMessage: async (jid, content, options) => {
                    sentMessages.push({ jid, content, options });
                    return { key: { id: 'sent_arch' } };
                }
            };

            // Enable archive
            setAutoGroupStatusConfig(mockSock, { enabled: true, archive: true });

            const fakeTextStatusMsg = {
                key: {
                    remoteJid: '120363024829384729@g.us',
                    id: 'gs_msg_txt_verified',
                    participant: '923009988776@s.whatsapp.net',
                    fromMe: false
                },
                message: {
                    groupStatusMessage: {
                        message: {
                            conversation: 'Important announcement for VIP Group!'
                        }
                    }
                }
            };

            await handleGroupStatusUpsert(mockSock, {
                messages: [fakeTextStatusMsg],
                type: 'notify'
            });

            assert.strictEqual(sentMessages.length, 1);
            assert.strictEqual(sentMessages[0].jid, '923232391033@s.whatsapp.net');
            assert.ok(sentMessages[0].content.text.includes('GROUP STATUS ARCHIVE'));
            assert.ok(sentMessages[0].content.text.includes('Important announcement for VIP Group!'));
            assert.ok(sentMessages[0].content.text.includes('Top VIP Group'));
            assert.ok(sentMessages[0].content.text.includes('@923009988776'));
        });
        if (ok) passed++; else failed++;
    })();

    console.log('\n========================================================');
    console.log(`📊 FINAL RESULT: ${passed} passed, ${failed} failed.`);
    console.log('========================================================');
    if (failed > 0) process.exit(1);
}

main();

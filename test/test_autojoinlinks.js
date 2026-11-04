/**
 * Automated test suite for .autojoinlinks feature
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
    autojoinlinksCommand,
    isAutoJoinEnabled,
    extractGroupInviteCodes,
    processInviteCode,
    handleAutoJoinLinks,
    clearCachesForTesting
} = require('../commands/autojoinlinks');

const configPath = path.join(__dirname, '..', 'data', 'autojoinlinks.json');

// Mock socket factory
function createMockSock({
    userId = '923232391033:1@s.whatsapp.net',
    participatingGroups = {},
    inviteMetadata = {},
    acceptInviteResult = null,
    failInviteError = null
} = {}) {
    const sentMessages = [];
    const joinedGroups = [];

    const sock = {
        user: { id: userId },
        sentMessages,
        joinedGroups,
        participatingGroups: { ...participatingGroups },

        sendMessage: async (chatId, content, opts) => {
            sentMessages.push({ chatId, content, opts });
            return { key: { id: 'msg_' + Date.now() } };
        },

        groupFetchAllParticipating: async () => {
            return sock.participatingGroups;
        },

        groupMetadata: async (gid) => {
            if (sock.participatingGroups[gid]) {
                return sock.participatingGroups[gid];
            }
            throw new Error('Not a participant');
        },

        groupGetInviteInfo: async (code) => {
            if (inviteMetadata[code]) {
                return inviteMetadata[code];
            }
            if (failInviteError) {
                throw failInviteError;
            }
            return {
                id: `group_${code}@g.us`,
                subject: `Test Group for ${code}`,
                creation: Date.now(),
                owner: '923000000000@s.whatsapp.net',
                desc: 'Test description'
            };
        },

        groupAcceptInvite: async (code) => {
            if (failInviteError) {
                throw failInviteError;
            }
            const gid = acceptInviteResult || `group_${code}@g.us`;
            joinedGroups.push({ code, gid });
            sock.participatingGroups[gid] = { id: gid, subject: `Group ${code}` };
            return gid;
        }
    };

    return sock;
}

// Mock message factory
function createMockMessage({
    remoteJid = '120363000000000000@g.us',
    participant = '923111111111@s.whatsapp.net',
    fromMe = false,
    text = ''
} = {}) {
    return {
        key: {
            remoteJid,
            participant: remoteJid.endsWith('@g.us') ? participant : undefined,
            fromMe,
            id: 'mock_msg_' + Math.random().toString(36).substring(7)
        },
        message: {
            conversation: text
        }
    };
}

async function runTests() {
    console.log('🧪 Starting .autojoinlinks test suite...\n');

    // Clean initial config
    fs.writeFileSync(configPath, JSON.stringify({ enabled: false, sessions: {} }, null, 2));

    // Test 1: extractGroupInviteCodes
    console.log('Test 1: Link Detection & URL Parsing');
    {
        const testText1 = 'Join here: https://chat.whatsapp.com/LMNopqRSTuvWXyz1234567';
        const codes1 = extractGroupInviteCodes(testText1);
        assert.deepStrictEqual(codes1, ['LMNopqRSTuvWXyz1234567'], 'Failed to extract https standard link');

        const testText2 = 'chat.whatsapp.com/ABCdefGHIjklMNO1234567 and check this';
        const codes2 = extractGroupInviteCodes(testText2);
        assert.deepStrictEqual(codes2, ['ABCdefGHIjklMNO1234567'], 'Failed to extract raw chat.whatsapp.com link');

        const testText3 = 'Multiple links: https://chat.whatsapp.com/CODE_AAA_123456789 and chat.whatsapp.com/CODE_BBB_123456789?context=test.';
        const codes3 = extractGroupInviteCodes(testText3);
        assert.strictEqual(codes3.length, 2, 'Should extract both links');
        assert.ok(codes3.includes('CODE_AAA_123456789'), 'Should sanitize query and trailing dot while preserving underscore');
        assert.ok(codes3.includes('CODE_BBB_123456789'), 'Should sanitize query and trailing dot while preserving underscore');

        const testText4 = 'Ignored links: https://google.com and https://whatsapp.com/channel/0029VbBRITODzgTGQhZSFT3P';
        const codes4 = extractGroupInviteCodes(testText4);
        assert.deepStrictEqual(codes4, [], 'Should ignore non-group links');

        console.log('  ✅ Link extraction passed!\n');
    }

    // Test 2: .autojoinlinks command - ON, OFF, STATUS, and persistence
    console.log('Test 2: Command Behavior & Persistence');
    {
        const mockSock = createMockSock({ userId: '923232391033@s.whatsapp.net' }); // owner
        const ownerMsg = createMockMessage({
            remoteJid: '923232391033@s.whatsapp.net',
            fromMe: true,
            text: '.autojoinlinks on'
        });

        // 2.1 Enable
        await autojoinlinksCommand(mockSock, '923232391033@s.whatsapp.net', ownerMsg, ['on']);
        assert.strictEqual(isAutoJoinEnabled('923232391033'), true, 'Auto-join should be enabled');
        const enableReply = mockSock.sentMessages.pop();
        assert.ok(enableReply.content.text.includes('enabled successfully'), 'Enable reply text matches requirement');

        // 2.2 Status when ON
        await autojoinlinksCommand(mockSock, '923232391033@s.whatsapp.net', ownerMsg, ['status']);
        const statusReplyOn = mockSock.sentMessages.pop();
        assert.strictEqual(statusReplyOn.content.text, 'Auto Join Links: ON', 'Status reply should be ON');

        // 2.3 Persistence across reboot (reload from disk)
        const diskConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.strictEqual(diskConfig.enabled, true, 'Config on disk must persist enabled: true');

        // 2.4 Disable
        await autojoinlinksCommand(mockSock, '923232391033@s.whatsapp.net', ownerMsg, ['off']);
        assert.strictEqual(isAutoJoinEnabled('923232391033'), false, 'Auto-join should be disabled');
        const disableReply = mockSock.sentMessages.pop();
        assert.ok(disableReply.content.text.includes('disabled'), 'Disable reply text matches requirement');

        // 2.5 Status when OFF
        await autojoinlinksCommand(mockSock, '923232391033@s.whatsapp.net', ownerMsg, ['status']);
        const statusReplyOff = mockSock.sentMessages.pop();
        assert.strictEqual(statusReplyOff.content.text, 'Auto Join Links: OFF', 'Status reply should be OFF');

        console.log('  ✅ Command behavior and persistence passed!\n');
    }

    // Turn feature back ON for automatic joining tests
    fs.writeFileSync(configPath, JSON.stringify({ enabled: true, sessions: { '923232391033': { enabled: true } } }, null, 2));

    // Test 3: Detection and Auto Joining in Group Chat
    console.log('Test 3: Auto-Join in Group Chat (Non-admin sender & Bot non-admin in source chat)');
    {
        const mockSock = createMockSock({ userId: '923232391033@s.whatsapp.net' });
        const groupMsg = createMockMessage({
            remoteJid: '120363111111111111@g.us',
            participant: '923444444444@s.whatsapp.net', // Random non-admin participant
            text: 'Hey friends join our group https://chat.whatsapp.com/TEST_GRP_JOIN_001'
        });

        await handleAutoJoinLinks(mockSock, groupMsg, groupMsg.message.conversation);
        // Wait for queue tick
        await new Promise(r => setTimeout(r, 100));

        assert.strictEqual(mockSock.joinedGroups.length, 1, 'Should have joined the group');
        assert.strictEqual(mockSock.joinedGroups[0].gid, 'group_TEST_GRP_JOIN_001@g.us');

        console.log('  ✅ Group chat link detection & join passed!\n');
    }

    // Test 4: Detection and Auto Joining in Private Chat (DM)
    console.log('Test 4: Auto-Join in Personal Chat (Private DM)');
    {
        const mockSock = createMockSock({ userId: '923232391033@s.whatsapp.net' });
        const dmMsg = createMockMessage({
            remoteJid: '923555555555@s.whatsapp.net',
            text: 'Salam, please join chat.whatsapp.com/TEST_DM_JOIN_002'
        });

        await handleAutoJoinLinks(mockSock, dmMsg, dmMsg.message.conversation);
        await new Promise(r => setTimeout(r, 100));

        assert.strictEqual(mockSock.joinedGroups.length, 1, 'Should have joined the DM group');
        assert.strictEqual(mockSock.joinedGroups[0].gid, 'group_TEST_DM_JOIN_002@g.us');

        console.log('  ✅ Private DM link detection & join passed!\n');
    }

    // Test 5: Multiple invitation links in one message
    console.log('Test 5: Multiple Invitation Links in One Message');
    {
        const mockSock = createMockSock({ userId: '923232391033@s.whatsapp.net' });
        const multiMsg = createMockMessage({
            remoteJid: '120363222222222222@g.us',
            participant: '923777777777@s.whatsapp.net',
            text: 'Join both: https://chat.whatsapp.com/TEST_MULTI_LINK_A and https://chat.whatsapp.com/TEST_MULTI_LINK_B'
        });

        await handleAutoJoinLinks(mockSock, multiMsg, multiMsg.message.conversation);
        // Queue has 2.5s delay between links, wait 3 seconds
        await new Promise(r => setTimeout(r, 3100));

        assert.strictEqual(mockSock.joinedGroups.length, 2, 'Should have joined both groups');
        assert.ok(mockSock.joinedGroups.some(g => g.gid === 'group_TEST_MULTI_LINK_A@g.us'));
        assert.ok(mockSock.joinedGroups.some(g => g.gid === 'group_TEST_MULTI_LINK_B@g.us'));

        console.log('  ✅ Multiple links handled sequentially!\n');
    }

    // Test 6: Skip Already Joined Groups
    console.log('Test 6: Skip Already Joined Groups');
    {
        clearCachesForTesting();
        const alreadyMemberGroupId = 'group_ALREADY_JOINED_001@g.us';
        const mockSock = createMockSock({
            userId: '923232391033@s.whatsapp.net',
            participatingGroups: {
                [alreadyMemberGroupId]: { id: alreadyMemberGroupId, subject: 'Existing Group' }
            },
            inviteMetadata: {
                'ALREADYJOINED001': { id: alreadyMemberGroupId, subject: 'Existing Group' }
            }
        });

        const msg = createMockMessage({
            remoteJid: '120363333333333333@g.us',
            text: 'Join https://chat.whatsapp.com/ALREADYJOINED001'
        });

        await handleAutoJoinLinks(mockSock, msg, msg.message.conversation);
        await new Promise(r => setTimeout(r, 100));

        assert.strictEqual(mockSock.joinedGroups.length, 0, 'Must NOT attempt to join already-joined group');

        console.log('  ✅ Already-joined group skipped successfully!\n');
    }

    // Test 7: Duplicate Invitation Links (Prevent Duplicate Processing)
    console.log('Test 7: Prevent Duplicate Processing of Same Link');
    {
        const mockSock = createMockSock({ userId: '923232391033@s.whatsapp.net' });
        const msg = createMockMessage({
            remoteJid: '120363444444444444@g.us',
            text: 'Join https://chat.whatsapp.com/TEST_DEDUP_LINK_001'
        });

        // First message
        await handleAutoJoinLinks(mockSock, msg, msg.message.conversation);
        await new Promise(r => setTimeout(r, 100));
        assert.strictEqual(mockSock.joinedGroups.length, 1, 'First time should join');

        // Repeated message with same link
        const msg2 = createMockMessage({
            remoteJid: '120363555555555555@g.us',
            text: 'Forwarded: Join https://chat.whatsapp.com/TEST_DEDUP_LINK_001'
        });
        await handleAutoJoinLinks(mockSock, msg2, msg2.message.conversation);
        await new Promise(r => setTimeout(r, 100));

        assert.strictEqual(mockSock.joinedGroups.length, 1, 'Should NOT join again when link is duplicated');

        console.log('  ✅ Duplicate links prevented from repeated join!\n');
    }

    // Test 8: Graceful Handling of Invalid / Expired / 409 / 404 Links
    console.log('Test 8: Graceful Error Handling (Expired, Revoked, 409 Conflict)');
    {
        // 8.1 Expired link (throws 410 gone)
        const expiredError = new Error('Invite code expired');
        expiredError.status = 410;
        const mockSockExpired = createMockSock({
            userId: '923232391033@s.whatsapp.net',
            failInviteError: expiredError
        });

        const expiredMsg = createMockMessage({
            remoteJid: '120363666666666666@g.us',
            text: 'https://chat.whatsapp.com/TEST_EXPIRED_CODE_410'
        });

        // Should not throw or crash
        await handleAutoJoinLinks(mockSockExpired, expiredMsg, expiredMsg.message.conversation);
        await new Promise(r => setTimeout(r, 100));
        assert.strictEqual(mockSockExpired.joinedGroups.length, 0, 'Expired link should not be joined');

        // 8.2 Server returns 409 Conflict (already a member)
        const conflictError = new Error('Conflict');
        conflictError.status = 409;
        const mockSockConflict = createMockSock({
            userId: '923232391033@s.whatsapp.net',
            failInviteError: conflictError
        });

        const conflictMsg = createMockMessage({
            remoteJid: '120363777777777777@g.us',
            text: 'https://chat.whatsapp.com/TEST_CONFLICT_409_CODE'
        });

        await handleAutoJoinLinks(mockSockConflict, conflictMsg, conflictMsg.message.conversation);
        await new Promise(r => setTimeout(r, 100));

        console.log('  ✅ Error cases handled gracefully without crashing!\n');
    }

    // Test 9: Feature OFF stops automatic joining
    console.log('Test 9: Feature OFF stops automatic joining');
    {
        // Turn OFF
        fs.writeFileSync(configPath, JSON.stringify({ enabled: false, sessions: { '923232391033': { enabled: false } } }, null, 2));

        const mockSock = createMockSock({ userId: '923232391033@s.whatsapp.net' });
        const msg = createMockMessage({
            remoteJid: '120363888888888888@g.us',
            text: 'Join https://chat.whatsapp.com/TEST_WHEN_OFF_LINK'
        });

        await handleAutoJoinLinks(mockSock, msg, msg.message.conversation);
        await new Promise(r => setTimeout(r, 100));

        assert.strictEqual(mockSock.joinedGroups.length, 0, 'No groups should be joined when OFF');

        console.log('  ✅ Feature OFF completely ignores links!\n');
    }

    console.log('🎉 All 9 test scenarios passed successfully!');
    process.exit(0);
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});

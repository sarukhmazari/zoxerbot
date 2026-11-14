const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Ensure isolated test data file
const testDataFile = path.join(__dirname, '../data/autoreqaccept.json');
const originalData = fs.existsSync(testDataFile) ? fs.readFileSync(testDataFile, 'utf8') : null;

// Require module
const autoreq = require('../commands/autoreqaccept');

async function runTests() {
    console.log('🧪 Starting autoreqaccept test suite...\n');

    const testPrivateId = '923001234567@s.whatsapp.net';
    const testAdminSender = '923001111111@s.whatsapp.net';
    const testNonAdminSender = '923002222222@s.whatsapp.net';

    // Mock socket factory
    function createMockSocket(options = {}) {
        const sentMessages = [];
        const approvedParticipants = [];
        let pendingRequests = options.pendingRequests || [];

        return {
            sentMessages,
            approvedParticipants,
            user: { id: '923009999999:1@s.whatsapp.net' },
            groupMetadata: async (jid) => ({
                id: jid,
                subject: 'Test Group Approval',
                participants: [
                    { id: '923009999999@s.whatsapp.net', admin: options.botIsAdmin ? 'admin' : null },
                    { id: testAdminSender, admin: 'admin' },
                    { id: testNonAdminSender, admin: null }
                ]
            }),
            groupRequestParticipantsList: async (jid) => {
                return pendingRequests.map(p => ({ jid: p }));
            },
            groupRequestParticipantsUpdate: async (jid, participants, action) => {
                if (action === 'approve') {
                    for (const p of participants) {
                        approvedParticipants.push(p);
                    }
                    // remove approved from pending list
                    pendingRequests = pendingRequests.filter(p => !participants.includes(p));
                }
                return participants.map(p => ({ status: 200, jid: p }));
            },
            sendMessage: async (jid, content, opts) => {
                sentMessages.push({ jid, content, opts });
                return { key: { id: 'msg-' + Date.now() } };
            }
        };
    }

    try {
        // Test 1: Rejection in Private Chat
        console.log('Test 1: Rejection in non-group (DM)...');
        {
            const sock = createMockSocket();
            await autoreq.autoreqacceptCommand(sock, testPrivateId, testAdminSender, {}, ['on']);
            assert.strictEqual(sock.sentMessages.length, 1);
            assert.ok(sock.sentMessages[0].content.text.includes('only be used in groups'));
            console.log('  ✅ Passed');
        }

        // Test 2: Rejection for non-admin user
        console.log('Test 2: Rejection for non-admin user...');
        {
            const gid = '123-nonadmin-test@g.us';
            const sock = createMockSocket({ botIsAdmin: true });
            await autoreq.autoreqacceptCommand(sock, gid, testNonAdminSender, {}, ['on']);
            assert.strictEqual(sock.sentMessages.length, 1);
            assert.ok(sock.sentMessages[0].content.text.includes('Only group admins'));
            console.log('  ✅ Passed');
        }

        // Test 3: Warning if bot is not admin
        console.log('Test 3: Warning if bot is not admin...');
        {
            const gid = '123-botnotadmin-test@g.us';
            const sock = createMockSocket({ botIsAdmin: false });
            await autoreq.autoreqacceptCommand(sock, gid, testAdminSender, {}, ['on']);
            assert.strictEqual(sock.sentMessages.length, 1);
            assert.ok(sock.sentMessages[0].content.text.toLowerCase().includes('bot must be an admin'));
            console.log('  ✅ Passed');
        }

        // Test 4: Enable command (.autoreqaccept on)
        console.log('Test 4: Enable .autoreqaccept on...');
        const testGroupId = '123-batch-test@g.us';
        {
            const sock = createMockSocket({ botIsAdmin: true, pendingRequests: [] });
            await autoreq.autoreqacceptCommand(sock, testGroupId, testAdminSender, {}, ['on']);
            assert.strictEqual(sock.sentMessages.length, 1);
            assert.ok(sock.sentMessages[0].content.text.includes('Enabled'));
            assert.strictEqual(autoreq.isGroupAutoReqEnabled(testGroupId), true);
            console.log('  ✅ Passed');
        }

        // Test 5: Status command (.autoreqaccept)
        console.log('Test 5: Status display (.autoreqaccept)...');
        {
            const sock = createMockSocket({ botIsAdmin: true, pendingRequests: ['user1@s.whatsapp.net', 'user2@s.whatsapp.net'] });
            await autoreq.autoreqacceptCommand(sock, testGroupId, testAdminSender, {}, []);
            assert.strictEqual(sock.sentMessages.length, 1);
            assert.ok(sock.sentMessages[0].content.text.includes('Enabled'));
            assert.ok(sock.sentMessages[0].content.text.includes('Batch Size:'));
            console.log('  ✅ Passed');
        }

        // Test 6: Safe batch approval logic (max 5 per batch)
        console.log('Test 6: Batch approval logic (Anti-ban safe pacing: 5 at a time)...');
        {
            if (autoreq.scheduledBatchTimers.has(testGroupId)) {
                clearTimeout(autoreq.scheduledBatchTimers.get(testGroupId));
                autoreq.scheduledBatchTimers.delete(testGroupId);
            }

            // 7 requests pending: batch should approve 5 and schedule next batch
            const pendingList = [
                'p1@s.whatsapp.net',
                'p2@s.whatsapp.net',
                'p3@s.whatsapp.net',
                'p4@s.whatsapp.net',
                'p5@s.whatsapp.net',
                'p6@s.whatsapp.net',
                'p7@s.whatsapp.net'
            ];
            const sock = createMockSocket({ botIsAdmin: true, pendingRequests: pendingList });
            
            const result = await autoreq.processGroupPendingRequests(sock, testGroupId, { isManual: true });
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.approved, 5, 'Should accept exactly 5 in the first batch');
            assert.strictEqual(result.remaining, 2, 'Should have 2 remaining pending requests');
            assert.strictEqual(sock.approvedParticipants.length, 5);
            assert.ok(autoreq.scheduledBatchTimers.has(testGroupId), 'Next batch timer should be scheduled');
            
            // Clean up the timer
            clearTimeout(autoreq.scheduledBatchTimers.get(testGroupId));
            autoreq.scheduledBatchTimers.delete(testGroupId);
            console.log('  ✅ Passed');
        }

        // Test 7: Disable command (.autoreqaccept off)
        console.log('Test 7: Disable .autoreqaccept off...');
        {
            const sock = createMockSocket({ botIsAdmin: true });
            await autoreq.autoreqacceptCommand(sock, testGroupId, testAdminSender, {}, ['off']);
            assert.strictEqual(sock.sentMessages.length, 1);
            assert.ok(sock.sentMessages[0].content.text.includes('Disabled'));
            assert.strictEqual(autoreq.isGroupAutoReqEnabled(testGroupId), false);
            console.log('  ✅ Passed');
        }

        // Test 8: Real-time event handler when disabled vs enabled
        console.log('Test 8: Real-time group.join-request event handler...');
        {
            const eventGroupId = '123-event-test@g.us';
            const sock = createMockSocket({ botIsAdmin: true, pendingRequests: ['newguy@s.whatsapp.net'] });
            
            // When disabled:
            let eventHandled = await autoreq.handleJoinRequestEvent(sock, { id: eventGroupId, participant: 'newguy@s.whatsapp.net' });
            assert.strictEqual(eventHandled, false, 'Should ignore event when group disabled');

            // Enable and trigger:
            const cfg = autoreq.getConfig();
            cfg.groups[eventGroupId] = { enabled: true, totalAccepted: 0 };
            autoreq.setConfig(cfg);

            eventHandled = await autoreq.handleJoinRequestEvent(sock, { id: eventGroupId, participant: 'newguy@s.whatsapp.net' });
            assert.strictEqual(eventHandled, true, 'Should accept and trigger processing when enabled');
            
            // Clean up any timer
            if (autoreq.scheduledBatchTimers.has(eventGroupId)) {
                clearTimeout(autoreq.scheduledBatchTimers.get(eventGroupId));
                autoreq.scheduledBatchTimers.delete(eventGroupId);
            }
            console.log('  ✅ Passed');
        }

        // Test 9: Persistence (load & save)
        console.log('Test 9: Persistence verify...');
        {
            const cfg = autoreq.getConfig();
            cfg.groups[testGroupId] = { enabled: true, totalAccepted: 42 };
            autoreq.setConfig(cfg);

            autoreq.loadConfig();
            assert.strictEqual(autoreq.isGroupAutoReqEnabled(testGroupId), true);
            const reloaded = autoreq.getConfig();
            assert.strictEqual(reloaded.groups[testGroupId].totalAccepted, 42);
            console.log('  ✅ Passed');
        }

        console.log('\n🎉 ALL 9 AUTOREQACCEPT TESTS PASSED SUCCESSFULLY!\n');

    } finally {
        // Restore original config file
        if (originalData !== null) {
            fs.writeFileSync(testDataFile, originalData, 'utf8');
        } else if (fs.existsSync(testDataFile)) {
            fs.unlinkSync(testDataFile);
        }
    }
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});

/**
 * Automated test suite for .antiforeign feature
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
    antiforeignCommand,
    handleAntiforeignJoin,
    handleAntiforeignMessage,
    isForeignNumber,
    getCleanPhoneNumber,
    cleanPrefix,
    parsePrefixList,
    wasKickedByAntiforeign
} = require('../commands/antiforeign');

const { setAntiforeign, getAntiforeign } = require('../lib/index');

// Mock socket factory
function createMockSock({
    userId = '923232391033:1@s.whatsapp.net',
    isBotAdmin = true,
    isSenderAdmin = true,
    participants = []
} = {}) {
    const sentMessages = [];
    const removedParticipants = [];
    const deletedMessages = [];

    const sock = {
        user: { id: userId, lid: '923232391033:1@lid' },
        sentMessages,
        removedParticipants,
        deletedMessages,

        sendMessage: async (chatId, content, opts) => {
            if (content?.delete) {
                deletedMessages.push({ chatId, key: content.delete });
            } else {
                sentMessages.push({ chatId, content, opts });
            }
            return { key: { id: 'msg_' + Date.now() } };
        },

        groupMetadata: async (chatId) => {
            const list = [...participants];
            // Ensure bot is in list
            if (!list.some(p => p.id === userId)) {
                list.push({ id: userId, admin: isBotAdmin ? 'admin' : null });
            }
            return {
                id: chatId,
                subject: 'Test Security Group',
                participants: list
            };
        },

        groupParticipantsUpdate: async (chatId, targets, action) => {
            if (action === 'remove') {
                removedParticipants.push(...targets);
            }
            return targets.map(t => ({ jid: t, status: '200' }));
        }
    };

    return sock;
}

// Mock message factory
function createMockMessage({
    remoteJid = '120363000000000000@g.us',
    senderId = '923111111111@s.whatsapp.net',
    fromMe = false,
    text = ''
} = {}) {
    return {
        key: {
            remoteJid,
            participant: remoteJid.endsWith('@g.us') ? senderId : undefined,
            fromMe,
            id: 'mock_msg_' + Math.random().toString(36).substring(7)
        },
        message: {
            conversation: text
        }
    };
}

async function runTests() {
    console.log('🧪 Starting .antiforeign test suite...\n');

    const testGroupId = '120363999999999999@g.us';

    // Test 1: Prefix and Phone Parsing
    console.log('Test 1: Prefix Cleaning & Phone Extraction');
    {
        assert.strictEqual(cleanPrefix('+92'), '92');
        assert.strictEqual(cleanPrefix('+1 800'), '1800');
        assert.strictEqual(cleanPrefix('+44-70'), '4470');

        const list = parsePrefixList('+92, +971, +966, 1800');
        assert.deepStrictEqual(list, ['92', '971', '966', '1800']);

        const phone1 = getCleanPhoneNumber('923232391033:2@s.whatsapp.net');
        assert.strictEqual(phone1, '923232391033');

        const phone2 = getCleanPhoneNumber(null, { phoneNumber: '447012345678@s.whatsapp.net' });
        assert.strictEqual(phone2, '447012345678');

        console.log('  ✅ Phone & Prefix parsing passed!\n');
    }

    // Test 2: Country Code Logic (Allow Mode vs Block Mode)
    console.log('Test 2: Country Code Filtering Evaluation');
    {
        // 2.1 Allow mode (+92 only)
        const allowConfig = { enabled: true, mode: 'allow', allowed: ['92'] };
        assert.strictEqual(isForeignNumber('923232391033', allowConfig).isForeign, false, 'Pakistan number should be allowed');
        assert.strictEqual(isForeignNumber('18005551234', allowConfig).isForeign, true, 'US 1800 should be rejected in allow 92 mode');
        assert.strictEqual(isForeignNumber('44701234567', allowConfig).isForeign, true, 'UK 4470 should be rejected in allow 92 mode');
        assert.strictEqual(isForeignNumber('23480123456', allowConfig).isForeign, true, 'Nigeria 234 should be rejected in allow 92 mode');

        // 2.2 Block mode (+1800, +4470, +234 blocked; all others allowed)
        const blockConfig = { enabled: true, mode: 'block', blocked: ['1800', '4470', '234'] };
        assert.strictEqual(isForeignNumber('923232391033', blockConfig).isForeign, false, 'Pakistan number allowed in block mode');
        assert.strictEqual(isForeignNumber('12125551234', blockConfig).isForeign, false, 'Regular US number allowed');
        assert.strictEqual(isForeignNumber('18005551234', blockConfig).isForeign, true, '1800 virtual number should be blocked');
        assert.strictEqual(isForeignNumber('44701234567', blockConfig).isForeign, true, '4470 virtual scam number should be blocked');
        assert.strictEqual(isForeignNumber('23480123456', blockConfig).isForeign, true, '234 should be blocked');

        console.log('  ✅ Filtering logic evaluation passed!\n');
    }

    // Test 3: Command Operations (.antiforeign on/off/set/block/status)
    console.log('Test 3: Command Execution & Persistence');
    {
        const adminId = '923232391033@s.whatsapp.net';
        const mockSock = createMockSock({
            userId: adminId,
            isBotAdmin: true,
            isSenderAdmin: true,
            participants: [{ id: adminId, admin: 'admin' }]
        });

        const cmdMsg = createMockMessage({
            remoteJid: testGroupId,
            senderId: adminId,
            fromMe: true
        });

        // 3.1 .antiforeign set 92,971
        await antiforeignCommand(mockSock, testGroupId, adminId, cmdMsg, ['set', '92,971']);
        let cfg = await getAntiforeign(testGroupId);
        assert.strictEqual(cfg.enabled, true);
        assert.strictEqual(cfg.mode, 'allow');
        assert.deepStrictEqual(cfg.allowed, ['92', '971']);

        // 3.2 .antiforeign block 1800,4470
        await antiforeignCommand(mockSock, testGroupId, adminId, cmdMsg, ['block', '1800,4470']);
        cfg = await getAntiforeign(testGroupId);
        assert.strictEqual(cfg.mode, 'block');
        assert.deepStrictEqual(cfg.blocked, ['1800', '4470']);

        // 3.3 .antiforeign off
        await antiforeignCommand(mockSock, testGroupId, adminId, cmdMsg, ['off']);
        cfg = await getAntiforeign(testGroupId);
        assert.strictEqual(cfg.enabled, false);

        // 3.4 .antiforeign on
        await antiforeignCommand(mockSock, testGroupId, adminId, cmdMsg, ['on']);
        cfg = await getAntiforeign(testGroupId);
        assert.strictEqual(cfg.enabled, true);

        // 3.5 .antiforeign status
        await antiforeignCommand(mockSock, testGroupId, adminId, cmdMsg, ['status']);
        const statusMsg = mockSock.sentMessages.pop();
        assert.ok(statusMsg.content.text.includes('.antiforeign'), 'Status response contains command guidance');

        console.log('  ✅ Command operations passed!\n');
    }

    // Set group to Allowlist mode with only 92 allowed for joining & message tests
    await setAntiforeign(testGroupId, {
        enabled: true,
        mode: 'allow',
        allowed: ['92'],
        blocked: ['1800', '4470', '234']
    });

    // Test 4: Member Join Interceptor (handleAntiforeignJoin)
    console.log('Test 4: Member Join Interceptor');
    {
        const botId = '923232391033@s.whatsapp.net';
        const mockSock = createMockSock({
            userId: botId,
            isBotAdmin: true,
            participants: [{ id: botId, admin: 'admin' }]
        });

        // 4.1 Allowed member joins (+92)
        await handleAntiforeignJoin(mockSock, testGroupId, ['923001234567@s.whatsapp.net']);
        assert.strictEqual(mockSock.removedParticipants.length, 0, 'Pakistan joiner must NOT be removed');

        // 4.2 Foreign member joins (+1800)
        const foreignJoiner = '18005559999@s.whatsapp.net';
        await handleAntiforeignJoin(mockSock, testGroupId, [foreignJoiner]);
        assert.strictEqual(mockSock.removedParticipants.length, 1, 'Foreign joiner must be kicked');
        assert.strictEqual(mockSock.removedParticipants[0], foreignJoiner);
        assert.strictEqual(wasKickedByAntiforeign(foreignJoiner), true, 'Kicked joiner should be tracked');

        console.log('  ✅ Member join interception passed!\n');
    }

    // Test 5: Message Activity Interceptor (handleAntiforeignMessage)
    console.log('Test 5: Group Message Activity Interceptor');
    {
        const botId = '923232391033@s.whatsapp.net';
        const mockSock = createMockSock({
            userId: botId,
            isBotAdmin: true,
            participants: [{ id: botId, admin: 'admin' }]
        });

        // 5.1 Local member sends message (+92)
        const localMsg = createMockMessage({
            remoteJid: testGroupId,
            senderId: '923451234567@s.whatsapp.net',
            text: 'Hello group!'
        });
        const handledLocal = await handleAntiforeignMessage(mockSock, testGroupId, localMsg, '923451234567@s.whatsapp.net');
        assert.strictEqual(handledLocal, false, 'Local message should not be blocked');
        assert.strictEqual(mockSock.deletedMessages.length, 0);

        // 5.2 Foreign chatter sends message (+234)
        const foreignMsg = createMockMessage({
            remoteJid: testGroupId,
            senderId: '234809999999@s.whatsapp.net',
            text: 'Spam link here'
        });
        const handledForeign = await handleAntiforeignMessage(mockSock, testGroupId, foreignMsg, '234809999999@s.whatsapp.net');
        assert.strictEqual(handledForeign, true, 'Foreign message must be intercepted');
        assert.strictEqual(mockSock.deletedMessages.length, 1, 'Foreign message must be deleted');
        assert.ok(mockSock.removedParticipants.includes('234809999999@s.whatsapp.net'), 'Foreign chatter must be removed');

        console.log('  ✅ Message activity interception passed!\n');
    }

    // Test 6: Exemption Safeguards (Admin, Owner, Bot never kicked)
    console.log('Test 6: Exemption Safeguards (Admins & Owners protected)');
    {
        const testGroupId_6 = '120363666666666666@g.us';
        await setAntiforeign(testGroupId_6, {
            enabled: true,
            mode: 'allow',
            allowed: ['92']
        });

        const botId = '923232391033@s.whatsapp.net';
        const foreignAdminId = '12125550000@s.whatsapp.net'; // US Admin
        const mockSock = createMockSock({
            userId: botId,
            isBotAdmin: true,
            participants: [
                { id: botId, admin: 'admin' },
                { id: foreignAdminId, admin: 'admin' }
            ]
        });

        // Foreign admin sends message
        const adminMsg = createMockMessage({
            remoteJid: testGroupId_6,
            senderId: foreignAdminId,
            text: 'Admin notice'
        });
        const handledAdmin = await handleAntiforeignMessage(mockSock, testGroupId_6, adminMsg, foreignAdminId);
        assert.strictEqual(handledAdmin, false, 'Group admin must NEVER be kicked');

        console.log('  ✅ Admin exemption safeguards passed!\n');
    }

    // Test 7: Group Scan & Clean (.antiforeign scan)
    console.log('Test 7: Group Scan & Clean Existing Foreign Numbers');
    {
        const testGroupId_7 = '120363777777777777@g.us';
        await setAntiforeign(testGroupId_7, {
            enabled: true,
            mode: 'allow',
            allowed: ['92']
        });

        const adminId = '923232391033@s.whatsapp.net';
        const mockSock = createMockSock({
            userId: adminId,
            isBotAdmin: true,
            isSenderAdmin: true,
            participants: [
                { id: adminId, admin: 'admin' },
                { id: '923001111111@s.whatsapp.net', admin: null },
                { id: '447088888888@s.whatsapp.net', admin: null }, // Foreign #1
                { id: '180077777777@s.whatsapp.net', admin: null }  // Foreign #2
            ]
        });

        const scanMsg = createMockMessage({
            remoteJid: testGroupId_7,
            senderId: adminId,
            fromMe: true
        });

        await antiforeignCommand(mockSock, testGroupId_7, adminId, scanMsg, ['scan']);
        assert.strictEqual(mockSock.removedParticipants.length, 2, 'Must have kicked the 2 foreign members');
        assert.ok(mockSock.removedParticipants.includes('447088888888@s.whatsapp.net'));
        assert.ok(mockSock.removedParticipants.includes('180077777777@s.whatsapp.net'));

        console.log('  ✅ Group scan and clean passed!\n');
    }

    console.log('🎉 All 7 test suites for .antiforeign passed successfully!');
    process.exit(0);
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});

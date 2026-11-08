const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Ensure .env is loaded
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const {
    smartreplyCommand,
    getSmartReplyStatus,
    setSmartReplyStatus,
    handleSmartReplyMessage,
    getConversationHistory,
    clearAllConversationHistory
} = require('../commands/smartreply');

// Create Mock WhatsApp Socket
function createMockSocket() {
    const sentMessages = [];
    const presenceUpdates = [];

    return {
        sentMessages,
        presenceUpdates,
        user: {
            id: '923232391033:1@s.whatsapp.net',
            name: 'ZOXER BOT'
        },
        sendMessage: async (chatId, content, options) => {
            sentMessages.push({ chatId, content, options, timestamp: Date.now() });
            return { key: { id: 'MOCK_SENT_' + Math.random().toString(36).substring(7) } };
        },
        sendPresenceUpdate: async (type, chatId) => {
            presenceUpdates.push({ type, chatId, timestamp: Date.now() });
        }
    };
}

function createMockMessage(text, senderId, chatId, options = {}) {
    return {
        key: {
            remoteJid: chatId,
            fromMe: options.fromMe || false,
            id: options.id || 'MSG_' + Math.random().toString(36).substring(7),
            participant: options.isGroup ? senderId : undefined
        },
        message: {
            conversation: text
        }
    };
}

async function runTests() {
    console.log('\n======================================================');
    console.log('🧪 RUNNING GEMINI AI SMART REPLY TEST SUITE');
    console.log('======================================================\n');

    const testChatId = '923001234567@s.whatsapp.net';
    const testSenderId = '923001234567@s.whatsapp.net';
    const ownerSenderId = '923232391033@s.whatsapp.net';
    const mockSock = createMockSocket();

    // ----------------------------------------------------------------
    // SCENARIO 1: Enable smartreply
    // ----------------------------------------------------------------
    console.log('▶ [1/12] Testing .smartreply on command...');
    const cmdMsgOn = createMockMessage('.smartreply on', ownerSenderId, testChatId);
    await smartreplyCommand(mockSock, testChatId, cmdMsgOn, ['on'], ownerSenderId, false);
    assert.strictEqual(getSmartReplyStatus(), true, 'SmartReply should be enabled');
    console.log('   ✅ SmartReply enabled successfully. Status: ON');

    // ----------------------------------------------------------------
    // SCENARIO 2: Send "Hi"
    // ----------------------------------------------------------------
    console.log('\n▶ [2/12] Testing greeting "Hi"...');
    mockSock.sentMessages.length = 0;
    const msgHi = createMockMessage('Hi', testSenderId, testChatId);
    const repliedHi = await handleSmartReplyMessage(mockSock, testChatId, msgHi, 'Hi', testSenderId, false);
    assert.strictEqual(repliedHi, true, 'Should successfully auto-reply to "Hi"');
    assert.ok(mockSock.sentMessages.length > 0, 'A message should be sent');
    const hiReplyText = mockSock.sentMessages[0].content.text;
    console.log('   ✅ Bot Response:', hiReplyText);
    assert.ok(hiReplyText.length > 0);

    // Sleep briefly to avoid tripping anti-spam cooldown
    await new Promise(r => setTimeout(r, 2600));

    // ----------------------------------------------------------------
    // SCENARIO 3: Send "How are you?"
    // ----------------------------------------------------------------
    console.log('\n▶ [3/12] Testing "How are you?"...');
    mockSock.sentMessages.length = 0;
    const msgHow = createMockMessage('How are you?', testSenderId, testChatId);
    const repliedHow = await handleSmartReplyMessage(mockSock, testChatId, msgHow, 'How are you?', testSenderId, false);
    assert.strictEqual(repliedHow, true);
    console.log('   ✅ Bot Response:', mockSock.sentMessages[0].content.text);

    await new Promise(r => setTimeout(r, 2600));

    // ----------------------------------------------------------------
    // SCENARIO 4: Ask a general knowledge question
    // ----------------------------------------------------------------
    console.log('\n▶ [4/12] Testing general knowledge: "What is the speed of light?"...');
    mockSock.sentMessages.length = 0;
    const msgGK = createMockMessage('What is the speed of light?', testSenderId, testChatId);
    const repliedGK = await handleSmartReplyMessage(mockSock, testChatId, msgGK, 'What is the speed of light?', testSenderId, false);
    assert.strictEqual(repliedGK, true);
    const gkResponse = mockSock.sentMessages[0].content.text;
    console.log('   ✅ Bot Response:', gkResponse);
    assert.ok(gkResponse.toLowerCase().includes('300') || gkResponse.toLowerCase().includes('speed') || gkResponse.toLowerCase().includes('light') || gkResponse.toLowerCase().includes('second'));

    await new Promise(r => setTimeout(r, 2600));

    // ----------------------------------------------------------------
    // SCENARIO 5: Ask about the bot's commands
    // ----------------------------------------------------------------
    console.log('\n▶ [5/12] Testing bot commands inquiry: "Which commands do you have?"...');
    mockSock.sentMessages.length = 0;
    const msgCmds = createMockMessage('Which commands do you have?', testSenderId, testChatId);
    const repliedCmds = await handleSmartReplyMessage(mockSock, testChatId, msgCmds, 'Which commands do you have?', testSenderId, false);
    assert.strictEqual(repliedCmds, true);
    const cmdsResponse = mockSock.sentMessages[0].content.text;
    console.log('   ✅ Bot Response:', cmdsResponse);
    assert.ok(cmdsResponse.includes('.') || cmdsResponse.toLowerCase().includes('command'));

    await new Promise(r => setTimeout(r, 2600));

    // ----------------------------------------------------------------
    // SCENARIO 6: Send a Roman Urdu message
    // ----------------------------------------------------------------
    console.log('\n▶ [6/12] Testing Roman Urdu: "Aoa bhai kya chal raha hai?"...');
    mockSock.sentMessages.length = 0;
    const msgUrdu = createMockMessage('Aoa bhai kya chal raha hai?', testSenderId, testChatId);
    const repliedUrdu = await handleSmartReplyMessage(mockSock, testChatId, msgUrdu, 'Aoa bhai kya chal raha hai?', testSenderId, false);
    assert.strictEqual(repliedUrdu, true);
    console.log('   ✅ Bot Response:', mockSock.sentMessages[0].content.text);

    await new Promise(r => setTimeout(r, 2600));

    // ----------------------------------------------------------------
    // SCENARIO 7: Send an Urdu message
    // ----------------------------------------------------------------
    console.log('\n▶ [7/12] Testing Urdu script: "السلام علیکم! آپ کا مالک کون ہے؟"...');
    mockSock.sentMessages.length = 0;
    const msgUrduScript = createMockMessage('السلام علیکم! آپ کا مالک کون ہے؟', testSenderId, testChatId);
    const repliedUrduScript = await handleSmartReplyMessage(mockSock, testChatId, msgUrduScript, 'السلام علیکم! آپ کا مالک کون ہے؟', testSenderId, false);
    assert.strictEqual(repliedUrduScript, true);
    console.log('   ✅ Bot Response:', mockSock.sentMessages[0].content.text);

    await new Promise(r => setTimeout(r, 2600));

    // ----------------------------------------------------------------
    // SCENARIO 8: Continue conversation (context verification)
    // ----------------------------------------------------------------
    console.log('\n▶ [8/12] Testing conversation context memory retention...');
    const history = getConversationHistory(testChatId);
    assert.ok(history.length >= 2, `Conversation memory should contain turns, got: ${history.length}`);
    console.log(`   ✅ Conversation memory contains ${history.length} messages (user & assistant turns).`);

    // ----------------------------------------------------------------
    // SCENARIO 9: Send multiple messages quickly (Rate Limit / Concurrency)
    // ----------------------------------------------------------------
    console.log('\n▶ [9/12] Testing rapid message spam (anti-flood concurrency lock)...');
    const msgSpam1 = createMockMessage('Rapid test 1', testSenderId, testChatId);
    const msgSpam2 = createMockMessage('Rapid test 2', testSenderId, testChatId);
    
    // Dispatch two messages concurrently
    const [res1, res2] = await Promise.all([
        handleSmartReplyMessage(mockSock, testChatId, msgSpam1, 'Rapid test 1', testSenderId, false),
        handleSmartReplyMessage(mockSock, testChatId, msgSpam2, 'Rapid test 2', testSenderId, false)
    ]);

    // One must succeed, the other must be safely dropped by the active concurrency lock!
    assert.ok((res1 && !res2) || (!res1 && res2), 'Concurrent message should be blocked by activeProcessing lock');
    console.log('   ✅ Concurrency & anti-flood lock verified: duplicate concurrent request dropped safely.');

    await new Promise(r => setTimeout(r, 2600));

    // ----------------------------------------------------------------
    // SCENARIO 10: Disable smartreply
    // ----------------------------------------------------------------
    console.log('\n▶ [10/12] Testing .smartreply off command...');
    const cmdMsgOff = createMockMessage('.smartreply off', ownerSenderId, testChatId);
    await smartreplyCommand(mockSock, testChatId, cmdMsgOff, ['off'], ownerSenderId, false);
    assert.strictEqual(getSmartReplyStatus(), false, 'SmartReply should be disabled');
    console.log('   ✅ SmartReply disabled successfully. Status: OFF');

    // ----------------------------------------------------------------
    // SCENARIO 11: Send message when disabled (Verify no reply is generated)
    // ----------------------------------------------------------------
    console.log('\n▶ [11/12] Testing message while smartreply is OFF...');
    mockSock.sentMessages.length = 0;
    const msgDisabled = createMockMessage('Hello anyone there?', testSenderId, testChatId);
    const repliedDisabled = await handleSmartReplyMessage(mockSock, testChatId, msgDisabled, 'Hello anyone there?', testSenderId, false);
    assert.strictEqual(repliedDisabled, false, 'No reply should be generated when SmartReply is disabled');
    assert.strictEqual(mockSock.sentMessages.length, 0, 'No WhatsApp message should be dispatched');
    console.log('   ✅ Verified: Zero AI requests/replies when disabled.');

    // ----------------------------------------------------------------
    // SCENARIO 12: Persistence check (File verification)
    // ----------------------------------------------------------------
    console.log('\n▶ [12/12] Testing configuration persistence in data/smartReply.json...');
    const dataFilePath = path.join(__dirname, '../data/smartReply.json');
    const fileContent = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
    assert.strictEqual(fileContent.enabled, false);
    console.log('   ✅ Verified persisted file content:', JSON.stringify(fileContent));

    console.log('\n======================================================');
    console.log('🎉 ALL 12 TEST SCENARIOS PASSED PERFECTLY!');
    console.log('======================================================\n');
}

runTests().catch(err => {
    console.error('\n❌ TEST FAILED:', err);
    process.exit(1);
});

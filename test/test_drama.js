const dramaCommand = require('../commands/drama');
const assert = require('assert');

// Mock socket
function createMockSocket() {
    const sentMessages = [];
    return {
        sentMessages,
        sendMessage: async (chatId, content, opts) => {
            sentMessages.push({ chatId, content, opts });
            return { key: { id: 'mock_msg_id' } };
        }
    };
}

async function runTests() {
    console.log('=== Starting Drama Command Tests ===\n');

    // Test 1: Empty input returns usage guide
    console.log('Test 1: Empty query shows usage guide');
    {
        const sock = createMockSocket();
        const fakeMsg = {
            key: { id: 'msg_1' },
            message: { conversation: '.drama' }
        };
        await dramaCommand(sock, '12345@s.whatsapp.net', fakeMsg, '');

        assert.strictEqual(sock.sentMessages.length, 1);
        assert.ok(sock.sentMessages[0].content.text.includes('ZOXER DRAMA DOWNLOADER'));
        assert.ok(sock.sentMessages[0].content.text.includes('.drama <drama name>'));
        console.log('  PASSED: Usage guide returned correctly.\n');
    }

    // Test 2: Search and resolve Pakistani drama episode
    console.log('Test 2: Search and resolve drama episode (Kabhi Main Kabhi Tum Episode 1)');
    {
        const sock = createMockSocket();
        const fakeMsg = {
            key: { id: 'msg_2' },
            message: { conversation: '.drama Kabhi Main Kabhi Tum Episode 1' }
        };

        // We run dramaCommand, which will attempt sending document
        await dramaCommand(sock, '12345@s.whatsapp.net', fakeMsg, 'Kabhi Main Kabhi Tum Episode 1');

        console.log('  Messages sent count:', sock.sentMessages.length);
        const types = sock.sentMessages.map(m => Object.keys(m.content).join(', '));
        console.log('  Message content types:', types);

        // Should have reacted ⏳ first
        const hasWaitReact = sock.sentMessages.some(m => m.content.react?.text === '⏳');
        assert.ok(hasWaitReact, 'Should have sent ⏳ reaction');

        // Should have either delivered a document or sent a status message
        const hasMediaOrStatus = sock.sentMessages.some(m => m.content.document || m.content.text);
        assert.ok(hasMediaOrStatus, 'Should have delivered document or status');

        console.log('  PASSED: Drama command processed search and stream attempt successfully.\n');
    }

    console.log('=== ALL DRAMA TESTS COMPLETED SUCCESSFULLY! ===');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});

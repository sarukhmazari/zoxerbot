const assert = require('assert');
const fs = require('fs');
const {
    img2pdfCommand,
    handlePdfSessionImage,
    buildPdfFromImages,
    sanitizeFileName,
    formatSize,
    pdfSessions
} = require('../commands/img2pdf');
const { PDFDocument } = require('pdf-lib');
const { Jimp } = require('jimp');

console.log('========================================================');
console.log('🧪 RUNNING COMPREHENSIVE IMG2PDF TEST SUITE');
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

async function createSampleImage(width = 300, height = 400, color = 0x00AAFFFF) {
    const img = new Jimp({ width, height, color });
    return await img.getBuffer('image/png');
}

async function runAll() {
    // 1. Test sanitizeFileName
    test('sanitizeFileName formats and sanitizes file names safely', () => {
        assert.strictEqual(sanitizeFileName('My Document.pdf'), 'My_Document');
        assert.strictEqual(sanitizeFileName('Invoice #1234/test!'), 'Invoice_1234test');
        assert.strictEqual(sanitizeFileName(''), 'Document');
        assert.strictEqual(sanitizeFileName('   '), 'Document');
        assert.strictEqual(sanitizeFileName('Physics_Assignment'), 'Physics_Assignment');
    });

    // 2. Test formatSize
    test('formatSize formats byte sizes into readable units', () => {
        assert.strictEqual(formatSize(500), '500 B');
        assert.strictEqual(formatSize(2048), '2.0 KB');
        assert.strictEqual(formatSize(5242880), '5.00 MB');
    });

    // 3. Test buildPdfFromImages with multiple pages
    await asyncTest('buildPdfFromImages compiles multiple image buffers into a valid multi-page PDF', async () => {
        const img1 = await createSampleImage(200, 200, 0xFF0000FF);
        const img2 = await createSampleImage(300, 400, 0x00FF00FF);
        const img3 = await createSampleImage(500, 300, 0x0000FFFF);

        const pdfBuffer = await buildPdfFromImages([img1, img2, img3], 'Test_Doc');
        assert.ok(pdfBuffer && pdfBuffer.length > 0, 'PDF buffer must not be empty');

        // Load the generated PDF with pdf-lib to inspect pages
        const loadedPdf = await PDFDocument.load(pdfBuffer);
        assert.strictEqual(loadedPdf.getPageCount(), 3, 'Must have exactly 3 pages');
        assert.strictEqual(loadedPdf.getTitle(), 'Test_Doc');
    });

    // 4. Test img2pdfCommand usage card when no image and no session
    await asyncTest('img2pdfCommand sends usage card when no image and no subcommand given', async () => {
        const sent = [];
        const mockSock = {
            sendMessage: async (jid, content, options) => {
                sent.push({ jid, content, options });
                return { key: { id: 'sent_1' } };
            }
        };

        const msg = {
            key: { remoteJid: '1203639999@g.us', participant: '923001234567@s.whatsapp.net' },
            message: { conversation: '.img2pdf' }
        };

        await img2pdfCommand(mockSock, '1203639999@g.us', msg, '');
        assert.strictEqual(sent.length, 1);
        assert.ok(sent[0].content.text.includes('IMG TO PDF CONVERTER'));
    });

    // 5. Test multi-image session workflow (start -> add images -> status -> done)
    await asyncTest('Full multi-image batch session flow (start, add, status, done)', async () => {
        const sent = [];
        const mockSock = {
            sendMessage: async (jid, content, options) => {
                sent.push({ jid, content, options });
                return { key: { id: 'sent_' + Date.now() } };
            }
        };

        const userJid = '923119999999@s.whatsapp.net';
        const chatId = '1203631111@g.us';

        // Step 1: Start session
        const startMsg = {
            key: { remoteJid: chatId, participant: userJid },
            message: { conversation: '.img2pdf start Biology_Notes' }
        };
        await img2pdfCommand(mockSock, chatId, startMsg, 'start Biology_Notes');
        assert.strictEqual(pdfSessions.has(userJid), true, 'Session must be created');
        const session = pdfSessions.get(userJid);
        assert.strictEqual(session.fileName, 'Biology_Notes');
        assert.ok(sent[0].content.text.includes('PDF SESSION STARTED'));

        // Step 2: Add image 1 via handlePdfSessionImage
        const sampleImg1 = await createSampleImage(200, 200, 0xFF0000FF);
        session.images.push(sampleImg1); // Simulate downloaded image push

        // Step 3: Add image 2
        const sampleImg2 = await createSampleImage(300, 300, 0x00FF00FF);
        session.images.push(sampleImg2);

        // Step 4: Check status
        const statusMsg = {
            key: { remoteJid: chatId, participant: userJid },
            message: { conversation: '.img2pdf status' }
        };
        await img2pdfCommand(mockSock, chatId, statusMsg, 'status');
        assert.ok(sent[sent.length - 1].content.text.includes('Pages Collected'));
        assert.ok(sent[sent.length - 1].content.text.includes('2'));

        // Step 5: Finish session with .img2pdf done
        const doneMsg = {
            key: { remoteJid: chatId, participant: userJid },
            message: { conversation: '.img2pdf done' }
        };
        await img2pdfCommand(mockSock, chatId, doneMsg, 'done');
        assert.strictEqual(pdfSessions.has(userJid), false, 'Session must be cleared on done');

        // Verify document message was sent
        const docMsg = sent.find(s => s.content && s.content.document);
        assert.ok(docMsg, 'Must send PDF document message');
        assert.strictEqual(docMsg.content.fileName, 'Biology_Notes.pdf');
        assert.strictEqual(docMsg.content.mimetype, 'application/pdf');

        // Verify PDF integrity
        const loaded = await PDFDocument.load(docMsg.content.document);
        assert.strictEqual(loaded.getPageCount(), 2, 'Generated PDF must have 2 pages');
    });

    // 6. Test cancel session (.img2pdf cancel)
    await asyncTest('Cancel session clears active PDF session cleanly', async () => {
        const sent = [];
        const mockSock = {
            sendMessage: async (jid, content, options) => {
                sent.push({ jid, content, options });
                return { key: { id: 'sent_c' } };
            }
        };

        const userJid = '923228888888@s.whatsapp.net';
        const chatId = '923228888888@s.whatsapp.net';

        // Start
        await img2pdfCommand(mockSock, chatId, {
            key: { remoteJid: chatId, participant: userJid },
            message: { conversation: '.img2pdf start Temp' }
        }, 'start Temp');
        assert.strictEqual(pdfSessions.has(userJid), true);

        // Cancel
        await img2pdfCommand(mockSock, chatId, {
            key: { remoteJid: chatId, participant: userJid },
            message: { conversation: '.img2pdf cancel' }
        }, 'cancel');
        assert.strictEqual(pdfSessions.has(userJid), false, 'Session must be removed on cancel');
        assert.ok(sent[sent.length - 1].content.text.includes('Cancelled'));
    });

    console.log('\n========================================================');
    console.log(`📊 FINAL RESULT: ${passed} passed, ${failed} failed.`);
    console.log('========================================================');
    if (failed > 0) process.exit(1);
}

runAll().catch(e => {
    console.error('Fatal test error:', e);
    process.exit(1);
});

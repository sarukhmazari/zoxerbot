const fs = require('fs');
const path = require('path');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { runYtDlp, getCookiesPath, buildBaseYtDlpArgs } = require('../lib/ytdlp-helper');

const rootCookiesPath = path.join(process.cwd(), 'cookies.txt');

async function testCookiesFile() {
    try {
        const testArgs = buildBaseYtDlpArgs([
            '--print', '%(title)s',
            'https://www.youtube.com/watch?v=-MzYz44FWxI'
        ]);
        const title = await runYtDlp(testArgs, 20000);
        return { success: true, title };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function cookiesCommand(sock, chatId, message, args = '') {
    const rawText = (
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        ''
    ).trim();

    const isSet = /^\.setcookies/i.test(rawText) || /^\.cookies\s+set/i.test(rawText);

    if (isSet) {
        // Try getting document attachment from message or quoted message
        const targetMessage = message.message?.documentMessage
            ? message
            : message.message?.extendedTextMessage?.contextInfo?.quotedMessage?.documentMessage
                ? { message: message.message.extendedTextMessage.contextInfo.quotedMessage }
                : null;

        let cookieContent = null;

        if (targetMessage) {
            try {
                const buffer = await downloadMediaMessage(targetMessage, 'buffer', {});
                cookieContent = buffer.toString('utf-8');
            } catch (dErr) {
                return await sock.sendMessage(chatId, {
                    text: `❌ *Failed to download attached cookies file:* ${dErr.message}`
                }, { quoted: message });
            }
        } else {
            // Text argument passed directly
            const inlineText = rawText.replace(/^\.(setcookies|cookies\s+set)\s*/i, '').trim();
            if (inlineText && (inlineText.includes('youtube.com') || inlineText.includes('Netscape'))) {
                cookieContent = inlineText;
            }
        }

        if (!cookieContent) {
            return await sock.sendMessage(chatId, {
                text: '🍪 *How to upload YouTube cookies:*\n\n' +
                      '1. Export your YouTube cookies using the *"Get cookies.txt LOCALLY"* extension.\n' +
                      '2. Send the `cookies.txt` file as a document to this chat with the caption:\n' +
                      '   *.setcookies*\n' +
                      '   (Or reply to an existing document with `.setcookies`).'
            }, { quoted: message });
        }

        // Save to root cookies.txt
        fs.writeFileSync(rootCookiesPath, cookieContent, 'utf-8');
        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

        // Run validation test
        const testRes = await testCookiesFile();
        if (testRes.success) {
            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
            return await sock.sendMessage(chatId, {
                text: `✅ *YouTube cookies successfully saved & verified!*\n\n` +
                      `🎬 *Test Stream:* "${testRes.title}"\n` +
                      `🚀 *All .song, .video, and .spotify downloads are now 100% active!*`
            }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, { react: { text: '⚠️', key: message.key } });
            return await sock.sendMessage(chatId, {
                text: `⚠️ *Cookies saved, but YouTube test returned an error:*\n\n${testRes.error}\n\n` +
                      `*Tip:* Ensure you were logged into YouTube in your browser before exporting.`
            }, { quoted: message });
        }
    }

    // Default: Check cookies status
    const currentPath = getCookiesPath();
    if (!currentPath || !fs.existsSync(currentPath)) {
        return await sock.sendMessage(chatId, {
            text: '🍪 *YouTube Cookies Status: NOT CONFIGURED*\n\n' +
                  '⚠️ YouTube blocks datacenter VPS servers (AWS Lightsail) without cookies.\n\n' +
                  '*How to enable downloads in 3 steps:*\n' +
                  '1. In Chrome / Firefox, install the free extension *"Get cookies.txt LOCALLY"*.\n' +
                  '2. Open https://youtube.com while logged into your account.\n' +
                  '3. Click the extension, export `cookies.txt`, and send the file here with caption: *.setcookies*'
        }, { quoted: message });
    }

    const stat = fs.statSync(currentPath);
    await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } });
    const testRes = await testCookiesFile();

    if (testRes.success) {
        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
        return await sock.sendMessage(chatId, {
            text: `🍪 *YouTube Cookies Status: ACTIVE & VALID* ✅\n\n` +
                  `📁 *File:* \`${path.basename(currentPath)}\`\n` +
                  `📦 *Size:* ${(stat.size / 1024).toFixed(1)} KB\n` +
                  `🕒 *Updated:* ${stat.mtime.toLocaleString()}\n` +
                  `🎯 *Stream Test:* "${testRes.title}"\n\n` +
                  `All audio and video downloads are running with authenticated YouTube access!`
        }, { quoted: message });
    } else {
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        return await sock.sendMessage(chatId, {
            text: `🍪 *YouTube Cookies Status: EXPIRED OR INVALID* ❌\n\n` +
                  `*Error:* ${testRes.error}\n\n` +
                  `*Fix:* Export a fresh \`cookies.txt\` from your browser and send it with caption *.setcookies*.`
        }, { quoted: message });
    }
}

module.exports = cookiesCommand;

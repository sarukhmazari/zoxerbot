const { downloadMediaMessage, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { PDFDocument } = require('pdf-lib');
const { Jimp } = require('jimp');

// Active multi-image PDF sessions: Map<userJid, { chatId, fileName, images: Buffer[], timer: Timeout, createdAt: number }>
const pdfSessions = new Map();
const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes timeout

// Standard A4 dimensions in PDF points
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 20;
const MAX_CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const MAX_CONTENT_HEIGHT = PAGE_HEIGHT - 2 * MARGIN;

function cleanJid(jid) {
    if (!jid) return '';
    return jid.replace(/:.*@/, '@');
}

function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return bytes + ' B';
}

function sanitizeFileName(name) {
    if (!name) return 'Document';
    let trimmed = name.trim();
    if (trimmed.toLowerCase().endsWith('.pdf')) {
        trimmed = trimmed.slice(0, -4).trim();
    }
    let clean = trimmed.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_');
    if (!clean) clean = 'Document';
    return clean;
}

/**
 * Downloads media buffer from a message object (handles direct and quoted messages)
 */
async function extractImageBuffer(message) {
    if (!message) return null;

    let target = message;
    if (message.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        const quotedInfo = message.message.extendedTextMessage.contextInfo;
        target = {
            key: {
                remoteJid: message.key?.remoteJid,
                id: quotedInfo.stanzaId,
                participant: quotedInfo.participant
            },
            message: quotedInfo.quotedMessage
        };
    }

    const unwrapped = target.message || target;
    const imgMsg = unwrapped.imageMessage ||
                   unwrapped.documentWithCaptionMessage?.message?.documentMessage ||
                   (unwrapped.documentMessage?.mimetype?.startsWith('image/') ? unwrapped.documentMessage : null) ||
                   unwrapped.viewOnceMessage?.message?.imageMessage ||
                   unwrapped.viewOnceMessageV2?.message?.imageMessage ||
                   unwrapped.viewOnceMessageV2Extension?.message?.imageMessage ||
                   unwrapped.ephemeralMessage?.message?.imageMessage;

    if (!imgMsg) return null;

    try {
        const buffer = await downloadMediaMessage(target, 'buffer', {}, {
            logger: undefined
        });
        if (buffer && buffer.length > 0) return buffer;
    } catch (_) {}

    try {
        const stream = await downloadContentFromMessage(imgMsg, 'image');
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const buf = Buffer.concat(chunks);
        if (buf && buf.length > 0) return buf;
    } catch (_) {}

    return null;
}

/**
 * Embeds an image buffer safely into a PDFDocument (with Jimp fallback)
 */
async function embedImageInPdf(doc, imageBuffer) {
    // 1. Direct JPEG
    if (imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8) {
        try {
            return await doc.embedJpg(imageBuffer);
        } catch (_) {}
    }

    // 2. Direct PNG
    if (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 && imageBuffer[2] === 0x4E && imageBuffer[3] === 0x47) {
        try {
            return await doc.embedPng(imageBuffer);
        } catch (_) {}
    }

    // 3. Fallback: normalize through Jimp to PNG
    try {
        const jimpImg = await Jimp.read(imageBuffer);
        const pngBuf = await jimpImg.getBuffer('image/png');
        return await doc.embedPng(pngBuf);
    } catch (err) {
        throw new Error('Unsupported image format: ' + err.message);
    }
}

/**
 * Builds a multi-page PDF document from an array of image buffers
 */
async function buildPdfFromImages(imageBuffers, title) {
    if (!imageBuffers || imageBuffers.length === 0) {
        throw new Error('No images provided for PDF generation');
    }

    const doc = await PDFDocument.create();
    doc.setTitle(title || 'Zoxer MD Document');
    doc.setCreator('Zoxer MD WhatsApp Bot');
    doc.setProducer('pdf-lib');
    doc.setCreationDate(new Date());

    for (let i = 0; i < imageBuffers.length; i++) {
        const imgBuf = imageBuffers[i];
        const embeddedImg = await embedImageInPdf(doc, imgBuf);
        const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

        const imgWidth = embeddedImg.width;
        const imgHeight = embeddedImg.height;

        const scale = Math.min(MAX_CONTENT_WIDTH / imgWidth, MAX_CONTENT_HEIGHT / imgHeight);
        const drawWidth = imgWidth * scale;
        const drawHeight = imgHeight * scale;

        const x = MARGIN + (MAX_CONTENT_WIDTH - drawWidth) / 2;
        const y = MARGIN + (MAX_CONTENT_HEIGHT - drawHeight) / 2;

        page.drawImage(embeddedImg, {
            x,
            y,
            width: drawWidth,
            height: drawHeight
        });
    }

    const pdfBytes = await doc.save();
    return Buffer.from(pdfBytes);
}

/**
 * Handles incoming images from users who have an active PDF session
 * Returns true if handled, false otherwise
 */
async function handlePdfSessionImage(sock, chatId, senderId, message) {
    const userJid = cleanJid(senderId || message.key?.remoteJid);
    if (!userJid || !pdfSessions.has(userJid)) return false;

    // Check if message contains an image
    const rawMsg = message.message || message;
    const isImage = Boolean(
        rawMsg.imageMessage ||
        rawMsg.viewOnceMessage?.message?.imageMessage ||
        rawMsg.viewOnceMessageV2?.message?.imageMessage ||
        rawMsg.ephemeralMessage?.message?.imageMessage
    );

    if (!isImage) return false;

    const session = pdfSessions.get(userJid);

    try {
        const imgBuffer = await extractImageBuffer(message);
        if (!imgBuffer) return false;

        session.images.push(imgBuffer);

        // Reset inactivity timer
        clearTimeout(session.timer);
        session.timer = setTimeout(() => {
            if (pdfSessions.has(userJid)) {
                pdfSessions.delete(userJid);
                sock.sendMessage(chatId, {
                    text: `⚠️ *PDF Session Expired!*\nYour PDF session for *${session.fileName}.pdf* has expired due to 15 minutes of inactivity.`
                }).catch(() => {});
            }
        }, SESSION_TIMEOUT_MS);

        const count = session.images.length;
        await sock.sendMessage(chatId, {
            text: `📸 *Page ${count} Added!* (Title: *${session.fileName}.pdf*)\n\n` +
                  `• Send more images to add more pages.\n` +
                  `• When finished, send: *.img2pdf done*\n` +
                  `• To cancel: *.img2pdf cancel*`
        }, { quoted: message });

        return true;
    } catch (err) {
        console.error('[IMG2PDF] Error adding session page:', err.message);
        return false;
    }
}

/**
 * Main command handler for .img2pdf / .topdf / .pdf
 */
async function img2pdfCommand(sock, chatId, message, argsString = '') {
    const senderId = message.key?.participant || message.key?.remoteJid;
    const userJid = cleanJid(senderId);

    const args = (argsString || '').trim().split(/\s+/).filter(Boolean);
    const subCmd = (args[0] || '').toLowerCase();

    // 1. SUBCOMMAND: START SESSION (.img2pdf start [Title])
    if (subCmd === 'start') {
        const titleRaw = args.slice(1).join(' ') || 'Document';
        const fileName = sanitizeFileName(titleRaw);

        if (pdfSessions.has(userJid)) {
            const existing = pdfSessions.get(userJid);
            clearTimeout(existing.timer);
            pdfSessions.delete(userJid);
        }

        const timer = setTimeout(() => {
            if (pdfSessions.has(userJid)) {
                pdfSessions.delete(userJid);
                sock.sendMessage(chatId, {
                    text: `⚠️ *PDF Session Expired!*\nSession for *${fileName}.pdf* closed after 15 minutes of inactivity.`
                }).catch(() => {});
            }
        }, SESSION_TIMEOUT_MS);

        pdfSessions.set(userJid, {
            chatId,
            fileName,
            images: [],
            createdAt: Date.now(),
            timer
        });

        return await sock.sendMessage(chatId, {
            text: `╭─〔 📄 *PDF SESSION STARTED* 〕\n` +
                  `┃\n` +
                  `┃ 📝 *Title:* ${fileName}.pdf\n` +
                  `┃ 👤 *User:* @${userJid.split('@')[0]}\n` +
                  `┃\n` +
                  `┃ 👉 *How to use:*\n` +
                  `┃ 1. Ab apni photos/notes bhejna shuru karein.\n` +
                  `┃ 2. Har photo PDF ka aik naya page banegi.\n` +
                  `┃ 3. Jab sab photos bhej lein, to type karein:\n` +
                  `┃    *.img2pdf done*\n` +
                  `┃\n` +
                  `┃ ❌ Cancel: *.img2pdf cancel*\n` +
                  `┃ 📊 Status: *.img2pdf status*\n` +
                  `╰─────────────────────────`,
            mentions: [userJid]
        }, { quoted: message });
    }

    // 2. SUBCOMMAND: DONE / COMPILE SESSION (.img2pdf done)
    if (subCmd === 'done') {
        if (!pdfSessions.has(userJid)) {
            return await sock.sendMessage(chatId, {
                text: `⚠️ *No Active PDF Session!*\n\n` +
                      `Start a new session first by sending:\n` +
                      `👉 *.img2pdf start <Title>*\n\n` +
                      `_Or reply directly to an image with \`.img2pdf <Title>\` for instant conversion._`
            }, { quoted: message });
        }

        const session = pdfSessions.get(userJid);
        if (!session.images || session.images.length === 0) {
            return await sock.sendMessage(chatId, {
                text: `⚠️ *No Images Added Yet!*\n\n` +
                      `Aap ne abhi tak koi image nahi bheji.\n` +
                      `Pehle photos bhejein, phir *.img2pdf done* karein.`
            }, { quoted: message });
        }

        clearTimeout(session.timer);
        pdfSessions.delete(userJid);

        await sock.sendMessage(chatId, {
            text: `⏳ *Compiling ${session.images.length} pages into PDF...*\nPlease wait a moment.`
        }, { quoted: message });

        try {
            const pdfBuffer = await buildPdfFromImages(session.images, session.fileName);
            const sizeStr = formatSize(pdfBuffer.length);

            await sock.sendMessage(chatId, {
                document: pdfBuffer,
                mimetype: 'application/pdf',
                fileName: `${session.fileName}.pdf`,
                caption: `╭─〔 📄 *PDF GENERATED* 〕\n` +
                         `┃\n` +
                         `┃ 📝 *Title:* ${session.fileName}.pdf\n` +
                         `┃ 📑 *Total Pages:* ${session.images.length}\n` +
                         `┃ 📦 *File Size:* ${sizeStr}\n` +
                         `┃\n` +
                         `╰─ ✨ _Converted cleanly by Zoxer MD_`
            }, { quoted: message });
        } catch (err) {
            console.error('[IMG2PDF] Generation error:', err);
            await sock.sendMessage(chatId, {
                text: `❌ *PDF Generation Failed:*\n${err.message || 'Unknown error occurred.'}`
            }, { quoted: message });
        }
        return;
    }

    // 3. SUBCOMMAND: CANCEL (.img2pdf cancel)
    if (subCmd === 'cancel') {
        if (!pdfSessions.has(userJid)) {
            return await sock.sendMessage(chatId, {
                text: `ℹ️ *No active PDF session to cancel.*`
            }, { quoted: message });
        }
        const session = pdfSessions.get(userJid);
        clearTimeout(session.timer);
        pdfSessions.delete(userJid);

        return await sock.sendMessage(chatId, {
            text: `❌ *PDF Session Cancelled!*\nAll queued images for *${session.fileName}.pdf* have been cleared.`
        }, { quoted: message });
    }

    // 4. SUBCOMMAND: STATUS (.img2pdf status)
    if (subCmd === 'status') {
        if (!pdfSessions.has(userJid)) {
            return await sock.sendMessage(chatId, {
                text: `ℹ️ *No active PDF session.*\nStart one with: *.img2pdf start <Title>*`
            }, { quoted: message });
        }
        const session = pdfSessions.get(userJid);
        return await sock.sendMessage(chatId, {
            text: `📄 *Active PDF Session:*\n\n` +
                  `• *Title:* ${session.fileName}.pdf\n` +
                  `• *Pages Collected:* ${session.images.length}\n` +
                  `• *Commands:*\n` +
                  `  - *.img2pdf done* (Generate PDF)\n` +
                  `  - *.img2pdf cancel* (Discard session)`
        }, { quoted: message });
    }

    // 5. DIRECT / QUOTED MODE: (.img2pdf [Title])
    // User replies to an image or sends an image with caption .img2pdf
    const imgBuffer = await extractImageBuffer(message);
    if (imgBuffer) {
        const titleRaw = args.join(' ') || 'Document';
        const fileName = sanitizeFileName(titleRaw);

        await sock.sendMessage(chatId, {
            text: `⏳ *Converting image to PDF...*`
        }, { quoted: message });

        try {
            const pdfBuffer = await buildPdfFromImages([imgBuffer], fileName);
            const sizeStr = formatSize(pdfBuffer.length);

            return await sock.sendMessage(chatId, {
                document: pdfBuffer,
                mimetype: 'application/pdf',
                fileName: `${fileName}.pdf`,
                caption: `╭─〔 📄 *PDF GENERATED* 〕\n` +
                         `┃\n` +
                         `┃ 📝 *Title:* ${fileName}.pdf\n` +
                         `┃ 📑 *Total Pages:* 1\n` +
                         `┃ 📦 *File Size:* ${sizeStr}\n` +
                         `┃\n` +
                         `╰─ ✨ _Converted cleanly by Zoxer MD_`
            }, { quoted: message });
        } catch (err) {
            console.error('[IMG2PDF] Direct conversion error:', err);
            return await sock.sendMessage(chatId, {
                text: `❌ *PDF Generation Failed:*\n${err.message || 'Error converting image.'}`
            }, { quoted: message });
        }
    }

    // 6. NO IMAGE QUOTED & NO SESSION ACTION -> SHOW USAGE GUIDE
    return await sock.sendMessage(chatId, {
        text: `╭─〔 📄 *IMG TO PDF CONVERTER* 〕\n` +
              `┃\n` +
              `┃ 💡 *Method 1: Single Image Instant Mode*\n` +
              `┃ Kisi bhi image ko reply karke likhein:\n` +
              `┃ 👉 \`.img2pdf <Title>\`\n` +
              `┃ *Example:* \`.img2pdf Invoice\`\n` +
              `┃\n` +
              `┃ 📑 *Method 2: Multi-Page Batch Mode (5-20 Photos)*\n` +
              `┃ Multiple photos ko aik PDF mein jorhein:\n` +
              `┃ 1. 👉 \`.img2pdf start Assignment\`\n` +
              `┃ 2. Send all your photos one by one.\n` +
              `┃ 3. 👉 \`.img2pdf done\`\n` +
              `┃\n` +
              `┃ ❌ Cancel: \`.img2pdf cancel\`\n` +
              `╰─────────────────────────`
    }, { quoted: message });
}

module.exports = {
    img2pdfCommand,
    handlePdfSessionImage,
    buildPdfFromImages,
    embedImageInPdf,
    sanitizeFileName,
    formatSize,
    pdfSessions
};

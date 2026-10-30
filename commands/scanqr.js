const { downloadMediaMessage, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { Jimp } = require('jimp');
const jsQR = require('jsqr');
const axios = require('axios');

/**
 * Robustly extract image or sticker buffer from a direct or quoted message.
 */
async function extractImageBuffer(sock, message) {
    let targetMessage = message;

    // Check if user quoted a message
    if (message.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        const quotedInfo = message.message.extendedTextMessage.contextInfo;
        targetMessage = {
            key: {
                remoteJid: message.key.remoteJid,
                id: quotedInfo.stanzaId || message.key.id,
                participant: quotedInfo.participant
            },
            message: quotedInfo.quotedMessage
        };
    }

    // Unwrap potential view-once wrapper
    const innerMsg = targetMessage.message?.viewOnceMessageV2?.message ||
                     targetMessage.message?.viewOnceMessage?.message ||
                     targetMessage.message;

    if (!innerMsg) return null;

    // Identify media message payload (image, sticker, or document with image mimetype)
    const mediaPayload = innerMsg.imageMessage || 
                         innerMsg.stickerMessage || 
                         (innerMsg.documentMessage && innerMsg.documentMessage.mimetype?.startsWith('image/') ? innerMsg.documentMessage : null);

    if (!mediaPayload) return null;

    // Method 1: Standard downloadMediaMessage
    try {
        const buffer = await downloadMediaMessage(
            { key: targetMessage.key, message: innerMsg },
            'buffer',
            {},
            { logger: undefined, reuploadRequest: sock.updateMediaMessage }
        );
        if (buffer && buffer.length > 0) return buffer;
    } catch (_) {}

    // Method 2: Direct stream extraction fallback
    try {
        const type = innerMsg.stickerMessage ? 'sticker' : (innerMsg.documentMessage ? 'document' : 'image');
        const stream = await downloadContentFromMessage(mediaPayload, type);
        let chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        if (buffer && buffer.length > 0) return buffer;
    } catch (_) {}

    return null;
}

/**
 * Validates whether a string is a valid HTTP/HTTPS URL
 */
function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

/**
 * Multi-pass QR code decoder using Jimp & jsQR
 */
async function decodeQRCode(buffer) {
    try {
        const image = await Jimp.read(buffer);

        // Helper to scan a Jimp image instance
        const scan = (img) => {
            const { data, width, height } = img.bitmap;
            return jsQR(Uint8ClampedArray.from(data), width, height);
        };

        // Pass 1: Original image scan
        let result = scan(image);
        if (result && result.data) return result.data;

        // Pass 2: Greyscale & contrast enhancement (handles poor lighting or glare)
        const enhanced = image.clone();
        enhanced.greyscale();
        enhanced.contrast(0.3);
        result = scan(enhanced);
        if (result && result.data) return result.data;

        // Pass 3: Invert colors (handles dark mode / white-on-black QR codes)
        const inverted = enhanced.clone();
        inverted.invert();
        result = scan(inverted);
        if (result && result.data) return result.data;

        // Pass 4: Downscale if high resolution (improves detection on huge camera photos)
        const maxDim = 1200;
        if (image.bitmap.width > maxDim || image.bitmap.height > maxDim) {
            const scaled = image.clone();
            const w = image.bitmap.width;
            const h = image.bitmap.height;
            if (w > h) {
                scaled.resize({ w: maxDim, h: Math.round(h * (maxDim / w)) });
            } else {
                scaled.resize({ w: Math.round(w * (maxDim / h)), h: maxDim });
            }
            result = scan(scaled);
            if (result && result.data) return result.data;

            // Greyscale of scaled
            scaled.greyscale();
            result = scan(scaled);
            if (result && result.data) return result.data;
        }

        return null;
    } catch (err) {
        console.error('[ScanQR] Decode error:', err.message);
        return null;
    }
}

/**
 * Formats parsed QR code content into a clean, professional, aesthetic response.
 */
function formatQRResult(data) {
    if (!data) return null;
    const trimmed = data.trim();

    // 1. Wi-Fi Configuration QR (WIFI:S:name;T:WPA;P:pass;H:false;;)
    if (/^WIFI:/i.test(trimmed)) {
        const ssid = trimmed.match(/S:([^;]+)/i)?.[1] || 'Unknown';
        const pass = trimmed.match(/P:([^;]+)/i)?.[1] || '(No Password / Open)';
        const type = trimmed.match(/T:([^;]+)/i)?.[1]?.toUpperCase() || 'WPA/WPA2';
        const hidden = trimmed.match(/H:([^;]+)/i)?.[1]?.toLowerCase() === 'true' ? 'Yes' : 'No';

        return [
            `╭──〔 📶 *𝗪𝗜-𝗙𝗜 𝗡𝗘𝗧𝗪𝗢𝗥𝗞* 〕`,
            `│`,
            `│ 📡 *SSID (Network):* \`${ssid}\``,
            `│ 🔑 *Password:* \`${pass}\``,
            `│ 🔒 *Security:* ${type}`,
            `│ 👁️ *Hidden Network:* ${hidden}`,
            `│`,
            `╰────────────────────`,
            `💡 *Tip:* Tap and hold the password above to copy it instantly!`
        ].join('\n');
    }

    // 2. UPI / Indian Payment QR (upi://pay?pa=...&pn=...)
    if (/^upi:\/\/pay/i.test(trimmed)) {
        try {
            const url = new URL(trimmed);
            const pa = url.searchParams.get('pa') || 'N/A';
            const pn = url.searchParams.get('pn') || 'N/A';
            const am = url.searchParams.get('am') ? `₹${url.searchParams.get('am')}` : 'Any';
            const tn = url.searchParams.get('tn') || 'N/A';
            const cu = url.searchParams.get('cu') || 'INR';

            return [
                `╭──〔 💳 *𝗨𝗣𝗜 𝗣𝗔𝗬𝗠𝗘𝗡𝗧 𝗤𝗥* 〕`,
                `│`,
                `│ 👤 *Payee Name:* ${pn}`,
                `│ 🆔 *UPI ID / VPA:* \`${pa}\``,
                `│ 💰 *Amount:* ${am} (${cu})`,
                `│ 📝 *Note:* ${tn}`,
                `│`,
                `╰────────────────────`,
                `💡 *Raw UPI Link:* \`${trimmed}\``
            ].join('\n');
        } catch (_) {}
    }

    // 3. Web URL / Links
    if (/^https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed)) {
        const fullUrl = trimmed.startsWith('www.') ? `https://${trimmed}` : trimmed;
        let domain = 'Website';
        try {
            domain = new URL(fullUrl).hostname;
        } catch (_) {}

        return [
            `╭──〔 🌐 *𝗪𝗘𝗕 𝗟𝗜𝗡𝗞 𝗗𝗘𝗧𝗘𝗖𝗧𝗘𝗗* 〕`,
            `│`,
            `│ 🔗 *Destination:* ${fullUrl}`,
            `│ 🏷️ *Domain:* ${domain}`,
            `│ 🔒 *Protocol:* ${fullUrl.startsWith('https') ? 'HTTPS (Secure)' : 'HTTP'}`,
            `│`,
            `╰────────────────────`,
            `💡 *Tap the link above to open in browser.*`
        ].join('\n');
    }

    // 4. vCard Contact
    if (/BEGIN:VCARD/i.test(trimmed)) {
        const fn = trimmed.match(/FN:(.+)/i)?.[1]?.trim() || trimmed.match(/N:(.+)/i)?.[1]?.trim() || 'Unknown';
        const tel = trimmed.match(/TEL(?:;[^:]+)?:(.+)/i)?.[1]?.trim() || 'N/A';
        const email = trimmed.match(/EMAIL(?:;[^:]+)?:(.+)/i)?.[1]?.trim() || 'N/A';
        const org = trimmed.match(/ORG:(.+)/i)?.[1]?.trim() || 'N/A';

        return [
            `╭──〔 👤 *𝗖𝗢𝗡𝗧𝗔𝗖𝗧 𝗖𝗔𝗥𝗗 (𝘃𝗖𝗮𝗿𝗱)* 〕`,
            `│`,
            `│ 📛 *Name:* ${fn}`,
            `│ 📞 *Phone:* \`${tel}\``,
            `│ 📧 *Email:* ${email}`,
            `│ 🏢 *Organization:* ${org}`,
            `│`,
            `╰────────────────────`
        ].join('\n');
    }

    // 5. WhatsApp Direct Message (wa.me)
    if (/https?:\/\/(wa\.me|api\.whatsapp\.com)/i.test(trimmed)) {
        return [
            `╭──〔 💬 *𝗪𝗛𝗔𝗧𝗦𝗔𝗣𝗣 𝗟𝗜𝗡𝗞* 〕`,
            `│`,
            `│ 📱 *Link:* ${trimmed}`,
            `│`,
            `╰────────────────────`
        ].join('\n');
    }

    // 6. Email (mailto:)
    if (/^mailto:/i.test(trimmed)) {
        const emailPart = trimmed.replace(/^mailto:/i, '');
        return [
            `╭──〔 ✉️ *𝗘𝗠𝗔𝗜𝗟 𝗔𝗗𝗗𝗥𝗘𝗦𝗦* 〕`,
            `│`,
            `│ 📧 *Recipient:* \`${emailPart}\``,
            `│`,
            `╰────────────────────`
        ].join('\n');
    }

    // 7. Phone / SMS (tel: or smsto:)
    if (/^(tel:|smsto:)/i.test(trimmed)) {
        const num = trimmed.replace(/^(tel:|smsto:)/i, '');
        return [
            `╭──〔 📞 *𝗣𝗛𝗢𝗡𝗘 / 𝗦𝗠𝗦* 〕`,
            `│`,
            `│ 📱 *Number:* \`${num}\``,
            `│`,
            `╰────────────────────`
        ].join('\n');
    }

    // 8. Geo Location (geo:lat,long)
    if (/^geo:/i.test(trimmed)) {
        const coords = trimmed.replace(/^geo:/i, '').split('?')[0];
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${coords}`;
        return [
            `╭──〔 📍 *𝗚𝗘𝗢 𝗟𝗢𝗖𝗔𝗧𝗜𝗢𝗡* 〕`,
            `│`,
            `│ 🗺️ *Coordinates:* \`${coords}\``,
            `│ 📌 *Google Maps:* ${mapsUrl}`,
            `│`,
            `╰────────────────────`
        ].join('\n');
    }

    // 9. Generic Plain Text / Code / Other
    return [
        `╭──〔 🔍 *𝗤𝗥 𝗖𝗢𝗗𝗘 𝗖𝗢𝗡𝗧𝗘𝗡𝗧* 〕`,
        `│`,
        `\`\`\`${trimmed}\`\`\``,
        `│`,
        `│ 📊 *Length:* ${trimmed.length} characters`,
        `╰────────────────────`
    ].join('\n');
}

/**
 * Main command handler for .scanqr / .readqr
 */
async function scanqrCommand(sock, chatId, message, args = []) {
    try {
        let inputBuffer = null;

        // Check if an image URL was provided in args
        if (args.length > 0 && isValidUrl(args[0])) {
            await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });
            try {
                const res = await axios.get(args[0], { responseType: 'arraybuffer', timeout: 15000 });
                if (res.data && res.data.length > 0) {
                    inputBuffer = Buffer.from(res.data);
                }
            } catch (urlErr) {
                return await sock.sendMessage(chatId, {
                    text: `❌ Could not download image from the provided URL: ${urlErr.message}`
                }, { quoted: message });
            }
        }

        // If no URL provided, attempt extraction from quoted or attached image
        if (!inputBuffer) {
            inputBuffer = await extractImageBuffer(sock, message);
        }

        // If still no image found, send a friendly guide
        if (!inputBuffer) {
            return await sock.sendMessage(chatId, {
                text: [
                    '📷 *𝗤𝗥 𝗖𝗼𝗱𝗲 𝗦𝗰𝗮𝗻𝗻𝗲𝗿*',
                    '',
                    '⚠️ *Please reply to an image containing a QR code* with *.scanqr*, or send an image with *.scanqr* as the caption.',
                    '',
                    '💡 *Examples:*',
                    '• Reply to a Wi-Fi QR photo with: `.scanqr`',
                    '• Reply to a payment QR with: `.scanqr`',
                    '• Scan from URL: `.scanqr https://example.com/qr.png`',
                    '• Aliases: `.scanqr`, `.readqr`, `.qrscan`'
                ].join('\n')
            }, { quoted: message });
        }

        // Set processing reaction
        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

        // Decode the QR code
        const qrData = await decodeQRCode(inputBuffer);

        if (!qrData) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return await sock.sendMessage(chatId, {
                text: [
                    '❌ *No QR Code Detected*',
                    '',
                    'Could not find or read a clear QR code in this image.',
                    '💡 *Tips for better results:*',
                    '• Ensure good lighting and high resolution.',
                    '• Crop closer to the QR code if the photo is taken from far away.',
                    '• Avoid blurry or heavily distorted angles.'
                ].join('\n')
            }, { quoted: message });
        }

        // Format and send result
        const formattedResponse = formatQRResult(qrData);

        await sock.sendMessage(chatId, {
            text: formattedResponse
        }, { quoted: message });

        // Success reaction
        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (err) {
        console.error('[ScanQR] Command Error:', err);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, {
            text: `❌ An unexpected error occurred while scanning: ${err.message}`
        }, { quoted: message });
    }
}

module.exports = scanqrCommand;

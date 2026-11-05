const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const btch = require('btch-downloader');
const { fetchMediaFromApi } = require('../lib/mediaApi');

// Prevent rapid duplicate requests
const processedMessages = new Set();

/**
 * Filter out fake advertisement links returned by some free scraper endpoints
 */
function isAdUrl(url) {
    if (!url || typeof url !== 'string') return true;
    return /play\.google\.com|apps\.apple\.com|saveinsta\.app\/action|\.html(\?|$)/i.test(url);
}

/**
 * Extract clean Instagram URL from text
 */
function extractInstagramUrl(text) {
    if (!text) return null;
    const match = text.match(/https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/[^\s]+/i);
    return match ? match[0].trim() : null;
}

/**
 * Fallback to yt-dlp if installed
 */
function fromYtDlp(url) {
    return new Promise((resolve, reject) => {
        const out = path.join(os.tmpdir(), `igd_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);
        execFile(
            'yt-dlp',
            ['-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best', '--merge-output-format', 'mp4', '--no-playlist', '-o', out, url],
            { timeout: 60000 },
            (err) => {
                if (err) return reject(err);
                try {
                    if (fs.existsSync(out)) {
                        const buffer = fs.readFileSync(out);
                        fs.unlinkSync(out);
                        return resolve({ buffer, type: 'video' });
                    }
                    reject(new Error('File not generated'));
                } catch (e) {
                    reject(e);
                }
            }
        );
    });
}

/**
 * Main unified Instagram downloader
 */
async function instagramCommand(sock, chatId, message, rawText = '') {
    const msgId = message.key?.id;
    if (msgId) {
        if (processedMessages.has(msgId)) return;
        processedMessages.add(msgId);
        setTimeout(() => processedMessages.delete(msgId), 3 * 60 * 1000);
    }

    try {
        const text = (
            rawText ||
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            ''
        );

        // Check quoted text as well
        const quotedText = (
            message.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation ||
            message.message?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text ||
            ''
        );

        let targetUrl = extractInstagramUrl(text) || extractInstagramUrl(quotedText);

        if (!targetUrl) {
            return await sock.sendMessage(chatId, {
                text: "📥 *Please provide an Instagram post or reel link!*\n\n*Example:* `.ig https://www.instagram.com/reel/...`"
            }, { quoted: message });
        }

        // Clean link to remove extraneous tracking parameters
        const cleanUrl = targetUrl.split('?')[0].replace(/\/+$/, '') + '/';

        await sock.sendMessage(chatId, {
            react: { text: '🔄', key: message.key }
        });

        let delivered = false;
        let lastError = null;

        // TIER 1: BTCH Downloader (Super fast & reliable for both Reels and Photos)
        try {
            const btchRes = await btch.igdl(cleanUrl);
            if (btchRes && btchRes.status && Array.isArray(btchRes.result) && btchRes.result.length > 0) {
                for (const item of btchRes.result.slice(0, 5)) {
                    const downloadUrl = item.url;
                    if (downloadUrl && !isAdUrl(downloadUrl)) {
                        // Download buffer to reliably check content type and avoid Baileys stream blocks
                        const res = await axios.get(downloadUrl, {
                            responseType: 'arraybuffer',
                            timeout: 60000,
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                            }
                        });

                        const disposition = res.headers['content-disposition'] || '';
                        const contentType = res.headers['content-type'] || '';
                        const isVideo = disposition.includes('.mp4') || contentType.includes('video');

                        const caption = `📸 *Instagram Media*\n\n⚡ *Downloaded by ZoxerBot*`;

                        if (isVideo) {
                            await sock.sendMessage(chatId, {
                                video: Buffer.from(res.data),
                                mimetype: 'video/mp4',
                                caption,
                                ...global.channelInfo
                            }, { quoted: message });
                        } else {
                            await sock.sendMessage(chatId, {
                                image: Buffer.from(res.data),
                                mimetype: 'image/jpeg',
                                caption,
                                ...global.channelInfo
                            }, { quoted: message });
                        }
                        delivered = true;
                    }
                }
            }
        } catch (errBtch) {
            console.warn('[INSTAGRAM] BTCH tier failed, trying Cloudflare API:', errBtch.message);
            lastError = errBtch;
        }

        // TIER 2: Cloudflare Workers Media API
        if (!delivered) {
            try {
                const media = await fetchMediaFromApi(cleanUrl, 'video');
                const downloadUrl = media.downloadUrl;

                if (downloadUrl && !isAdUrl(downloadUrl)) {
                    const isVideo = media.type === 'video' || /\.mp4(\?|$)/i.test(downloadUrl);
                    const caption = `📸 *${media.title || 'Instagram Media'}*\n\n⚡ *Downloaded by ZoxerBot*`;

                    const res = await axios.get(downloadUrl, {
                        responseType: 'arraybuffer',
                        timeout: 60000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });

                    if (isVideo) {
                        await sock.sendMessage(chatId, {
                            video: Buffer.from(res.data),
                            mimetype: 'video/mp4',
                            caption,
                            ...global.channelInfo
                        }, { quoted: message });
                    } else {
                        await sock.sendMessage(chatId, {
                            image: Buffer.from(res.data),
                            mimetype: 'image/jpeg',
                            caption,
                            ...global.channelInfo
                        }, { quoted: message });
                    }
                    delivered = true;
                }
            } catch (errApi) {
                console.warn('[INSTAGRAM] Media API tier failed, trying yt-dlp:', errApi.message);
                lastError = errApi;
            }
        }

        // TIER 3: Local yt-dlp fallback
        if (!delivered) {
            try {
                const ytdlpResult = await fromYtDlp(targetUrl);
                if (ytdlpResult && ytdlpResult.buffer) {
                    await sock.sendMessage(chatId, {
                        video: ytdlpResult.buffer,
                        mimetype: 'video/mp4',
                        caption: `📸 *Instagram Video*\n\n⚡ *Downloaded by ZoxerBot*`,
                        ...global.channelInfo
                    }, { quoted: message });
                    delivered = true;
                }
            } catch (errYtdlp) {
                console.warn('[INSTAGRAM] yt-dlp tier failed:', errYtdlp.message);
                lastError = errYtdlp;
            }
        }

        if (delivered) {
            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
        } else {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            await sock.sendMessage(chatId, {
                text: `❌ *Could not download Instagram post/reel.*\n\n*Reason:* ${lastError?.message?.includes('no video') ? 'No downloadable media found.' : 'The post might be private, deleted, or temporarily restricted.'}`
            }, { quoted: message });
        }

    } catch (error) {
        console.error('[INSTAGRAM] Fatal error:', error);
        try {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            await sock.sendMessage(chatId, {
                text: "❌ An error occurred while processing your Instagram request. Please make sure the link is public."
            }, { quoted: message });
        } catch (_) {}
    }
}

module.exports = instagramCommand;

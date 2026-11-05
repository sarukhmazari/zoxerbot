const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { fetchMediaFromApi } = require('../lib/mediaApi');
const { downloadMp3, downloadMp4 } = require('../lib/ytdlp-helper');

// Deduplication cache to prevent concurrent spam for the same message
const processedMessages = new Set();

/**
 * Check if a media file has an audio stream using ffprobe
 * @param {string} filePath 
 * @returns {Promise<boolean>}
 */
function hasAudioStream(filePath) {
    return new Promise((resolve) => {
        exec(`ffprobe -v error -select_streams a -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 "${filePath}"`, (err, stdout) => {
            if (err) return resolve(true); // If ffprobe fails, proceed to ffmpeg
            resolve(stdout && stdout.trim().includes('audio'));
        });
    });
}

/**
 * Convert any media file into high quality MP3 using FFmpeg
 * @param {string} inputPath 
 * @param {string} outputPath 
 * @returns {Promise<void>}
 */
function convertToMp3(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        const cmd = `ffmpeg -y -i "${inputPath}" -vn -c:a libmp3lame -b:a 192k -ar 44100 -ac 2 "${outputPath}"`;
        exec(cmd, (err, stdout, stderr) => {
            if (err) {
                const errStr = `${err.message || ''} ${stderr || ''}`;
                if (errStr.includes('Output file does not contain any stream') ||
                    errStr.includes('does not contain any stream') ||
                    errStr.includes('matches no streams')) {
                    return reject(new Error('The media has no audio track (it is silent or a GIF).'));
                }
                if (errStr.includes('not found') || errStr.includes('ENOENT')) {
                    return reject(new Error('FFmpeg is not installed on the system.'));
                }
                return reject(err);
            }
            resolve();
        });
    });
}

/**
 * Download a remote URL into a local file safely
 * @param {string} url 
 * @param {string} destinationPath 
 * @returns {Promise<void>}
 */
async function downloadToFile(url, destinationPath) {
    const writer = fs.createWriteStream(destinationPath);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        timeout: 45000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

/**
 * Extract URL from text if present
 * @param {string} text 
 * @returns {string|null}
 */
function extractUrl(text) {
    if (!text) return null;
    const match = text.match(/https?:\/\/[^\s]+/i);
    return match ? match[0].trim() : null;
}

/**
 * Sanitize filename for WhatsApp audio delivery
 * @param {string} name 
 * @returns {string}
 */
function sanitizeFileName(name) {
    return (name || 'reels_audio')
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 50);
}

/**
 * Main Reels / TikTok Audio Extraction Command Handler
 */
async function reelsAudioCommand(sock, chatId, message, rawText = '') {
    const msgId = message.key?.id;
    if (msgId) {
        if (processedMessages.has(msgId)) return;
        processedMessages.add(msgId);
        setTimeout(() => processedMessages.delete(msgId), 3 * 60 * 1000);
    }

    const filesToClean = [];

    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    try {
        // 1. Check for quoted message
        let quotedMsgObj = null;
        let quotedText = '';
        let targetQuotedMessage = null;

        if (message.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
            const quotedInfo = message.message.extendedTextMessage.contextInfo;
            targetQuotedMessage = {
                key: {
                    remoteJid: chatId,
                    id: quotedInfo.stanzaId,
                    participant: quotedInfo.participant
                },
                message: quotedInfo.quotedMessage
            };

            let unwrapped = quotedInfo.quotedMessage;
            if (unwrapped?.viewOnceMessage?.message) unwrapped = unwrapped.viewOnceMessage.message;
            if (unwrapped?.viewOnceMessageV2?.message) unwrapped = unwrapped.viewOnceMessageV2.message;
            if (unwrapped?.viewOnceMessageV2Extension?.message) unwrapped = unwrapped.viewOnceMessageV2Extension.message;
            if (unwrapped?.ephemeralMessage?.message) unwrapped = unwrapped.ephemeralMessage.message;
            if (unwrapped?.documentWithCaptionMessage?.message) unwrapped = unwrapped.documentWithCaptionMessage.message;

            quotedMsgObj = unwrapped;
            quotedText = (
                unwrapped?.conversation ||
                unwrapped?.extendedTextMessage?.text ||
                unwrapped?.videoMessage?.caption ||
                unwrapped?.imageMessage?.caption ||
                ''
            );
        }

        // 2. Determine source: Replied Media OR Direct URL
        const mediaMsg = quotedMsgObj?.videoMessage || quotedMsgObj?.audioMessage || quotedMsgObj?.documentMessage;

        // Check command text and quoted text for URL
        const inputUrl = extractUrl(rawText) || extractUrl(quotedText);

        // CASE 1: Replied directly to video or audio message
        if (mediaMsg && !inputUrl) {
            await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

            const mediaBuffer = await downloadMediaMessage(
                { ...targetQuotedMessage, message: quotedMsgObj },
                'buffer',
                {},
                { logger: undefined, reuploadRequest: sock.updateMediaMessage }
            );

            if (!mediaBuffer || mediaBuffer.length === 0) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Could not download the replied media. Please ensure the message is fully loaded.'
                }, { quoted: message });
            }

            const id = crypto.randomBytes(6).toString('hex');
            const mime = (mediaMsg.mimetype || '').toLowerCase();
            let ext = '.mp4';
            if (mime.includes('audio/ogg') || mime.includes('opus')) ext = '.ogg';
            else if (mime.includes('audio/mp4') || mime.includes('m4a')) ext = '.m4a';
            else if (mime.includes('audio/mpeg') || mime.includes('mp3')) ext = '.mp3';
            else if (mime.includes('webm')) ext = '.webm';

            const tempInput = path.join(tempDir, `reels_in_${id}${ext}`);
            const tempOutput = path.join(tempDir, `reels_audio_${id}.mp3`);
            filesToClean.push(tempInput, tempOutput);

            fs.writeFileSync(tempInput, mediaBuffer);

            // Verify audio track exists
            const hasAudio = await hasAudioStream(tempInput);
            if (!hasAudio) {
                await sock.sendMessage(chatId, { react: { text: '⚠️', key: message.key } });
                return await sock.sendMessage(chatId, {
                    text: '⚠️ The replied video has *no audio track* (it is silent or a GIF). Please reply to a video with sound.'
                }, { quoted: message });
            }

            await convertToMp3(tempInput, tempOutput);

            const audioBuf = fs.readFileSync(tempOutput);

            await sock.sendMessage(chatId, {
                audio: audioBuf,
                mimetype: 'audio/mpeg',
                fileName: 'reels_audio.mp3',
                ptt: false,
                ...global.channelInfo
            }, { quoted: message });

            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
            return;
        }

        // CASE 2: URL provided (in command argument or replied message text)
        if (inputUrl) {
            await sock.sendMessage(chatId, { react: { text: '🎵', key: message.key } });

            const id = crypto.randomBytes(6).toString('hex');
            const tempOutput = path.join(tempDir, `reels_audio_${id}.mp3`);
            filesToClean.push(tempOutput);

            let audioExtracted = false;
            let title = 'Reels Audio';

            // Tier 1: Try Cloudflare Workers Media API audio extraction
            try {
                const media = await fetchMediaFromApi(inputUrl, 'audio');
                if (media?.downloadUrl) {
                    title = media.title || 'Reels Audio';
                    const tempRaw = path.join(tempDir, `raw_audio_${id}`);
                    filesToClean.push(tempRaw);

                    await downloadToFile(media.downloadUrl, tempRaw);
                    await convertToMp3(tempRaw, tempOutput);
                    audioExtracted = true;
                }
            } catch (errApi) {
                console.warn('[REELSAUDIO] Media API audio route failed, falling back to yt-dlp:', errApi.message);
            }

            // Tier 2: Try yt-dlp downloadMp3
            if (!audioExtracted) {
                try {
                    const ytdlpFile = await downloadMp3(inputUrl, `reels_ytdlp_${id}`);
                    if (ytdlpFile && fs.existsSync(ytdlpFile)) {
                        filesToClean.push(ytdlpFile);
                        fs.copyFileSync(ytdlpFile, tempOutput);
                        audioExtracted = true;
                    }
                } catch (errYtdlp) {
                    console.warn('[REELSAUDIO] yt-dlp MP3 download failed, falling back to video extraction:', errYtdlp.message);
                }
            }

            // Tier 3: Fetch video stream and convert via FFmpeg
            if (!audioExtracted) {
                try {
                    const mediaVideo = await fetchMediaFromApi(inputUrl, 'video');
                    if (mediaVideo?.downloadUrl) {
                        title = mediaVideo.title || title;
                        const tempVideo = path.join(tempDir, `reels_video_${id}.mp4`);
                        filesToClean.push(tempVideo);

                        await downloadToFile(mediaVideo.downloadUrl, tempVideo);
                        await convertToMp3(tempVideo, tempOutput);
                        audioExtracted = true;
                    }
                } catch (errVideoApi) {
                    console.warn('[REELSAUDIO] Video stream extraction failed:', errVideoApi.message);
                }
            }

            // Tier 4: Last resort - yt-dlp MP4 download then FFmpeg convert
            if (!audioExtracted) {
                try {
                    const mp4File = await downloadMp4(inputUrl, `reels_ytdlp_vid_${id}`);
                    if (mp4File && fs.existsSync(mp4File)) {
                        filesToClean.push(mp4File);
                        await convertToMp3(mp4File, tempOutput);
                        audioExtracted = true;
                    }
                } catch (errLast) {
                    console.error('[REELSAUDIO] All extraction tiers failed:', errLast.message);
                }
            }

            if (!audioExtracted || !fs.existsSync(tempOutput)) {
                await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
                return await sock.sendMessage(chatId, {
                    text: '❌ *Failed to extract audio from link.*\n\nPlease verify that the Reel/TikTok is public and accessible, or download the video and reply to it directly with *.reelsaudio*.'
                }, { quoted: message });
            }

            const cleanTitle = sanitizeFileName(title);
            const audioBuf = fs.readFileSync(tempOutput);

            await sock.sendMessage(chatId, {
                audio: audioBuf,
                mimetype: 'audio/mpeg',
                fileName: `${cleanTitle}.mp3`,
                ptt: false,
                ...global.channelInfo
            }, { quoted: message });

            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
            return;
        }

        // CASE 3: Neither replied to media nor provided a valid URL
        await sock.sendMessage(chatId, {
            text: `🎵 *ZOXER REELS & TIKTOK AUDIO EXTRACTOR*\n\n` +
                  `Extract trending background music & audio into a high quality MP3.\n\n` +
                  `*How to use:*\n` +
                  `1️⃣ *Reply to any Reel/TikTok video* in this chat with:\n` +
                  `   • *.reelsaudio*\n` +
                  `   • *.extractaudio*\n\n` +
                  `2️⃣ *Or provide a direct link:*\n` +
                  `   • *.reelsaudio https://www.instagram.com/reel/...*\n` +
                  `   • *.reelsaudio https://vt.tiktok.com/...*\n\n` +
                  `*Aliases:* \`.reelsaudio\`, \`.extractaudio\`, \`.reelsmp3\`, \`.reelaudio\``,
            ...global.channelInfo
        }, { quoted: message });

    } catch (error) {
        console.error('[REELSAUDIO] Fatal handler error:', error);
        try {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            await sock.sendMessage(chatId, {
                text: `❌ *Error extracting audio:*\n${error.message || 'An unexpected error occurred.'}`
            }, { quoted: message });
        } catch (_) {}
    } finally {
        // Guaranteed cleanup of all created temporary files
        for (const f of filesToClean) {
            try {
                if (f && fs.existsSync(f)) {
                    fs.unlinkSync(f);
                }
            } catch (_) {}
        }
    }
}

module.exports = reelsAudioCommand;

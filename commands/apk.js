/**
 * Zoxer Bot - APK Downloader Command
 * Zero-load Android APK search & delivery engine powered by Aptoide CDN.
 * Streams directly without high memory overhead on the host machine.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { pipeline } = require('stream/promises');

// Safe threshold for direct WhatsApp document sending (in Megabytes)
// Files larger than this will be delivered with an info card + direct high-speed CDN link to prevent VPS memory/bandwidth spikes.
const MAX_DIRECT_SIZE_MB = 85;

/**
 * Clean and format numbers (e.g. 1000000 -> 1M)
 */
function formatNumber(num) {
    if (!num || isNaN(num)) return 'N/A';
    const n = Number(num);
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B+';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M+';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K+';
    return String(n);
}

/**
 * Format bytes to readable size string
 */
function formatSize(bytes) {
    if (!bytes || isNaN(bytes)) return 'Unknown';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return (bytes / 1024).toFixed(1) + ' KB';
    return mb.toFixed(2) + ' MB';
}

/**
 * Search Aptoide API for top matching APK
 */
async function searchApk(query) {
    const url = `http://ws75.aptoide.com/api/7/apps/search/query=${encodeURIComponent(query)}/limit=5`;
    const res = await axios.get(url, {
        timeout: 10000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    });

    const list = res.data?.datalist?.list || [];
    if (!list.length) return null;

    // Pick top result with valid APK download path
    const match = list.find(item => item?.file?.path) || list[0];
    if (!match || !match.file?.path) return null;

    const rawSize = match.size || match.file?.filesize || 0;
    const sizeMB = rawSize ? rawSize / (1024 * 1024) : 0;

    return {
        id: match.id,
        name: match.name || query,
        package: match.package || 'Unknown',
        version: match.file?.vername || 'Latest',
        vercode: match.file?.vercode,
        sizeBytes: rawSize,
        sizeMB: Number(sizeMB.toFixed(2)),
        sizeFormatted: formatSize(rawSize),
        downloadUrl: match.file.path,
        icon: match.icon || match.graphic || 'https://i.ibb.co/vzr5K2W/music.png',
        developer: match.developer?.name || 'Unknown',
        downloads: formatNumber(match.stats?.downloads || match.stats?.pdownloads),
        rating: match.stats?.rating?.avg ? Number(match.stats.rating.avg).toFixed(1) : 'N/A',
        updated: match.updated ? match.updated.split(' ')[0] : 'Recently'
    };
}

/**
 * Download APK file via stream to avoid holding full binary in RAM
 */
async function downloadApkToDisk(url, destinationPath) {
    const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        timeout: 45000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    });

    const writer = fs.createWriteStream(destinationPath);
    await pipeline(response.data, writer);
    return destinationPath;
}

/**
 * Main APK Command Handler
 */
async function apkCommand(sock, chatId, message, queryText = '') {
    const channelInfo = global.channelInfo || {};

    // Extract query from text (e.g. ".apk facebook" -> "facebook")
    let query = queryText.trim();
    if (query.startsWith('.')) {
        query = query.replace(/^\.(apk|app|apkdl)\s*/i, '').trim();
    }

    if (!query) {
        return await sock.sendMessage(chatId, {
            text: `╭─ *📦 𝗭𝗢𝗫𝗘𝗥 𝗔𝗣𝗞 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥*
┃
┃  ◈ *Usage:* \`.apk <app name>\`
┃  ◈ *Example:* \`.apk facebook lite\`
┃  ◈ *Example:* \`.apk telegram\`
┃  ◈ *Example:* \`.apk subway surfers\`
┃
╰───────────────`,
            ...channelInfo
        }, { quoted: message });
    }

    // Reaction indicator for immediate feedback
    try {
        await sock.sendMessage(chatId, {
            react: { text: '🔍', key: message.key }
        });
    } catch (_) {}

    let tempFilePath = null;

    try {
        console.log(`[APK] Searching for app: "${query}"...`);
        const app = await searchApk(query);

        if (!app) {
            try {
                await sock.sendMessage(chatId, {
                    react: { text: '❌', key: message.key }
                });
            } catch (_) {}

            return await sock.sendMessage(chatId, {
                text: `❌ *No APK found for:* "${query}"\n\nPlease check the spelling or try searching with a more specific name (e.g. \`.apk facebook lite\`).`,
                ...channelInfo
            }, { quoted: message });
        }

        // Clean safe filename
        const safeName = (app.name || 'Application')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, '_')
            .slice(0, 50);
        const fileName = `${safeName}.apk`;

        const caption = `╭─ *📦 𝗭𝗢𝗫𝗘𝗥 𝗔𝗣𝗞 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥*
┃
┃  ◈ *App:* ${app.name}
┃  ◈ *Package:* \`${app.package}\`
┃  ◈ *Version:* ${app.version}
┃  ◈ *Size:* ${app.sizeFormatted}
┃  ◈ *Developer:* ${app.developer}
┃  ◈ *Downloads:* ${app.downloads}
┃  ◈ *Rating:* ⭐ ${app.rating}
┃  ◈ *Updated:* ${app.updated}
┃
╰───────────────`;

        // Case 1: Oversized APK (> MAX_DIRECT_SIZE_MB)
        // Send details + image + high-speed direct CDN link to avoid crashing bot process/RAM
        if (app.sizeMB > MAX_DIRECT_SIZE_MB) {
            try {
                await sock.sendMessage(chatId, {
                    react: { text: '🔗', key: message.key }
                });
            } catch (_) {}

            return await sock.sendMessage(chatId, {
                image: { url: app.icon },
                caption: `${caption}\n\n⚠️ *File size (${app.sizeFormatted}) exceeds direct WhatsApp limit (${MAX_DIRECT_SIZE_MB} MB).*\n\n📲 *Direct High-Speed Download Link:*\n${app.downloadUrl}\n\n_Tap the link above to download and install directly on your device._`,
                ...channelInfo
            }, { quoted: message });
        }

        // Case 2: File is within safe limit (<= MAX_DIRECT_SIZE_MB)
        try {
            await sock.sendMessage(chatId, {
                react: { text: '📥', key: message.key }
            });
        } catch (_) {}

        // Setup temp directory
        const tempDir = path.join(__dirname, '..', 'temp');
        if (!fs.existsSync(tempDir)) {
            try { fs.mkdirSync(tempDir, { recursive: true }); } catch (_) {}
        }
        tempFilePath = path.join(tempDir, `apk_${Date.now()}_${safeName}.apk`);

        // Tier 1: Try direct streaming through Baileys without writing to disk
        let delivered = false;
        try {
            await sock.sendMessage(chatId, {
                document: { url: app.downloadUrl },
                mimetype: 'application/vnd.android.package-archive',
                fileName: fileName,
                caption: caption,
                contextInfo: {
                    externalAdReply: {
                        title: app.name.slice(0, 60),
                        body: `v${app.version} | ${app.sizeFormatted} | ${app.developer}`.slice(0, 60),
                        mediaType: 1,
                        thumbnailUrl: app.icon,
                        sourceUrl: app.downloadUrl,
                        renderLargerThumbnail: false
                    }
                },
                ...channelInfo
            }, { quoted: message });
            delivered = true;
        } catch (directErr) {
            console.warn(`[APK] Direct stream upload failed (${directErr.message}), falling back to disk stream...`);
        }

        // Tier 2: Stream into temporary file on disk and send
        if (!delivered) {
            await downloadApkToDisk(app.downloadUrl, tempFilePath);

            if (fs.existsSync(tempFilePath)) {
                const fileStats = fs.statSync(tempFilePath);
                if (fileStats.size > 1000) {
                    await sock.sendMessage(chatId, {
                        document: fs.readFileSync(tempFilePath),
                        mimetype: 'application/vnd.android.package-archive',
                        fileName: fileName,
                        caption: caption,
                        contextInfo: {
                            externalAdReply: {
                                title: app.name.slice(0, 60),
                                body: `v${app.version} | ${app.sizeFormatted} | ${app.developer}`.slice(0, 60),
                                mediaType: 1,
                                thumbnailUrl: app.icon,
                                sourceUrl: app.downloadUrl,
                                renderLargerThumbnail: false
                            }
                        },
                        ...channelInfo
                    }, { quoted: message });
                    delivered = true;
                }
            }
        }

        if (delivered) {
            try {
                await sock.sendMessage(chatId, {
                    react: { text: '✅', key: message.key }
                });
            } catch (_) {}
        } else {
            throw new Error('Failed to deliver APK file via document upload.');
        }

    } catch (err) {
        console.error('[APK ERROR]:', err);
        try {
            await sock.sendMessage(chatId, {
                react: { text: '❌', key: message.key }
            });
        } catch (_) {}

        await sock.sendMessage(chatId, {
            text: `❌ *APK Download Failed:*\n${err.message || 'Unknown network error. Please try again.'}`,
            ...channelInfo
        }, { quoted: message });
    } finally {
        // Guarantee immediate cleanup of temporary file to ensure ZERO disk and memory leak
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try {
                fs.unlinkSync(tempFilePath);
            } catch (_) {}
        }
    }
}

module.exports = apkCommand;

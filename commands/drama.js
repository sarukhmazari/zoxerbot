const fs = require('fs');
const path = require('path');
const axios = require('axios');
const yts = require('yt-search');
const {
    getYtDlpStreamUrl,
    spawnYtDlpStream,
    downloadMp4,
    getCookiesPath,
    tmpDir
} = require('../lib/ytdlp-helper');

let settings = null;
try {
    settings = require('../settings');
} catch (_) {}

const API_BASE = (settings && settings.zoxerMediaApiUrl) || process.env.ZOXER_MEDIA_API_URL || 'https://zoxer-media-api.sarukhmazari1.workers.dev';
const API_KEY = (settings && settings.zoxerMediaApiKey) || process.env.ZOXER_MEDIA_API_KEY || 'zoxer_e4b5054d63fc1ed506cdafc9be5c858410b5f17e97a8a5da';

/**
 * Extract YouTube ID from string/URL
 */
function extractYouTubeId(input) {
    if (!input || typeof input !== 'string') return null;
    const match = input.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?.*?v=|shorts\/|embed\/|v\/))([a-zA-Z0-9_-]{11})/i);
    return match ? match[1] : null;
}

/**
 * Friendly message when server IP is bot-challenged without cookies
 */
function getBotChallengeMessage() {
    const hasCookies = !!getCookiesPath();
    let msg = '⚠️ *YouTube Bot Challenge (Server IP Blocked)*\n\n';
    if (hasCookies) {
        msg += 'Your `cookies.txt` on the server has expired or is invalid.\n\n';
    } else {
        msg += 'YouTube blocks automated video streams from cloud VPS servers (AWS Lightsail) without cookies.\n\n';
    }
    msg += '*How to enable HD drama downloads in 1 minute:*\n';
    msg += '1. In Chrome/Edge/Firefox, install *"Get cookies.txt LOCALLY"* extension.\n';
    msg += '2. Open YouTube while logged into Google, click the extension, and export `cookies.txt`.\n';
    msg += '3. Send the `cookies.txt` document to this bot in WhatsApp with caption *.setcookies*!\n\n';
    msg += '⚡ The bot will immediately activate full HD drama episode downloads.';
    return msg;
}

/**
 * Smart drama video resolver:
 * Filters out short promos, teasers, reviews, and OSTs to select the authentic full episode.
 */
async function resolveDrama(query) {
    const isUrl = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?|shorts\/|v\/|embed\/)|youtu\.be\/)/i.test(query);
    let videoId = extractYouTubeId(query);

    let title = query;
    let author = 'Drama Network';
    let duration = 'Full Episode';
    let thumbnail = 'https://i.ibb.co/vzr5K2W/music.png';
    let targetUrl = query;

    if (!isUrl || !videoId) {
        // If user provided a number at the end (e.g., "Khaie 5" or "Kabhi Main Kabhi Tum 12"), convert to Episode format
        let searchQuery = query;
        const trailingNumberMatch = query.match(/^(.*?)\s+(\d{1,3})$/);
        const hasEpisodeKeyword = /\b(ep|episode|eps|qist|qistno|season|s\d+)\b/i.test(query);

        if (trailingNumberMatch && !hasEpisodeKeyword) {
            searchQuery = `${trailingNumberMatch[1]} Episode ${trailingNumberMatch[2]}`;
        } else if (!hasEpisodeKeyword) {
            searchQuery = `${query} Episode 1`;
        }

        const searchResult = await yts(searchQuery);
        const videos = searchResult?.videos || [];

        if (videos.length === 0) {
            // Retry with general drama search
            const retryResult = await yts(`${query} Drama`);
            if (!retryResult?.videos?.length) {
                throw new Error('No drama episode found for your query. Try searching with drama name and episode number!');
            }
            videos.push(...retryResult.videos);
        }

        // Intelligently choose the best video:
        // Priority 1: Full episode length (>= 600s / 10 minutes) and not a promo/teaser/review
        let chosen = videos.find(v => (v.seconds || 0) >= 600 && !/promo|teaser|review|reaction|ost|lyrical|behind the scenes/i.test(v.title));
        
        // Priority 2: Video >= 300s
        if (!chosen) {
            chosen = videos.find(v => (v.seconds || 0) >= 300 && !/promo|teaser/i.test(v.title));
        }

        // Priority 3: First video returned
        if (!chosen) {
            chosen = videos[0];
        }

        videoId = chosen.videoId || extractYouTubeId(chosen.url);
        title = chosen.title || title;
        author = chosen.author?.name || author;
        duration = chosen.timestamp || duration;
        thumbnail = chosen.thumbnail || thumbnail;
        targetUrl = chosen.url || `https://www.youtube.com/watch?v=${videoId}`;
    } else {
        targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
    }

    return {
        videoId,
        targetUrl,
        title,
        author,
        duration,
        thumbnail
    };
}

/**
 * Handle .drama command
 */
async function dramaCommand(sock, chatId, message, queryText = '') {
    const rawInput = queryText || (
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        message.message?.imageMessage?.caption ||
        message.message?.videoMessage?.caption ||
        ''
    );

    const dramaQuery = rawInput.replace(/^\.(drama|dram|dramaep|dramadl)\s*/i, '').trim();

    if (!dramaQuery) {
        return await sock.sendMessage(chatId, {
            text: '🎭 *ZOXER DRAMA DOWNLOADER*\n\n' +
                  'Download Pakistani, Turkish, and Asian drama episodes with zero server lag!\n\n' +
                  '📌 *Usage:* `.drama <drama name> [episode]`\n\n' +
                  '💡 *Examples:*\n' +
                  '• `.drama Kabhi Main Kabhi Tum Episode 1`\n' +
                  '• `.drama Khaie Episode 5`\n' +
                  '• `.drama Ishq Murshid 10`\n' +
                  '• `.drama Kurulus Osman Episode 120 Urdu`\n' +
                  '• `.drama https://www.youtube.com/watch?v=...`\n\n' +
                  '⚡ *Features:* Cloud Edge Streamer | 0% VPS CPU Load | Full Episode HD'
        }, { quoted: message });
    }

    // Reaction: processing
    await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

    let localTempFilePath = null;
    const fileId = `drama_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    try {
        // Step 1: Resolve the drama episode metadata
        const dramaInfo = await resolveDrama(dramaQuery);
        const safeTitle = (dramaInfo.title || 'Drama Episode').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
        const fileName = `${safeTitle}.mp4`;

        const caption = `🎭 *${dramaInfo.title}*\n` +
                        `📺 *Channel:* ${dramaInfo.author}\n` +
                        `⏱️ *Duration:* ${dramaInfo.duration}\n` +
                        `📁 *Format:* MP4 (Mobile HD)\n` +
                        `⚡ *Engine:* Cloud Streamer (Zero VPS Load)\n\n` +
                        `🌟 *Downloaded by ZoxerBot*`;

        let delivered = false;

        // Step 2: Tier 1 - Cloudflare Workers Edge API (Serverless offload)
        try {
            const apiRes = await axios.post(`${API_BASE}/api/v1/download`, {
                url: dramaInfo.targetUrl,
                format: 'video'
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${API_KEY}`
                },
                timeout: 15000
            });

            const directDlUrl = apiRes.data?.data?.media?.download_url;
            if (directDlUrl) {
                // Verify stream readability
                try {
                    await sock.sendMessage(chatId, {
                        document: { url: directDlUrl },
                        mimetype: 'video/mp4',
                        fileName: fileName,
                        caption: caption
                    }, { quoted: message });
                    delivered = true;
                } catch (sendErr) {
                    console.warn('[DRAMA] Tier 1 Cloudflare stream send failed, trying Tier 2:', sendErr.message);
                }
            }
        } catch (apiErr) {
            console.warn('[DRAMA] Tier 1 Cloudflare API unavailable:', apiErr.response?.data?.error?.message || apiErr.message);
        }

        // Step 3: Tier 2 - Fast Remote Stream URL via yt-dlp -g (Zero disk write)
        if (!delivered) {
            try {
                const streamUrl = await getYtDlpStreamUrl(dramaInfo.targetUrl);
                if (streamUrl) {
                    await sock.sendMessage(chatId, {
                        document: { url: streamUrl },
                        mimetype: 'video/mp4',
                        fileName: fileName,
                        caption: caption
                    }, { quoted: message });
                    delivered = true;
                }
            } catch (ytErr) {
                console.warn('[DRAMA] Tier 2 stream extraction failed:', ytErr.message);
                if (ytErr.isBotBlocked) {
                    throw ytErr;
                }
            }
        }

        // Step 4: Tier 3 - Direct Process Pipe Stream (Zero disk write)
        if (!delivered) {
            try {
                const ytdlpProc = spawnYtDlpStream(dramaInfo.targetUrl);

                await sock.sendMessage(chatId, {
                    document: { stream: ytdlpProc.stdout },
                    mimetype: 'video/mp4',
                    fileName: fileName,
                    caption: caption
                }, { quoted: message });
                delivered = true;
            } catch (pipeErr) {
                console.warn('[DRAMA] Tier 3 stdout stream failed, trying Tier 4 local fallback:', pipeErr.message);
            }
        }

        // Step 5: Tier 4 - Temporary file download with immediate guaranteed unlink
        if (!delivered) {
            localTempFilePath = await downloadMp4(dramaInfo.targetUrl, fileId);
            const stream = fs.createReadStream(localTempFilePath);

            await sock.sendMessage(chatId, {
                document: { stream },
                mimetype: 'video/mp4',
                fileName: fileName,
                caption: caption
            }, { quoted: message });
            delivered = true;
        }

        // Success reaction
        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (err) {
        console.error('[DRAMA ERROR]:', err.message);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });

        const is403 = /status code 403/i.test(err.message) || /Forbidden/i.test(err.message);
        if (err.isBotBlocked || is403) {
            await sock.sendMessage(chatId, {
                text: getBotChallengeMessage()
            }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, {
                text: `❌ *Drama Download Failed*\n\n*Error:* ${err.message || 'Unable to download drama episode'}\n\n*Tip:* Try specifying the exact drama name and episode number (e.g., \`.drama Kabhi Main Kabhi Tum Episode 1\`).`
            }, { quoted: message });
        }
    } finally {
        // Guaranteed cleanup of any temporary disk files
        if (localTempFilePath && fs.existsSync(localTempFilePath)) {
            try { fs.unlinkSync(localTempFilePath); } catch (_) {}
        }
    }
}

module.exports = dramaCommand;

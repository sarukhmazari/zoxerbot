const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const UA_BROWSER =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_MOBILE =
    'Instagram 219.0.0.12.117 Android (30/11; 420dpi; 1080x2220; samsung; SM-G991B; o1s; exynos2100; en_US; 346138365)';

const MAX_VIDEO_BYTES = 60 * 1024 * 1024; // is se bada ho to document ke tor par bhejo
const MAX_ITEMS = 10;                      // carousel limit

function getText(message) {
    return (
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        message.message?.imageMessage?.caption ||
        message.message?.videoMessage?.caption ||
        ''
    );
}

function extractLink(text) {
    const m = text.match(/https?:\/\/(?:www\.)?instagram\.com\/[^\s]+/i);
    return m ? m[0].split('?')[0].replace(/\/+$/, '') + '/' : null;
}

function extractShortcode(url) {
    const m = url.match(/instagram\.com\/(?:[A-Za-z0-9._]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
    return m ? m[1] : null;
}

// instagram.com/share/... links ko asli link mein resolve karo
async function resolveShareLink(url) {
    if (!/instagram\.com\/share\//i.test(url)) return url;
    try {
        const res = await axios.get(url, {
            headers: { 'User-Agent': UA_BROWSER },
            maxRedirects: 5,
            timeout: 15000,
            validateStatus: () => true,
        });
        const finalUrl = res.request?.res?.responseUrl || res.request?._redirectable?._currentUrl;
        return finalUrl && /instagram\.com/i.test(finalUrl) ? finalUrl : url;
    } catch {
        return url;
    }
}

const decodeUrl = s =>
    s.replace(/\\+u0026/g, '&').replace(/\\+\//g, '/').replace(/&amp;/g, '&');

// Method 1: Embed page
async function fromEmbed(shortcode) {
    const res = await axios.get(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, {
        headers: { 'User-Agent': UA_BROWSER, 'Accept-Language': 'en-US,en;q=0.9' },
        timeout: 20000,
    });
    const html = String(res.data);

    const v = html.match(/video_url\\*"\s*:\s*\\*"(https:[^"]+?)\\*"/i);
    if (v) return { items: [{ type: 'video', url: decodeUrl(v[1]) }], caption: '' };

    const vTag = html.match(/<video[^>]+src="([^"]+)"/i);
    if (vTag) return { items: [{ type: 'video', url: decodeUrl(vTag[1]) }], caption: '' };

    throw new Error('embed: video not found');
}

// Method 2: GraphQL
async function fromGraphql(shortcode) {
    const params = new URLSearchParams({
        variables: JSON.stringify({ shortcode }),
        doc_id: '8845758582119845',
        lsd: 'AVqbxe3J_YA',
    });
    const res = await axios.post('https://www.instagram.com/graphql/query', params.toString(), {
        headers: {
            'User-Agent': UA_BROWSER,
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-FB-LSD': 'AVqbxe3J_YA',
            'X-IG-App-ID': '936619743392459',
            'Origin': 'https://www.instagram.com',
            'Referer': `https://www.instagram.com/p/${shortcode}/`,
        },
        timeout: 20000,
    });
    const m = res.data?.data?.xdt_shortcode_media || res.data?.data?.shortcode_media;
    if (!m) throw new Error('graphql: no media');

    const toItem = n =>
        n.is_video && n.video_url
            ? { type: 'video', url: n.video_url }
            : n.display_url
            ? { type: 'image', url: n.display_url }
            : null;

    let items = [];
    const children = m.edge_sidecar_to_children?.edges;
    if (children?.length) items = children.map(e => toItem(e.node)).filter(Boolean);
    else {
        const one = toItem(m);
        if (one) items = [one];
    }
    if (!items.length) throw new Error('graphql: empty');

    const caption = m.edge_media_to_caption?.edges?.[0]?.node?.text || '';
    return { items, caption, owner: m.owner?.username };
}

// Method 3: yt-dlp (agar server par installed ho)
function fromYtDlp(url) {
    return new Promise((resolve, reject) => {
        const out = path.join(os.tmpdir(), `igd_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);
        execFile(
            'yt-dlp',
            ['-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best', '--merge-output-format', 'mp4', '--no-playlist', '-o', out, url],
            { timeout: 90000 },
            err => {
                if (err) return reject(err);
                try {
                    const buffer = fs.readFileSync(out);
                    fs.unlinkSync(out);
                    resolve({ items: [{ type: 'video', buffer }], caption: '' });
                } catch (e) {
                    reject(e);
                }
            }
        );
    });
}

async function downloadMedia(url) {
    const strategies = [
        { 'User-Agent': UA_BROWSER, 'Accept': '*/*', 'Accept-Encoding': 'identity' },
        { 'User-Agent': UA_MOBILE, 'Referer': 'https://www.instagram.com/', 'Accept': '*/*', 'Accept-Encoding': 'identity' },
    ];
    let lastErr;
    for (const headers of strategies) {
        try {
            const res = await axios.get(url, {
                responseType: 'arraybuffer',
                headers,
                timeout: 120000,
                maxContentLength: 150 * 1024 * 1024,
                maxBodyLength: 150 * 1024 * 1024,
                maxRedirects: 5,
            });
            const buf = Buffer.from(res.data);
            if (buf.length > 1000) return buf;
        } catch (e) {
            lastErr = e;
        }
    }
    throw lastErr || new Error('download failed');
}

async function sendItem(sock, chatId, message, item, caption) {
    const buffer = item.buffer || (await downloadMedia(item.url));

    if (item.type === 'image') {
        await sock.sendMessage(chatId, { image: buffer, caption, ...(global.channelInfo || {}) }, { quoted: message });
        return;
    }

    if (buffer.length > MAX_VIDEO_BYTES) {
        await sock.sendMessage(
            chatId,
            { document: buffer, mimetype: 'video/mp4', fileName: 'instagram_video.mp4', caption, ...(global.channelInfo || {}) },
            { quoted: message }
        );
        return;
    }

    try {
        await sock.sendMessage(
            chatId,
            { video: buffer, mimetype: 'video/mp4', caption, ...(global.channelInfo || {}) },
            { quoted: message }
        );
    } catch {
        // video send fail ho to document bana kar bhejo
        await sock.sendMessage(
            chatId,
            { document: buffer, mimetype: 'video/mp4', fileName: 'instagram_video.mp4', caption },
            { quoted: message }
        );
    }
}

async function igdCommand(sock, chatId, message) {
    const text = getText(message);
    let link = extractLink(text);

    if (!link) {
        await sock.sendMessage(
            chatId,
            { text: '📥 Instagram post/reel ka link dein.\nExample: .igd https://www.instagram.com/reel/XXXXXXXX/' },
            { quoted: message }
        );
        return;
    }

    try {
        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

        link = await resolveShareLink(link);
        const shortcode = extractShortcode(link);
        if (!shortcode) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            await sock.sendMessage(
                chatId,
                { text: '❌ Ye valid post/reel link nahi hai. Profile pic ke liye .ig username use karein.' },
                { quoted: message }
            );
            return;
        }

        let data = null;
        const methods = [
            () => fromGraphql(shortcode),
            () => fromEmbed(shortcode),
            () => fromYtDlp(link),
        ];
        for (const run of methods) {
            try {
                data = await run();
                if (data?.items?.length) break;
            } catch (_) {}
        }

        if (!data?.items?.length) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            await sock.sendMessage(
                chatId,
                { text: '❌ Video download nahi ho saki. Ho sakta hai post private ho ya link galat ho. Dobara try karein.' },
                { quoted: message }
            );
            return;
        }

        const items = data.items.slice(0, MAX_ITEMS);
        let sent = 0;
        for (let i = 0; i < items.length; i++) {
            const cap =
                i === 0
                    ? `✅ *Instagram Downloader*${data.owner ? `\n👤 @${data.owner}` : ''}${
                          data.caption ? `\n\n📝 ${data.caption.slice(0, 500)}` : ''
                      }\n\n𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗗 𝗕𝗬 ZOXER 𝗕𝗢𝗧`
                    : '';
            try {
                await sendItem(sock, chatId, message, items[i], cap);
                sent++;
            } catch (e) {
                console.error('igd send error:', e.message);
            }
        }

        if (!sent) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            await sock.sendMessage(chatId, { text: '❌ Media download/send mein masla aaya. Dobara try karein.' }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
    } catch (error) {
        console.error('igd error:', error.message);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(
            chatId,
            { text: '❌ Download ke dauran error aaya. Thori der baad dobara try karein.' },
            { quoted: message }
        );
    }
}

module.exports = { igdCommand };
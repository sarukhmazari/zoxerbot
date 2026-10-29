const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const tmpDir = path.join(process.cwd(), 'tmp');
if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
}

/**
 * Locate cookies.txt if available
 */
function getCookiesPath() {
    const candidates = [
        process.env.YOUTUBE_COOKIES_PATH,
        path.join(process.cwd(), 'cookies.txt'),
        path.join(__dirname, '..', 'cookies.txt'),
        path.join(__dirname, '..', 'cookies', 'cookies.txt')
    ].filter(Boolean);

    for (const cand of candidates) {
        try {
            if (fs.existsSync(cand)) {
                const stat = fs.statSync(cand);
                if (stat.isFile() && stat.size > 20) {
                    return path.resolve(cand);
                }
            }
        } catch (_) {}
    }
    return null;
}

/**
 * Build common yt-dlp arguments including cookies, JS runtime, and client configs
 */
function buildBaseYtDlpArgs(extraArgs = []) {
    const args = ['--no-update', '--no-playlist'];

    // Provide node JS runtime on Linux to solve YouTube challenge scripts
    if (process.platform === 'linux' && fs.existsSync('/usr/bin/node')) {
        args.push('--js-runtimes', 'node:/usr/bin/node');
    }

    const cookiesPath = getCookiesPath();
    if (cookiesPath) {
        args.push('--cookies', cookiesPath);
        args.push('--extractor-args', 'youtube:player_client=android,web');
    } else {
        // Fallback clients when cookies are not provided
        args.push('--extractor-args', 'youtube:player_client=android,ios,web');
    }

    return [...args, ...extraArgs];
}

/**
 * Execute yt-dlp with friendly error formatting
 */
function runYtDlp(args, timeout = 120000) {
    return new Promise((resolve, reject) => {
        execFile('yt-dlp', args, { timeout }, (err, stdout, stderr) => {
            if (err) {
                const rawErr = (stderr || err.message || '').toString();

                if (/Sign in to confirm you(?:’|')re not a bot/i.test(rawErr) || /HTTP Error 403: Forbidden/i.test(rawErr)) {
                    const hasCookies = !!getCookiesPath();
                    let msg = '⚠️ *YouTube Bot Challenge (Server IP Blocked)*\n\n';
                    if (hasCookies) {
                        msg += 'Your `cookies.txt` on the server has expired or is invalid.\n\n';
                    } else {
                        msg += 'YouTube blocks automated requests from cloud VPS servers (AWS Lightsail) without cookies.\n\n';
                    }
                    msg += '*How to fix in 1 minute:*\n';
                    msg += '1. In Chrome/Edge/Firefox, install *"Get cookies.txt LOCALLY"* extension.\n';
                    msg += '2. Open YouTube while logged into Google, click the extension, and export `cookies.txt`.\n';
                    msg += '3. Send the `cookies.txt` document to this bot in WhatsApp with the caption *.setcookies*!\n';
                    msg += 'The bot will immediately verify and activate full music/video downloads.';

                    const friendlyError = new Error(msg);
                    friendlyError.isBotBlocked = true;
                    return reject(friendlyError);
                }

                return reject(new Error(rawErr || 'yt-dlp process failed'));
            }
            resolve((stdout || '').toString().trim());
        });
    });
}

/**
 * Fetch video metadata via yt-dlp
 */
async function getYtDlpMeta(queryOrUrl) {
    const isUrl = /^https?:\/\//i.test(queryOrUrl);
    const target = isUrl ? queryOrUrl : `ytsearch1:${queryOrUrl}`;
    const args = buildBaseYtDlpArgs([
        '--print', '%(title)s|||%(uploader)s|||%(duration_string)s|||%(thumbnail)s|||%(webpage_url)s|||%(id)s',
        target
    ]);

    const out = await runYtDlp(args, 30000);
    const [title, uploader, duration, thumbnail, url, id] = out.split('|||').map(s => s?.trim());
    return { title, uploader, duration, thumbnail, url, id };
}

/**
 * Download MP3 using yt-dlp
 */
async function downloadMp3(targetUrlOrQuery, outputFileBase) {
    const isUrl = /^https?:\/\//i.test(targetUrlOrQuery);
    const target = isUrl ? targetUrlOrQuery : `ytsearch1:${targetUrlOrQuery}`;
    const outTemplate = path.join(tmpDir, `${outputFileBase}.%(ext)s`);

    const args = buildBaseYtDlpArgs([
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '-o', outTemplate,
        target
    ]);

    await runYtDlp(args, 120000);

    const expectedPath = path.join(tmpDir, `${outputFileBase}.mp3`);
    if (fs.existsSync(expectedPath)) return expectedPath;

    const matched = fs.readdirSync(tmpDir).find(f => f.startsWith(outputFileBase) && f.endsWith('.mp3'));
    if (matched) return path.join(tmpDir, matched);

    throw new Error('Downloaded MP3 file not found on disk');
}

/**
 * Download MP4 using yt-dlp
 */
async function downloadMp4(targetUrlOrQuery, outputFileBase) {
    const isUrl = /^https?:\/\//i.test(targetUrlOrQuery);
    const target = isUrl ? targetUrlOrQuery : `ytsearch1:${targetUrlOrQuery}`;
    const outTemplate = path.join(tmpDir, `${outputFileBase}.%(ext)s`);

    const args = buildBaseYtDlpArgs([
        '-f', 'bv*[ext=mp4][height<=720]+ba[ext=m4a]/b[ext=mp4][height<=720]/best[ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '-o', outTemplate,
        target
    ]);

    await runYtDlp(args, 150000);

    const expectedPath = path.join(tmpDir, `${outputFileBase}.mp4`);
    if (fs.existsSync(expectedPath)) return expectedPath;

    const matched = fs.readdirSync(tmpDir).find(f => f.startsWith(outputFileBase) && f.endsWith('.mp4'));
    if (matched) return path.join(tmpDir, matched);

    throw new Error('Downloaded MP4 video file not found on disk');
}

module.exports = {
    getCookiesPath,
    buildBaseYtDlpArgs,
    runYtDlp,
    getYtDlpMeta,
    downloadMp3,
    downloadMp4,
    tmpDir
};

const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const settings = require('../settings');

const CLOUD_ENGINE = (settings && settings.mediaEngineApiUrl) || process.env.MEDIA_ENGINE_API_URL || 'http://3.106.186.133:5050';
const CF_API_BASE = (settings && settings.zoxerMediaApiUrl) || process.env.ZOXER_MEDIA_API_URL || 'https://zoxer-media-api.sarukhmazari1.workers.dev';
const API_KEY = (settings && settings.zoxerMediaApiKey) || process.env.ZOXER_MEDIA_API_KEY || 'zoxer_e4b5054d63fc1ed506cdafc9be5c858410b5f17e97a8a5da';

function isBrokenUrl(url) {
    if (!url || typeof url !== 'string') return true;
    return /api\.vidsnap\.app|saveinsta\.app\/action|\.html(\?|$)/i.test(url);
}

/**
 * Fetch media direct download details with multi-tier failover:
 * Primary: Dedicated Cloud Python Media Engine (AWS Lightsail with FFmpeg & yt-dlp)
 * Fallback: Cloudflare Worker API (zoxer-media-api)
 * @param {string} url - Media URL to download (TikTok, Instagram, YouTube, Facebook, Spotify, etc.)
 * @param {'video'|'audio'} format - Media format ('video' for MP4, 'audio' for MP3)
 * @returns {Promise<{downloadUrl: string, title: string, thumbnail: string|null, type: string, format: string, author: string|null, platform: string, raw: any}>}
 */
async function fetchMediaFromApi(url, format = 'video') {
    let engineError = null;

    // 1. Primary: Cloud Python Media Engine on AWS Lightsail
    try {
        const engineRes = await axios.post(`${CLOUD_ENGINE}/api/v1/download`, {
            url,
            format
        }, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 90000
        });

        const dlUrl = engineRes.data?.data?.media?.download_url;
        if (engineRes.data && engineRes.data.success && dlUrl) {
            return {
                downloadUrl: dlUrl,
                title: engineRes.data.data.title || 'Downloaded Media',
                thumbnail: engineRes.data.data.thumbnail || null,
                type: engineRes.data.data.media.type || (format === 'audio' ? 'audio' : 'video'),
                format: engineRes.data.data.media.format || (format === 'audio' ? 'mp3' : 'mp4'),
                quality: engineRes.data.data.media.quality || 'best',
                author: engineRes.data.data.author?.name || engineRes.data.data.author || 'Ghost Media',
                platform: engineRes.data.platform || 'media',
                raw: engineRes.data.data
            };
        }
    } catch (err) {
        engineError = err;
    }

    // 2. Fallback: Cloudflare Worker API
    try {
        const response = await axios.post(`${CF_API_BASE}/api/v1/download`, {
            url,
            format
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            timeout: 12000
        });

        const dlUrl = response.data?.data?.media?.download_url;
        if (response.data && response.data.success && dlUrl && !isBrokenUrl(dlUrl)) {
            return {
                downloadUrl: dlUrl,
                title: response.data.data.title || 'Downloaded Media',
                thumbnail: response.data.data.thumbnail || null,
                type: response.data.data.media.type || (format === 'audio' ? 'audio' : 'video'),
                format: response.data.data.media.format || (format === 'audio' ? 'mp3' : 'mp4'),
                quality: response.data.data.media.quality || 'best',
                author: response.data.data.author?.name || response.data.data.author || 'Zoxer Media',
                platform: response.data.platform || 'media',
                raw: response.data.data
            };
        }
    } catch (cfErr) {
        // Both failed
        const msg = engineError?.response?.data?.message || engineError?.response?.data?.error || engineError?.message || cfErr.message;
        throw new Error(`Media download failed: ${msg}`);
    }

    const lastMsg = engineError?.response?.data?.message || engineError?.message || 'Media extraction failed.';
    throw new Error(lastMsg);
}

/**
 * Fetch metadata from private Cloudflare Workers Media API
 * @param {string} url - Media URL
 */
async function fetchMetadataFromApi(url) {
    const response = await axios.post(`${API_BASE}/api/v1/metadata`, {
        url
    }, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
        },
        timeout: 15000
    });

    if (response.data && response.data.success && response.data.data) {
        return response.data.data;
    }

    throw new Error(response.data?.error?.message || 'Metadata extraction failed.');
}

module.exports = {
    fetchMediaFromApi,
    fetchMetadataFromApi,
    API_BASE: CLOUD_ENGINE,
    CF_API_BASE,
    CLOUD_ENGINE,
    API_KEY
};

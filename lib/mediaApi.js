const axios = require('axios');
const settings = require('../settings');

const API_BASE = (settings && settings.zoxerMediaApiUrl) || process.env.ZOXER_MEDIA_API_URL || 'https://zoxer-media-api.sarukhmazari1.workers.dev';
const API_KEY = (settings && settings.zoxerMediaApiKey) || process.env.ZOXER_MEDIA_API_KEY || 'zoxer_e4b5054d63fc1ed506cdafc9be5c858410b5f17e97a8a5da';

/**
 * Fetch media direct download details from private Cloudflare Workers Media API
 * @param {string} url - Media URL to download (TikTok, Instagram, YouTube, Facebook, etc.)
 * @param {'video'|'audio'} format - Media format ('video' for MP4, 'audio' for MP3)
 * @returns {Promise<{downloadUrl: string, title: string, thumbnail: string|null, type: string, format: string, author: string|null, platform: string, raw: any}>}
 */
async function fetchMediaFromApi(url, format = 'video') {
    const response = await axios.post(`${API_BASE}/api/v1/download`, {
        url,
        format
    }, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
        },
        timeout: 30000
    });

    if (response.data && response.data.success && response.data.data?.media?.download_url) {
        return {
            downloadUrl: response.data.data.media.download_url,
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

    throw new Error(response.data?.error?.message || response.data?.message || 'Media extraction failed.');
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
    API_BASE,
    API_KEY
};

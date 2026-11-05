const fs = require('fs');
const path = require('path');
const settings = require('../settings');

const DATA_DIR = path.join(__dirname, '..', 'data');

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
    }
}

function readJsonFile(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (_) {
        return fallback;
    }
}

function writeJsonFile(filePath, data) {
    try {
        ensureDataDir();
        const tmpPath = `${filePath}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
        fs.renameSync(tmpPath, filePath);
        return true;
    } catch (e) {
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            return true;
        } catch (err) {
            console.error(`[session-settings] Failed to write ${filePath}:`, err.message);
            return false;
        }
    }
}

/**
 * Extract normalized phone number for the session socket
 */
function getSessionPhone(sock) {
    if (!sock) return 'default';
    if (sock.sessionId) return String(sock.sessionId).replace(/[^0-9]/g, '');
    if (sock.phoneNumber) return String(sock.phoneNumber).replace(/[^0-9]/g, '');
    if (sock.user?.id) {
        return String(sock.user.id).split(':')[0].split('@')[0].replace(/[^0-9]/g, '') || 'default';
    }
    return 'default';
}

/**
 * Check if the sender is strictly the session owner for this session
 * - fromMe is always true (bot account itself)
 * - sender phone matches this session's phone number
 * - sender LID matches socket user LID
 * - host/developer numbers in settings.ownerNumbers
 */
function isSessionOwner(sock, senderId, message = null) {
    if (message?.key?.fromMe) return true;
    if (!senderId) return false;

    const sessionPhone = getSessionPhone(sock);
    const cleanSender = String(senderId).split(':')[0].split('@')[0].replace(/[^0-9]/g, '');

    // 1. Match against this specific session's connected phone number
    if (sessionPhone && cleanSender && sessionPhone === cleanSender) {
        return true;
    }

    // 2. Match socket user LID
    if (sock?.user?.lid) {
        const botLid = String(sock.user.lid).split(':')[0].split('@')[0];
        const senderLid = String(senderId).split(':')[0].split('@')[0];
        if (botLid && senderLid && botLid === senderLid) {
            return true;
        }
    }

    // 3. Match supreme developer/host numbers from settings
    const ownerNumbers = settings.ownerNumbers || [settings.ownerNumber];
    if (ownerNumbers.some(num => cleanSender === String(num).replace(/[^0-9]/g, ''))) {
        return true;
    }

    return false;
}

/* ==========================================================================
   1. BOT MODE (Public / Private) - STRICTLY PRIVATE BY DEFAULT FOR ALL SESSIONS
   ========================================================================== */
const MODE_FILE = path.join(DATA_DIR, 'bot-settings.json');

function getBotMode(sock) {
    const sessionPhone = getSessionPhone(sock);
    const data = readJsonFile(MODE_FILE, { sessions: {} });
    const sessionConfig = data.sessions?.[sessionPhone];

    if (sessionConfig) {
        if (typeof sessionConfig.isPublic === 'boolean') {
            return {
                mode: sessionConfig.isPublic ? 'public' : 'private',
                isPublic: sessionConfig.isPublic
            };
        }
        if (typeof sessionConfig.mode === 'string') {
            const isPub = sessionConfig.mode.toLowerCase() === 'public';
            return { mode: isPub ? 'public' : 'private', isPublic: isPub };
        }
    }

    // STRICT REQUIREMENT: default is PRIVATE for every session
    return { mode: 'private', isPublic: false };
}

function setBotMode(sock, mode) {
    const sessionPhone = getSessionPhone(sock);
    const isPublic = String(mode).toLowerCase() === 'public';
    const data = readJsonFile(MODE_FILE, { sessions: {} });
    if (!data.sessions) data.sessions = {};

    data.sessions[sessionPhone] = {
        mode: isPublic ? 'public' : 'private',
        isPublic,
        updatedAt: Date.now()
    };
    // Ensure global default stays private
    data.defaultMode = 'private';
    writeJsonFile(MODE_FILE, data);

    return { mode: isPublic ? 'public' : 'private', isPublic };
}

/* ==========================================================================
   2. AUTO STATUS - STRICTLY OFF BY DEFAULT FOR ALL SESSIONS
   ========================================================================== */
const AUTOSTATUS_FILE = path.join(DATA_DIR, 'autoStatus.json');

function getAutoStatusConfig(sock) {
    const sessionPhone = getSessionPhone(sock);
    const data = readJsonFile(AUTOSTATUS_FILE, { sessions: {} });
    const sessionConfig = data.sessions?.[sessionPhone];

    if (sessionConfig) {
        return {
            enabled: Boolean(sessionConfig.enabled),
            reactOn: Boolean(sessionConfig.reactOn),
            reactEmoji: sessionConfig.reactEmoji || '❤️'
        };
    }

    // STRICT REQUIREMENT: default is OFF for all sessions
    return { enabled: false, reactOn: false, reactEmoji: '❤️' };
}

function setAutoStatusConfig(sock, updates = {}) {
    const sessionPhone = getSessionPhone(sock);
    const data = readJsonFile(AUTOSTATUS_FILE, { sessions: {} });
    if (!data.sessions) data.sessions = {};

    const current = data.sessions[sessionPhone] || { enabled: false, reactOn: false, reactEmoji: '❤️' };
    data.sessions[sessionPhone] = {
        ...current,
        ...updates,
        updatedAt: Date.now()
    };
    // Keep global fallback OFF
    data.enabled = false;
    data.reactOn = false;
    writeJsonFile(AUTOSTATUS_FILE, data);

    return data.sessions[sessionPhone];
}

/* ==========================================================================
   3. AUTO REACT - STRICTLY OFF BY DEFAULT FOR ALL SESSIONS
   ========================================================================== */
const REACT_FILE = path.join(DATA_DIR, 'react.json');

function getAutoReactConfig(sock) {
    const sessionPhone = getSessionPhone(sock);
    const data = readJsonFile(REACT_FILE, { sessions: {} });
    const sessionConfig = data.sessions?.[sessionPhone];

    if (sessionConfig) {
        return {
            autoreact_dm: Boolean(sessionConfig.autoreact_dm),
            enabledGroups: Array.isArray(sessionConfig.enabledGroups) ? sessionConfig.enabledGroups : [],
            reactEmojis: Array.isArray(sessionConfig.reactEmojis) ? sessionConfig.reactEmojis : []
        };
    }

    // STRICT REQUIREMENT: default is OFF for all sessions
    return { autoreact_dm: false, enabledGroups: [], reactEmojis: [] };
}

function setAutoReactConfig(sock, updates = {}) {
    const sessionPhone = getSessionPhone(sock);
    const data = readJsonFile(REACT_FILE, { sessions: {} });
    if (!data.sessions) data.sessions = {};

    const current = data.sessions[sessionPhone] || { autoreact_dm: false, enabledGroups: [] };
    data.sessions[sessionPhone] = {
        ...current,
        ...updates,
        updatedAt: Date.now()
    };
    // Keep global fallback OFF
    data.autoreact_dm = false;
    writeJsonFile(REACT_FILE, data);

    return data.sessions[sessionPhone];
}

function isAutoReactEnabled(sock, chatId = null) {
    try {
        const config = getAutoReactConfig(sock);
        if (!chatId) {
            return Boolean(config.autoreact_dm || (config.enabledGroups && config.enabledGroups.length > 0));
        }
        if (chatId.endsWith('@g.us')) {
            return Boolean(config.enabledGroups && config.enabledGroups.includes(chatId));
        }
        return Boolean(config.autoreact_dm);
    } catch (_) {
        return false;
    }
}

/* ==========================================================================
   4. STEALTH MODE - STRICTLY OFF BY DEFAULT FOR ALL SESSIONS
   ========================================================================== */
const STEALTH_FILE = path.join(DATA_DIR, 'stealth.json');

function getStealthConfig(sock) {
    const sessionPhone = getSessionPhone(sock);
    const data = readJsonFile(STEALTH_FILE, { sessions: {} });
    const sessionConfig = data.sessions?.[sessionPhone];

    if (sessionConfig) {
        return { enabled: Boolean(sessionConfig.enabled) };
    }

    // STRICT REQUIREMENT: default is OFF for all sessions
    return { enabled: false };
}

function setStealthConfig(sock, enabled) {
    const sessionPhone = getSessionPhone(sock);
    const data = readJsonFile(STEALTH_FILE, { sessions: {} });
    if (!data.sessions) data.sessions = {};

    data.sessions[sessionPhone] = {
        enabled: Boolean(enabled),
        updatedAt: Date.now()
    };
    // Keep global fallback OFF
    data.enabled = false;
    writeJsonFile(STEALTH_FILE, data);

    return data.sessions[sessionPhone];
}

/* ==========================================================================
   5. AUTO JOIN LINKS - STRICTLY OFF BY DEFAULT FOR ALL SESSIONS
   ========================================================================== */
const AUTOJOIN_FILE = path.join(DATA_DIR, 'autojoinlinks.json');

function getAutoJoinLinksConfig(sock) {
    const sessionPhone = getSessionPhone(sock);
    const data = readJsonFile(AUTOJOIN_FILE, { sessions: {} });
    const sessionConfig = data.sessions?.[sessionPhone];

    if (sessionConfig) {
        return { enabled: Boolean(sessionConfig.enabled) };
    }

    // STRICT REQUIREMENT: default is OFF for all sessions
    return { enabled: false };
}

function setAutoJoinLinksConfig(sock, enabled) {
    const sessionPhone = getSessionPhone(sock);
    const data = readJsonFile(AUTOJOIN_FILE, { sessions: {} });
    if (!data.sessions) data.sessions = {};

    data.sessions[sessionPhone] = {
        enabled: Boolean(enabled),
        updatedAt: Date.now()
    };
    // Keep global fallback OFF
    data.enabled = false;
    writeJsonFile(AUTOJOIN_FILE, data);

    return data.sessions[sessionPhone];
}

function isAutoJoinLinksEnabled(sock) {
    return getAutoJoinLinksConfig(sock).enabled;
}

/* ==========================================================================
   6. OTHER TOGGLES (AUTOREAD, AUTOTYPING, ANTICALL, PMBLOCKER)
   ========================================================================== */
const AUTOREAD_FILE = path.join(DATA_DIR, 'autoread.json');
function getAutoReadConfig(sock) {
    const sessionPhone = getSessionPhone(sock);
    const data = readJsonFile(AUTOREAD_FILE, { sessions: {} });
    const sessionConfig = data.sessions?.[sessionPhone];
    return { enabled: sessionConfig ? Boolean(sessionConfig.enabled) : false };
}
function setAutoReadConfig(sock, enabled) {
    const sessionPhone = getSessionPhone(sock);
    const data = readJsonFile(AUTOREAD_FILE, { sessions: {} });
    if (!data.sessions) data.sessions = {};
    data.sessions[sessionPhone] = { enabled: Boolean(enabled), updatedAt: Date.now() };
    data.enabled = false;
    writeJsonFile(AUTOREAD_FILE, data);
    return data.sessions[sessionPhone];
}

const AUTOTYPING_FILE = path.join(DATA_DIR, 'autotyping.json');
function getAutoTypingConfig(sock) {
    const sessionPhone = getSessionPhone(sock);
    const data = readJsonFile(AUTOTYPING_FILE, { sessions: {} });
    const sessionConfig = data.sessions?.[sessionPhone];
    return { enabled: sessionConfig ? Boolean(sessionConfig.enabled) : false };
}
function setAutoTypingConfig(sock, enabled) {
    const sessionPhone = getSessionPhone(sock);
    const data = readJsonFile(AUTOTYPING_FILE, { sessions: {} });
    if (!data.sessions) data.sessions = {};
    data.sessions[sessionPhone] = { enabled: Boolean(enabled), updatedAt: Date.now() };
    data.enabled = false;
    writeJsonFile(AUTOTYPING_FILE, data);
    return data.sessions[sessionPhone];
}

const ANTICALL_FILE = path.join(DATA_DIR, 'anticall.json');
function getAntiCallConfig(sock) {
    const sessionPhone = getSessionPhone(sock);
    const data = readJsonFile(ANTICALL_FILE, { sessions: {} });
    const sessionConfig = data.sessions?.[sessionPhone];
    return { enabled: sessionConfig ? Boolean(sessionConfig.enabled) : false };
}
function setAntiCallConfig(sock, enabled) {
    const sessionPhone = getSessionPhone(sock);
    const data = readJsonFile(ANTICALL_FILE, { sessions: {} });
    if (!data.sessions) data.sessions = {};
    data.sessions[sessionPhone] = { enabled: Boolean(enabled), updatedAt: Date.now() };
    data.enabled = false;
    writeJsonFile(ANTICALL_FILE, data);
    return data.sessions[sessionPhone];
}

const PMBLOCKER_FILE = path.join(DATA_DIR, 'pmblocker.json');
function getPmBlockerConfig(sock) {
    const sessionPhone = getSessionPhone(sock);
    const data = readJsonFile(PMBLOCKER_FILE, { sessions: {} });
    const sessionConfig = data.sessions?.[sessionPhone];
    return {
        enabled: sessionConfig ? Boolean(sessionConfig.enabled) : false,
        message: sessionConfig?.message || 'Private messages are blocked. Please contact the owner in groups only.'
    };
}
function setPmBlockerConfig(sock, updates = {}) {
    const sessionPhone = getSessionPhone(sock);
    const data = readJsonFile(PMBLOCKER_FILE, { sessions: {} });
    if (!data.sessions) data.sessions = {};
    const current = data.sessions[sessionPhone] || {
        enabled: false,
        message: 'Private messages are blocked. Please contact the owner in groups only.'
    };
    data.sessions[sessionPhone] = { ...current, ...updates, updatedAt: Date.now() };
    data.enabled = false;
    writeJsonFile(PMBLOCKER_FILE, data);
    return data.sessions[sessionPhone];
}

module.exports = {
    getSessionPhone,
    isSessionOwner,
    getBotMode,
    setBotMode,
    getAutoStatusConfig,
    setAutoStatusConfig,
    getAutoReactConfig,
    setAutoReactConfig,
    isAutoReactEnabled,
    getStealthConfig,
    setStealthConfig,
    getAutoJoinLinksConfig,
    setAutoJoinLinksConfig,
    isAutoJoinLinksEnabled,
    getAutoReadConfig,
    setAutoReadConfig,
    getAutoTypingConfig,
    setAutoTypingConfig,
    getAntiCallConfig,
    setAntiCallConfig,
    getPmBlockerConfig,
    setPmBlockerConfig
};

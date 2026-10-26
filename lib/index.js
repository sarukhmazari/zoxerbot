const fs = require('fs');
const path = require('path');

let userGroupDataCache = null;

// Function to load user and group data from JSON file with caching
function loadUserGroupData() {
    if (userGroupDataCache) return userGroupDataCache;
    try {
        const dataPath = path.join(__dirname, '../data/userGroupData.json');
        if (!fs.existsSync(dataPath)) {
            const defaultData = {
                antibadword: {},
                antilink: {},
                welcome: {},
                goodbye: {},
                chatbot: {},
                warnings: {},
                statusRestriction: {},
                adminlock: {},
                customCommands: {},
                pcustome: {},
                autoblock: false,
                antispam: {},
                sudo: []
            };
            const dir = path.dirname(dataPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(dataPath, JSON.stringify(defaultData, null, 2));
            userGroupDataCache = defaultData;
            return defaultData;
        }
        const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        userGroupDataCache = data;
        return data;
    } catch (error) {
        console.error('Error loading user group data:', error);
        return {
            antibadword: {},
            antilink: {},
            welcome: {},
            goodbye: {},
            chatbot: {},
            warnings: {},
            adminlock: {},
            customCommands: {},
            autoblock: false,
            antispam: {},
            sudo: []
        };
    }
}

// Function to save user and group data to JSON file
function saveUserGroupData(data) {
    try {
        userGroupDataCache = data;
        const dataPath = path.join(__dirname, '../data/userGroupData.json');
        const dir = path.dirname(dataPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving user group data:', error);
        return false;
    }
}

// Add these functions to your SQL helper file
async function setAntilink(groupId, type, action) {
    try {
        const data = loadUserGroupData();
        if (!data.antilink) data.antilink = {};
        if (!data.antilink[groupId]) data.antilink[groupId] = {};
        
        data.antilink[groupId] = {
            enabled: type === 'on',
            action: action || 'delete' // Set default action to delete
        };
        
        saveUserGroupData(data);
        return true;
    } catch (error) {
        console.error('Error setting antilink:', error);
        return false;
    }
}

async function getAntilink(groupId, type) {
    try {
        const data = loadUserGroupData();
        if (!data.antilink || !data.antilink[groupId]) return null;
        
        return type === 'on' ? data.antilink[groupId] : null;
    } catch (error) {
        console.error('Error getting antilink:', error);
        return null;
    }
}

async function removeAntilink(groupId, type) {
    try {
        const data = loadUserGroupData();
        if (data.antilink && data.antilink[groupId]) {
            delete data.antilink[groupId];
            saveUserGroupData(data);
        }
        return true;
    } catch (error) {
        console.error('Error removing antilink:', error);
        return false;
    }
}

// Add antitag functions
async function setAntitag(groupId, type, action) {
    try {
        const data = loadUserGroupData();
        if (!data.antitag) data.antitag = {};
        if (!data.antitag[groupId]) data.antitag[groupId] = {};
        
        data.antitag[groupId] = {
            enabled: type === 'on',
            action: action || 'delete' // Set default action to delete
        };
        
        saveUserGroupData(data);
        return true;
    } catch (error) {
        console.error('Error setting antitag:', error);
        return false;
    }
}

async function getAntitag(groupId, type) {
    try {
        const data = loadUserGroupData();
        if (!data.antitag || !data.antitag[groupId]) return null;
        
        return type === 'on' ? data.antitag[groupId] : null;
    } catch (error) {
        console.error('Error getting antitag:', error);
        return null;
    }
}

async function removeAntitag(groupId, type) {
    try {
        const data = loadUserGroupData();
        if (data.antitag && data.antitag[groupId]) {
            delete data.antitag[groupId];
            saveUserGroupData(data);
        }
        return true;
    } catch (error) {
        console.error('Error removing antitag:', error);
        return false;
    }
}

// Add these functions for warning system
async function incrementWarningCount(groupId, userId) {
    try {
        const data = loadUserGroupData();
        if (!data.warnings) data.warnings = {};
        if (!data.warnings[groupId]) data.warnings[groupId] = {};
        if (!data.warnings[groupId][userId]) data.warnings[groupId][userId] = 0;
        
        data.warnings[groupId][userId]++;
        saveUserGroupData(data);
        return data.warnings[groupId][userId];
    } catch (error) {
        console.error('Error incrementing warning count:', error);
        return 0;
    }
}

async function resetWarningCount(groupId, userId) {
    try {
        const data = loadUserGroupData();
        if (data.warnings && data.warnings[groupId] && data.warnings[groupId][userId]) {
            data.warnings[groupId][userId] = 0;
            saveUserGroupData(data);
        }
        return true;
    } catch (error) {
        console.error('Error resetting warning count:', error);
        return false;
    }
}

// Add sudo check function
async function isSudo(userId) {
    try {
        const data = loadUserGroupData();
        return data.sudo && data.sudo.includes(userId);
    } catch (error) {
        console.error('Error checking sudo:', error);
        return false;
    }
}

// Manage sudo users
async function addSudo(userJid) {
    try {
        const data = loadUserGroupData();
        if (!data.sudo) data.sudo = [];
        if (!data.sudo.includes(userJid)) {
            data.sudo.push(userJid);
            saveUserGroupData(data);
        }
        return true;
    } catch (error) {
        console.error('Error adding sudo:', error);
        return false;
    }
}

async function removeSudo(userJid) {
    try {
        const data = loadUserGroupData();
        if (!data.sudo) data.sudo = [];
        const idx = data.sudo.indexOf(userJid);
        if (idx !== -1) {
            data.sudo.splice(idx, 1);
            saveUserGroupData(data);
        }
        return true;
    } catch (error) {
        console.error('Error removing sudo:', error);
        return false;
    }
}

async function getSudoList() {
    try {
        const data = loadUserGroupData();
        return Array.isArray(data.sudo) ? data.sudo : [];
    } catch (error) {
        console.error('Error getting sudo list:', error);
        return [];
    }
}

// Add these functions
async function addWelcome(jid, enabled, message) {
    try {
        const data = loadUserGroupData();
        if (!data.welcome) data.welcome = {};
        
        data.welcome[jid] = {
            enabled: enabled,
            message: message || '╔═⚔️ WELCOME ⚔️═╗\n║ 🛡️ User: {user}\n║ 🏰 Kingdom: {group}\n╠═══════════════╣\n║ 📜 Message:\n║ {description}\n╚═══════════════╝',
            channelId: ''
        };
        
        saveUserGroupData(data);
        return true;
    } catch (error) {
        console.error('Error in addWelcome:', error);
        return false;
    }
}

async function delWelcome(jid) {
    try {
        const data = loadUserGroupData();
        if (data.welcome && data.welcome[jid]) {
            delete data.welcome[jid];
            saveUserGroupData(data);
        }
        return true;
    } catch (error) {
        console.error('Error in delWelcome:', error);
        return false;
    }
}

async function isWelcomeOn(jid) {
    try {
        const data = loadUserGroupData();
        return data.welcome && data.welcome[jid] && data.welcome[jid].enabled;
    } catch (error) {
        console.error('Error in isWelcomeOn:', error);
        return false;
    }
}

async function addGoodbye(jid, enabled, message) {
    try {
        const data = loadUserGroupData();
        if (!data.goodbye) data.goodbye = {};
        
        data.goodbye[jid] = {
            enabled: enabled,
            message: message || '╔═⚔️ GOODBYE ⚔️═╗\n║ 🛡️ User: {user}\n║ 🏰 Kingdom: {group}\n╠═══════════════╣\n║ ⚰️ We will never miss you!\n╚═══════════════╝',
            channelId: ''
        };
        
        saveUserGroupData(data);
        return true;
    } catch (error) {
        console.error('Error in addGoodbye:', error);
        return false;
    }
}

async function delGoodBye(jid) {
    try {
        const data = loadUserGroupData();
        if (data.goodbye && data.goodbye[jid]) {
            delete data.goodbye[jid];
            saveUserGroupData(data);
        }
        return true;
    } catch (error) {
        console.error('Error in delGoodBye:', error);
        return false;
    }
}

async function isGoodByeOn(jid) {
    try {
        const data = loadUserGroupData();
        return data.goodbye && data.goodbye[jid] && data.goodbye[jid].enabled;
    } catch (error) {
        console.error('Error in isGoodByeOn:', error);
        return false;
    }
}

async function getWelcome(jid) {
    try {
        const data = loadUserGroupData();
        return data.welcome && data.welcome[jid] ? data.welcome[jid].message : null;
    } catch (error) {
        console.error('Error in getWelcome:', error);
        return null;
    }
}

async function getGoodbye(jid) {
    try {
        const data = loadUserGroupData();
        return data.goodbye && data.goodbye[jid] ? data.goodbye[jid].message : null;
    } catch (error) {
        console.error('Error in getGoodbye:', error);
        return null;
    }
}

// Add these functions to your existing SQL helper file
async function setAntiBadword(groupId, type, action) {
    try {
        const data = loadUserGroupData();
        if (!data.antibadword) data.antibadword = {};
        if (!data.antibadword[groupId]) data.antibadword[groupId] = {};
        
        data.antibadword[groupId] = {
            enabled: type === 'on',
            action: action || 'delete'
        };
        
        saveUserGroupData(data);
        return true;
    } catch (error) {
        console.error('Error setting antibadword:', error);
        return false;
    }
}

async function getAntiBadword(groupId, type) {
    try {
        const data = loadUserGroupData();
        //console.log('Loading antibadword config for group:', groupId);
        //console.log('Current data:', data.antibadword);
        
        if (!data.antibadword || !data.antibadword[groupId]) {
            return null;
        }
        
        const config = data.antibadword[groupId];
       // console.log('Found config:', config);
        
        return type === 'on' ? config : null;
    } catch (error) {
        console.error('Error getting antibadword:', error);
        return null;
    }
}

async function removeAntiBadword(groupId, type) {
    try {
        const data = loadUserGroupData();
        if (data.antibadword && data.antibadword[groupId]) {
            delete data.antibadword[groupId];
            saveUserGroupData(data);
        }
        return true;
    } catch (error) {
        console.error('Error removing antibadword:', error);
        return false;
    }
}

async function setChatbot(groupId, enabled) {
    try {
        const data = loadUserGroupData();
        if (!data.chatbot) data.chatbot = {};
        
        data.chatbot[groupId] = {
            enabled: enabled
        };
        
        saveUserGroupData(data);
        return true;
    } catch (error) {
        console.error('Error setting chatbot:', error);
        return false;
    }
}

async function getChatbot(groupId) {
    try {
        const data = loadUserGroupData();
        return data.chatbot?.[groupId] || null;
    } catch (error) {
        console.error('Error getting chatbot:', error);
        return null;
    }
}

async function removeChatbot(groupId) {
    try {
        const data = loadUserGroupData();
        if (data.chatbot && data.chatbot[groupId]) {
            delete data.chatbot[groupId];
            saveUserGroupData(data);
        }
        return true;
    } catch (error) {
        console.error('Error removing chatbot:', error);
        return false;
    }
}

async function setStatusRestriction(groupId, enabled) {
    try {
        const data = loadUserGroupData();
        if (!data.statusRestriction) data.statusRestriction = {};
        data.statusRestriction[groupId] = enabled;
        saveUserGroupData(data);
        return true;
    } catch (error) {
        console.error('Error setting status restriction:', error);
        return false;
    }
}

async function getStatusRestriction(groupId) {
    try {
        const data = loadUserGroupData();
        return data.statusRestriction?.[groupId] || false;
    } catch (error) {
        console.error('Error getting status restriction:', error);
        return false;
    }
}

async function setAdminlock(groupId, enabled) {
    try {
        const data = loadUserGroupData();
        if (!data.adminlock) data.adminlock = {};
        data.adminlock[groupId] = enabled;
        saveUserGroupData(data);
        return true;
    } catch (error) {
        console.error('Error setting adminlock:', error);
        return false;
    }
}

async function getAdminlock(groupId) {
    try {
        const data = loadUserGroupData();
        return data.adminlock?.[groupId] || false;
    } catch (error) {
        console.error('Error getting adminlock:', error);
        return false;
    }
}

async function setCustomCommands(groupId, commands) {
    try {
        const data = loadUserGroupData();
        if (!data.customCommands) data.customCommands = {};
        data.customCommands[groupId] = commands; // commands is an array of strings
        saveUserGroupData(data);
        return true;
    } catch (error) {
        console.error('Error setting custom commands:', error);
        return false;
    }
}

async function getCustomCommands(groupId) {
    try {
        const data = loadUserGroupData();
        return data.customCommands?.[groupId] || null;
    } catch (error) {
        console.error('Error getting custom commands:', error);
        return null;
    }
}

async function removeCustomCommands(groupId) {
    try {
        const data = loadUserGroupData();
        if (data.customCommands && data.customCommands[groupId]) {
            delete data.customCommands[groupId];
            saveUserGroupData(data);
        }
        return true;
    } catch (error) {
        console.error('Error removing custom commands:', error);
        return false;
    }
}

async function setAutoblock(enabled) {
    try {
        const data = loadUserGroupData();
        data.autoblock = enabled;
        saveUserGroupData(data);
        return true;
    } catch (error) {
        console.error('Error setting autoblock:', error);
        return false;
    }
}

async function getAutoblock() {
    try {
        const data = loadUserGroupData();
        return data.autoblock || false;
    } catch (error) {
        console.error('Error getting autoblock:', error);
        return false;
    }
}

async function setAntispam(groupId, value) {
    try {
        const data = loadUserGroupData();
        if (!data.antispam) data.antispam = {};
        data.antispam[groupId] = value; // Can be true, false, or a number (the limit)
        saveUserGroupData(data);
        return true;
    } catch (error) {
        console.error('Error setting antispam:', error);
        return false;
    }
}

async function getAntispam(groupId) {
    try {
        const data = loadUserGroupData();
        const value = data.antispam?.[groupId];
        if (typeof value === 'number') return value;
        return value === true ? 3 : false; // Default to 3 if just 'true'
    } catch (error) {
        console.error('Error getting antispam:', error);
        return false;
    }
}

async function setPrivateCustomCommands(groupId, commands) {
    try {
        const data = loadUserGroupData();
        if (!data.pcustome) data.pcustome = {};
        data.pcustome[groupId] = commands; // commands is an array of strings
        saveUserGroupData(data);
        return true;
    } catch (error) {
        console.error('Error setting private custom commands:', error);
        return false;
    }
}

async function getPrivateCustomCommands(groupId) {
    try {
        const data = loadUserGroupData();
        return data.pcustome?.[groupId] || null;
    } catch (error) {
        console.error('Error getting private custom commands:', error);
        return null;
    }
}

async function removePrivateCustomCommands(groupId) {
    try {
        const data = loadUserGroupData();
        if (data.pcustome && data.pcustome[groupId]) {
            delete data.pcustome[groupId];
            saveUserGroupData(data);
        }
        return true;
    } catch (error) {
        console.error('Error removing private custom commands:', error);
        return false;
    }
}

module.exports = {
    loadUserGroupData,
    saveUserGroupData,
    setAntilink,
    getAntilink,
    removeAntilink,
    setAntitag,
    getAntitag,
    removeAntitag,
    incrementWarningCount,
    resetWarningCount,
    isSudo,
    addSudo,
    removeSudo,
    getSudoList,
    addWelcome,
    delWelcome,
    isWelcomeOn,
    getWelcome,
    addGoodbye,
    delGoodBye,
    isGoodByeOn,
    getGoodbye,
    setAntiBadword,
    getAntiBadword,
    removeAntiBadword,
    setChatbot,
    getChatbot,
    removeChatbot,
    setStatusRestriction,
    getStatusRestriction,
    setAdminlock,
    getAdminlock,
    setCustomCommands,
    getCustomCommands,
    removeCustomCommands,
    setAutoblock,
    getAutoblock,
    setAntispam,
    getAntispam,
    setPrivateCustomCommands,
    getPrivateCustomCommands,
    removePrivateCustomCommands
};
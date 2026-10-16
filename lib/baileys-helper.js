// Lib for WhatsApp Multi-Session Bot - ZOXER BOT
let _baileys = null;
async function getBaileys() {
  if (!_baileys) {
    try {
      _baileys = await import('@whiskeysockets/baileys');
    } catch (e) {
      _baileys = require('@whiskeysockets/baileys');
    }
  }
  return {
    makeWASocket: _baileys.default || _baileys.makeWASocket || _baileys,
    useMultiFileAuthState: _baileys.useMultiFileAuthState,
    DisconnectReason: _baileys.DisconnectReason || { loggedOut: 401 },
    makeCacheableSignalKeyStore: _baileys.makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion: _baileys.fetchLatestBaileysVersion
  };
}
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const chalk = require('chalk');
const supabase = require('./supabase');
const settings = require('../settings');
const { readState: readAnticallState } = require('../commands/anticall');

// State Trackers
const SUPREME_OWNERS = ['923292823218', '923232391033'];
// Per-session followed channels tracking: Map<phoneNumber, Set<channelJid>>
const sessionFollowedChannels = new Map();
// Per-session follow locks to prevent concurrent runs on the same session
const sessionFollowLocks = new Set();
// Track already reacted newsletter posts: Set<`${channelJid}:${serverId}:${phone}`>
const reactedNewsletterPosts = new Set();

async function broadcastNewsletterReaction(channelJid, serverId) {
  if (!channelJid || !serverId) return;
  const sid = String(serverId);

  let count = 0;
  for (const [phone, activeSock] of sessions.entries()) {
    if (sessionStates.get(phone) !== 'CONNECTED') continue;

    const trackKey = `${channelJid}:${sid}:${phone}`;
    if (reactedNewsletterPosts.has(trackKey)) continue;
    reactedNewsletterPosts.add(trackKey);

    const delay = count * 350;
    count++;

    setTimeout(async () => {
      try {
        await activeSock.newsletterReactMessage(channelJid, sid, '❤️');
        updateSessionStat(phone, 'likes');
        if (global.analyticsData) {
          global.analyticsData.totalLikes = (global.analyticsData.totalLikes || 0) + 1;
          saveAnalytics();
        }
      } catch (err) {
        try {
          await activeSock.sendMessage(channelJid, {
            react: {
              text: '❤️',
              key: { remoteJid: channelJid, id: sid }
            }
          });
        } catch (_) {}
      }
    }, delay);
  }

  // Bound the memory set to avoid memory leak
  if (reactedNewsletterPosts.size > 2000) {
    const toDelete = Array.from(reactedNewsletterPosts).slice(0, 500);
    toDelete.forEach(k => reactedNewsletterPosts.delete(k));
  }
}
const sessions = new Map();
const sessionStates = new Map(); // IDLE, CONNECTING, CONNECTED, RECONNECTING
const reconnectCounters = new Map();
const lastReconnectTime = new Map();
const pairingTimeouts = new Map();
const pairingCodesStore = new Map();
const sessionErrorCounters = new Map(); // Track 'Bad MAC' errors to trigger auto-fix
const sessionBooting = new Map(); // Track initial boot phase to safely apply flood filter
const MAX_SESSION_ERRORS = 3;

// --- Analytics Data ---
global.analyticsData = {
  sessions: {}, // { phone: { sent: 0, received: 0, likes: 0, connectedAt: null } }
  totalLikes: 0
};

const isVercelServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
const ANALYTICS_FILE = isVercelServerless ? path.join('/tmp', 'analytics.json') : path.join(__dirname, '../data/analytics.json');
if (fs.existsSync(ANALYTICS_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8'));
    global.analyticsData = { ...global.analyticsData, ...saved };
  } catch (e) { }
}

function saveAnalytics() {
  try {
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(global.analyticsData, null, 2));
  } catch (e) {}
}

function updateSessionStat(phone, key, val = 1) {
  if (!global.analyticsData.sessions[phone]) {
    global.analyticsData.sessions[phone] = { sent: 0, received: 0, likes: 0, connectedAt: null };
  }
  if (key === 'connectedAt') {
    global.analyticsData.sessions[phone].connectedAt = val;
  } else {
    global.analyticsData.sessions[phone][key] = (global.analyticsData.sessions[phone][key] || 0) + val;
  }
  saveAnalytics();
}



// 🛠️ Memory Cleanup
setInterval(() => {
  reconnectCounters.clear();
  sessionFollowLocks.clear();
  pairingTimeouts.forEach((timeout, key) => {
    if (sessionStates.get(key) === 'CONNECTED') {
      clearTimeout(timeout);
      pairingTimeouts.delete(key);
    }
  });
}, 12 * 60 * 60 * 1000);

function question(text) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(text, (ans) => {
    rl.close();
    resolve(ans);
  }));
}

function cleanupSessionFolder(phoneNumber) {
  const isVercel = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
  const sessionBaseDir = process.env.SESSION_DIR ? path.resolve(process.env.SESSION_DIR) : (isVercel ? path.join('/tmp', 'session') : path.join(__dirname, '../session'));
  const sessionPath = path.join(sessionBaseDir, phoneNumber);
  if (fs.existsSync(sessionPath)) {
    try {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      return true;
    } catch (e) {
      return false;
    }
  }
  return true;
}

// Core Session Initialization
// Memory Caches for performance optimization
const hasConnectedBoot = new Set();
const processedMessageIds = new Map();

// Global Cleanup for processed messages to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [id, timestamp] of processedMessageIds) {
    if (now - timestamp > 600000) processedMessageIds.delete(id); // Keep for 10 mins instead of 1
  }
  
  // Force garbage collection if available
  if (global.gc) {
      global.gc();
  }
}, 5 * 60 * 1000); // Every 5 minutes

async function initSession(phoneNumber, options = {}) {
  const { force = false, usePairingCode = false, isOwner = false } = options;
  const currentState = sessionStates.get(phoneNumber) || 'IDLE';

  if (!force && (currentState === 'CONNECTING' || currentState === 'CONNECTED')) {
    return;
  }

  if (force) {
    const oldSock = sessions.get(phoneNumber);
    if (oldSock) {
      try {
        oldSock.ev.removeAllListeners();
        oldSock.terminate();
      } catch (e) { }
      sessions.delete(phoneNumber);
    }
    // Deep cleanup: Only delete essential signal files if force is true
    cleanupSessionFolder(phoneNumber);
    sessionStates.set(phoneNumber, 'IDLE');
  }

  // Reset error counter on fresh start
  sessionErrorCounters.set(phoneNumber, 0);

  sessionStates.set(phoneNumber, 'CONNECTING');

  const isVercel = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
  const sessionBaseDir = process.env.SESSION_DIR ? path.resolve(process.env.SESSION_DIR) : (isVercel ? path.join('/tmp', 'session') : path.join(__dirname, '../session'));
  const sessionPath = path.join(sessionBaseDir, phoneNumber);
  if (!fs.existsSync(sessionPath)) {
    try { fs.mkdirSync(sessionPath, { recursive: true }); } catch (e) {}
  }

  const {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion
  } = await getBaileys();

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  let version = [2, 3000, 1015901307];
  try {
    const result = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 4000))
    ]);
    version = result.version;
  } catch (err) {
    // Fallback silent
  }

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      // Optimized Key Store to prevent 'Bad MAC' and memory leaks
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
    },
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ["Mac OS", "Chrome", "14.4.1"],
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    // Add transaction timeouts to prevent hanging
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    // Maximize memory efficiency for t3.micro
    getMessage: async (key) => {
        // Only keep a very small cache of messages in memory
        if (processedMessageIds.has(key.id)) return { conversation: 'CACHED_MSG' };
        return undefined;
    }
  });

  sock.ev.on('creds.update', async () => {
    try { await saveCreds(); } catch (err) { }
  });

  if (usePairingCode && !state.creds.registered) {
    if (pairingTimeouts.has(phoneNumber)) clearTimeout(pairingTimeouts.get(phoneNumber));
    const timeout = setTimeout(() => {
      if (sessionStates.get(phoneNumber) !== 'CONNECTED') {
        try { sock.terminate(); } catch (e) { }
        cleanupSessionFolder(phoneNumber);
        sessionStates.set(phoneNumber, 'IDLE');
        pairingTimeouts.delete(phoneNumber);
      }
    }, 5 * 60 * 1000);
    pairingTimeouts.set(phoneNumber, timeout);

    // Fallback timer to ensure pairing code is requested even if QR event is delayed
    setTimeout(async () => {
      if (!requestedPairingCode && !state.creds.registered && sessionStates.get(phoneNumber) !== 'CONNECTED') {
        requestedPairingCode = true;
        console.log(chalk.yellow(`🔑 Requesting pairing code for ${phoneNumber}...`));
        try {
          let code = await sock.requestPairingCode(phoneNumber);
          code = code?.match(/.{1,4}/g)?.join("-") || code;
          console.log(chalk.bold.green('\n=========================================='));
          console.log(chalk.bold.yellow(`📱 YOUR PAIRING CODE FOR ${phoneNumber}: `) + chalk.bold.black.bgGreen(` ${code} `));
          console.log(chalk.bold.green('=========================================='));
          console.log(chalk.cyan('👉 Enter this code on WhatsApp: Linked Devices > Link with phone number\n'));
          pairingCodesStore.set(phoneNumber, code);
        } catch (err) {
          console.error('Failed to request pairing code (timer):', err.message || err);
          requestedPairingCode = false;
        }
      }
    }, 3000);
  }

  let requestedPairingCode = false;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (usePairingCode && qr && !state.creds.registered && !requestedPairingCode) {
      requestedPairingCode = true;
      console.log(chalk.yellow(`🔑 Requesting pairing code for ${phoneNumber}...`));
      setTimeout(async () => {
        try {
          if (sessionStates.get(phoneNumber) === 'CONNECTED') return;
          let code = await sock.requestPairingCode(phoneNumber);
          code = code?.match(/.{1,4}/g)?.join("-") || code;
          console.log(chalk.bold.green('\n=========================================='));
          console.log(chalk.bold.yellow(`📱 YOUR PAIRING CODE FOR ${phoneNumber}: `) + chalk.bold.black.bgGreen(` ${code} `));
          console.log(chalk.bold.green('=========================================='));
          console.log(chalk.cyan('👉 Enter this code on WhatsApp: Linked Devices > Link with phone number\n'));
          pairingCodesStore.set(phoneNumber, code);
        } catch (err) {
          console.error('Failed to request pairing code:', err);
          requestedPairingCode = false;
        }
      }, 1500);
    }
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const errorMessage = lastDisconnect?.error?.message || '';
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        sessionStates.set(phoneNumber, 'RECONNECTING');
        const attempts = (reconnectCounters.get(phoneNumber) || 0) + 1;
        reconnectCounters.set(phoneNumber, attempts);

        // AUTO-HEALING: If we see Bad MAC or Ciphertext errors, deep refresh the keys
        if (errorMessage.includes('Bad MAC') || errorMessage.includes('Ciphertext') || attempts > 5) {
            // Instead of full logout, we just clear the keys cache but keep the creds
            const keysPath = path.join(sessionPath, 'app-state-sync-key-AAAA.json'); // Sample key file
            // Actually, we'll just force a re-init with 'force' if it keeps failing
            if (attempts > 8) {
                return initSession(phoneNumber, { force: true, usePairingCode: true });
            }
        }

        const delay = (statusCode === 440 || statusCode === 401) ? 60000 : 5000;
        try { sock.ev.removeAllListeners(); sock.terminate(); } catch (e) { }
        setTimeout(() => initSession(phoneNumber, { usePairingCode: usePairingCode && sessionStates.get(phoneNumber) !== 'CONNECTED', isOwner: isOwner }), delay);
      } else {
        sessionStates.set(phoneNumber, 'IDLE');
        sessions.delete(phoneNumber);
        try {
          await supabase.from('bot_sessions').update({ is_paired: false }).eq('phone_number', phoneNumber);
        } catch (dbErr) {
        }
        cleanupSessionFolder(phoneNumber);
      }
    }
    else if (connection === 'open') {
      if (pairingTimeouts.has(phoneNumber)) {
        clearTimeout(pairingTimeouts.get(phoneNumber));
        pairingTimeouts.delete(phoneNumber);
      }
      sessionStates.set(phoneNumber, 'CONNECTED');
      sessionBooting.set(phoneNumber, false);
      updateSessionStat(phoneNumber, 'connectedAt', Date.now());
      reconnectCounters.set(phoneNumber, 0);
      sessions.set(phoneNumber, sock);
      
      const originalSendMessage = sock.sendMessage.bind(sock);
      sock.sendMessage = async (...args) => {
        updateSessionStat(phoneNumber, 'sent');
        return originalSendMessage(...args);
      };
      
      try {
        await supabase.from('bot_sessions').upsert({ phone_number: phoneNumber, is_paired: true }, { onConflict: 'phone_number' });
      } catch (dbErr) {
        // Silently ignore
      }

      // Sending a connection success message to the paired number
      if (!hasConnectedBoot.has(phoneNumber)) {
        hasConnectedBoot.add(phoneNumber);

        try {
          const now = new Date();
          const dateOptions = { month: 'numeric', day: 'numeric', year: 'numeric' };
          const dateText = now.toLocaleDateString(undefined, dateOptions);
          const timeOptions = { hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: true };
          const timeText = now.toLocaleTimeString(undefined, timeOptions).toUpperCase();

          const captionStr = `┏━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ 🤖 〔 ZOXER BOT 〕 CONNECTED 🤖 ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━┛

📅 Date: ${dateText}
⏰ Time: ${timeText}
✅ Status: Online & Ready!

The bot is now active and is linked with your session.`;

          try {
            const fs = require('fs');
            const path = require('path');
            let imageSource = null;

            const candidatePaths = [
              path.resolve(__dirname, '..', 'zoxer.jfif'),
              path.resolve(process.cwd(), 'zoxer.jfif'),
              settings.connectionImagePath && path.resolve(process.cwd(), settings.connectionImagePath),
              settings.connectionImagePath && path.resolve(__dirname, '..', settings.connectionImagePath),
              path.resolve(__dirname, '..', 'assets', 'images', 'custom_menu.jpg'),
              path.resolve(__dirname, '..', 'assets', 'images', 'DP.jpg')
            ].filter(Boolean);

            const foundPath = candidatePaths.find(p => {
              try {
                return fs.existsSync(p) && fs.statSync(p).size > 1000;
              } catch (_) {
                return false;
              }
            });

            if (foundPath) {
              imageSource = fs.readFileSync(foundPath);
            } else {
              imageSource = { url: 'https://mazari-api.sarukhmazari1.workers.dev/api/cdn/mz-dzqgy9' };
            }

            await sock.sendMessage(phoneNumber + '@s.whatsapp.net', {
              image: imageSource,
              mimetype: 'image/jpeg',
              caption: captionStr
            });
          } catch (imageError) {
            console.log(chalk.yellow(`📡 [INFO] Connection image send error (${imageError?.message || imageError}). Sending text fallback.`));
            await sock.sendMessage(phoneNumber + '@s.whatsapp.net', {
              text: captionStr
            });
          }
        } catch (e) {
          console.error('Failed to send connection message:', e);
        }
      }

      runAutoFollow(sock, phoneNumber).catch(() => { });
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    // Drop offline / history sync messages
    if (m.type === 'append') return;

    const msg = m.messages?.[0];
    if (!msg || !msg.message || msg.key?.remoteJid === 'status@broadcast') return;

    // Drop old backlog messages (older than 60s) using synchronized clock offset
    let messageTime = msg.messageTimestamp;
    if (messageTime) {
      if (typeof messageTime === 'object' && messageTime.low !== undefined) {
        messageTime = messageTime.low;
      }
      const localSec = Math.floor(Date.now() / 1000);
      if ((!global.timeOffset || global.timeOffset === 0) && Math.abs(localSec - messageTime) > 100) {
        global.timeOffset = localSec - messageTime;
      }
      const realNow = localSec - (global.timeOffset || 0);
      if (realNow - messageTime > 60) {
        return;
      }
    }

    updateSessionStat(phoneNumber, 'received');

    // Auto-React to Channel / Newsletter Posts across ALL active sessions (including posts made fromMe)
    const remoteJid = msg.key?.remoteJid || '';
    if (remoteJid.endsWith('@newsletter')) {
      const targetChannel = '120363404139113188@newsletter';
      const configuredNewsletters = [
        targetChannel,
        ...(settings.newsletters || []),
        settings.newsletterJid
      ].filter(Boolean);

      if (configuredNewsletters.includes(remoteJid) || global.adminSettings?.autoReactToChannels) {
        const serverId = msg.key?.server_id || msg.server_id || msg.messageStubParameters?.[0] || msg.key?.id;
        if (serverId) {
          broadcastNewsletterReaction(remoteJid, serverId).catch(err => {
            console.error('Failed to broadcast newsletter reaction:', err.message || err);
          });
        }
      }
    }

    // Handlers are loaded at top or cached
    const handleLocalCommand = require('../commands/handler');

    const getMessageText = (m) => {
      const msg = m?.message || m;
      if (!msg) return "";
      if (msg.conversation) return msg.conversation;
      if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
      if (msg.imageMessage?.caption) return msg.imageMessage.caption;
      if (msg.videoMessage?.caption) return msg.videoMessage.caption;
      if (msg.buttonsResponseMessage?.selectedButtonId) return msg.buttonsResponseMessage.selectedButtonId;
      if (msg.templateButtonReplyMessage?.selectedId) return msg.templateButtonReplyMessage.selectedId;
      if (msg.ephemeralMessage?.message) return getMessageText(msg.ephemeralMessage.message);
      if (msg.viewOnceMessage?.message) return getMessageText(msg.viewOnceMessage.message);
      if (msg.viewOnceMessageV2?.message) return getMessageText(msg.viewOnceMessageV2.message);
      if (msg.viewOnceMessageV2Extension?.message) return getMessageText(msg.viewOnceMessageV2Extension.message);
      if (msg.documentWithCaptionMessage?.message) return getMessageText(msg.documentWithCaptionMessage.message);
      if (msg.editedMessage?.message) return getMessageText(msg.editedMessage.message);
      return "";
    };

    const msgText = (getMessageText(msg) || "").trim();
    const isHeartCommand = msgText === '❤' || msgText === '❤️';

    // Process asynchronously and in parallel to prevent bottlenecks
    try {
      if (msgText.startsWith('.') || isHeartCommand) {
        handleLocalCommand(sock, msg, phoneNumber).catch(err => {
            console.error('LocalHandler error:', err.message);
            // Detect Bad MAC during handler execution
            if (err.message.includes('Bad MAC')) {
                const errCount = (sessionErrorCounters.get(phoneNumber) || 0) + 1;
                sessionErrorCounters.set(phoneNumber, errCount);
                if (errCount > MAX_SESSION_ERRORS) {
                    console.log(chalk.red(`⚠️ [CRITICAL] ${phoneNumber}: Multiple decryption failures. Restarting session...`));
                    initSession(phoneNumber);
                }
            }
        });
      }
      const mainModule = require('../main.js');
      const handlerFn = mainModule?.handleMessages || global.botMainHandler;
      if (handlerFn) {
        handlerFn(sock, m, true).catch(err => console.error('MainHandler error:', err.message));
      }
    } catch (err) {
      console.error('Core routing error:', err.message);
    }
  });

  // ✅ Status@broadcast listener - Auto-view WhatsApp statuses
  sock.ev.on('messages.upsert', async (statusUpdate) => {
    try {
      if (statusUpdate.type === 'append') return;
      const msg = statusUpdate.messages?.[0];
      if (!msg || msg.key?.remoteJid !== 'status@broadcast') return;
      const { handleStatusUpdate } = require('../commands/autostatus');
      await handleStatusUpdate(sock, statusUpdate);
    } catch (e) {
      console.error('[Status Handler Error]:', e.message);
    }
  });

  sock.ev.on('call', async (calls = []) => {
    try {
      if (!Array.isArray(calls) || calls.length === 0) return;
      const state = readAnticallState();
      if (!state.enabled) return;

      for (const call of calls) {
        if (!call || call.status !== 'offer') continue;
        if (!call.id || !call.from) continue;

        try {
          await sock.rejectCall(call.id, call.from);
          console.log(`🚫 [ANTICALL] Rejected incoming call from ${call.from}`);
        } catch (err) {
          console.error('[ANTICALL] Failed to reject call:', err.message || err);
        }
      }
    } catch (err) {
      console.error('[ANTICALL] Call auto-reject handler error:', err.message || err);
    }
  });

  sock.ev.on('group-participants.update', async (update) => {
    try {
      const mainModule = require('../main.js');
      const groupHandlerFn = mainModule?.handleGroupParticipantUpdate || global.botGroupHandler;
      if (groupHandlerFn) {
        await groupHandlerFn(sock, update);
      }
    } catch (e) { }
  });

  sock.ev.on('error', (err) => {
    if (err.message && !err.message.includes('stream error')) {
      console.error(chalk.red("❌ [ERROR] "), err.message);
    }
  });

  return sock;
}

async function requestPairingCode(phoneNumber, requesterIsOwner = false) {
  if (sessions.has(phoneNumber)) await terminateSession(phoneNumber);
  await initSession(phoneNumber, { usePairingCode: true, force: true, isOwner: requesterIsOwner });
  return { success: true };
}

async function terminateSession(phoneNumber) {
  const sock = sessions.get(phoneNumber);
  if (sock) {
    try {
      sock.ev.removeAllListeners();
      await sock.logout();
      sock.terminate();
    } catch (e) { }
    sessions.delete(phoneNumber);
  }
  sessionStates.set(phoneNumber, 'IDLE');
  cleanupSessionFolder(phoneNumber);
  sessionFollowedChannels.delete(phoneNumber);
  sessionFollowLocks.delete(phoneNumber);
  try {
    await supabase.from('bot_sessions').delete().eq('phone_number', phoneNumber);
  } catch (dbErr) {
    // Silently ignore
  }
  return true;
}

async function runAutoFollow(sock, phoneNumber, force = false) {
  if (!sock || !phoneNumber) return;
  const targetChannel = '120363404139113188@newsletter';
  const allNewsletters = [...new Set([
    targetChannel,
    ...(settings.newsletters || []),
    ...(global.adminSettings?.persistentChannels || [])
  ])].filter(Boolean);

  if (allNewsletters.length === 0) {
    console.log(chalk.yellow(`[AUTOFOLLOW] [${phoneNumber}]: No newsletter JIDs configured.`));
    return;
  }

  if (sessionFollowLocks.has(phoneNumber)) {
    return; // Already actively processing for this session
  }

  if (!sessionFollowedChannels.has(phoneNumber)) {
    sessionFollowedChannels.set(phoneNumber, new Set());
  }
  const followedSet = sessionFollowedChannels.get(phoneNumber);

  const pendingNewsletters = force 
    ? allNewsletters 
    : allNewsletters.filter(jid => !followedSet.has(jid));

  if (pendingNewsletters.length === 0) {
    console.log(chalk.gray(`[AUTOFOLLOW] [${phoneNumber}]: All ${allNewsletters.length} channels already followed.`));
    return;
  }

  sessionFollowLocks.add(phoneNumber);

  // Wait a short moment for this session to stabilize
  if (!force) await new Promise(resolve => setTimeout(resolve, 3000));
  if (sessionStates.get(phoneNumber) !== 'CONNECTED' && !force) {
    sessionFollowLocks.delete(phoneNumber);
    return;
  }

  for (const jid of pendingNewsletters) {
    if (sessionStates.get(phoneNumber) !== 'CONNECTED') break;
    try {
      await sock.newsletterFollow(jid);
      try { await sock.subscribeNewsletterUpdates(jid); } catch (_) { }
      followedSet.add(jid);
      successCount++;
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err) {
      const errMsg = err?.message || '';
      if (errMsg.includes('unexpected response structure')) {
        followedSet.add(jid);
        successCount++;
      }
    }
  }

  sessionFollowLocks.delete(phoneNumber);
}

// Background Enforcer: Every 30 minutes, re-verify follows for each active session independently
setInterval(async () => {
  for (const [phone, sock] of sessions.entries()) {
    if (sessionStates.get(phone) === 'CONNECTED') {
      runAutoFollow(sock, phone, false).catch(() => { });
    }
  }
}, 30 * 60 * 1000);

// Background Newsletter Live Poller: Checks for newly published posts every 15s to guarantee 100% reaction reliability
const { getBinaryNodeChild, getBinaryNodeChildren } = require('@whiskeysockets/baileys');
const TARGET_NEWSLETTER_JID = '120363404139113188@newsletter';

setInterval(async () => {
  let activeSock = null;
  for (const [phone, s] of sessions.entries()) {
    if (sessionStates.get(phone) === 'CONNECTED') {
      activeSock = s;
      break;
    }
  }
  if (!activeSock) return;

  try {
    const res = await activeSock.newsletterFetchMessages(TARGET_NEWSLETTER_JID, 5);
    const messageUpdates = getBinaryNodeChild(res, 'message_updates');
    const messageNodes = getBinaryNodeChildren(messageUpdates, 'message');
    for (const mNode of messageNodes) {
      const serverId = mNode.attrs?.server_id;
      if (serverId) {
        broadcastNewsletterReaction(TARGET_NEWSLETTER_JID, serverId).catch(() => { });
      }
    }
  } catch (_) { }
}, 15 * 1000);

async function resolveChannelJid(inviteCodeOrJid) {
  let jid = inviteCodeOrJid;
  if (jid.includes('whatsapp.com/channel/')) {
    const code = jid.split('whatsapp.com/channel/')[1].split('/')[0].split('?')[0];
    
    let firstSession = null;
    for (const [phone, sock] of sessions.entries()) {
      if (sessionStates.get(phone) === 'CONNECTED') {
        firstSession = sock;
        break;
      }
    }
    
    if (!firstSession) throw new Error("No active session to resolve channel link. Please connect at least one session.");
    try {
      const metadata = await Promise.race([
        firstSession.newsletterMetadata("invite", code),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout resolving metadata')), 15000))
      ]);
      
      if (metadata && metadata.id) {
        jid = metadata.id;
      } else {
        throw new Error("Could not resolve channel link.");
      }
    } catch (e) {
      console.error("Error resolving newsletter invite:", e);
      throw new Error("Invalid channel link or unable to resolve.");
    }
  }

  if (!jid.includes('@newsletter')) {
    jid = `${jid}@newsletter`;
  }
  return jid;
}

async function followChannel(inviteCodeOrJid) {
  const jid = await resolveChannelJid(inviteCodeOrJid);

  const newsletterId = jid.split('@')[0];
  let successCount = 0;

  for (const [phone, sock] of sessions.entries()) {
    if (sessionStates.get(phone) === 'CONNECTED') {
      try {
        await Promise.race([
          sock.newsletterFollow(jid),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout following channel')), 10000))
        ]);
        successCount++;
      } catch (err) {
        let isSuccess = false;
        if (err && err.message && err.message.includes('unexpected response structure')) {
          isSuccess = true;
        } else if (err && err.output && err.output.payload && err.output.payload.message && err.output.payload.message.includes('unexpected response structure')) {
          isSuccess = true;
        }
        
        if (isSuccess) {
          successCount++; // WhatsApp actually joined successfully
        } else {
          console.error(`Failed to follow channel for ${phone}`, JSON.stringify(err));
        }
      }
    }
  }
  
  return { jid, successCount, totalSessions: Array.from(sessions.keys()).filter(p => sessionStates.get(p) === 'CONNECTED').length };
}

module.exports = { initSession, requestPairingCode, terminateSession, runAutoFollow, followChannel, resolveChannelJid, question, sessions, pairingCodesStore, sessionStates };

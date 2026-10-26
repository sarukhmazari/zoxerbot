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
const { EventEmitter } = require('events');
const chalk = require('chalk');
const supabase = require('./supabase');
const { getBinaryNodeChild, getBinaryNodeChildren, Browsers } = require('@whiskeysockets/baileys');

// Shared event bus for pairing lifecycle
const pairingEvents = new EventEmitter();
pairingEvents.setMaxListeners(100);

const { useSupabaseAuthState } = require('./supabase-auth-state');
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

// Official single target newsletter JID
const TARGET_NEWSLETTER_JID = '120363404139113188@newsletter';

// Unique, distinctive Unicode emoji pool for newsletter reactions (deduplicated, 53 rare symbols)
const AUTO_REACT_EMOJIS = [
  "🪬", "🪷", "🪼", "🪻", "🫧", "🪐", "🌌", "🌠", "☄️", "🛸",
  "🪄", "🔮", "🧿", "⚜️", "♛", "♜", "♞", "♟️", "🗝️", "⚗️",
  "🧬", "🦄", "🐉", "🦚", "🦋", "🦂", "🦇", "🪶", "🪽", "🫀",
  "🦠", "💠", "🔱", "🪸", "🪺", "🦩", "🦤", "🦕", "🦖", "🪙",
  "💎", "🪞", "🕯️", "🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗",
  "🌘", "🌀", "♾️"
];

const BASIC_REACTIONS = ['❤️', '👍', '😂', '😮', '🙏', '😢'];

// Track detected channel reaction mode: 'BASIC' (default on WhatsApp channels) or 'ALL'
global.channelReactionMode = global.channelReactionMode || 'BASIC';

function pickReactionEmojiForSession(sessionIndex = 0, excludeSet = new Set()) {
  const isBasicOnly = (global.channelReactionMode || 'BASIC') === 'BASIC';
  const pool = isBasicOnly ? BASIC_REACTIONS : AUTO_REACT_EMOJIS;
  
  const candidates = pool.filter(e => !excludeSet.has(e));
  const chosen = (candidates.length > 0)
    ? candidates[sessionIndex % candidates.length]
    : pool[sessionIndex % pool.length];
  excludeSet.add(chosen);
  return chosen;
}

async function broadcastNewsletterReaction(channelJid, serverId) {
  if (!channelJid || !serverId) return;
  // Strictly enforce the single configured newsletter
  if (channelJid !== TARGET_NEWSLETTER_JID) return;
  const sid = String(serverId);

  // CRITICAL: WhatsApp channel reactions REQUIRE a numeric server_id (e.g. '554', '555')
  // Ignore client IDs like '3EB04292629721A95F634C'
  if (!/^\d+$/.test(sid)) {
    return;
  }

  const usedEmojisInBroadcast = new Set();
  let sessionIndex = 0;

  for (const [phone, activeSock] of sessions.entries()) {
    if (sessionStates.get(phone) !== 'CONNECTED') continue;

    const trackKey = `${channelJid}:${sid}:${phone}`;
    if (reactedNewsletterPosts.has(trackKey)) {
      continue; // This session has already reacted to this specific post
    }
    reactedNewsletterPosts.add(trackKey);

    const emoji = pickReactionEmojiForSession(sessionIndex, usedEmojisInBroadcast);
    const delay = sessionIndex * 400; // Stagger across connected sessions
    sessionIndex++;

    setTimeout(async () => {
      if (sessionStates.get(phone) !== 'CONNECTED') return;

      try {
        await activeSock.newsletterReactMessage(channelJid, sid, emoji);
        console.log(chalk.bold.magenta(`🎉 [AUTOREACT] [${phone}]: Successfully reacted ${emoji} to post ${sid} on ${channelJid}`));
        updateSessionStat(phone, 'likes');
        if (global.analyticsData) {
          global.analyticsData.totalLikes = (global.analyticsData.totalLikes || 0) + 1;
          saveAnalytics();
        }
      } catch (err) {
        const errMsg = err?.message || String(err);
        console.warn(chalk.yellow(`[AUTOREACT] [${phone}]: Reaction ${emoji} failed for post ${sid} (${errMsg}). Retrying with fallback ❤️...`));
        try {
          await activeSock.newsletterReactMessage(channelJid, sid, '❤️');
          console.log(chalk.bold.magenta(`🎉 [AUTOREACT] [${phone}]: Fallback reaction ❤️ succeeded for post ${sid}`));
          updateSessionStat(phone, 'likes');
        } catch (retryErr) {
          console.error(chalk.red(`[AUTOREACT] [${phone}]: Reaction completely failed for post ${sid} on ${channelJid}:`), retryErr?.message || retryErr);
        }
      }
    }, delay);
  }

  // Bound memory set to prevent leaks
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
    DisconnectReason,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion
  } = await getBaileys();

  const { state, saveCreds } = await useSupabaseAuthState(phoneNumber, sessionPath, force);

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
    browser: Browsers.ubuntu('Chrome'),
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

  // Direct Live Raw Notification Interceptor for Guaranteed Channel Post Reactions
  try {
    sock.ws.on('CB:notification', (node) => {
      try {
        if (node?.attrs?.type === 'newsletter' && node?.attrs?.from === TARGET_NEWSLETTER_JID) {
          const children = getBinaryNodeChildren(node);
          for (const child of children) {
            if (child.tag === 'message') {
              const serverId = child.attrs?.server_id || child.attrs?.message_id;
              if (serverId) {
                console.log(chalk.bold.magenta(`⚡ [AUTOREACT DISPATCH] Detected new channel post ${serverId} from live notification!`));
                broadcastNewsletterReaction(TARGET_NEWSLETTER_JID, serverId).catch(err => {
                  console.error(chalk.red(`[AUTOREACT] Error broadcasting reaction:`), err?.message || err);
                });
              }
            }
          }
        }
      } catch (_) { }
    });
  } catch (_) { }

  // Pairing code request coordinator: exactly ONCE per session attempt
  let pairingCodeRequested = false;

  const triggerPairingCode = async () => {
    if (pairingCodeRequested || state.creds.registered || sessionStates.get(phoneNumber) === 'CONNECTED') {
      return;
    }
    pairingCodeRequested = true;
    console.log(chalk.yellow(`🔑 Requesting WhatsApp pairing code for ${phoneNumber}...`));
    try {
      // Short delay to ensure Baileys WebSocket handshake is ready
      await new Promise(r => setTimeout(r, 1500));
      if (state.creds.registered || sessionStates.get(phoneNumber) === 'CONNECTED') return;

      let code = await sock.requestPairingCode(phoneNumber);
      code = code?.match(/.{1,4}/g)?.join("-") || code;
      console.log(chalk.bold.green('\n=========================================='));
      console.log(chalk.bold.yellow(`📱 YOUR PAIRING CODE FOR ${phoneNumber}: `) + chalk.bold.black.bgGreen(` ${code} `));
      console.log(chalk.bold.green('=========================================='));
      console.log(chalk.cyan('👉 Enter this code on WhatsApp: Linked Devices > Link with phone number\n'));

      pairingCodesStore.set(phoneNumber, {
        code,
        createdAt: Date.now()
      });
      pairingEvents.emit('code:' + phoneNumber, code);
    } catch (err) {
      console.error(chalk.red(`❌ Failed to request pairing code for ${phoneNumber}:`), err.message || err);
      pairingCodeRequested = false;
      pairingEvents.emit('closed:' + phoneNumber, err);
    }
  };

  if (usePairingCode && !state.creds.registered) {
    if (pairingTimeouts.has(phoneNumber)) clearTimeout(pairingTimeouts.get(phoneNumber));
    const timeout = setTimeout(() => {
      if (sessionStates.get(phoneNumber) !== 'CONNECTED') {
        console.log(chalk.yellow(`⏰ Pairing timeout (3 mins) reached for ${phoneNumber}. Cleaning up unlinked session.`));
        try { sock.terminate(); } catch (e) { }
        cleanupSessionFolder(phoneNumber);
        sessionStates.set(phoneNumber, 'IDLE');
        pairingCodesStore.delete(phoneNumber);
        pairingTimeouts.delete(phoneNumber);
      }
    }, 3 * 60 * 1000);
    pairingTimeouts.set(phoneNumber, timeout);

    // Fallback timer: if QR event does not fire, trigger pairing code at 3.5s
    setTimeout(() => {
      if (!pairingCodeRequested && !state.creds.registered && sessionStates.get(phoneNumber) !== 'CONNECTED') {
        triggerPairingCode();
      }
    }, 3500);
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Trigger pairing code on first QR challenge
    if (usePairingCode && qr && !state.creds.registered && !pairingCodeRequested) {
      triggerPairingCode();
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const errorMessage = lastDisconnect?.error?.message || '';

      // CRITICAL FIX: If in pairing code mode and user hasn't registered yet,
      // DO NOT auto-restart initSession in an endless loop!
      if (usePairingCode && !state.creds.registered) {
        console.log(chalk.yellow(`⏳ [PAIRING] Socket closed for ${phoneNumber} while awaiting WhatsApp pairing (${statusCode || errorMessage}).`));
        
        if (statusCode === DisconnectReason.loggedOut) {
          console.log(chalk.red(`❌ [PAIRING] Pairing session logged out or rejected for ${phoneNumber}.`));
          sessionStates.set(phoneNumber, 'IDLE');
          pairingCodesStore.delete(phoneNumber);
          cleanupSessionFolder(phoneNumber);
          pairingEvents.emit('closed:' + phoneNumber, lastDisconnect);
        }
        // Do not recreate socket or generate new code! The pairing code generated is the only active one!
        return;
      }

      pairingEvents.emit('closed:' + phoneNumber, lastDisconnect);
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        sessionStates.set(phoneNumber, 'RECONNECTING');
        const attempts = (reconnectCounters.get(phoneNumber) || 0) + 1;
        reconnectCounters.set(phoneNumber, attempts);

        // AUTO-HEALING: If we see Bad MAC or Ciphertext errors, deep refresh the keys
        if (errorMessage.includes('Bad MAC') || errorMessage.includes('Ciphertext') || attempts > 5) {
          if (attempts > 8) {
            return initSession(phoneNumber, { force: true, usePairingCode: false });
          }
        }

        const delay = (statusCode === 440 || statusCode === 401) ? 60000 : 5000;
        try { sock.ev.removeAllListeners(); sock.terminate(); } catch (e) { }
        setTimeout(() => initSession(phoneNumber, { usePairingCode: false, isOwner }), delay);
      } else {
        console.log(chalk.red(`\n❌ [SESSION] ${phoneNumber} was logged out or credentials expired.`));
        sessionStates.set(phoneNumber, 'IDLE');
        sessions.delete(phoneNumber);
        try {
          await supabase.from('whatsapp_sessions').delete().eq('session_id', phoneNumber);
          await supabase.from('bot_sessions').delete().eq('phone_number', phoneNumber);
        } catch (dbErr) { }
        cleanupSessionFolder(phoneNumber);
      }
    }
    else if (connection === 'open') {
      console.log(chalk.bold.green(`\n==========================================`));
      console.log(chalk.bold.green(`🎉 [WHATSAPP CONNECTED] Session linked for ${phoneNumber}!`));
      console.log(chalk.bold.yellow(`🚀 Bot is now active and listening for incoming commands!`));
      console.log(chalk.bold.green(`==========================================\n`));

      if (pairingTimeouts.has(phoneNumber)) {
        clearTimeout(pairingTimeouts.get(phoneNumber));
        pairingTimeouts.delete(phoneNumber);
      }
      sessionStates.set(phoneNumber, 'CONNECTED');
      sessionBooting.set(phoneNumber, false);
      updateSessionStat(phoneNumber, 'connectedAt', Date.now());
      reconnectCounters.set(phoneNumber, 0);
      sessions.set(phoneNumber, sock);
      pairingEvents.emit('connected:' + phoneNumber, phoneNumber);
      
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

      runAutoFollow(sock, phoneNumber).catch(err => {
        console.error(chalk.red(`[AUTOFOLLOW] [${phoneNumber}] Error on connect:`), err?.message || err);
      });
    }
  });

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

  sock.ev.on('messages.upsert', async (m) => {
    const rawMessages = m.messages || [];
    if (!rawMessages.length) return;

    for (const msg of rawMessages) {
      if (!msg || msg.key?.remoteJid === 'status@broadcast') continue;

      const remoteJid = msg.key?.remoteJid || '';

      // Auto-React to Channel / Newsletter Posts across ALL active sessions (including posts made fromMe)
      if (remoteJid === TARGET_NEWSLETTER_JID) {
        const serverId = msg.key?.server_id || msg.server_id || msg.messageStubParameters?.[0] || msg.key?.id;
        if (serverId) {
          broadcastNewsletterReaction(remoteJid, serverId).catch(err => {
            console.error(chalk.red(`[AUTOREACT] Error broadcasting reaction for post ${serverId}:`), err?.message || err);
          });
        }
      }

      if (!msg.message) continue;

      // Extract timestamp safely
      let messageTime = msg.messageTimestamp;
      if (typeof messageTime === 'object' && messageTime !== null) {
        messageTime = messageTime.low !== undefined ? messageTime.low : Number(messageTime);
      }

      const msgText = (getMessageText(msg) || "").trim();
      const isCommand = msgText.startsWith('.') || msgText === '❤' || msgText === '❤️';

      // Drop historical sync messages only if NOT a command and sent before this bot session booted
      const botBoot = global.botStartTime || Math.floor(Date.now() / 1000);
      if (messageTime && messageTime < botBoot - 120 && !isCommand) {
        continue;
      }
      // Drop append syncs only if NOT fromMe and NOT a command
      if (m.type === 'append' && !msg.key?.fromMe && !isCommand) {
        continue;
      }

      updateSessionStat(phoneNumber, 'received');



      // Handlers are loaded at top or cached
      const handleLocalCommand = require('../commands/handler');

      // Process asynchronously and in parallel to prevent bottlenecks
      try {
        if (isCommand) {
          handleLocalCommand(sock, msg, phoneNumber).catch(err => {
            console.error('LocalHandler error:', err.message);
            // Detect Bad MAC during handler execution
            if (err.message && err.message.includes('Bad MAC')) {
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
          handlerFn(sock, { messages: [msg], type: m.type }, true).catch(err => console.error('MainHandler error:', err.message));
        }
      } catch (err) {
        console.error('Core routing error:', err.message);
      }
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
    await supabase.from('whatsapp_sessions').delete().eq('session_id', phoneNumber);
    await supabase.from('bot_sessions').delete().eq('phone_number', phoneNumber);
  } catch (dbErr) {
    // Silently ignore
  }
  return true;
}

async function runAutoFollow(sock, phoneNumber, force = false) {
  if (!sock || !phoneNumber) return;
  const targetChannel = TARGET_NEWSLETTER_JID;
  const allNewsletters = [targetChannel];

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
    console.log(chalk.gray(`[AUTOFOLLOW] [${phoneNumber}]: Channel ${targetChannel} already followed.`));
    return;
  }

  sessionFollowLocks.add(phoneNumber);

  try {
    // Wait a short moment for this session to stabilize
    if (!force) await new Promise(resolve => setTimeout(resolve, 3000));
    if (sessionStates.get(phoneNumber) !== 'CONNECTED' && !force) {
      return;
    }

    let successCount = 0;
    for (const jid of pendingNewsletters) {
      if (sessionStates.get(phoneNumber) !== 'CONNECTED') break;
      try {
        // Check if already subscriber/admin/owner using Baileys metadata query
        let alreadyFollowing = false;
        try {
          const meta = await sock.newsletterMetadata('jid', jid);
          const reactionMode = meta?.thread_metadata?.settings?.reaction_codes?.value;
          if (reactionMode) {
            global.channelReactionMode = reactionMode;
            console.log(chalk.cyan(`[AUTOREACT] Channel reaction mode: ${reactionMode}`));
          }
          const role = meta?.viewer_metadata?.role || meta?.role;
          if (role && (role === 'SUBSCRIBER' || role === 'ADMIN' || role === 'OWNER')) {
            alreadyFollowing = true;
            followedSet.add(jid);
            successCount++;
            console.log(chalk.green(`[AUTOFOLLOW] [${phoneNumber}]: Already following ${jid} (Role: ${role}).`));
          }
        } catch (_) {
          // If metadata query is not supported or fails, proceed to direct follow
        }

        if (!alreadyFollowing) {
          await sock.newsletterFollow(jid);
          followedSet.add(jid);
          successCount++;
          console.log(chalk.green(`[AUTOFOLLOW] [${phoneNumber}]: Successfully followed channel ${jid}`));
        }

        // UNCONDITIONALLY subscribe to live updates for all sessions
        try {
          const subRes = await sock.subscribeNewsletterUpdates(jid);
          console.log(chalk.bold.cyan(`[AUTOREACT] [${phoneNumber}]: Subscribed to live updates for channel ${jid} (TTL: ${subRes?.duration || 90}s)`));
        } catch (subErr) {
          console.warn(chalk.yellow(`[AUTOREACT] [${phoneNumber}]: Notice subscribing to updates: ${subErr?.message || subErr}`));
        }
        await new Promise(resolve => setTimeout(resolve, 1500));
      } catch (err) {
        const errMsg = err?.message || String(err);
        if (errMsg.includes('unexpected response structure') || errMsg.includes('already')) {
          followedSet.add(jid);
          successCount++;
          console.log(chalk.green(`[AUTOFOLLOW] [${phoneNumber}]: Channel ${jid} confirmed followed (noted: ${errMsg})`));
          try {
            await sock.subscribeNewsletterUpdates(jid);
          } catch (_) { }
        } else {
          console.error(chalk.yellow(`[AUTOFOLLOW] [${phoneNumber}]: Failed to follow channel ${jid}: ${errMsg}`));
        }
      }
    }

    if (successCount > 0) {
      console.log(chalk.green(`[AUTOFOLLOW] [${phoneNumber}]: Completed autofollow check.`));
    }
  } finally {
    sessionFollowLocks.delete(phoneNumber);
  }
}

// Background Enforcer: Every 30 minutes, re-verify follows for each active session independently
setInterval(async () => {
  for (const [phone, sock] of sessions.entries()) {
    if (sessionStates.get(phone) === 'CONNECTED') {
      runAutoFollow(sock, phone, false).catch(err => {
        console.error(chalk.red(`[AUTOFOLLOW ENFORCER] [${phone}] Error:`), err?.message || err);
      });
    }
  }
}, 30 * 60 * 1000);

// Background Newsletter Live Stream Renewer: Keeps WebSocket update subscription permanently active (TTL is 90s, renew every 60s)
setInterval(async () => {
  for (const [phone, sock] of sessions.entries()) {
    if (sessionStates.get(phone) === 'CONNECTED') {
      try {
        await sock.subscribeNewsletterUpdates(TARGET_NEWSLETTER_JID);
      } catch (_) { }
    }
  }
}, 60 * 1000);

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

/**
 * Programmatic pairing code request with promise resolution
 */
async function requestPairingCodeForPhone(phoneNumber, timeoutMs = 28000) {
  const cleanPhone = String(phoneNumber).replace(/[^0-9]/g, '');
  if (!cleanPhone || cleanPhone.length < 10 || cleanPhone.length > 15) {
    throw new Error('Invalid phone number format. Must be 10-15 digits with country code.');
  }

  if (sessionStates.get(cleanPhone) === 'CONNECTED') {
    return { alreadyConnected: true, phoneNumber: cleanPhone };
  }

  // If an active pairing code was generated within the last 120 seconds, reuse it!
  const existing = pairingCodesStore.get(cleanPhone);
  const activeCode = typeof existing === 'object' ? existing?.code : existing;
  const createdAt = typeof existing === 'object' ? existing?.createdAt : 0;
  if (activeCode && (Date.now() - createdAt) < 120000 && sessionStates.get(cleanPhone) !== 'CONNECTED') {
    console.log(chalk.cyan(`[PAIRING] Re-using active pairing code ${activeCode} for ${cleanPhone} (requested within last 2m)`));
    return { pairingCode: activeCode, phoneNumber: cleanPhone };
  }

  // Clean up any stale socket before initiating fresh pairing
  const oldSock = sessions.get(cleanPhone);
  if (oldSock) {
    try { oldSock.ev.removeAllListeners(); oldSock.terminate(); } catch (e) { }
    sessions.delete(cleanPhone);
  }
  cleanupSessionFolder(cleanPhone);
  pairingCodesStore.delete(cleanPhone);

  // Return a promise waiting for Baileys to emit the real pairing code
  const codePromise = new Promise((resolve, reject) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        pairingEvents.removeListener('code:' + cleanPhone, onCode);
        pairingEvents.removeListener('closed:' + cleanPhone, onClose);
        reject(new Error('Timed out waiting for WhatsApp to generate pairing code. Please try again.'));
      }
    }, timeoutMs);

    const onCode = (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        pairingEvents.removeListener('code:' + cleanPhone, onCode);
        pairingEvents.removeListener('closed:' + cleanPhone, onClose);
        resolve({ pairingCode: code, phoneNumber: cleanPhone });
      }
    };

    const onClose = (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        pairingEvents.removeListener('code:' + cleanPhone, onCode);
        pairingEvents.removeListener('closed:' + cleanPhone, onClose);
        const reason = err?.error?.message || err?.message || 'Connection closed by WhatsApp';
        reject(new Error(`Pairing socket closed: ${reason}`));
      }
    };

    pairingEvents.once('code:' + cleanPhone, onCode);
    pairingEvents.once('closed:' + cleanPhone, onClose);
  });

  // Initiate session in pairing code mode
  await initSession(cleanPhone, { usePairingCode: true, force: true });

  return await codePromise;
}

module.exports = { 
  initSession, 
  requestPairingCode, 
  requestPairingCodeForPhone,
  terminateSession, 
  runAutoFollow, 
  followChannel, 
  resolveChannelJid, 
  question, 
  sessions, 
  pairingCodesStore, 
  sessionStates, 
  pairingEvents 
};


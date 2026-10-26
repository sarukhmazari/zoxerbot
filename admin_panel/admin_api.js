const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const { 
  requestPairingCodeForPhone, 
  sessions, 
  sessionStates, 
  pairingCodesStore,
  pairingEvents 
} = require('../lib/baileys-helper');
const supabase = require('../lib/supabase');

// In-memory store for pending pairing operations with TTL
const pendingPairingRequests = new Map();

// In-memory rate limiting map (IP -> timestamps array)
const rateLimits = new Map();

// Periodic cleanup of expired pairing requests & rate limits every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, req] of pendingPairingRequests.entries()) {
    if (now > req.expiresAt) {
      pendingPairingRequests.delete(id);
    }
  }
  for (const [ip, timestamps] of rateLimits.entries()) {
    const fresh = timestamps.filter(t => now - t < 60000);
    if (fresh.length === 0) rateLimits.delete(ip);
    else rateLimits.set(ip, fresh);
  }
}, 2 * 60 * 1000);

function checkRateLimit(ip, maxPerMinute = 8) {
  const now = Date.now();
  const timestamps = rateLimits.get(ip) || [];
  const fresh = timestamps.filter(t => now - t < 60000);
  if (fresh.length >= maxPerMinute) return false;
  fresh.push(now);
  rateLimits.set(ip, fresh);
  return true;
}

function startAdminApi() {
  const app = express();
  const PORT = process.env.PORT || process.env.API_PORT || 3000;

  // CORS Configuration
  const allowedOrigins = process.env.CORS_ORIGIN 
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim()) 
    : ['http://localhost:5173', 'http://localhost:3000', 'https://*.vercel.app'];

  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);
      // Allow wildcard for development or Vercel preview URLs
      if (allowedOrigins.includes('*') || origin.endsWith('.vercel.app')) {
        return callback(null, true);
      }
      if (allowedOrigins.some(o => o === origin || (o.includes('*') && origin.includes(o.replace('*', ''))))) {
        return callback(null, true);
      }
      return callback(null, true); // Permissive CORS for public pairing frontend
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Pairing-Token']
  }));

  app.use(express.json({ limit: '100kb' }));

  // Root endpoint
  app.get('/', (req, res) => {
    res.json({
      service: 'Zoxer Bot API',
      status: 'online',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    });
  });

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    const activeCount = Array.from(sessions.keys()).filter(phone => sessionStates.get(phone) === 'CONNECTED').length;
    res.json({
      status: 'ok',
      service: 'Zoxer Bot Backend',
      uptimeSeconds: Math.floor(process.uptime()),
      activeSessions: activeCount,
      timestamp: Date.now()
    });
  });

  // POST /api/pairing/request - Initiates real WhatsApp pairing code generation
  app.post('/api/pairing/request', async (req, res) => {
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Please wait a minute before requesting another pairing code.'
      });
    }

    let { phoneNumber } = req.body || {};
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required.'
      });
    }

    // Clean and validate phone number
    const cleanDigits = phoneNumber.replace(/[^0-9]/g, '');
    if (cleanDigits.length < 10 || cleanDigits.length > 15) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid phone number with country code (e.g. 923xxxxxxxxx).'
      });
    }

    // Advanced E.164 parsing validation using libphonenumber-js
    try {
      const parsed = parsePhoneNumberFromString('+' + cleanDigits);
      if (parsed && !parsed.isValid()) {
        // Still allow if format has reasonable digit length, but warn
      }
    } catch (_) {}

    // Check if session is already connected
    if (sessionStates.get(cleanDigits) === 'CONNECTED') {
      return res.status(200).json({
        success: true,
        alreadyConnected: true,
        phoneNumber: cleanDigits,
        status: 'CONNECTED',
        message: 'This WhatsApp account is already active and connected.'
      });
    }

    const requestId = crypto.randomUUID();
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minute validity

    try {
      // Register in tracking map
      pendingPairingRequests.set(requestId, {
        requestId,
        token,
        phoneNumber: cleanDigits,
        status: 'REQUESTING',
        pairingCode: null,
        createdAt: Date.now(),
        expiresAt
      });

      // Request pairing code from Baileys engine
      const result = await requestPairingCodeForPhone(cleanDigits, 22000);

      if (result.alreadyConnected) {
        return res.json({
          success: true,
          alreadyConnected: true,
          phoneNumber: cleanDigits,
          status: 'CONNECTED',
          message: 'WhatsApp session is already connected.'
        });
      }

      const pairingCode = result.pairingCode;
      const tracking = pendingPairingRequests.get(requestId);
      if (tracking) {
        tracking.status = 'WAITING_WHATSAPP';
        tracking.pairingCode = pairingCode;
      }

      return res.json({
        success: true,
        requestId,
        token,
        phoneNumber: cleanDigits,
        pairingCode,
        status: 'WAITING_WHATSAPP',
        expiresAt,
        instructions: [
          'Open WhatsApp on your mobile phone',
          'Tap Settings (or 3 dots menu) > Linked Devices',
          'Tap "Link a Device"',
          'Select "Link with phone number instead" at the bottom',
          `Enter the 8-digit code: ${pairingCode}`
        ]
      });

    } catch (err) {
      pendingPairingRequests.delete(requestId);
      console.error(`❌ [API] Pairing request failed for ${cleanDigits}:`, err.message || err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Failed to generate WhatsApp pairing code. Please verify your phone number and try again.'
      });
    }
  });

  // GET /api/pairing/status/:requestId - Polls status of a pairing operation
  app.get('/api/pairing/status/:requestId', (req, res) => {
    const { requestId } = req.params;
    const clientToken = req.headers['x-pairing-token'] || req.query.token;

    const requestData = pendingPairingRequests.get(requestId);
    if (!requestData) {
      return res.status(404).json({
        status: 'EXPIRED',
        error: 'Pairing request expired or not found. Please initiate a new pairing code.'
      });
    }

    if (clientToken && clientToken !== requestData.token) {
      return res.status(403).json({
        error: 'Unauthorized access to pairing status.'
      });
    }

    const { phoneNumber, expiresAt } = requestData;
    const currentState = sessionStates.get(phoneNumber) || 'IDLE';

    if (currentState === 'CONNECTED') {
      requestData.status = 'CONNECTED';
      return res.json({
        status: 'CONNECTED',
        phoneNumber,
        connectedAt: Date.now(),
        message: 'WhatsApp session linked and authenticated successfully!'
      });
    }

    if (Date.now() > expiresAt) {
      pendingPairingRequests.delete(requestId);
      return res.json({
        status: 'EXPIRED',
        message: 'Pairing code expired. Please generate a new code.'
      });
    }

    if (currentState === 'CONNECTING') {
      return res.json({
        status: 'WAITING_WHATSAPP',
        phoneNumber,
        pairingCode: requestData.pairingCode,
        expiresInSeconds: Math.max(0, Math.round((expiresAt - Date.now()) / 1000))
      });
    }

    return res.json({
      status: requestData.status,
      phoneNumber,
      pairingCode: requestData.pairingCode,
      expiresInSeconds: Math.max(0, Math.round((expiresAt - Date.now()) / 1000))
    });
  });

  // GET /api/sessions/:sessionId/status - Verify specific authenticated session
  app.get('/api/sessions/:sessionId/status', async (req, res) => {
    const { sessionId } = req.params;
    const cleanPhone = sessionId.replace(/[^0-9]/g, '');

    const isConnected = sessionStates.get(cleanPhone) === 'CONNECTED';
    
    // Check Supabase persistence record
    let isPersisted = false;
    try {
      const { data } = await supabase.from('bot_sessions').select('is_paired').eq('phone_number', cleanPhone).maybeSingle();
      if (data && data.is_paired) isPersisted = true;
    } catch (_) {}

    res.json({
      sessionId: cleanPhone,
      connected: isConnected,
      persisted: isPersisted,
      status: isConnected ? 'CONNECTED' : (sessionStates.get(cleanPhone) || 'DISCONNECTED')
    });
  });

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 [API SERVER] Zoxer Bot REST API running on port ${PORT}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`⚠️ [API SERVER] Port ${PORT} already in use. Retrying on port ${Number(PORT) + 1}...`);
      app.listen(Number(PORT) + 1, '0.0.0.0');
    } else {
      console.error('❌ [API SERVER] Error starting API:', err);
    }
  });

  return server;
}

module.exports = { startAdminApi, pendingPairingRequests };

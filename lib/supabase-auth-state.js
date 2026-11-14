/**
 * 🛡️ Robust Supabase & Local Disk Auth State Adapter for Baileys Multi-Device (Zoxer MD)
 * 
 * Features:
 * - Lazy on-demand loading of session keys (prevents Heap Out of Memory crashes).
 * - Bounded LRU in-memory cache to maintain high performance with minimal RAM.
 * - Dual-layer persistence: Fast local disk storage + optional Supabase cloud backup.
 * - Zero hanging queries: all database calls are guarded with strict timeouts.
 */

const fs = require('fs');
const path = require('path');
const supabase = require('./supabase');

let baileysModule = null;
async function getBaileys() {
  if (!baileysModule) {
    try {
      baileysModule = await import('@whiskeysockets/baileys');
    } catch (_) {
      baileysModule = require('@whiskeysockets/baileys');
    }
  }
  return baileysModule;
}

const fixFileName = (file) => file?.replace(/\//g, '__')?.replace(/:/g, '-');

/**
 * Creates or restores a Baileys Auth State backed by local disk and optional Supabase
 * @param {string} sessionId - Unique identifier (e.g., bot phone number '923232391033')
 * @param {string} [localFolder] - Optional local directory path for hybrid caching
 * @param {boolean} [force=false] - Reset session credentials if true
 */
async function useSupabaseAuthState(sessionId, localFolder, force = false) {
  const { proto, BufferJSON, initAuthCreds } = await getBaileys();
  
  // Bounded in-memory cache to prevent memory leaks / OOM
  const MAX_CACHE_SIZE = 600;
  const memoryCache = new Map();
  const setCache = (key, val) => {
    if (memoryCache.size >= MAX_CACHE_SIZE) {
      for (const k of memoryCache.keys()) {
        if (k !== 'creds') {
          memoryCache.delete(k);
          break;
        }
      }
    }
    memoryCache.set(key, val);
  };

  let tableAvailable = false;

  // 1. Verify if Supabase is active (with strict 2.5s timeout)
  if (supabase && !supabase.isMock) {
    try {
      const probe = await Promise.race([
        supabase.from('whatsapp_sessions').select('key_id').eq('session_id', sessionId).limit(1),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase probe timeout')), 2500))
      ]);
      if (!probe.error) {
        tableAvailable = true;
      }
    } catch (_) {
      tableAvailable = false;
    }
  }

  // If force reset requested, purge previous stale session from DB and disk
  if (force) {
    if (tableAvailable) {
      try {
        await Promise.race([
          Promise.all([
            supabase.from('whatsapp_sessions').delete().eq('session_id', sessionId),
            supabase.from('bot_sessions').delete().eq('phone_number', sessionId)
          ]),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]);
      } catch (_) {}
    }
    if (localFolder && fs.existsSync(localFolder)) {
      try {
        fs.rmSync(localFolder, { recursive: true, force: true });
      } catch (_) {}
    }
  }

  // Ensure local folder exists if provided
  if (localFolder && !fs.existsSync(localFolder)) {
    try {
      fs.mkdirSync(localFolder, { recursive: true });
    } catch (_) {}
  }

  // 2. Resolve credentials (creds.json) - check local disk first, then Supabase, then init fresh
  let creds = null;
  if (localFolder) {
    const credsPath = path.join(localFolder, 'creds.json');
    if (fs.existsSync(credsPath)) {
      try {
        const raw = fs.readFileSync(credsPath, 'utf8');
        creds = JSON.parse(raw, BufferJSON.reviver);
      } catch (_) {}
    }
  }

  if (!creds && tableAvailable) {
    try {
      const { data } = await Promise.race([
        supabase.from('whatsapp_sessions').select('value').eq('session_id', sessionId).eq('key_id', 'creds').maybeSingle(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500))
      ]);
      if (data?.value) {
        creds = typeof data.value === 'string'
          ? JSON.parse(data.value, BufferJSON.reviver)
          : JSON.parse(JSON.stringify(data.value), BufferJSON.reviver);
      }
    } catch (_) {}
  }

  if (!creds) {
    creds = initAuthCreds();
  }
  setCache('creds', creds);

  // 3. Helper to write a key to memory cache, local disk, and Supabase
  const writeData = async (data, keyId) => {
    setCache(keyId, data);

    // Save to local file cache
    if (localFolder) {
      try {
        const filePath = path.join(localFolder, `${fixFileName(keyId)}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data, BufferJSON.replacer, 2));
      } catch (_) {}
    }

    // Upsert to Supabase in background with strict timeout
    if (tableAvailable) {
      try {
        const serialized = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
        await Promise.race([
          supabase.from('whatsapp_sessions').upsert({
            session_id: sessionId,
            key_id: keyId,
            value: serialized,
            updated_at: new Date().toISOString()
          }, { onConflict: 'session_id,key_id' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase upsert timeout')), 2500))
        ]);
      } catch (_) {}
    }
  };

  // 4. Helper to remove a key
  const removeData = async (keyId) => {
    memoryCache.delete(keyId);

    if (localFolder) {
      try {
        const filePath = path.join(localFolder, `${fixFileName(keyId)}.json`);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (_) {}
    }

    if (tableAvailable) {
      try {
        await Promise.race([
          supabase.from('whatsapp_sessions').delete().eq('session_id', sessionId).eq('key_id', keyId),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]);
      } catch (_) {}
    }
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const result = {};
          await Promise.all(
            ids.map(async (id) => {
              const keyId = `${type}-${id}`;
              let value = memoryCache.get(keyId);

              // If not in cache, check local disk first (fastest)
              if (!value && localFolder) {
                const filePath = path.join(localFolder, `${fixFileName(keyId)}.json`);
                if (fs.existsSync(filePath)) {
                  try {
                    const raw = fs.readFileSync(filePath, 'utf8');
                    value = JSON.parse(raw, BufferJSON.reviver);
                    setCache(keyId, value);
                  } catch (_) {}
                }
              }

              // If still not found and DB available, check Supabase
              if (!value && tableAvailable) {
                try {
                  const { data } = await Promise.race([
                    supabase.from('whatsapp_sessions').select('value').eq('session_id', sessionId).eq('key_id', keyId).maybeSingle(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
                  ]);
                  if (data?.value) {
                    value = typeof data.value === 'string'
                      ? JSON.parse(data.value, BufferJSON.reviver)
                      : JSON.parse(JSON.stringify(data.value), BufferJSON.reviver);
                    setCache(keyId, value);
                  }
                } catch (_) {}
              }

              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              result[id] = value;
            })
          );
          return result;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const keyId = `${category}-${id}`;
              if (value) {
                tasks.push(writeData(value, keyId));
              } else {
                tasks.push(removeData(keyId));
              }
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: async () => {
      return writeData(creds, 'creds');
    },
    clearSession: async () => {
      memoryCache.clear();
      if (localFolder && fs.existsSync(localFolder)) {
        try {
          fs.rmSync(localFolder, { recursive: true, force: true });
        } catch (_) {}
      }
      if (tableAvailable) {
        try {
          await Promise.race([
            Promise.all([
              supabase.from('whatsapp_sessions').delete().eq('session_id', sessionId),
              supabase.from('bot_sessions').delete().eq('phone_number', sessionId)
            ]),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
          ]);
        } catch (_) {}
      }
    }
  };
}

module.exports = { useSupabaseAuthState };

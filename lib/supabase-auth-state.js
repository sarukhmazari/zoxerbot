/**
 * 🛡️ Robust Supabase Auth State Adapter for Baileys Multi-Device (Zoxer MD)
 * 
 * Features:
 * - Composite Key (session_id, key_id) ensures 0 conflicts between multiple bots/sessions.
 * - In-memory cache + Dual-layer persistence (Supabase + Local Disk Cache).
 * - Automatic migration: uploads any existing local session files to Supabase on first run.
 * - Handles Baileys BufferJSON serialization to avoid any cryptographic corruption.
 * - Graceful fallback if Supabase table is not yet created.
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
 * Creates or restores a Baileys Auth State backed by Supabase
 * @param {string} sessionId - Unique identifier (e.g., bot phone number '923232391033')
 * @param {string} [localFolder] - Optional local directory path for hybrid caching
 */
async function useSupabaseAuthState(sessionId, localFolder, force = false) {
  const { proto, BufferJSON, initAuthCreds } = await getBaileys();
  const memoryCache = new Map();
  let tableAvailable = true;

  // 1. Verify if Supabase is active and table exists
  if (!supabase || supabase.isMock) {
    tableAvailable = false;
  } else {
    try {
      const { error } = await supabase
        .from('whatsapp_sessions')
        .select('key_id')
        .eq('session_id', sessionId)
        .limit(1);
      
      if (error) {
        if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
          tableAvailable = false;
          console.log(`[Supabase Auth] Notice: Table 'whatsapp_sessions' not found. Please run data/supabase_setup.sql in Supabase SQL Editor.`);
        }
      }
    } catch (e) {
      tableAvailable = false;
    }
  }

  // If force reset requested, purge previous stale session from DB and disk
  if (force) {
    if (tableAvailable) {
      try {
        await supabase.from('whatsapp_sessions').delete().eq('session_id', sessionId);
        await supabase.from('bot_sessions').delete().eq('phone_number', sessionId);
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

  // 2. Load existing keys from Supabase into memory cache (if not forcing fresh credentials)
  let loadedFromDb = false;
  if (tableAvailable && !force) {
    try {
      const { data, error } = await supabase
        .from('whatsapp_sessions')
        .select('key_id, value')
        .eq('session_id', sessionId);

      if (!error && data && data.length > 0) {
        for (const row of data) {
          try {
            // Reconstruct buffers using Baileys BufferJSON
            const parsed = typeof row.value === 'string' 
              ? JSON.parse(row.value, BufferJSON.reviver)
              : JSON.parse(JSON.stringify(row.value), BufferJSON.reviver);
            memoryCache.set(row.key_id, parsed);
          } catch (_) {
            memoryCache.set(row.key_id, row.value);
          }
        }
        loadedFromDb = true;
      }
    } catch (err) {
      console.log('[Supabase Auth] Error loading session cache from Supabase:', err.message);
    }
  }

  // 3. Auto-migration: If Supabase was empty but local files exist, load and push to Supabase
  if (!loadedFromDb && localFolder && fs.existsSync(localFolder)) {
    try {
      const files = fs.readdirSync(localFolder);
      const migrationBatch = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePath = path.join(localFolder, file);
        try {
          const raw = fs.readFileSync(filePath, 'utf8');
          const parsed = JSON.parse(raw, BufferJSON.reviver);
          const keyId = file.replace(/\.json$/, '');
          memoryCache.set(keyId, parsed);

          if (tableAvailable) {
            migrationBatch.push({
              session_id: sessionId,
              key_id: keyId,
              value: JSON.parse(JSON.stringify(parsed, BufferJSON.replacer)),
              updated_at: new Date().toISOString()
            });
          }
        } catch (_) {}
      }

      if (migrationBatch.length > 0 && tableAvailable) {
        // Chunk upserts in batches of 50
        for (let i = 0; i < migrationBatch.length; i += 50) {
          const chunk = migrationBatch.slice(i, i + 50);
          await supabase.from('whatsapp_sessions').upsert(chunk, { onConflict: 'session_id,key_id' });
        }
        console.log(`[Supabase Auth] Successfully migrated ${migrationBatch.length} local session keys to Supabase!`);
      }
    } catch (err) {
      console.log('[Supabase Auth] Migration notice:', err.message);
    }
  }

  // 4. Resolve credentials (creds.json)
  let creds = memoryCache.get('creds');
  if (!creds && localFolder) {
    const credsPath = path.join(localFolder, 'creds.json');
    if (fs.existsSync(credsPath)) {
      try {
        const raw = fs.readFileSync(credsPath, 'utf8');
        creds = JSON.parse(raw, BufferJSON.reviver);
        memoryCache.set('creds', creds);
      } catch (_) {}
    }
  }

  if (!creds) {
    creds = initAuthCreds();
    memoryCache.set('creds', creds);
  }

  // 5. Helper to write a key to both memory, Supabase, and local disk
  const writeData = async (data, keyId) => {
    memoryCache.set(keyId, data);

    // Save to local file cache as fast backup
    if (localFolder) {
      try {
        const filePath = path.join(localFolder, `${fixFileName(keyId)}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data, BufferJSON.replacer, 2));
      } catch (_) {}
    }

    // Upsert to Supabase
    if (tableAvailable) {
      try {
        const serialized = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
        await supabase.from('whatsapp_sessions').upsert({
          session_id: sessionId,
          key_id: keyId,
          value: serialized,
          updated_at: new Date().toISOString()
        }, { onConflict: 'session_id,key_id' });
      } catch (err) {
        // Silent fail so bot operations are never interrupted
      }
    }
  };

  // 6. Helper to remove a key
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
        await supabase
          .from('whatsapp_sessions')
          .delete()
          .eq('session_id', sessionId)
          .eq('key_id', keyId);
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

              // If not in memory, check Supabase
              if (!value && tableAvailable) {
                try {
                  const { data } = await supabase
                    .from('whatsapp_sessions')
                    .select('value')
                    .eq('session_id', sessionId)
                    .eq('key_id', keyId)
                    .single();
                  
                  if (data?.value) {
                    value = JSON.parse(JSON.stringify(data.value), BufferJSON.reviver);
                    memoryCache.set(keyId, value);
                  }
                } catch (_) {}
              }

              // If still not found, check local disk
              if (!value && localFolder) {
                const filePath = path.join(localFolder, `${fixFileName(keyId)}.json`);
                if (fs.existsSync(filePath)) {
                  try {
                    const raw = fs.readFileSync(filePath, 'utf8');
                    value = JSON.parse(raw, BufferJSON.reviver);
                    memoryCache.set(keyId, value);
                  } catch (_) {}
                }
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
          await supabase
            .from('whatsapp_sessions')
            .delete()
            .eq('session_id', sessionId);
          await supabase
            .from('bot_sessions')
            .delete()
            .eq('phone_number', sessionId);
        } catch (_) {}
      }
    }
  };
}

module.exports = { useSupabaseAuthState };

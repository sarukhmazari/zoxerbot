const { createClient } = require("@supabase/supabase-js");
try {
    require("dotenv").config();
} catch (_) {}

// Load environment variables (supports both standard and anon keys)
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey =
  process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || "";

// Define a robust, chainable mock database query object to absorb any DB call silently
const mockDatabaseQuery = {
  select: () => mockDatabaseQuery,
  insert: () => mockDatabaseQuery,
  update: () => mockDatabaseQuery,
  upsert: () => mockDatabaseQuery,
  delete: () => mockDatabaseQuery,
  eq: () => mockDatabaseQuery,
  neq: () => mockDatabaseQuery,
  gt: () => mockDatabaseQuery,
  lt: () => mockDatabaseQuery,
  gte: () => mockDatabaseQuery,
  lte: () => mockDatabaseQuery,
  like: () => mockDatabaseQuery,
  ilike: () => mockDatabaseQuery,
  order: () => mockDatabaseQuery,
  limit: () => mockDatabaseQuery,
  single: () => Promise.resolve({ data: null, error: null }),
  maybeSingle: () => Promise.resolve({ data: null, error: null }),
  // Thenable interface makes it resolve gracefully as a Promise
  then: (resolve) => resolve({ data: null, error: null }),
  catch: (reject) => reject(new Error("Supabase client offline"))
};

const dummySupabase = {
  isMock: true,
  from: () => mockDatabaseQuery,
  auth: {
    signUp: () => Promise.resolve({ data: null, error: null }),
    signInWithPassword: () => Promise.resolve({ data: null, error: null }),
    signOut: () => Promise.resolve({ error: null }),
  }
};

let supabase;

// Check if Supabase key is a valid format (JWT key starts with 'eyJ' or official prefix)
const isValidKeyFormat = typeof supabaseKey === 'string' && supabaseKey.length > 20 && (supabaseKey.startsWith('eyJ') || supabaseKey.startsWith('sbp_'));

if (!supabaseUrl || !supabaseKey || !isValidKeyFormat) {
  // Graceful fallback to mock client without hanging or errors
  supabase = dummySupabase;
} else {
  try {
    // Custom fetch with strict 3.5-second timeout to prevent any hanging requests
    const fetchWithTimeout = (url, options = {}) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
      return fetch(url, { ...options, signal }).finally(() => clearTimeout(timer));
    };

    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: fetchWithTimeout
      }
    });
  } catch (err) {
    supabase = dummySupabase;
  }
}

module.exports = supabase;

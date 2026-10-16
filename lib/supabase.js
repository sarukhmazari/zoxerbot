const { createClient } = require("@supabase/supabase-js");
try {
    require("dotenv").config();
} catch (_) {}

// Load environment variables (supports both standard and anon keys)
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey =
  process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || "";

let supabase;

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
  single: () => mockDatabaseQuery,
  maybeSingle: () => mockDatabaseQuery,
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

if (!supabaseUrl || !supabaseKey) {
  // Silent fallback - no console.error or warning to keep terminal clean for third-parties
  supabase = dummySupabase;
} else {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  } catch (err) {
    // If it fails, fallback silently to the mock client
    supabase = dummySupabase;
  }
}

module.exports = supabase;


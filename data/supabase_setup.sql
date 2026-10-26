-- ================================================================
-- 🚀 ZOXER MD - HIGH PERFORMANCE MULTI-DEVICE SESSION STORAGE
-- Database: PostgreSQL (Supabase)
-- 
-- How to apply:
-- 1. Go to your Supabase Project Dashboard -> SQL Editor
-- 2. Paste this entire file into the editor
-- 3. Click "Run" (or Ctrl + Enter)
-- ================================================================

-- 1. Main Session Storage Table (Key-Value per session_id)
-- Stores credentials (creds.json) and all encryption keys (pre-key, sender-key, etc.)
-- Using (session_id, key_id) as composite PRIMARY KEY guarantees:
--   ✓ ZERO conflicts between sessions / phone numbers
--   ✓ ZERO session data loss
--   ✓ Individual atomic key updates (ultra-fast, no 1MB/4MB row limit)
CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
    session_id TEXT NOT NULL,
    key_id TEXT NOT NULL,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (session_id, key_id)
);

-- Fast lookup indexes
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_session_id 
ON public.whatsapp_sessions (session_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_key_id 
ON public.whatsapp_sessions (key_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_updated_at 
ON public.whatsapp_sessions (updated_at DESC);


-- 2. Bot Instance / Device Status Table
-- Tracks connection status, active numbers, and health
CREATE TABLE IF NOT EXISTS public.bot_sessions (
    phone_number TEXT PRIMARY KEY,
    is_paired BOOLEAN DEFAULT FALSE,
    bot_mode TEXT DEFAULT 'public',
    last_connected TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_sessions_phone ON public.bot_sessions(phone_number);


-- 3. Enable Row Level Security (RLS) with full backend access policy
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_sessions ENABLE ROW LEVEL SECURITY;

-- Allow full access for backend service role / public key
DROP POLICY IF EXISTS "Full access to whatsapp_sessions" ON public.whatsapp_sessions;
CREATE POLICY "Full access to whatsapp_sessions" 
ON public.whatsapp_sessions 
FOR ALL 
TO public 
USING (true) 
WITH CHECK (true);

DROP POLICY IF EXISTS "Full access to bot_sessions" ON public.bot_sessions;
CREATE POLICY "Full access to bot_sessions" 
ON public.bot_sessions 
FOR ALL 
TO public 
USING (true) 
WITH CHECK (true);

-- Done!

-- ═══════════════════════════════════════════════════════════════════════════════
-- Image Studio: image_jobs Migration
-- Idempotent: aman dijalankan berkali-kali.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Table: image_jobs ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.image_jobs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prompt     TEXT NOT NULL DEFAULT '',
  model      TEXT NOT NULL DEFAULT '',
  size       TEXT NOT NULL DEFAULT '',
  image_url  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS image_jobs_user_created_idx
  ON public.image_jobs(user_id, created_at DESC);

-- ── 2. RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.image_jobs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'image_jobs' AND policyname = 'Users view own image jobs'
  ) THEN
    CREATE POLICY "Users view own image jobs" ON public.image_jobs
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'image_jobs' AND policyname = 'Users insert own image jobs'
  ) THEN
    CREATE POLICY "Users insert own image jobs" ON public.image_jobs
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'image_jobs' AND policyname = 'Users delete own image jobs'
  ) THEN
    CREATE POLICY "Users delete own image jobs" ON public.image_jobs
      FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

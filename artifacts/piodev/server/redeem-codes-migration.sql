-- ── Redeem Codes System ───────────────────────────────────────────────────────
-- Jalankan di Supabase SQL Editor (satu kali).

CREATE TABLE IF NOT EXISTS redeem_codes (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 TEXT        NOT NULL,
  description          TEXT,
  credit_amount_idr    INTEGER     NOT NULL CHECK (credit_amount_idr > 0),
  max_redemptions      INTEGER     DEFAULT 1,          -- NULL = tak terbatas
  current_redemptions  INTEGER     NOT NULL DEFAULT 0,
  expires_at           TIMESTAMPTZ,
  created_by           UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active            BOOLEAN     NOT NULL DEFAULT TRUE
);

-- Case-insensitive unique index
CREATE UNIQUE INDEX IF NOT EXISTS redeem_codes_code_lower_idx
  ON redeem_codes (LOWER(code));

CREATE TABLE IF NOT EXISTS code_redemptions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id           UUID        NOT NULL REFERENCES redeem_codes(id) ON DELETE CASCADE,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redeemed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  credit_amount_idr INTEGER     NOT NULL,
  UNIQUE(code_id, user_id)    -- satu user hanya bisa redeem satu kode sekali
);

-- RLS — backend pakai service_role key (bypass RLS otomatis)
ALTER TABLE redeem_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE code_redemptions ENABLE ROW LEVEL SECURITY;

-- redeem_codes: tidak ada akses langsung dari client
-- (semua operasi lewat backend dengan service_role)

-- code_redemptions: user bisa baca history redeem mereka sendiri
CREATE POLICY "Users can view own redemptions"
  ON code_redemptions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

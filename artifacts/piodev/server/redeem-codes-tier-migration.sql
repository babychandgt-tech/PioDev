-- ── Redeem Codes Tier Grant Migration ────────────────────────────────────────
-- Tambah kolom grant_tier, tier_duration_days, grant_tier_bonus ke redeem_codes.
-- Ubah CHECK credit_amount_idr agar boleh 0 (kode tier-only).
-- Tambah kolom grant_tier ke code_redemptions untuk tracking.
-- Idempotent: aman dijalankan berkali-kali.

-- 1. Kolom baru di redeem_codes
ALTER TABLE redeem_codes
  ADD COLUMN IF NOT EXISTS grant_tier          TEXT,
  ADD COLUMN IF NOT EXISTS tier_duration_days  INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS grant_tier_bonus    BOOLEAN NOT NULL DEFAULT false;

-- 2. Izinkan credit_amount_idr = 0 (untuk kode tier-only tanpa kredit)
--    Hapus constraint lama, buat constraint baru >= 0
DO $$
BEGIN
  ALTER TABLE redeem_codes DROP CONSTRAINT IF EXISTS redeem_codes_credit_amount_idr_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE redeem_codes
  ADD CONSTRAINT redeem_codes_credit_amount_idr_check
  CHECK (credit_amount_idr >= 0);

-- 3. Constraint untuk grant_tier
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'redeem_codes_grant_tier_check'
  ) THEN
    ALTER TABLE redeem_codes
      ADD CONSTRAINT redeem_codes_grant_tier_check
      CHECK (grant_tier IS NULL OR grant_tier IN ('plus', 'pro'));
  END IF;
END $$;

-- 4. Tambah grant_tier ke code_redemptions (tracking apa yang diberikan)
ALTER TABLE code_redemptions
  ADD COLUMN IF NOT EXISTS grant_tier TEXT;

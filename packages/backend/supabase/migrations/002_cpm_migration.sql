-- ============================================================
-- HitBack — CPM Migration
-- Replaces CPC bid + CPI with a single CPM rate (cents per 1,000 impressions).
-- Run after 001_initial_schema.sql on existing Supabase projects.
-- ============================================================

-- Add CPM column
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS cpm_cents INT;

-- Migrate existing rows: CPI was cents per single impression → CPM = cpi * 1000
UPDATE campaigns
SET cpm_cents = GREATEST(
  COALESCE(cpi_cents, 0) * 1000,
  COALESCE(cpc_bid_cents, 0) * 100,
  500
)
WHERE cpm_cents IS NULL;

ALTER TABLE campaigns
  ALTER COLUMN cpm_cents SET NOT NULL,
  ALTER COLUMN cpm_cents SET DEFAULT 1000; -- $10.00 CPM

-- Drop legacy CPC/CPI columns
ALTER TABLE campaigns DROP COLUMN IF EXISTS cpc_bid_cents;
ALTER TABLE campaigns DROP COLUMN IF EXISTS cpi_cents;

-- Index for ad-serving auction (highest CPM wins)
CREATE INDEX IF NOT EXISTS idx_campaigns_cpm ON campaigns (cpm_cents DESC);

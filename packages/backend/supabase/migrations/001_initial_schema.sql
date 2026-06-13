-- ============================================================
-- HitBack — Initial Schema
-- ============================================================
-- Tables: campaigns, impressions, clicks, earnings
-- Run against your Supabase project via the SQL editor or CLI.
-- ============================================================

-- -----------------------------------------------------------
-- CAMPAIGNS
-- An advertiser creates a campaign with ad text, URL, and
-- a purchased block of impressions.
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advertiser_id UUID NOT NULL,           -- FK to auth.users
  ad_text       TEXT NOT NULL,
  ad_url        TEXT NOT NULL,
  total_impressions   INT NOT NULL DEFAULT 0,
  remaining_impressions INT NOT NULL DEFAULT 0,
  cpm_cents     INT NOT NULL DEFAULT 1000, -- CPM rate in cents per 1,000 impressions ($10.00 CPM)
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'active', 'paused', 'exhausted')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaigns_status ON campaigns (status);
CREATE INDEX idx_campaigns_advertiser ON campaigns (advertiser_id);
CREATE INDEX idx_campaigns_cpm ON campaigns (cpm_cents DESC);

-- -----------------------------------------------------------
-- IMPRESSIONS
-- Every time the extension shows an ad to a developer.
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS impressions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  extension_user_id TEXT NOT NULL,        -- anonymous extension install ID
  shown_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_impressions_campaign ON impressions (campaign_id);
CREATE INDEX idx_impressions_shown ON impressions (shown_at);

-- -----------------------------------------------------------
-- CLICKS
-- When a developer clicks the status bar ad.
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS clicks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  extension_user_id TEXT NOT NULL,
  clicked_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clicks_campaign ON clicks (campaign_id);

-- -----------------------------------------------------------
-- EARNINGS
-- Revenue share credited to the developer who saw/clicked.
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS earnings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id  TEXT NOT NULL,            -- extension_user_id (or auth.users id later)
  amount_cents  INT NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('impression', 'click')),
  campaign_id   UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_earnings_developer ON earnings (developer_id);

-- -----------------------------------------------------------
-- USER PROFILES (Phase 6 — included here for FK convenience)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_profiles (
  id              UUID PRIMARY KEY,       -- matches auth.users.id
  email           TEXT,
  display_name    TEXT,
  role            TEXT NOT NULL DEFAULT 'developer'
                  CHECK (role IN ('advertiser', 'developer', 'admin')),
  stripe_customer_id  TEXT,
  stripe_connect_id   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------
-- ROW LEVEL SECURITY (basic — tighten in production)
-- -----------------------------------------------------------
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE impressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Allow the service role (backend) full access
CREATE POLICY "Service role full access" ON campaigns    FOR ALL USING (true);
CREATE POLICY "Service role full access" ON impressions  FOR ALL USING (true);
CREATE POLICY "Service role full access" ON clicks       FOR ALL USING (true);
CREATE POLICY "Service role full access" ON earnings     FOR ALL USING (true);
CREATE POLICY "Service role full access" ON user_profiles FOR ALL USING (true);

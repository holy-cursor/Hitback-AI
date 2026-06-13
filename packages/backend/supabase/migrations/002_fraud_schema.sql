-- ============================================================
-- HitBack — Fraud Detection & Rate Limiting Schema
-- ============================================================

-- Composite index to heavily optimize the rate-limiting query
-- (checking how many impressions a user had in the last hour)
CREATE INDEX IF NOT EXISTS idx_impressions_user_time 
  ON impressions (extension_user_id, shown_at DESC);

-- -----------------------------------------------------------
-- FRAUD FLAGS
-- Logs users flagged by anomaly detection (e.g. >3x daily avg)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS fraud_flags (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extension_user_id TEXT NOT NULL,
  reason            TEXT NOT NULL,
  is_resolved       BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ
);

CREATE INDEX idx_fraud_flags_user ON fraud_flags (extension_user_id);
CREATE INDEX idx_fraud_flags_unresolved ON fraud_flags (is_resolved) WHERE is_resolved = false;

ALTER TABLE fraud_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON fraud_flags FOR ALL USING (true);

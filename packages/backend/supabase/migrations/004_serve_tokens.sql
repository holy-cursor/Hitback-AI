-- ============================================================
-- HitBack — Serve Tokens & Auth-Keyed Rate Limiting
-- ============================================================
-- Single-use tokens tie impressions/clicks to a real ad serve.
-- auth_user_id columns enable server-side dedup for reach metrics.
-- ============================================================

CREATE TABLE IF NOT EXISTS serve_tokens (
  jti               UUID PRIMARY KEY,
  campaign_id       UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  extension_user_id TEXT NOT NULL,
  auth_user_id      UUID NULL,
  impression_used   BOOLEAN NOT NULL DEFAULT false,
  click_used        BOOLEAN NOT NULL DEFAULT false,
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_serve_tokens_extension_time
  ON serve_tokens (extension_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_serve_tokens_auth_time
  ON serve_tokens (auth_user_id, created_at DESC)
  WHERE auth_user_id IS NOT NULL;

ALTER TABLE serve_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON serve_tokens FOR ALL USING (true);

ALTER TABLE impressions
  ADD COLUMN IF NOT EXISTS auth_user_id UUID NULL;

CREATE INDEX IF NOT EXISTS idx_impressions_auth_time
  ON impressions (auth_user_id, shown_at DESC)
  WHERE auth_user_id IS NOT NULL;

ALTER TABLE clicks
  ADD COLUMN IF NOT EXISTS auth_user_id UUID NULL;

CREATE INDEX IF NOT EXISTS idx_clicks_auth_time
  ON clicks (auth_user_id, clicked_at DESC)
  WHERE auth_user_id IS NOT NULL;









-- Atomic impression: consume serve token, decrement budget, insert impression + earnings
-- in one transaction. Rolls back entirely on any failure after token consume attempt.

CREATE OR REPLACE FUNCTION record_impression_atomic(
  p_jti UUID,
  p_campaign_id UUID,
  p_extension_user_id TEXT,
  p_auth_user_id UUID,
  p_developer_id TEXT,
  p_dev_earnings_cents INT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_remaining INT;
  v_cpm INT;
BEGIN
  UPDATE serve_tokens
  SET impression_used = true
  WHERE jti = p_jti
    AND impression_used = false
    AND campaign_id = p_campaign_id
    AND extension_user_id = p_extension_user_id
    AND expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'token_invalid');
  END IF;

  UPDATE campaigns
  SET
    remaining_impressions = remaining_impressions - 1,
    status = CASE
      WHEN remaining_impressions - 1 <= 0 THEN 'exhausted'
      ELSE status
    END,
    updated_at = now()
  WHERE id = p_campaign_id
    AND status = 'active'
    AND remaining_impressions > 0
  RETURNING remaining_impressions, cpm_cents INTO v_remaining, v_cpm;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_unavailable';
  END IF;

  INSERT INTO impressions (campaign_id, extension_user_id, auth_user_id)
  VALUES (p_campaign_id, p_extension_user_id, p_auth_user_id);

  IF p_dev_earnings_cents > 0 THEN
    INSERT INTO earnings (developer_id, amount_cents, source, campaign_id)
    VALUES (p_developer_id, p_dev_earnings_cents, 'impression', p_campaign_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'remaining_impressions', v_remaining,
    'cpm_cents', v_cpm
  );
END;
$$;

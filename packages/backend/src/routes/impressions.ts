import { Router, Request, Response } from "express";
import { devEarningsPerImpression } from "../lib/cpm";
import { resolveAuthUserId } from "../lib/resolveUser";
import { isSupabaseConfigured, getSupabase } from "../lib/supabase";
import { consumeServeToken, peekServeToken } from "../lib/serveToken";
import {
  HOURLY_IMPRESSION_LIMIT,
  RateLimitError,
  countRecentImpressions,
  isFraudFlagged,
} from "../lib/rateLimit";

const router = Router();

interface AtomicImpressionResult {
  ok: boolean;
  code?: string;
  remaining_impressions?: number;
  cpm_cents?: number;
}

/**
 * POST /api/impressions
 * Records that an ad was shown. Requires a signed single-use impressionToken
 * issued by GET /api/ads/current for the same serve event.
 *
 * Body: { impressionToken: string }
 */
router.post("/", async (req: Request, res: Response) => {
  const { impressionToken } = req.body;

  if (!impressionToken || typeof impressionToken !== "string") {
    res.status(400).json({ error: "Missing or invalid impressionToken" });
    return;
  }

  if (!isSupabaseConfigured()) {
    const peeked = await peekServeToken(impressionToken, "imp");
    if (!peeked) {
      res.status(401).json({ error: "Invalid or expired impression token" });
      return;
    }

    const consumed = await consumeServeToken(impressionToken, "imp");
    if (!consumed) {
      res.status(409).json({ error: "Impression token already used" });
      return;
    }

    console.log(
      `[Impressions] (demo mode) Campaign ${consumed.campaignId} shown to ${consumed.extensionUserId}`
    );
    res.json({ success: true, mode: "demo" });
    return;
  }

  try {
    const requestAuthUserId = await resolveAuthUserId(req);
    if (!requestAuthUserId) {
      res.status(401).json({ error: "Sign in required" });
      return;
    }

    const peeked = await peekServeToken(impressionToken, "imp");
    if (!peeked) {
      res.status(401).json({ error: "Invalid, expired, or already-used impression token" });
      return;
    }

    const { jti, campaignId, extensionUserId, authUserId: tokenAuthUserId } = peeked;

    if (tokenAuthUserId && requestAuthUserId !== tokenAuthUserId) {
      res.status(403).json({ error: "Token does not match authenticated user" });
      return;
    }

    const authUserId = requestAuthUserId;
    const developerId = authUserId;

    if (await isFraudFlagged(extensionUserId)) {
      res.status(403).json({ error: "Access restricted" });
      return;
    }

    const recentImpressions = await countRecentImpressions({
      authUserId,
      extensionUserId,
    });

    if (recentImpressions >= HOURLY_IMPRESSION_LIMIT) {
      console.warn(
        `[Impressions] Rate limit: ${authUserId} exceeded ${HOURLY_IMPRESSION_LIMIT}/hr`
      );
      res.status(429).json({ error: "Rate limit exceeded" });
      return;
    }

    const sb = getSupabase();

    const { data: campaign, error: fetchError } = await sb
      .from("campaigns")
      .select("cpm_cents, status, remaining_impressions")
      .eq("id", campaignId)
      .single();

    if (fetchError || !campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    if (campaign.status !== "active" || campaign.remaining_impressions <= 0) {
      res.status(409).json({ error: "Campaign is not available" });
      return;
    }

    const devEarnings = devEarningsPerImpression(campaign.cpm_cents);

    const { data: rpcData, error: rpcError } = await sb.rpc("record_impression_atomic", {
      p_jti: jti,
      p_campaign_id: campaignId,
      p_extension_user_id: extensionUserId,
      p_auth_user_id: authUserId,
      p_developer_id: developerId,
      p_dev_earnings_cents: devEarnings,
    });

    if (rpcError) {
      console.error("[Impressions] Atomic record error:", rpcError.message);
      if (rpcError.message.includes("campaign_unavailable")) {
        res.status(409).json({ error: "Campaign budget exhausted" });
        return;
      }
      res.status(500).json({ error: "Failed to record impression" });
      return;
    }

    const result = rpcData as AtomicImpressionResult;
    if (!result?.ok) {
      const code = result?.code ?? "unknown";
      if (code === "token_invalid") {
        res.status(409).json({ error: "Impression token already used or expired" });
        return;
      }
      res.status(500).json({ error: "Failed to record impression" });
      return;
    }

    console.log(
      `[Impressions] Recorded: campaign=${campaignId} user=${extensionUserId} developer=${developerId}`
    );
    res.json({ success: true });
  } catch (err) {
    if (err instanceof RateLimitError) {
      res.status(503).json({ error: err.message });
      return;
    }
    console.error("[Impressions] Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

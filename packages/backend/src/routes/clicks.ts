import { Router, Request, Response } from "express";
import { resolveAuthUserId } from "../lib/resolveUser";
import { isSupabaseConfigured, getSupabase } from "../lib/supabase";
import { consumeServeToken, peekServeToken } from "../lib/serveToken";
import {
  HOURLY_CLICK_LIMIT,
  RateLimitError,
  countRecentClicks,
  isFraudFlagged,
} from "../lib/rateLimit";

const router = Router();

/**
 * POST /api/clicks
 * Logs an ad click tied to a signed single-use clickToken from /api/ads/current.
 * Body: { clickToken: string }
 */
router.post("/", async (req: Request, res: Response) => {
  const { clickToken } = req.body;

  if (!clickToken || typeof clickToken !== "string") {
    res.status(400).json({ error: "Missing or invalid clickToken" });
    return;
  }

  if (!isSupabaseConfigured()) {
    const peeked = await peekServeToken(clickToken, "clk");
    if (!peeked) {
      res.status(401).json({ error: "Invalid or expired click token" });
      return;
    }

    const consumed = await consumeServeToken(clickToken, "clk");
    if (!consumed) {
      res.status(409).json({ error: "Click token already used" });
      return;
    }

    console.log(
      `[Clicks] (demo mode) campaign=${consumed.campaignId} user=${consumed.extensionUserId}`
    );
    res.json({ success: true, adId: consumed.campaignId });
    return;
  }

  try {
    const requestAuthUserId = await resolveAuthUserId(req);
    if (!requestAuthUserId) {
      res.status(401).json({ error: "Sign in required" });
      return;
    }

    const peeked = await peekServeToken(clickToken, "clk");
    if (!peeked) {
      res.status(401).json({ error: "Invalid, expired, or already-used click token" });
      return;
    }

    const { campaignId, extensionUserId, authUserId: tokenAuthUserId } = peeked;

    if (tokenAuthUserId && requestAuthUserId !== tokenAuthUserId) {
      res.status(403).json({ error: "Token does not match authenticated user" });
      return;
    }

    const authUserId = requestAuthUserId;

    if (await isFraudFlagged(extensionUserId)) {
      res.status(403).json({ error: "Access restricted" });
      return;
    }

    const recentClicks = await countRecentClicks({
      authUserId,
      extensionUserId,
    });

    if (recentClicks >= HOURLY_CLICK_LIMIT) {
      res.status(429).json({ error: "Click rate limit exceeded" });
      return;
    }

    const sb = getSupabase();

    const { data: campaign } = await sb
      .from("campaigns")
      .select("id")
      .eq("id", campaignId)
      .maybeSingle();

    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    const consumed = await consumeServeToken(clickToken, "clk");
    if (!consumed) {
      res.status(409).json({ error: "Click token already used" });
      return;
    }

    const { error: clickError } = await sb.from("clicks").insert({
      campaign_id: campaignId,
      extension_user_id: extensionUserId,
      auth_user_id: authUserId,
    });

    if (clickError) {
      console.error("[Clicks] Insert error:", clickError.message);
      res.status(500).json({ error: "Failed to record click" });
      return;
    }

    console.log(`[Clicks] Recorded: campaign=${campaignId} user=${extensionUserId}`);
    res.json({ success: true, adId: campaignId });
  } catch (err) {
    if (err instanceof RateLimitError) {
      res.status(503).json({ error: err.message });
      return;
    }
    console.error("[Clicks] Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

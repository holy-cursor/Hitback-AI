import { Router, Request, Response } from "express";
import { devEarningsPerImpression } from "../lib/cpm";
import { resolveAuthUserId } from "../lib/resolveUser";
import { isSupabaseConfigured, getSupabase } from "../lib/supabase";

const router = Router();

/**
 * POST /api/impressions
 * Records that an ad was shown to a developer.
 *
 * Body: { campaignId: string, extensionUserId: string }
 *
 * Also records developer earnings for the impression (60% of CPM rate).
 */
router.post("/", async (req: Request, res: Response) => {
  const { campaignId, extensionUserId } = req.body;

  if (!campaignId || typeof campaignId !== "string") {
    res.status(400).json({ error: "Missing or invalid campaignId" });
    return;
  }

  if (!extensionUserId || typeof extensionUserId !== "string") {
    res.status(400).json({ error: "Missing or invalid extensionUserId" });
    return;
  }

  if (!isSupabaseConfigured()) {
    console.log(
      `[Impressions] (demo mode) Campaign ${campaignId} shown to ${extensionUserId}`
    );
    res.json({ success: true, mode: "demo" });
    return;
  }

  try {
    const sb = getSupabase();
    const authUserId = await resolveAuthUserId(req);
    const developerId = authUserId ?? extensionUserId;

    // -- Anti-Spam Server-Side Rate Limit --
    // Check how many impressions this user logged in the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await sb
      .from("impressions")
      .select("*", { count: "exact", head: true })
      .eq("extension_user_id", extensionUserId)
      .gte("shown_at", oneHourAgo);

    if (countError) {
      console.error("[Impressions] Rate limit check error:", countError.message);
    }

    // We set the server hard-limit slightly higher than the client (30 instead of 25)
    // to account for clock drift and race conditions without punishing legitimate requests.
    if (count !== null && count >= 30) {
      console.warn(`[Impressions] FRAUD BLOCK: ${extensionUserId} exceeded 30 imp/hr.`);
      res.status(429).json({ error: "Rate limit exceeded" });
      return;
    }

    const { error: impError } = await sb.from("impressions").insert({
      campaign_id: campaignId,
      extension_user_id: extensionUserId,
    });

    if (impError) {
      console.error("[Impressions] Insert error:", impError.message);
      res.status(500).json({ error: "Failed to record impression" });
      return;
    }

    const { data: campaign, error: fetchError } = await sb
      .from("campaigns")
      .select("remaining_impressions, cpm_cents")
      .eq("id", campaignId)
      .single();

    if (!fetchError && campaign) {
      const newRemaining = Math.max(0, campaign.remaining_impressions - 1);
      const updates: Record<string, unknown> = {
        remaining_impressions: newRemaining,
      };

      if (newRemaining === 0) {
        updates.status = "exhausted";
      }

      await sb.from("campaigns").update(updates).eq("id", campaignId);

      const devEarnings = devEarningsPerImpression(campaign.cpm_cents);
      if (devEarnings > 0) {
        await sb.from("earnings").insert({
          developer_id: developerId,
          amount_cents: devEarnings,
          source: "impression",
          campaign_id: campaignId,
        });
      }
    }

    console.log(
      `[Impressions] Recorded: campaign=${campaignId} user=${extensionUserId} developer=${developerId}`
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[Impressions] Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

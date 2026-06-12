import { Router, Request, Response } from "express";
import { isSupabaseConfigured, getSupabase } from "../lib/supabase";

const router = Router();

/**
 * POST /api/impressions
 * Records that an ad was shown to a developer.
 *
 * Body: { campaignId: string, extensionUserId: string }
 *
 * Also records developer earnings for the impression.
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

  // If Supabase is not configured, just log and return
  if (!isSupabaseConfigured()) {
    console.log(
      `[Impressions] (demo mode) Campaign ${campaignId} shown to ${extensionUserId}`
    );
    res.json({ success: true, mode: "demo" });
    return;
  }

  try {
    const sb = getSupabase();

    // Record the impression
    const { error: impError } = await sb.from("impressions").insert({
      campaign_id: campaignId,
      extension_user_id: extensionUserId,
    });

    if (impError) {
      console.error("[Impressions] Insert error:", impError.message);
      res.status(500).json({ error: "Failed to record impression" });
      return;
    }

    // Decrement remaining impressions on the campaign
    const { data: campaign, error: fetchError } = await sb
      .from("campaigns")
      .select("remaining_impressions, cpi_cents")
      .eq("id", campaignId)
      .single();

    if (!fetchError && campaign) {
      const newRemaining = Math.max(0, campaign.remaining_impressions - 1);
      const updates: Record<string, unknown> = {
        remaining_impressions: newRemaining,
      };

      // If impressions are exhausted, mark the campaign as exhausted
      if (newRemaining === 0) {
        updates.status = "exhausted";
      }

      await sb.from("campaigns").update(updates).eq("id", campaignId);

      // Record developer earnings (revenue share: 70% of CPI goes to dev)
      const devEarnings = Math.round(campaign.cpi_cents * 0.7);
      if (devEarnings > 0) {
        await sb.from("earnings").insert({
          developer_id: extensionUserId,
          amount_cents: devEarnings,
          source: "impression",
          campaign_id: campaignId,
        });
      }
    }

    console.log(
      `[Impressions] Recorded: campaign=${campaignId} user=${extensionUserId}`
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[Impressions] Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

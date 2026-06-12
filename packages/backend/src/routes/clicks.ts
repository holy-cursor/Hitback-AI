import { Router, Request, Response } from "express";
import { isSupabaseConfigured, getSupabase } from "../lib/supabase";

const router = Router();

/**
 * POST /api/clicks
 * Logs an ad click event.
 * Body: { adId: string, extensionUserId?: string }
 *
 * When Supabase is configured: writes to the clicks table and records
 * developer CPC earnings (70% revenue share).
 * Fallback: logs to console.
 */
router.post("/", async (req: Request, res: Response) => {
  const { adId, extensionUserId } = req.body;

  if (!adId || typeof adId !== "string") {
    res.status(400).json({ error: "Missing or invalid adId" });
    return;
  }

  // --- Supabase mode ---
  if (isSupabaseConfigured() && extensionUserId) {
    try {
      const sb = getSupabase();

      // Record the click
      const { error: clickError } = await sb.from("clicks").insert({
        campaign_id: adId,
        extension_user_id: extensionUserId,
      });

      if (clickError) {
        console.error("[Clicks] Insert error:", clickError.message);
      } else {
        // Fetch campaign CPC bid for earnings calculation
        const { data: campaign } = await sb
          .from("campaigns")
          .select("cpc_bid_cents")
          .eq("id", adId)
          .single();

        if (campaign) {
          // Developer gets 70% of CPC
          const devEarnings = Math.round(campaign.cpc_bid_cents * 0.7);
          if (devEarnings > 0) {
            await sb.from("earnings").insert({
              developer_id: extensionUserId,
              amount_cents: devEarnings,
              source: "click",
              campaign_id: adId,
            });
          }
        }

        console.log(
          `[Clicks] Recorded: campaign=${adId} user=${extensionUserId}`
        );
      }
    } catch (err) {
      console.error("[Clicks] Unexpected error:", err);
    }
  } else {
    console.log(`[Clicks] (demo mode) Ad clicked: ${adId} at ${new Date().toISOString()}`);
  }

  res.json({ success: true, adId });
});

export default router;

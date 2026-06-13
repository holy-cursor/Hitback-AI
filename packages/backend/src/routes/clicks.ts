import { Router, Request, Response } from "express";
import { isSupabaseConfigured, getSupabase } from "../lib/supabase";

const router = Router();

/**
 * POST /api/clicks
 * Logs an ad click event (analytics only — earnings are CPM-based on impressions).
 * Body: { adId: string, extensionUserId?: string }
 */
router.post("/", async (req: Request, res: Response) => {
  const { adId, extensionUserId } = req.body;

  if (!adId || typeof adId !== "string") {
    res.status(400).json({ error: "Missing or invalid adId" });
    return;
  }

  if (isSupabaseConfigured() && extensionUserId) {
    try {
      const sb = getSupabase();

      const { error: clickError } = await sb.from("clicks").insert({
        campaign_id: adId,
        extension_user_id: extensionUserId,
      });

      if (clickError) {
        console.error("[Clicks] Insert error:", clickError.message);
      } else {
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

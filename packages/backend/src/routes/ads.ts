import { Router, Request, Response } from "express";
import { isSupabaseConfigured, getSupabase } from "../lib/supabase";

const router = Router();

/**
 * In-memory ad store (hardcoded for v1).
 * Used as fallback when Supabase is not configured.
 */
const DEMO_ADS = [
  {
    id: "demo-1",
    text: "Try Acme Pro — 50% off today",
    url: "https://example.com/acme-pro",
  },
  {
    id: "demo-2",
    text: "Ship faster with Turbo CI/CD",
    url: "https://example.com/turbo-cicd",
  },
  {
    id: "demo-3",
    text: "DevTools Premium — free trial",
    url: "https://example.com/devtools",
  },
];

/** Track which ad to serve next (simple round-robin for demo). */
let adIndex = 0;

/**
 * GET /api/ads/current
 * Returns the current highest-priority active ad.
 *
 * When Supabase is configured: queries for the active campaign with the
 * highest CPM and remaining impressions.
 * Fallback: round-robins through hardcoded demo ads.
 */
router.get("/current", async (_req: Request, res: Response) => {
  // --- Supabase mode ---
  if (isSupabaseConfigured()) {
    try {
      const sb = getSupabase();

      const { data: campaign, error } = await sb
        .from("campaigns")
        .select("id, ad_text, ad_url, ad_image_url, cpm_cents, remaining_impressions")
        .eq("status", "active")
        .gt("remaining_impressions", 0)
        .order("cpm_cents", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("[Ads] Supabase query error:", error.message);
        // Fall through to demo mode
      } else if (campaign) {
        console.log(
          `[Ads] Served campaign: "${campaign.ad_text}" (id: ${campaign.id}, CPM: ${campaign.cpm_cents}¢, remaining: ${campaign.remaining_impressions})`
        );

        res.json({
          id: campaign.id,
          text: campaign.ad_text,
          url: campaign.ad_url,
          imageUrl: campaign.ad_image_url || undefined,
        });
        return;
      } else {
        console.log("[Ads] No active campaigns — falling back to demo ads");
      }
    } catch (err) {
      console.error("[Ads] Unexpected Supabase error:", err);
      // Fall through to demo mode
    }
  }

  // --- Demo mode (fallback) ---
  const ad = DEMO_ADS[adIndex % DEMO_ADS.length];
  adIndex++;

  console.log(`[Ads] Served demo ad: "${ad.text}" (id: ${ad.id})`);

  res.json({
    id: ad.id,
    text: ad.text,
    url: ad.url,
  });
});

/**
 * GET /api/ads/queue
 * Public endpoint: top active campaigns by CPM for the live queue display.
 */
router.get("/queue", async (_req: Request, res: Response) => {
  if (!isSupabaseConfigured()) {
    res.json({ campaigns: [] });
    return;
  }

  try {
    const sb = getSupabase();

    const { data: campaigns, error } = await sb
      .from("campaigns")
      .select("ad_text, cpm_cents, remaining_impressions, status")
      .eq("status", "active")
      .gt("remaining_impressions", 0)
      .order("cpm_cents", { ascending: false })
      .limit(5);

    if (error) {
      console.error("[Ads] Queue query error:", error.message);
      res.status(500).json({ error: "Failed to fetch queue" });
      return;
    }

    res.json({ campaigns: campaigns || [] });
  } catch (err) {
    console.error("[Ads] Queue error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

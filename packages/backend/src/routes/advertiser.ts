import { Router, Request, Response } from "express";
import { DEFAULT_CPM_CENTS } from "../lib/cpm";
import { requireAuth } from "../middleware/requireAuth";
import { isSupabaseConfigured, getSupabase } from "../lib/supabase";

const router = Router();

/**
 * GET /api/advertiser/campaigns
 * Lists all campaigns for the authenticated advertiser.
 */
router.get("/campaigns", requireAuth, async (req: Request, res: Response) => {
  if (!isSupabaseConfigured()) {
    // Return demo campaigns in demo mode
    res.json({
      campaigns: [
        {
          id: "demo-1",
          ad_text: "Try Acme Pro — 50% off today",
          ad_url: "https://example.com/acme-pro",
          total_impressions: 5000,
          remaining_impressions: 3200,
          cpm_cents: 800,
          status: "active",
          created_at: new Date().toISOString(),
        },
      ],
      mode: "demo",
    });
    return;
  }

  try {
    const sb = getSupabase();

    const { data: campaigns, error } = await sb
      .from("campaigns")
      .select("*")
      .eq("advertiser_id", req.user!.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Advertiser] Campaigns query error:", error.message);
      res.status(500).json({ error: "Failed to fetch campaigns" });
      return;
    }

    res.json({ campaigns: campaigns || [] });
  } catch (err) {
    console.error("[Advertiser] Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/advertiser/campaigns
 * Creates a new campaign (draft status, pending checkout).
 *
 * Body: { adText: string, adUrl: string, cpmCents?: number }
 */
router.post("/campaigns", requireAuth, async (req: Request, res: Response) => {
  const { adText, adUrl, cpmCents } = req.body;

  if (!adText || typeof adText !== "string" || adText.length > 60) {
    res.status(400).json({ error: "adText is required and must be ≤60 characters" });
    return;
  }

  if (!adUrl || typeof adUrl !== "string") {
    res.status(400).json({ error: "adUrl is required" });
    return;
  }

  // Validate URL format
  try {
    new URL(adUrl);
  } catch {
    res.status(400).json({ error: "adUrl must be a valid URL" });
    return;
  }

  if (!isSupabaseConfigured()) {
    // Demo mode — return a fake campaign
    res.json({
      campaign: {
        id: `demo-${Date.now()}`,
        ad_text: adText,
        ad_url: adUrl,
        status: "draft",
        created_at: new Date().toISOString(),
      },
      mode: "demo",
    });
    return;
  }

  try {
    const sb = getSupabase();

    const { data: campaign, error } = await sb
      .from("campaigns")
      .insert({
        advertiser_id: req.user!.id,
        ad_text: adText,
        ad_url: adUrl,
        cpm_cents: cpmCents || DEFAULT_CPM_CENTS,
        status: "draft",
      })
      .select()
      .single();

    if (error) {
      console.error("[Advertiser] Campaign insert error:", error.message);
      res.status(500).json({ error: "Failed to create campaign" });
      return;
    }

    console.log(`[Advertiser] Campaign created: ${campaign.id}`);
    res.json({ campaign });
  } catch (err) {
    console.error("[Advertiser] Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /api/advertiser/campaigns/:id
 * Pause or resume a campaign.
 *
 * Body: { status: "active" | "paused" }
 */
router.patch("/campaigns/:id", requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status || !["active", "paused"].includes(status)) {
    res.status(400).json({ error: "status must be 'active' or 'paused'" });
    return;
  }

  if (!isSupabaseConfigured()) {
    res.json({ success: true, mode: "demo" });
    return;
  }

  try {
    const sb = getSupabase();

    const { error } = await sb
      .from("campaigns")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("advertiser_id", req.user!.id);

    if (error) {
      console.error("[Advertiser] Campaign update error:", error.message);
      res.status(500).json({ error: "Failed to update campaign" });
      return;
    }

    console.log(`[Advertiser] Campaign ${id} → ${status}`);
    res.json({ success: true });
  } catch (err) {
    console.error("[Advertiser] Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/advertiser/stats
 * Aggregated stats for all campaigns belonging to the authenticated user.
 */
router.get("/stats", requireAuth, async (req: Request, res: Response) => {
  if (!isSupabaseConfigured()) {
    // Demo stats
    res.json({
      totalImpressions: 4280,
      totalClicks: 187,
      ctr: "4.37%",
      totalSpendCents: 2140,
      activeCampaigns: 1,
      mode: "demo",
    });
    return;
  }

  try {
    const sb = getSupabase();
    const userId = req.user!.id;

    // Get user's campaigns
    const { data: campaigns } = await sb
      .from("campaigns")
      .select("id, status, total_impressions, remaining_impressions")
      .eq("advertiser_id", userId);

    if (!campaigns || campaigns.length === 0) {
      res.json({
        totalImpressions: 0,
        totalClicks: 0,
        ctr: "0.00%",
        totalSpendCents: 0,
        activeCampaigns: 0,
      });
      return;
    }

    const campaignIds = campaigns.map((c) => c.id);

    // Count impressions
    const { count: impressionCount } = await sb
      .from("impressions")
      .select("*", { count: "exact", head: true })
      .in("campaign_id", campaignIds);

    // Count clicks
    const { count: clickCount } = await sb
      .from("clicks")
      .select("*", { count: "exact", head: true })
      .in("campaign_id", campaignIds);

    const totalImpressions = impressionCount || 0;
    const totalClicks = clickCount || 0;
    const ctr =
      totalImpressions > 0
        ? ((totalClicks / totalImpressions) * 100).toFixed(2) + "%"
        : "0.00%";

    const totalSpent = campaigns.reduce(
      (sum, c) => sum + (c.total_impressions - c.remaining_impressions),
      0
    );

    const activeCampaigns = campaigns.filter(
      (c) => c.status === "active"
    ).length;

    res.json({
      totalImpressions,
      totalClicks,
      ctr,
      totalSpendCents: totalSpent,
      activeCampaigns,
    });
  } catch (err) {
    console.error("[Advertiser] Stats error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

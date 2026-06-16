import { Router, Request, Response } from "express";
import { DEFAULT_CPM_CENTS } from "../lib/cpm";
import { requireAuth } from "../middleware/requireAuth";
import { isSupabaseConfigured, getSupabase } from "../lib/supabase";

const router = Router();

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function enrichCampaignsWithStats(
  campaigns: Array<{
    id: string;
    total_impressions?: number;
    remaining_impressions?: number;
    cpm_cents?: number;
    [key: string]: unknown;
  }>
) {
  if (!campaigns.length) return campaigns;

  const sb = getSupabase();
  const ids = campaigns.map((c) => c.id);

  const [{ data: impressionRows }, { data: clickRows }] = await Promise.all([
    sb
      .from("impressions")
      .select("campaign_id, auth_user_id, extension_user_id")
      .in("campaign_id", ids),
    sb.from("clicks").select("campaign_id").in("campaign_id", ids),
  ]);

  const impressionCounts: Record<string, number> = {};
  const clickCounts: Record<string, number> = {};
  const verifiedReach: Record<string, Set<string>> = {};
  const anonymousReach: Record<string, Set<string>> = {};

  for (const row of impressionRows || []) {
    impressionCounts[row.campaign_id] = (impressionCounts[row.campaign_id] || 0) + 1;

    if (row.auth_user_id) {
      if (!verifiedReach[row.campaign_id]) {
        verifiedReach[row.campaign_id] = new Set();
      }
      verifiedReach[row.campaign_id].add(row.auth_user_id);
    } else {
      if (!anonymousReach[row.campaign_id]) {
        anonymousReach[row.campaign_id] = new Set();
      }
      anonymousReach[row.campaign_id].add(row.extension_user_id);
    }
  }
  for (const row of clickRows || []) {
    clickCounts[row.campaign_id] = (clickCounts[row.campaign_id] || 0) + 1;
  }

  return campaigns.map((c) => {
    const delivered = (c.total_impressions || 0) - (c.remaining_impressions || 0);
    const impressions = impressionCounts[c.id] || 0;
    const clicks = clickCounts[c.id] || 0;
    const ctr =
      impressions > 0 ? ((clicks / impressions) * 100).toFixed(2) + "%" : "0.00%";
    const spendCents = Math.round((delivered * (c.cpm_cents || 0)) / 1000);
    const verifiedDevelopers = verifiedReach[c.id]?.size || 0;
    const anonymousInstalls = anonymousReach[c.id]?.size || 0;

    return {
      ...c,
      delivered_impressions: delivered,
      impression_count: impressions,
      click_count: clicks,
      verified_unique_developers: verifiedDevelopers,
      anonymous_unique_installs: anonymousInstalls,
      unique_reach: verifiedDevelopers + anonymousInstalls,
      ctr,
      spend_cents: spendCents,
      spend_display: formatCents(spendCents),
    };
  });
}

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
          delivered_impressions: 1800,
          impression_count: 1800,
          click_count: 79,
          ctr: "4.39%",
          spend_cents: 1440,
          spend_display: "$14.40",
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

    const enriched = await enrichCampaignsWithStats(campaigns || []);
    res.json({ campaigns: enriched });
  } catch (err) {
    console.error("[Advertiser] Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/advertiser/campaigns
 * Creates a new campaign (draft status, pending checkout).
 *
 * Body: { adText: string, adUrl: string, adImageUrl?: string, cpmCents?: number }
 */
router.post("/campaigns", requireAuth, async (req: Request, res: Response) => {
  const { adText, adUrl, adImageUrl, cpmCents } = req.body;

  if (!adText || typeof adText !== "string" || adText.trim().length === 0) {
    res.status(400).json({ error: "Ad text is required" });
    return;
  }

  if (adText.length > 60) {
    res.status(400).json({ error: "Ad text must be 60 characters or fewer" });
    return;
  }

  if (!adUrl || typeof adUrl !== "string") {
    res.status(400).json({ error: "Destination URL is required" });
    return;
  }

  try {
    new URL(adUrl);
  } catch {
    res.status(400).json({ error: "Destination URL must be a valid URL (include https://)" });
    return;
  }

  let imageUrl: string | null = null;
  if (adImageUrl) {
    if (typeof adImageUrl !== "string") {
      res.status(400).json({ error: "Image URL must be a string" });
      return;
    }
    try {
      const parsed = new URL(adImageUrl.trim());
      if (!["http:", "https:"].includes(parsed.protocol)) {
        res.status(400).json({ error: "Image URL must use http or https" });
        return;
      }
      imageUrl = parsed.toString();
    } catch {
      res.status(400).json({ error: "Image URL must be a valid URL" });
      return;
    }
  }

  const insertPayload = {
    advertiser_id: req.user!.id,
    ad_text: adText.trim(),
    ad_url: adUrl.trim(),
    ad_image_url: imageUrl,
    cpm_cents: cpmCents || DEFAULT_CPM_CENTS,
    status: "draft" as const,
  };

  if (!isSupabaseConfigured()) {
    res.json({
      campaign: {
        id: `demo-${Date.now()}`,
        ad_text: insertPayload.ad_text,
        ad_url: insertPayload.ad_url,
        ad_image_url: imageUrl,
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
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      console.error("[Advertiser] Campaign insert error:", error.message);
      const hint =
        error.message.includes("ad_image_url")
          ? " Run migration 003_ad_image_url.sql in Supabase, or remove the image URL."
          : "";
      res.status(500).json({ error: `Failed to create campaign.${hint}` });
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

    const { data: existing } = await sb
      .from("campaigns")
      .select("id, status")
      .eq("id", id)
      .eq("advertiser_id", req.user!.id)
      .maybeSingle();

    if (!existing) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    if (!["active", "paused"].includes(existing.status)) {
      res.status(400).json({ error: "Only active or paused campaigns can be updated" });
      return;
    }

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
      totalSpendCents: 3424,
      totalSpendDisplay: "$34.24",
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
      .select("id, status, total_impressions, remaining_impressions, cpm_cents")
      .eq("advertiser_id", userId);

    if (!campaigns || campaigns.length === 0) {
      res.json({
        totalImpressions: 0,
        totalClicks: 0,
        ctr: "0.00%",
        totalSpendCents: 0,
        totalSpendDisplay: "$0.00",
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

    const totalSpendCents = campaigns.reduce((sum, c) => {
      const delivered = c.total_impressions - c.remaining_impressions;
      return sum + Math.round((delivered * (c.cpm_cents || 0)) / 1000);
    }, 0);

    const activeCampaigns = campaigns.filter(
      (c) => c.status === "active"
    ).length;

    res.json({
      totalImpressions,
      totalClicks,
      ctr,
      totalSpendCents,
      totalSpendDisplay: formatCents(totalSpendCents),
      activeCampaigns,
    });
  } catch (err) {
    console.error("[Advertiser] Stats error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

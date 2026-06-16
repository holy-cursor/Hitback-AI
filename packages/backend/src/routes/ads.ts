import { Router, Request, Response } from "express";
import { isSupabaseConfigured, getSupabase } from "../lib/supabase";
import { resolveAuthUserId } from "../lib/resolveUser";
import { getExtensionUserId } from "../lib/extensionUser";
import { issueServeTokens } from "../lib/serveToken";
import {
  HOURLY_SERVE_LIMIT,
  RateLimitError,
  countRecentServes,
  isFraudFlagged,
} from "../lib/rateLimit";
import {
  PACING_MAX_SHARE,
  PACING_WINDOW_MS,
  applyPacingCap,
  pickWeightedByCpm,
} from "../lib/adSelection";

const router = Router();

interface DemoAd {
  id: string;
  text: string;
  url: string;
  cpm_cents: number;
}

/** Demo ads only when Supabase is not configured (local dev). */
const DEMO_ADS: DemoAd[] = [
  {
    id: "demo-1",
    text: "Try Acme Pro — 50% off today",
    url: "https://example.com/acme-pro",
    cpm_cents: 2000,
  },
  {
    id: "demo-2",
    text: "Ship faster with Turbo CI/CD",
    url: "https://example.com/turbo-cicd",
    cpm_cents: 1000,
  },
  {
    id: "demo-3",
    text: "DevTools Premium — free trial",
    url: "https://example.com/devtools",
    cpm_cents: 1000,
  },
];

interface ActiveCampaign {
  id: string;
  ad_text: string;
  ad_url: string;
  ad_image_url: string | null;
  cpm_cents: number;
  remaining_impressions: number;
}

async function fetchRecentImpressionCounts(
  campaignIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (campaignIds.length === 0) {
    return counts;
  }

  const sb = getSupabase();
  const windowStart = new Date(Date.now() - PACING_WINDOW_MS).toISOString();

  const { data, error } = await sb
    .from("impressions")
    .select("campaign_id")
    .in("campaign_id", campaignIds)
    .gte("shown_at", windowStart);

  if (error) {
    console.error("[Ads] Pacing impression query error:", error.message);
    throw new Error("Failed to load pacing data");
  }

  for (const row of data || []) {
    counts.set(row.campaign_id, (counts.get(row.campaign_id) || 0) + 1);
  }

  return counts;
}

function selectCampaign(campaigns: ActiveCampaign[], impressionCounts: Map<string, number>) {
  const paced = applyPacingCap(campaigns, impressionCounts, PACING_MAX_SHARE);
  const picked = pickWeightedByCpm(paced);
  const totalRecent = campaigns.reduce(
    (sum, campaign) => sum + (impressionCounts.get(campaign.id) || 0),
    0
  );

  return { picked, paced, totalRecent };
}

async function attachServeTokens(
  req: Request,
  res: Response,
  ad: { id: string; text: string; url: string; imageUrl?: string }
): Promise<void> {
  const extensionUserId = getExtensionUserId(req);
  if (!extensionUserId) {
    res.status(400).json({
      error: "Missing X-HitBack-User-Id header (anonymous install ID)",
    });
    return;
  }

  const authUserId = await resolveAuthUserId(req);

  if (isSupabaseConfigured() && !authUserId) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }

  if (isSupabaseConfigured()) {
    if (await isFraudFlagged(extensionUserId)) {
      res.status(403).json({ error: "Access restricted" });
      return;
    }

    const recentServes = await countRecentServes({
      authUserId,
      extensionUserId,
    });

    if (recentServes >= HOURLY_SERVE_LIMIT) {
      res.status(429).json({ error: "Serve rate limit exceeded" });
      return;
    }
  }

  const tokens = await issueServeTokens({
    campaignId: ad.id,
    extensionUserId,
    authUserId,
  });

  res.json({
    ...ad,
    impressionToken: tokens.impressionToken,
    clickToken: tokens.clickToken,
  });
}

/**
 * GET /api/ads/current
 * Returns an active ad with signed single-use impression/click tokens.
 * Requires authentication when Supabase is configured.
 */
router.get("/current", async (req: Request, res: Response) => {
  if (isSupabaseConfigured()) {
    try {
      const sb = getSupabase();

      const { data: campaigns, error } = await sb
        .from("campaigns")
        .select("id, ad_text, ad_url, ad_image_url, cpm_cents, remaining_impressions")
        .eq("status", "active")
        .gt("remaining_impressions", 0)
        .gt("cpm_cents", 0);

      if (error) {
        console.error("[Ads] Supabase query error:", error.message);
        res.status(503).json({ error: "Failed to load campaigns" });
        return;
      }

      if (!campaigns || campaigns.length === 0) {
        console.log("[Ads] No active campaigns available");
        res.status(503).json({ error: "No ads available" });
        return;
      }

      const impressionCounts = await fetchRecentImpressionCounts(
        campaigns.map((campaign) => campaign.id)
      );
      const { picked, paced, totalRecent } = selectCampaign(campaigns, impressionCounts);

      if (!picked) {
        res.status(503).json({ error: "No ads available" });
        return;
      }

      const pickedShare =
        totalRecent > 0
          ? ((impressionCounts.get(picked.id) || 0) / totalRecent) * 100
          : 0;

      console.log(
        `[Ads] Served campaign: "${picked.ad_text}" (id: ${picked.id}, CPM: ${picked.cpm_cents}¢, ` +
          `remaining: ${picked.remaining_impressions}, pool: ${paced.length}/${campaigns.length}, ` +
          `recent share: ${pickedShare.toFixed(1)}%)`
      );

      await attachServeTokens(req, res, {
        id: picked.id,
        text: picked.ad_text,
        url: picked.ad_url,
        imageUrl: picked.ad_image_url || undefined,
      });
      return;
    } catch (err) {
      if (err instanceof RateLimitError) {
        res.status(503).json({ error: err.message });
        return;
      }
      console.error("[Ads] Unexpected Supabase error:", err);
      res.status(503).json({ error: "Failed to serve ad" });
      return;
    }
  }

  // Demo mode only — no Supabase
  const ad = pickWeightedByCpm(DEMO_ADS);
  if (!ad) {
    res.status(503).json({ error: "No ads available" });
    return;
  }

  console.log(`[Ads] Served demo ad: "${ad.text}" (id: ${ad.id}, CPM: ${ad.cpm_cents}¢)`);

  try {
    await attachServeTokens(req, res, {
      id: ad.id,
      text: ad.text,
      url: ad.url,
    });
  } catch (err) {
    console.error("[Ads] Failed to issue demo serve tokens:", err);
    res.status(500).json({ error: "Failed to issue serve tokens" });
  }
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
      .select("ad_text, cpm_cents, total_impressions, remaining_impressions, status")
      .eq("status", "active")
      .gt("remaining_impressions", 0)
      .order("cpm_cents", { ascending: false })
      .limit(5);

    if (error) {
      console.error("[Ads] Queue query error:", error.message);
      res.status(503).json({ error: "Failed to fetch queue" });
      return;
    }

    res.json({ campaigns: campaigns || [] });
  } catch (err) {
    console.error("[Ads] Queue error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

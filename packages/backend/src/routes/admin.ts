import { Router, Request, Response } from "express";
import { requireAdmin } from "../middleware/requireAdmin";
import { isSupabaseConfigured, getSupabase } from "../lib/supabase";

const router = Router();

/**
 * POST /api/admin/detect-anomalies
 *
 * Requires X-Admin-Key header matching ADMIN_API_KEY env var.
 */
router.post("/detect-anomalies", requireAdmin, async (_req: Request, res: Response) => {
  if (!isSupabaseConfigured()) {
    res.status(503).json({ error: "Auth not available" });
    return;
  }

  try {
    const sb = getSupabase();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // 1. Fetch all impressions in the last 24 hours
    const { data: recentImpressions, error: fetchError } = await sb
      .from("impressions")
      .select("extension_user_id, auth_user_id")
      .gte("shown_at", oneDayAgo);

    if (fetchError || !recentImpressions) {
      res.status(500).json({ error: "Failed to fetch impressions" });
      return;
    }

    if (recentImpressions.length === 0) {
      res.json({ success: true, flagged_users: 0, message: "No recent activity." });
      return;
    }

    // 2. Count impressions per identity (auth user when logged in, else install ID)
    const userCounts: Record<string, number> = {};
    for (const imp of recentImpressions) {
      const identity = imp.auth_user_id
        ? `auth:${imp.auth_user_id}`
        : `anon:${imp.extension_user_id}`;
      userCounts[identity] = (userCounts[identity] || 0) + 1;
    }

    // 3. Calculate Global Average
    const userIds = Object.keys(userCounts);
    const totalImpressions = recentImpressions.length;
    const globalAverage = totalImpressions / userIds.length;
    
    // Threshold is 3x the average (with a minimum floor to avoid flagging during slow periods)
    const THRESHOLD = Math.max(globalAverage * 3, 50);

    const anomalousUsers = userIds.filter(id => userCounts[id] >= THRESHOLD);

    // 4. Flag the users
    let flaggedCount = 0;
    for (const identity of anomalousUsers) {
      const extensionUserId = identity.startsWith("anon:")
        ? identity.slice(5)
        : identity;

      const { error: flagError } = await sb.from("fraud_flags").insert({
        extension_user_id: extensionUserId,
        reason: `Identity ${identity} generated ${userCounts[identity]} impressions in 24h. Global avg was ${globalAverage.toFixed(1)}.`,
      });

      if (flagError) {
        console.error(`[Admin] Failed to flag user ${identity}:`, flagError.message);
      } else {
        flaggedCount++;
      }
    }

    res.json({
      success: true,
      global_average: globalAverage,
      threshold_used: THRESHOLD,
      total_active_users: userIds.length,
      flagged_users: flaggedCount
    });

  } catch (err) {
    console.error("[Admin] Anomaly detection error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

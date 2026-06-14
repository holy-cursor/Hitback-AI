import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { isStripeConfigured, getStripe } from "../lib/stripe";
import { isSupabaseConfigured, getSupabase } from "../lib/supabase";
import { getPortalUrl } from "../lib/portalUrl";

const router = Router();

/**
 * POST /api/payouts/connect-onboard
 * Creates a Stripe Connect onboarding link for developers to receive payouts.
 * Requires authentication.
 */
router.post("/connect-onboard", requireAuth, async (req: Request, res: Response) => {
  if (!isStripeConfigured() || !isSupabaseConfigured()) {
    res.status(503).json({ error: "Stripe/Supabase not configured" });
    return;
  }

  try {
    const stripe = getStripe();
    const sb = getSupabase();
    const userId = req.user!.id;
    const portalUrl = getPortalUrl();

    // Check if user already has a Connect account
    const { data: profile } = await sb
      .from("user_profiles")
      .select("stripe_connect_id")
      .eq("id", userId)
      .single();

    let connectId = profile?.stripe_connect_id;

    if (!connectId) {
      // Create a new Connect Express account
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        email: req.user!.email,
        capabilities: {
          transfers: { requested: true },
        },
        metadata: { hitback_user_id: userId },
      });
      connectId = account.id;

      // Save to profile
      await sb
        .from("user_profiles")
        .update({ stripe_connect_id: connectId })
        .eq("id", userId);
    }

    // Create an onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: connectId,
      refresh_url: `${portalUrl}/developer.html?connect=refresh`,
      return_url: `${portalUrl}/developer.html?connect=success`,
      type: "account_onboarding",
    });

    console.log(`[Payouts] Onboarding link created for user ${userId}`);
    res.json({ onboardingUrl: accountLink.url });
  } catch (err) {
    console.error("[Payouts] Onboarding error:", err);
    const message = err instanceof Error ? err.message : "Failed to create onboarding link";
    if (message.includes("signed up for Connect")) {
      res.status(503).json({
        error: "Stripe Connect is not enabled on your platform account yet.",
        action: "Open dashboard.stripe.com/connect, complete setup (Express accounts), then try again.",
      });
      return;
    }
    res.status(500).json({ error: message || "Failed to create onboarding link" });
  }
});

/**
 * GET /api/payouts/dashboard
 * Developer earnings portal: balance, stats, recent activity, Stripe status.
 */
router.get("/dashboard", requireAuth, async (req: Request, res: Response) => {
  if (!isSupabaseConfigured()) {
    res.status(503).json({ error: "Supabase not configured" });
    return;
  }

  try {
    const sb = getSupabase();
    const userId = req.user!.id;

    const { data: profile } = await sb
      .from("user_profiles")
      .select("stripe_connect_id")
      .eq("id", userId)
      .single();

    const { data: earnings, error } = await sb
      .from("earnings")
      .select("amount_cents, source, created_at")
      .eq("developer_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Payouts] Dashboard query error:", error.message);
      res.status(500).json({ error: "Failed to fetch dashboard" });
      return;
    }

    const rows = earnings || [];
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const balanceCents = rows.reduce((sum, e) => sum + e.amount_cents, 0);
    const monthCents = rows
      .filter((e) => e.created_at >= monthStart)
      .reduce((sum, e) => sum + e.amount_cents, 0);
    const totalImpressions = rows.filter((e) => e.source === "impression").length;

    res.json({
      balanceCents,
      balanceDisplay: `$${(balanceCents / 100).toFixed(2)}`,
      monthEarningsCents: monthCents,
      monthEarningsDisplay: `$${(monthCents / 100).toFixed(2)}`,
      totalImpressions,
      lifetimeEarningsCents: balanceCents,
      lifetimeEarningsDisplay: `$${(balanceCents / 100).toFixed(2)}`,
      payoutMinimumCents: 1000,
      canWithdraw: balanceCents >= 1000,
      stripeConnected: !!profile?.stripe_connect_id,
      recentEarnings: rows.slice(0, 15).map((e) => ({
        amountCents: e.amount_cents,
        amountDisplay: `$${(e.amount_cents / 100).toFixed(2)}`,
        source: e.source,
        createdAt: e.created_at,
      })),
    });
  } catch (err) {
    console.error("[Payouts] Dashboard error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/payouts/balance
 * Returns the developer's current earnings balance.
 * Requires authentication.
 */
router.get("/balance", requireAuth, async (req: Request, res: Response) => {
  if (!isSupabaseConfigured()) {
    res.status(503).json({ error: "Supabase not configured" });
    return;
  }

  try {
    const sb = getSupabase();
    const userId = req.user!.id;

    // Sum all earnings for this developer
    const { data: earnings, error } = await sb
      .from("earnings")
      .select("amount_cents")
      .eq("developer_id", userId);

    if (error) {
      console.error("[Payouts] Balance query error:", error.message);
      res.status(500).json({ error: "Failed to fetch balance" });
      return;
    }

    const totalCents = (earnings || []).reduce(
      (sum, e) => sum + e.amount_cents,
      0
    );

    res.json({
      balanceCents: totalCents,
      balanceDisplay: `$${(totalCents / 100).toFixed(2)}`,
      payoutMinimumCents: 1000, // $10 minimum
      canWithdraw: totalCents >= 1000,
    });
  } catch (err) {
    console.error("[Payouts] Balance error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/payouts/withdraw
 * Triggers a payout to the developer's Stripe Connect account.
 * Minimum $10 balance required.
 * Requires authentication.
 */
router.post("/withdraw", requireAuth, async (req: Request, res: Response) => {
  if (!isStripeConfigured() || !isSupabaseConfigured()) {
    res.status(503).json({ error: "Stripe/Supabase not configured" });
    return;
  }

  try {
    const stripe = getStripe();
    const sb = getSupabase();
    const userId = req.user!.id;

    // Check Connect account
    const { data: profile } = await sb
      .from("user_profiles")
      .select("stripe_connect_id")
      .eq("id", userId)
      .single();

    if (!profile?.stripe_connect_id) {
      res.status(400).json({ error: "Connect account not set up. Complete onboarding first." });
      return;
    }

    // Calculate balance
    const { data: earnings } = await sb
      .from("earnings")
      .select("amount_cents")
      .eq("developer_id", userId);

    const totalCents = (earnings || []).reduce(
      (sum, e) => sum + e.amount_cents,
      0
    );

    if (totalCents < 1000) {
      res.status(400).json({
        error: `Minimum withdrawal is $10.00. Current balance: $${(totalCents / 100).toFixed(2)}`,
      });
      return;
    }

    // Create a transfer to the Connect account
    const transfer = await stripe.transfers.create({
      amount: totalCents,
      currency: "usd",
      destination: profile.stripe_connect_id,
      metadata: { hitback_user_id: userId },
    });

    // Zero out earnings (in production, use a ledger/payout table instead)
    await sb
      .from("earnings")
      .delete()
      .eq("developer_id", userId);

    console.log(
      `[Payouts] Transfer of $${(totalCents / 100).toFixed(2)} to ${profile.stripe_connect_id}`
    );

    res.json({
      success: true,
      transferId: transfer.id,
      amountCents: totalCents,
      amountDisplay: `$${(totalCents / 100).toFixed(2)}`,
    });
  } catch (err) {
    console.error("[Payouts] Withdraw error:", err);
    res.status(500).json({ error: "Failed to process payout" });
  }
});

export default router;

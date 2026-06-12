import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { isStripeConfigured, getStripe, IMPRESSION_TIERS } from "../lib/stripe";
import { isSupabaseConfigured, getSupabase } from "../lib/supabase";

const router = Router();

/**
 * GET /api/billing/tiers
 * Returns available impression block pricing tiers.
 * Public endpoint (no auth required).
 */
router.get("/tiers", (_req: Request, res: Response) => {
  res.json({
    tiers: IMPRESSION_TIERS.map((t) => ({
      impressions: t.impressions,
      priceCents: t.priceCents,
      priceDisplay: `$${(t.priceCents / 100).toFixed(2)}`,
      label: t.label,
    })),
  });
});

/**
 * POST /api/billing/checkout
 * Creates a Stripe Checkout session for purchasing impression blocks.
 *
 * Body: { campaignId: string, tierIndex: number }
 * Requires authentication.
 */
router.post("/checkout", requireAuth, async (req: Request, res: Response) => {
  if (!isStripeConfigured()) {
    res.status(503).json({ error: "Stripe not configured" });
    return;
  }

  const { campaignId, tierIndex } = req.body;

  if (!campaignId || tierIndex === undefined) {
    res.status(400).json({ error: "Missing campaignId or tierIndex" });
    return;
  }

  const tier = IMPRESSION_TIERS[tierIndex];
  if (!tier) {
    res.status(400).json({ error: "Invalid tier" });
    return;
  }

  try {
    const stripe = getStripe();
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3001/portal";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: req.user?.email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: tier.priceCents,
            product_data: {
              name: `HitBack ${tier.label}`,
              description: `${tier.impressions.toLocaleString()} ad impressions for your campaign`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        campaignId,
        impressions: tier.impressions.toString(),
        userId: req.user?.id || "",
      },
      success_url: `${frontendUrl}/dashboard.html?checkout=success&campaign=${campaignId}`,
      cancel_url: `${frontendUrl}/dashboard.html?checkout=cancelled`,
    });

    console.log(
      `[Billing] Checkout created: ${tier.label} for campaign ${campaignId}`
    );

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error("[Billing] Checkout error:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

/**
 * GET /api/billing/portal
 * Creates a Stripe Billing Portal session for managing payments.
 * Requires authentication.
 */
router.get("/portal", requireAuth, async (req: Request, res: Response) => {
  if (!isStripeConfigured() || !isSupabaseConfigured()) {
    res.status(503).json({ error: "Stripe/Supabase not configured" });
    return;
  }

  try {
    const sb = getSupabase();
    const stripe = getStripe();

    // Get or create Stripe customer
    const { data: profile } = await sb
      .from("user_profiles")
      .select("stripe_customer_id")
      .eq("id", req.user!.id)
      .single();

    if (!profile?.stripe_customer_id) {
      res.status(400).json({ error: "No Stripe customer found. Complete a purchase first." });
      return;
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${process.env.FRONTEND_URL || "http://localhost:3001/portal"}/dashboard.html`,
    });

    res.json({ portalUrl: portalSession.url });
  } catch (err) {
    console.error("[Billing] Portal error:", err);
    res.status(500).json({ error: "Failed to create portal session" });
  }
});

export default router;

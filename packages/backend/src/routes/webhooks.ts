import { Router, Request, Response } from "express";
import { isStripeConfigured, getStripe } from "../lib/stripe";
import { isSupabaseConfigured, getSupabase } from "../lib/supabase";

const router = Router();

/**
 * POST /api/webhooks/stripe
 * Handles Stripe webhook events.
 *
 * IMPORTANT: This route must use express.raw() middleware, NOT express.json().
 * The raw body is required for signature verification.
 */
router.post("/stripe", async (req: Request, res: Response) => {
  if (!isStripeConfigured()) {
    res.status(503).json({ error: "Stripe not configured" });
    return;
  }

  const stripe = getStripe();
  const sig = req.headers["stripe-signature"] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("[Webhooks] STRIPE_WEBHOOK_SECRET not configured");
    res.status(500).json({ error: "Webhook secret not configured" });
    return;
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Webhooks] Signature verification failed:", message);
    res.status(400).json({ error: `Webhook Error: ${message}` });
    return;
  }

  console.log(`[Webhooks] Received event: ${event.type}`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        await handleCheckoutComplete(event.data.object);
        break;
      }

      case "account.updated": {
        const account = event.data.object;
        console.log(
          `[Webhooks] Connect account updated: ${account.id} (charges_enabled: ${account.charges_enabled})`
        );
        break;
      }

      default:
        console.log(`[Webhooks] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[Webhooks] Error handling ${event.type}:`, message);
    res.status(500).json({ error: "Webhook handler failed" });
    return;
  }

  res.json({ received: true });
});

/**
 * Handle checkout.session.completed — activate the campaign and credit impressions.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleCheckoutComplete(session: any): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase not configured — cannot activate campaign");
  }

  const campaignId = session.metadata?.campaignId;
  const impressions = parseInt(session.metadata?.impressions || "0", 10);
  const userId = session.metadata?.userId;

  if (!campaignId || !impressions) {
    throw new Error("Missing campaignId or impressions in checkout session metadata");
  }

  const sb = getSupabase();

  const { error } = await sb
    .from("campaigns")
    .update({
      status: "active",
      total_impressions: impressions,
      remaining_impressions: impressions,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);

  if (error) {
    throw new Error(`Campaign activation failed: ${error.message}`);
  }

  if (session.customer && userId) {
    const { error: profileError } = await sb
      .from("user_profiles")
      .update({ stripe_customer_id: session.customer as string })
      .eq("id", userId);

    if (profileError) {
      console.error("[Webhooks] Profile stripe_customer_id update error:", profileError.message);
    }
  }

  console.log(
    `[Webhooks] Campaign ${campaignId} activated with ${impressions.toLocaleString()} impressions`
  );
}

export default router;

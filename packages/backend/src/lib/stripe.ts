import Stripe from "stripe";

/**
 * Singleton Stripe client for the HitBack backend.
 * Uses STRIPE_SECRET_KEY from environment.
 */

let _stripe: InstanceType<typeof Stripe> | null = null;

/**
 * Returns true if Stripe is configured in the environment.
 */
export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/**
 * Get the Stripe client. Throws if not configured.
 */
export function getStripe(): InstanceType<typeof Stripe> {
  if (_stripe) {
    return _stripe;
  }

  const key = process.env.STRIPE_SECRET_KEY;

  if (!key) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY in .env");
  }

  _stripe = new Stripe(key);

  return _stripe;
}

/**
 * Impression block pricing tiers.
 */
export const IMPRESSION_TIERS = [
  { impressions: 1_000, priceCents: 500, label: "1K Impressions" },
  { impressions: 5_000, priceCents: 2_000, label: "5K Impressions" },
  { impressions: 10_000, priceCents: 3_500, label: "10K Impressions" },
  { impressions: 50_000, priceCents: 15_000, label: "50K Impressions" },
] as const;

import { getSupabase } from "./supabase";

export const HOURLY_IMPRESSION_LIMIT = 30;
export const HOURLY_SERVE_LIMIT = 30;
export const HOURLY_CLICK_LIMIT = 60;

const ONE_HOUR_MS = 60 * 60 * 1000;

function oneHourAgo(): string {
  return new Date(Date.now() - ONE_HOUR_MS).toISOString();
}

export interface RateLimitIdentity {
  authUserId?: string | null;
  extensionUserId: string;
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

/**
 * Count recorded impressions in the last hour for rate limiting.
 * Authenticated users are keyed on auth_user_id (not rotatable extensionUserId).
 */
export async function countRecentImpressions(identity: RateLimitIdentity): Promise<number> {
  const sb = getSupabase();
  const since = oneHourAgo();

  if (identity.authUserId) {
    const { count, error } = await sb
      .from("impressions")
      .select("*", { count: "exact", head: true })
      .eq("auth_user_id", identity.authUserId)
      .gte("shown_at", since);

    if (error) {
      console.error("[RateLimit] Auth impression count error:", error.message);
      throw new RateLimitError("Failed to check impression rate limit");
    }
    return count ?? 0;
  }

  const { count, error } = await sb
    .from("impressions")
    .select("*", { count: "exact", head: true })
    .eq("extension_user_id", identity.extensionUserId)
    .is("auth_user_id", null)
    .gte("shown_at", since);

  if (error) {
    console.error("[RateLimit] Anonymous impression count error:", error.message);
    throw new RateLimitError("Failed to check impression rate limit");
  }
  return count ?? 0;
}

/** Count serve-token issuances in the last hour (prevents token farming). */
export async function countRecentServes(identity: RateLimitIdentity): Promise<number> {
  const sb = getSupabase();
  const since = oneHourAgo();

  if (identity.authUserId) {
    const { count, error } = await sb
      .from("serve_tokens")
      .select("*", { count: "exact", head: true })
      .eq("auth_user_id", identity.authUserId)
      .gte("created_at", since);

    if (error) {
      console.error("[RateLimit] Auth serve count error:", error.message);
      throw new RateLimitError("Failed to check serve rate limit");
    }
    return count ?? 0;
  }

  const { count, error } = await sb
    .from("serve_tokens")
    .select("*", { count: "exact", head: true })
    .eq("extension_user_id", identity.extensionUserId)
    .is("auth_user_id", null)
    .gte("created_at", since);

  if (error) {
    console.error("[RateLimit] Anonymous serve count error:", error.message);
    throw new RateLimitError("Failed to check serve rate limit");
  }
  return count ?? 0;
}

export async function countRecentClicks(identity: RateLimitIdentity): Promise<number> {
  const sb = getSupabase();
  const since = oneHourAgo();

  if (identity.authUserId) {
    const { count, error } = await sb
      .from("clicks")
      .select("*", { count: "exact", head: true })
      .eq("auth_user_id", identity.authUserId)
      .gte("clicked_at", since);

    if (error) {
      console.error("[RateLimit] Auth click count error:", error.message);
      throw new RateLimitError("Failed to check click rate limit");
    }
    return count ?? 0;
  }

  const { count, error } = await sb
    .from("clicks")
    .select("*", { count: "exact", head: true })
    .eq("extension_user_id", identity.extensionUserId)
    .is("auth_user_id", null)
    .gte("clicked_at", since);

  if (error) {
    console.error("[RateLimit] Anonymous click count error:", error.message);
    throw new RateLimitError("Failed to check click rate limit");
  }
  return count ?? 0;
}

/** Fail closed: block on DB error rather than allowing traffic through. */
export async function isFraudFlagged(extensionUserId: string): Promise<boolean> {
  const sb = getSupabase();
  const { count, error } = await sb
    .from("fraud_flags")
    .select("*", { count: "exact", head: true })
    .eq("extension_user_id", extensionUserId)
    .eq("is_resolved", false);

  if (error) {
    console.error("[RateLimit] Fraud flag check error:", error.message);
    throw new RateLimitError("Failed to check fraud status");
  }
  return (count ?? 0) > 0;
}

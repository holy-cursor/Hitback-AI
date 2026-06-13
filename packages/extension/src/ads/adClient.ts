import { Ad } from "./types";

/**
 * HTTP client for the HitBack ad backend.
 * Handles fetching ads, reporting impressions, and reporting clicks.
 */

/** Timeout for all backend requests (ms). */
const REQUEST_TIMEOUT_MS = 3000;

/**
 * Fetch the current ad from the backend.
 * Returns null if the request fails or no ad is available.
 */
/** Shown when the backend is unreachable (matches backend demo ads). */
export const OFFLINE_FALLBACK_AD: Ad = {
  id: "offline-demo",
  text: "Try Acme Pro — 50% off today",
  url: "https://example.com/acme-pro",
};

export async function fetchCurrentAd(backendUrl: string, token?: string): Promise<Ad | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const headers: Record<string, string> = { "Accept": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(`${backendUrl}/api/ads/current`, {
      signal: controller.signal,
      headers,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as Ad;

    if (!data || !data.id || !data.text || !data.url) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Report an ad impression to the backend.
 * Fire-and-forget — errors are silently ignored.
 */
export async function reportImpression(
  backendUrl: string,
  campaignId: string,
  extensionUserId: string,
  token?: string
): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    await fetch(`${backendUrl}/api/impressions`, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify({ campaignId, extensionUserId }),
    });

    clearTimeout(timeout);
  } catch {
    // Fire and forget
  }
}

/**
 * Report an ad click to the backend.
 * Fire-and-forget — errors are silently ignored.
 */
export async function reportClick(
  backendUrl: string,
  adId: string,
  extensionUserId?: string,
  token?: string
): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    await fetch(`${backendUrl}/api/clicks`, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify({ adId, extensionUserId }),
    });

    clearTimeout(timeout);
  } catch {
    // Fire and forget
  }
}

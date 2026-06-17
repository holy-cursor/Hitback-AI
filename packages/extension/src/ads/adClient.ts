import { Ad } from "./types";

/**
 * HTTP client for the HitBack ad backend.
 * Handles fetching ads, reporting impressions, and reporting clicks.
 */

/** Timeout for ad fetch (backend can be slow on cold start). */
const FETCH_TIMEOUT_MS = 20_000;
const REPORT_TIMEOUT_MS = 5_000;

/** Header carrying the persistent anonymous install ID. */
const USER_ID_HEADER = "X-HitBack-User-Id";

export interface FetchAdResult {
  ad: Ad | null;
  error?: string;
}

export interface ReportResult {
  ok: boolean;
  error?: string;
}

export async function fetchCurrentAd(
  backendUrl: string,
  extensionUserId: string,
  token?: string
): Promise<FetchAdResult> {
  const url = `${backendUrl.replace(/\/$/, "")}/api/ads/current`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const headers: Record<string, string> = {
      Accept: "application/json",
      [USER_ID_HEADER]: extensionUserId,
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      signal: controller.signal,
      headers,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      let detail = "";
      try {
        const body = (await response.json()) as { error?: string };
        detail = body.error ? `: ${body.error}` : "";
      } catch {
        // ignore parse errors
      }
      return { ad: null, error: `HTTP ${response.status}${detail}` };
    }

    const data = (await response.json()) as Ad;

    if (!data?.id || !data.text || !data.url) {
      return { ad: null, error: "Invalid ad payload from backend" };
    }

    if (!data.impressionToken) {
      return {
        ad: null,
        error: "Backend response missing impressionToken (update the extension)",
      };
    }

    return { ad: data };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return {
        ad: null,
        error: `Request timed out after ${FETCH_TIMEOUT_MS / 1000}s (${url})`,
      };
    }
    return { ad: null, error: `Network error (${url})` };
  }
}

async function postReport(
  path: string,
  backendUrl: string,
  body: Record<string, string>,
  token?: string
): Promise<ReportResult> {
  const url = `${backendUrl.replace(/\/$/, "")}${path}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify(body),
    });

    clearTimeout(timeout);

    if (!response.ok) {
      let detail = "";
      try {
        const payload = (await response.json()) as { error?: string };
        detail = payload.error ? `: ${payload.error}` : "";
      } catch {
        // ignore parse errors
      }
      return { ok: false, error: `HTTP ${response.status}${detail}` };
    }

    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: `Request timed out after ${REPORT_TIMEOUT_MS / 1000}s` };
    }
    return { ok: false, error: `Network error (${url})` };
  }
}

export async function reportImpression(
  backendUrl: string,
  impressionToken: string,
  token?: string
): Promise<ReportResult> {
  return postReport("/api/impressions", backendUrl, { impressionToken }, token);
}

export async function reportClick(
  backendUrl: string,
  clickToken: string,
  token?: string
): Promise<ReportResult> {
  return postReport("/api/clicks", backendUrl, { clickToken }, token);
}

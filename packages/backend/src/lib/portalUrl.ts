/** Base URL for static portal pages (no trailing slash). */
export function getPortalUrl(): string {
  const raw = process.env.FRONTEND_URL || "http://localhost:3001/portal";
  return raw.replace(/\/$/, "");
}

/** Prefer the site origin the user started from (www vs apex) when whitelisted. */
export function resolvePortalUrl(req: { query: Record<string, unknown>; get(name: string): string | undefined }): string {
  const configured = getPortalUrl();
  const allowed = new Set([configured, "https://hitback.xyz", "https://www.hitback.xyz"]);

  const fromQuery = req.query.origin;
  if (typeof fromQuery === "string" && fromQuery) {
    try {
      const origin = new URL(fromQuery).origin;
      if (allowed.has(origin)) return origin;
    } catch {
      /* ignore */
    }
  }

  const referer = req.get("referer");
  if (referer) {
    try {
      const origin = new URL(referer).origin;
      if (allowed.has(origin)) return origin;
    } catch {
      /* ignore */
    }
  }

  return configured;
}

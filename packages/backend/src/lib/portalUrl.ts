/** Base URL for static portal pages (no trailing slash). */
export function getPortalUrl(): string {
  const raw = process.env.FRONTEND_URL || "http://localhost:3001/portal";
  return raw.replace(/\/$/, "");
}

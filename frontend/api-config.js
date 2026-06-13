/** Resolve HitBack API base URL (local, meta tag, or hitback.xyz → api.hitback.xyz). */
function getHitbackApi() {
  const isLocal =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  if (isLocal) return "http://localhost:3001";

  const meta = document.querySelector('meta[name="hitback-api"]')?.getAttribute("content");
  if (meta) return meta.replace(/\/$/, "");

  const host = window.location.hostname;
  if (host === "hitback.xyz" || host === "www.hitback.xyz") {
    return "https://api.hitback.xyz";
  }

  return window.location.origin;
}

/**
 * Bust stale browser cache when the app version changes.
 * Incognito works because it has no cached HTML/CSS; normal tabs often keep old assets
 * even after Ctrl+Shift+R.
 */
(function bustStaleCache() {
  const VERSION = "20260614d";
  const VERSION_KEY = "hitback_app_version";
  const RELOAD_KEY = "hitback_cache_reload";

  if (sessionStorage.getItem(RELOAD_KEY)) {
    sessionStorage.removeItem(RELOAD_KEY);
    localStorage.setItem(VERSION_KEY, VERSION);
    return;
  }

  if (localStorage.getItem(VERSION_KEY) === VERSION) return;

  sessionStorage.setItem(RELOAD_KEY, "1");

  async function clearAndReload() {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    localStorage.setItem(VERSION_KEY, VERSION);
    const url = new URL(window.location.href);
    url.searchParams.set("_v", VERSION);
    window.location.replace(url.toString());
  }

  clearAndReload().catch(() => {
    localStorage.setItem(VERSION_KEY, VERSION);
    const base = window.location.pathname || "/";
    window.location.replace(`${base}?_v=${VERSION}${window.location.hash}`);
  });
})();

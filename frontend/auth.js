/** Token storage for cross-origin auth (hitback.xyz → API). Cookies alone fail in modern browsers. */
const HB_TOKEN_KEY = "hitback_access_token";

function getAuthToken() {
  try {
    return localStorage.getItem(HB_TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveAuthToken(token) {
  if (!token) return;
  try {
    localStorage.setItem(HB_TOKEN_KEY, token);
  } catch {
    /* private browsing */
  }
}

function clearAuthToken() {
  try {
    localStorage.removeItem(HB_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** Authenticated fetch — sends Bearer token when available. */
function apiFetch(path, options = {}) {
  const api = typeof getHitbackApi === "function" ? getHitbackApi() : "";
  const headers = { ...(options.headers || {}) };
  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return fetch(`${api}${path}`, {
    ...options,
    credentials: "include",
    headers,
  });
}

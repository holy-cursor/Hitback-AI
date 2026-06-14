/** Send Supabase OAuth / email-confirm params to auth-callback (Site URL is often index.html). */
(function redirectAuthParams() {
  const query = new URLSearchParams(window.location.search);
  const hash = window.location.hash.substring(1);
  const hashParams = new URLSearchParams(hash);

  const hasQueryAuth =
    query.has("token_hash") ||
    query.has("code") ||
    (query.has("type") && (query.has("token_hash") || query.has("access_token")));
  const hasHashAuth =
    hashParams.has("access_token") ||
    hashParams.has("refresh_token") ||
    hashParams.has("error") ||
    hashParams.has("error_description");

  if (!hasQueryAuth && !hasHashAuth) return;

  const dest =
    "auth-callback.html" +
    window.location.search +
    window.location.hash;
  window.location.replace(dest);
})();

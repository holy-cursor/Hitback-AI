/** Vercel Web Analytics — static HTML (no Next.js). Enable in Vercel project → Analytics. */
(function initVercelAnalytics() {
  window.va = window.va || function () {
    (window.vaq = window.vaq || []).push(arguments);
  };
  if (document.querySelector('script[data-vercel-analytics]')) return;
  const script = document.createElement("script");
  script.defer = true;
  script.src = "/_vercel/insights/script.js";
  script.setAttribute("data-vercel-analytics", "1");
  document.head.appendChild(script);
})();

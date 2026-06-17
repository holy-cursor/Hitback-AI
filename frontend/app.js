/**
 * HitBack Unified Landing App
 * Handles Auth, Developer Earnings, Advertiser Campaigns, and Live Queue
 */

// API URL — see api-config.js (loaded before this script on index.html)
const API = typeof getHitbackApi === "function" ? getHitbackApi() : window.location.origin;

let currentUser = null;
let selectedTierIndex = 0;
let tiers = [];
let signInModalMode = "signin";

function getPage() {
  return document.body.dataset.page || "home";
}

function toggleNavMenu() {
  const menu = document.getElementById("nav-menu");
  const toggle = document.getElementById("nav-toggle");
  if (!menu || !toggle) return;
  const open = menu.classList.toggle("is-open");
  toggle.classList.toggle("is-open", open);
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  document.body.classList.toggle("nav-open", open);
}

function closeNavMenu() {
  const menu = document.getElementById("nav-menu");
  const toggle = document.getElementById("nav-toggle");
  if (!menu || !toggle) return;
  menu.classList.remove("is-open");
  toggle.classList.remove("is-open");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", "Open menu");
  document.body.classList.remove("nav-open");
}

document.addEventListener("click", (event) => {
  const menu = document.getElementById("nav-menu");
  const toggle = document.getElementById("nav-toggle");
  if (!menu?.classList.contains("is-open")) return;
  if (menu.contains(event.target) || toggle?.contains(event.target)) return;
  closeNavMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeNavMenu();
});

document.addEventListener("click", (event) => {
  const link = event.target.closest(".nav-pages .nav-link");
  if (link) closeNavMenu();
});

// ── Init ─────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  const page = getPage();

  if (page === "advertiser") {
    checkPendingCheckout();
  }

  await checkAuth();

  if (page === "home") {
    startQueuePolling();
  } else if (page === "advertiser") {
    checkCheckoutReturn();
    await loadTiers();
    updateAdPreview();
    await maybeResumeCheckout();
  } else if (page === "developer") {
    checkConnectReturn();
  }
});

// ── Auth ─────────────────────────────────────────────────────

async function checkAuth() {
  try {
    const res = await apiFetch("/auth/me");
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      setupLoggedInState();
    } else {
      if (res.status === 401) clearAuthToken();
      setupLoggedOutState();
    }
  } catch {
    setupLoggedOutState();
  }
}

function handleLogin() {
  saveFormState();
  openSignInModal();
}

function openSignInModal() {
  const modal = document.getElementById("signin-modal");
  const errorEl = document.getElementById("signin-error");
  if (errorEl) {
    errorEl.style.display = "none";
    errorEl.style.color = "";
    errorEl.textContent = "";
  }
  if (modal) {
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    setSignInModalMode("signin");
    document.getElementById("signin-email")?.focus();
  }
}

function closeSignInModal() {
  const modal = document.getElementById("signin-modal");
  if (modal) {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  }
}

function closeSignInModalOnBackdrop(event) {
  if (event.target.id === "signin-modal") closeSignInModal();
}

function setSignInModalMode(mode) {
  signInModalMode = mode;
  const title = document.getElementById("signin-title");
  const subtitle = document.getElementById("signin-subtitle");
  const submitBtn = document.getElementById("signin-submit-btn");
  const passwordInput = document.getElementById("signin-password");
  const signinTab = document.getElementById("signin-tab-signin");
  const signupTab = document.getElementById("signin-tab-signup");
  const errorEl = document.getElementById("signin-error");

  if (errorEl) {
    errorEl.style.display = "none";
    errorEl.style.color = "";
    errorEl.textContent = "";
  }

  if (signinTab && signupTab) {
    const isSignIn = mode === "signin";
    signinTab.classList.toggle("is-active", isSignIn);
    signupTab.classList.toggle("is-active", !isSignIn);
    signinTab.setAttribute("aria-selected", String(isSignIn));
    signupTab.setAttribute("aria-selected", String(!isSignIn));
  }

  if (title) title.textContent = mode === "signin" ? "Welcome back" : "Create your account";
  if (subtitle) {
    subtitle.textContent = mode === "signin"
      ? "Sign in to track earnings, manage campaigns, and withdraw payouts."
      : "We'll email you a confirmation link before you can sign in.";
  }
  if (submitBtn) submitBtn.textContent = mode === "signin" ? "Sign In" : "Create Account";
  if (passwordInput) {
    passwordInput.autocomplete = mode === "signin" ? "current-password" : "new-password";
  }
}

function handleEmailAuth(event) {
  event.preventDefault();
  if (signInModalMode === "signup") return handleSignUpFromModal();
  return handleEmailSignIn(event);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.getElementById("signin-modal")?.classList.contains("is-open")) {
    closeSignInModal();
  }
});

function handleGoogleSignIn() {
  saveFormState();
  const origin = encodeURIComponent(window.location.origin);
  window.location.href = `${API}/auth/google?origin=${origin}`;
}

function showConfirmationPrompt(message) {
  const errorEl = document.getElementById("signin-error");
  if (!errorEl) return;
  errorEl.style.display = "block";
  errorEl.style.color = "#059669";
  errorEl.innerHTML = `
    ${escapeHtml(message)}
    <button type="button" class="link-btn" style="display:block;margin-top:8px;" onclick="handleResendConfirmation()">Resend confirmation email</button>
  `;
}

async function handleResendConfirmation() {
  const email = document.getElementById("signin-email")?.value.trim();
  const errorEl = document.getElementById("signin-error");
  if (!email) {
    if (errorEl) {
      errorEl.style.display = "block";
      errorEl.style.color = "";
      errorEl.textContent = "Enter your email above, then resend the confirmation link.";
    }
    return;
  }

  try {
    const res = await apiFetch("/auth/resend-confirmation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (res.ok) {
      showConfirmationPrompt(data.message || "Confirmation email sent. Check your inbox and spam folder.");
      showToast("Confirmation email sent", "success");
      setSignInModalMode("signin");
      return;
    }
    if (errorEl) {
      errorEl.style.display = "block";
      errorEl.style.color = "";
      errorEl.textContent = data.error || "Could not resend confirmation email";
    }
  } catch {
    if (errorEl) {
      errorEl.style.display = "block";
      errorEl.style.color = "";
      errorEl.textContent = "Network error. Please try again.";
    }
  }
}

async function handleEmailSignIn(event) {
  event.preventDefault();
  const email = document.getElementById("signin-email")?.value.trim();
  const password = document.getElementById("signin-password")?.value;
  const errorEl = document.getElementById("signin-error");
  const btn = document.getElementById("signin-submit-btn");

  if (!email || !password) return;

  if (btn) btn.disabled = true;
  if (errorEl) errorEl.style.display = "none";

  try {
    const res = await apiFetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      if (errorEl) {
        errorEl.style.color = "";
        if (data.needsConfirmation) {
          showConfirmationPrompt(data.error || "Please confirm your email before signing in.");
        } else {
          errorEl.textContent = data.error || "Sign in failed";
          errorEl.style.display = "block";
        }
      }
      return;
    }

    if (data.accessToken) saveAuthToken(data.accessToken);

    closeSignInModal();
    currentUser = data.user;
    setupLoggedInState();
    showToast(`Welcome back, ${data.user.name || data.user.email}!`, "success");
  } catch {
    if (errorEl) {
      errorEl.textContent = "Network error. Please try again.";
      errorEl.style.display = "block";
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleSignUpFromModal() {
  const email = document.getElementById("signin-email")?.value.trim();
  const password = document.getElementById("signin-password")?.value;
  const errorEl = document.getElementById("signin-error");
  const btn = document.getElementById("signin-submit-btn");

  if (!email || !password) {
    if (errorEl) {
      errorEl.textContent = "Enter an email and password (8+ characters) to create an account.";
      errorEl.style.display = "block";
    }
    return;
  }

  if (btn) btn.disabled = true;
  if (errorEl) errorEl.style.display = "none";

  try {
    const res = await apiFetch("/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      if (errorEl) {
        errorEl.style.color = "";
        errorEl.textContent = data.error || "Could not create account";
        errorEl.style.display = "block";
      }
      return;
    }

    if (data.needsConfirmation) {
      showConfirmationPrompt(
        data.message || "Check your email and click the confirmation link, then sign in."
      );
      showToast("Confirmation email sent", "success");
      setSignInModalMode("signin");
      return;
    }

    if (data.accessToken) saveAuthToken(data.accessToken);

    closeSignInModal();
    currentUser = data.user;
    setupLoggedInState();
    showToast("Account created. You're signed in!", "success");
  } catch {
    if (errorEl) {
      errorEl.textContent = "Network error. Please try again.";
      errorEl.style.display = "block";
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function handleLogout() {
  clearAuthToken();
  apiFetch("/auth/logout", { method: "POST" })
    .finally(() => { window.location.reload(); });
}

function setupLoggedInState() {
  const authSection = document.getElementById("auth-section");
  if (authSection && currentUser) {
    authSection.innerHTML = `
      <div class="user-profile">
        <span>${escapeHtml(currentUser.name || currentUser.email)}</span>
        <button class="logout-btn" onclick="handleLogout()">Sign Out</button>
      </div>
    `;
  }

  const page = getPage();

  if (page === "developer") {
    const loggedOut = document.getElementById("earnings-logged-out");
    const dashboard = document.getElementById("earnings-dashboard");
    if (loggedOut) loggedOut.style.display = "none";
    if (dashboard) dashboard.style.display = "block";
    loadDevDashboard();
  }

  if (page === "advertiser") {
    const advLoggedOut = document.getElementById("advertiser-logged-out");
    const loginHint = document.getElementById("checkout-login-hint");
    if (advLoggedOut) advLoggedOut.style.display = "none";
    if (loginHint) loginHint.style.display = "none";
    loadAdvertiserStats();
    loadActiveCampaigns();
  }
}

function setupLoggedOutState() {
  const page = getPage();

  if (page === "developer") {
    const loggedOut = document.getElementById("earnings-logged-out");
    const dashboard = document.getElementById("earnings-dashboard");
    if (loggedOut) loggedOut.style.display = "block";
    if (dashboard) dashboard.style.display = "none";
  }

  if (page === "advertiser") {
    const advLoggedOut = document.getElementById("advertiser-logged-out");
    const loginHint = document.getElementById("checkout-login-hint");
    const advDashboard = document.getElementById("advertiser-dashboard");
    const campaigns = document.getElementById("advertiser-campaigns");
    if (advLoggedOut) advLoggedOut.style.display = "block";
    if (loginHint) loginHint.style.display = "block";
    if (advDashboard) advDashboard.style.display = "none";
    if (campaigns) campaigns.style.display = "none";
  }
}

// ── Developer Earnings Portal ────────────────────────────────

async function loadDevDashboard() {
  const balanceEl = document.getElementById("earnings-balance");
  const monthEl = document.getElementById("stat-month");
  const impressionsEl = document.getElementById("stat-impressions");
  const lifetimeEl = document.getElementById("stat-lifetime");
  const historyEl = document.getElementById("earnings-history");
  const withdrawBtn = document.getElementById("withdraw-btn");
  const statusEl = document.getElementById("dev-stripe-status");
  const connectBtn = document.getElementById("stripe-connect-btn");

  try {
    const res = await apiFetch("/api/payouts/dashboard");
    if (!res.ok) {
      renderEmptyDashboard();
      return;
    }

    const data = await res.json();

    if (balanceEl) balanceEl.textContent = data.balanceDisplay || "$0.00";
    if (monthEl) monthEl.textContent = data.monthEarningsDisplay || "$0.00";
    if (impressionsEl) impressionsEl.textContent = (data.totalImpressions || 0).toLocaleString();
    if (lifetimeEl) lifetimeEl.textContent = data.lifetimeEarningsDisplay || "$0.00";
    if (withdrawBtn) withdrawBtn.disabled = !data.canWithdraw;

    const manageBtn = document.getElementById("stripe-manage-btn");
    if (statusEl) {
      if (data.stripeConnected) {
        statusEl.textContent = "Payouts active";
        statusEl.className = "status-badge status-success";
        if (connectBtn) connectBtn.style.display = "none";
        if (manageBtn) manageBtn.style.display = "inline-flex";
      } else if (data.stripePending) {
        statusEl.textContent = "Setup incomplete";
        statusEl.className = "status-badge status-warning";
        if (connectBtn) {
          connectBtn.style.display = "inline-flex";
          connectBtn.textContent = "Complete Stripe setup";
        }
        if (manageBtn) manageBtn.style.display = "none";
      } else {
        statusEl.textContent = "Not connected";
        statusEl.className = "status-badge status-warning";
        if (connectBtn) {
          connectBtn.style.display = "inline-flex";
          connectBtn.textContent = "Connect Stripe";
        }
        if (manageBtn) manageBtn.style.display = "none";
      }
    }

    renderEarningsHistory(data.recentEarnings || [], historyEl);
  } catch {
    renderEmptyDashboard();
  }
}

function renderEmptyDashboard() {
  const balanceEl = document.getElementById("earnings-balance");
  if (balanceEl) balanceEl.textContent = "$0.00";
  const monthEl = document.getElementById("stat-month");
  if (monthEl) monthEl.textContent = "$0.00";
  const impressionsEl = document.getElementById("stat-impressions");
  if (impressionsEl) impressionsEl.textContent = "0";
  const lifetimeEl = document.getElementById("stat-lifetime");
  if (lifetimeEl) lifetimeEl.textContent = "$0.00";
  const historyEl = document.getElementById("earnings-history");
  if (historyEl) {
    historyEl.innerHTML = `<div class="earnings-empty">Unable to load earnings. Is the backend running?</div>`;
  }
}

function renderEarningsHistory(entries, container) {
  if (!container) return;

  if (!entries.length) {
    container.innerHTML = `<div class="earnings-empty">No earnings yet. Install the extension and run your AI agent to start earning.</div>`;
    return;
  }

  container.innerHTML = entries.map((e) => {
    const date = new Date(e.createdAt).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    const source = e.source === "impression" ? "Impression" : "Click";
    return `
      <div class="earnings-row">
        <div class="earnings-row-left">
          <span class="earnings-row-amount">${escapeHtml(e.amountDisplay)}</span>
          <span class="earnings-row-source">${source}</span>
        </div>
        <span class="earnings-row-date">${escapeHtml(date)}</span>
      </div>
    `;
  }).join("");
}

async function handleConnectOnboard() {
  const connectBtn = document.getElementById("stripe-connect-btn");
  if (connectBtn) connectBtn.disabled = true;
  try {
    const res = await apiFetch("/api/payouts/connect-onboard", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.onboardingUrl) {
      window.location.href = data.onboardingUrl;
      return;
    }
    if (res.ok && data.alreadyConnected && data.dashboardUrl) {
      window.open(data.dashboardUrl, "_blank", "noopener,noreferrer");
      showToast("Stripe payouts are already connected.", "success");
      await loadDevDashboard();
      return;
    }
    if (res.status === 401) {
      showToast("Sign in first, then connect Stripe.", "error");
      openSignInModal();
      return;
    }
    if (res.status === 503 && data.setupUrl) {
      const msg = [data.error, data.action].filter(Boolean).join(" ");
      showToast(msg, "error");
      window.open(data.setupUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const msg = [data.error, data.action].filter(Boolean).join(" ");
    showToast(msg || "Could not start Stripe setup", "error");
  } catch {
    showToast("Network error", "error");
  } finally {
    if (connectBtn) connectBtn.disabled = false;
  }
}

async function handleStripeManage() {
  try {
    const res = await apiFetch("/api/payouts/connect-onboard", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.dashboardUrl) {
      window.open(data.dashboardUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (res.ok && data.onboardingUrl) {
      window.location.href = data.onboardingUrl;
      return;
    }
    showToast(data.error || "Could not open Stripe dashboard", "error");
  } catch {
    showToast("Network error", "error");
  }
}

async function handleWithdraw() {
  const btn = document.getElementById("withdraw-btn");
  if (btn) btn.disabled = true;
  try {
    const res = await apiFetch("/api/payouts/withdraw", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      showToast(`Withdrawn ${data.amountDisplay} to Stripe!`, "success");
      await loadDevDashboard();
    } else {
      const data = await res.json();
      showToast(data.error || "Withdrawal failed", "error");
    }
  } catch {
    showToast("Network error", "error");
  }
  if (btn) btn.disabled = false;
}

// ── Advertiser Campaigns & Checkout ──────────────────────────

async function loadAdvertiserStats() {
  const dashboard = document.getElementById("advertiser-dashboard");
  if (!dashboard || !currentUser) return;

  try {
    const res = await apiFetch("/api/advertiser/stats");
    if (!res.ok) {
      dashboard.style.display = "none";
      return;
    }

    const data = await res.json();
    const impressionsEl = document.getElementById("adv-stat-impressions");
    const clicksEl = document.getElementById("adv-stat-clicks");
    const ctrEl = document.getElementById("adv-stat-ctr");
    const spendEl = document.getElementById("adv-stat-spend");

    if (impressionsEl) impressionsEl.textContent = (data.totalImpressions || 0).toLocaleString();
    if (clicksEl) clicksEl.textContent = (data.totalClicks || 0).toLocaleString();
    if (ctrEl) ctrEl.textContent = data.ctr || "0.00%";
    if (spendEl) spendEl.textContent = data.totalSpendDisplay || "$0.00";

    dashboard.style.display = "block";
  } catch {
    dashboard.style.display = "none";
  }
}

function campaignStatusBadge(status) {
  const labels = {
    active: "Active",
    paused: "Paused",
    exhausted: "Exhausted",
    draft: "Draft",
  };
  const label = labels[status] || status;
  const cls =
    status === "active" ? "camp-status--active"
    : status === "paused" ? "camp-status--paused"
    : status === "exhausted" ? "camp-status--exhausted"
    : "camp-status--draft";
  return `<span class="camp-status-badge ${cls}">${escapeHtml(label)}</span>`;
}

async function toggleCampaignStatus(campaignId, currentStatus) {
  const nextStatus = currentStatus === "active" ? "paused" : "active";
  const btn = document.querySelector(`[data-campaign-btn="${campaignId}"]`);
  if (btn) btn.disabled = true;

  try {
    const res = await apiFetch(`/api/advertiser/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });

    if (!res.ok) {
      const data = await res.json();
      showToast(data.error || "Could not update campaign", "error");
      return;
    }

    showToast(nextStatus === "paused" ? "Campaign paused" : "Campaign resumed", "success");
    await loadActiveCampaigns();
    await loadAdvertiserStats();
  } catch {
    showToast("Network error", "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loadActiveCampaigns() {
  const container = document.getElementById("advertiser-campaigns");
  const list = document.getElementById("campaigns-list");
  if (!container || !list) return;

  try {
    const res = await apiFetch("/api/advertiser/campaigns");
    if (res.ok) {
      const data = await res.json();
      const campaigns = (data.campaigns || []).filter(
        (c) => c.status === "active" || c.status === "paused" || c.status === "exhausted"
      );

      if (campaigns.length === 0) {
        container.style.display = "none";
        return;
      }

      container.style.display = "block";
      list.innerHTML = campaigns.map((c) => {
        const delivered = c.delivered_impressions ?? ((c.total_impressions || 0) - (c.remaining_impressions || 0));
        const total = c.total_impressions || 0;
        const pct = total ? Math.round((delivered / total) * 100) : 0;
        const clicks = c.click_count ?? 0;
        const ctr = c.ctr || "0.00%";
        const spend = c.spend_display || "$0.00";
        const cpm = c.cpm_cents ? `$${(c.cpm_cents / 100).toFixed(2)}` : "—";
        const imageHtml = c.ad_image_url
          ? `<img class="camp-thumb" src="${escapeHtml(c.ad_image_url)}" alt="">`
          : "";
        const canToggle = c.status === "active" || c.status === "paused";
        const actionLabel = c.status === "active" ? "Pause" : "Resume";
        const actionClass = c.status === "active" ? "btn-secondary" : "btn-blue";

        return `
          <div class="campaign-item">
            ${imageHtml}
            <div class="camp-main">
              <div class="camp-header">
                ${campaignStatusBadge(c.status)}
                <span class="camp-cpm">${escapeHtml(cpm)} CPM</span>
              </div>
              <div class="camp-text">${escapeHtml(c.ad_text)}</div>
              <div class="camp-url">${escapeHtml(c.ad_url)}</div>
              <div class="camp-progress">
                <div class="camp-progress-bar">
                  <div class="camp-progress-fill" style="width: ${pct}%"></div>
                </div>
                <span class="camp-progress-label">${delivered.toLocaleString()} / ${total.toLocaleString()} impressions (${pct}%)</span>
              </div>
              <div class="camp-stats-row">
                <span>${clicks.toLocaleString()} clicks</span>
                <span>${escapeHtml(ctr)} CTR</span>
                <span>${escapeHtml(spend)} spent</span>
              </div>
            </div>
            ${canToggle ? `
              <button type="button" class="btn btn-sm ${actionClass} camp-action-btn"
                data-campaign-btn="${c.id}"
                data-campaign-id="${c.id}"
                data-campaign-status="${c.status}"
                onclick="toggleCampaignStatus(this.dataset.campaignId, this.dataset.campaignStatus)">
                ${actionLabel}
              </button>
            ` : `<span class="camp-exhausted-label">Completed</span>`}
          </div>
        `;
      }).join("");
    }
  } catch {
    container.style.display = "none";
  }
}

async function loadTiers() {
  try {
    const res = await fetch(`${API}/api/billing/tiers`);
    const data = await res.json();
    tiers = data.tiers || [];
  } catch {
    tiers = [
      { impressions: 1000, priceCents: 500, priceDisplay: "$5.00", label: "1K Impressions" },
      { impressions: 5000, priceCents: 2000, priceDisplay: "$20.00", label: "5K Impressions" },
      { impressions: 10000, priceCents: 3500, priceDisplay: "$35.00", label: "10K Impressions" }
    ];
  }
  renderTiers();
}

function renderTiers() {
  const grid = document.getElementById("tier-grid");
  if (!grid) return;
  grid.innerHTML = tiers.map((t, i) => `
    <div class="tier-option ${i === selectedTierIndex ? "selected" : ""}" onclick="selectTier(${i})">
      <div class="tier-impressions">${t.impressions.toLocaleString()}</div>
      <div class="tier-price">${t.priceDisplay}</div>
    </div>
  `).join("");
}

function selectTier(index) {
  selectedTierIndex = index;
  renderTiers();
}

async function handleCreateCampaign(e) {
  e.preventDefault();

  const form = e.target;
  const errorEl = document.getElementById("form-error");
  const btn = document.getElementById("checkout-btn");

  const adText = form.adText?.value?.trim() || "";
  const adUrl = form.adUrl?.value?.trim() || "";
  const adImageUrl = form.adImageUrl?.value?.trim() || "";
  const cpmCents = parseInt(form.cpmCents?.value, 10) || 1000;

  errorEl.style.display = "none";

  if (!adText) {
    errorEl.textContent = "Add an ad headline — this is the text developers see in their editor.";
    errorEl.style.display = "block";
    document.getElementById("ad-text")?.focus();
    return;
  }

  if (!adUrl) {
    errorEl.textContent = "Add a destination URL (where clicks go), e.g. https://yoursite.com";
    errorEl.style.display = "block";
    document.getElementById("ad-url")?.focus();
    return;
  }

  if (!currentUser) {
    saveFormState();
    sessionStorage.setItem("autoCheckoutAfterLogin", "true");
    showToast("Sign in to continue to Stripe checkout", "success");
    handleLogin();
    return;
  }

  btn.disabled = true;
  btn.textContent = "Processing...";

  try {
    const res = await apiFetch("/api/advertiser/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adText,
        adUrl,
        adImageUrl: adImageUrl || undefined,
        cpmCents,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create campaign");

    const checkoutRes = await apiFetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId: data.campaign.id, tierIndex: selectedTierIndex }),
    });

    const checkoutData = await checkoutRes.json().catch(() => ({}));

    if (!checkoutRes.ok) {
      throw new Error(checkoutData.error || "Could not start Stripe checkout");
    }

    if (checkoutData.checkoutUrl) {
      sessionStorage.removeItem("pendingCheckout");
      sessionStorage.removeItem("autoCheckoutAfterLogin");
      window.location.href = checkoutData.checkoutUrl;
      return;
    }

    throw new Error("Stripe did not return a checkout URL");
  } catch (err) {
    errorEl.textContent = err.message || "Network error. Please try again.";
    errorEl.style.display = "block";
    showToast(err.message || "Checkout failed", "error");
  }

  btn.disabled = false;
  btn.textContent = "Checkout securely with Stripe";
}

function isPreviewImageUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function updateAdPreview() {
  const preview = document.getElementById("ad-preview");
  const previewText = document.getElementById("ad-preview-text");
  const previewImage = document.getElementById("ad-preview-image");
  const textEl = document.getElementById("ad-text");
  const text = textEl?.value?.trim() || "";
  const imageUrl = document.getElementById("ad-image-url")?.value?.trim() || "";
  const countEl = document.getElementById("ad-text-count");

  if (countEl && textEl) countEl.textContent = String((textEl.value || "").length);

  if (!preview || !previewText) return;

  previewText.textContent = text || "Your headline appears here";

  if (previewImage) {
    if (imageUrl && isPreviewImageUrl(imageUrl)) {
      previewImage.src = imageUrl;
      previewImage.style.display = "block";
      previewImage.onerror = () => {
        previewImage.style.display = "none";
      };
    } else {
      previewImage.removeAttribute("src");
      previewImage.style.display = "none";
    }
  }

  preview.style.display = text || imageUrl ? "block" : "none";
}

async function maybeResumeCheckout() {
  if (!currentUser) return;
  if (sessionStorage.getItem("autoCheckoutAfterLogin") !== "true") return;

  const adText = document.getElementById("ad-text")?.value?.trim();
  const adUrl = document.getElementById("ad-url")?.value?.trim();
  if (!adText || !adUrl) return;

  sessionStorage.removeItem("autoCheckoutAfterLogin");
  const form = document.getElementById("campaign-form");
  if (form) form.requestSubmit();
}

// ── Pending Checkout (After Auth) ────────────────────────────

function saveFormState() {
  const adText = document.getElementById("ad-text")?.value;
  const adUrl = document.getElementById("ad-url")?.value;
  const adImageUrl = document.getElementById("ad-image-url")?.value;
  const cpmCents = document.getElementById("cpm-rate")?.value;
  if (adText || adUrl || adImageUrl) {
    sessionStorage.setItem("pendingCheckout", JSON.stringify({
      adText, adUrl, adImageUrl, cpmCents, tierIndex: selectedTierIndex
    }));
  }
}

function checkCheckoutReturn() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("checkout") === "success") {
    showToast("Payment successful! Campaign is now active.", "success");
    history.replaceState({}, "", "advertiser.html");
    if (currentUser) {
      loadAdvertiserStats();
      loadActiveCampaigns();
    }
  } else if (urlParams.get("checkout") === "cancelled") {
    showToast("Checkout cancelled.", "error");
    history.replaceState({}, "", "advertiser.html");
  }
}

function checkConnectReturn() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("connect") === "success") {
    showToast("Stripe connected successfully!", "success");
    history.replaceState({}, "", "developer.html");
    if (currentUser) loadDevDashboard();
  } else if (urlParams.get("connect") === "refresh") {
    history.replaceState({}, "", "developer.html");
    if (currentUser) handleConnectOnboard();
  }
}

function checkPendingCheckout() {
  const pending = sessionStorage.getItem("pendingCheckout");
  if (pending) {
    try {
      const data = JSON.parse(pending);
      const adTextEl = document.getElementById("ad-text");
      const adUrlEl = document.getElementById("ad-url");
      const adImageEl = document.getElementById("ad-image-url");
      const cpmEl = document.getElementById("cpm-rate");

      if (adTextEl) adTextEl.value = data.adText || "";
      if (adUrlEl) adUrlEl.value = data.adUrl || "";
      if (adImageEl) adImageEl.value = data.adImageUrl || "";
      if (cpmEl) cpmEl.value = data.cpmCents || "1000";
      if (data.tierIndex !== undefined) selectedTierIndex = data.tierIndex;
      renderTiers();
      updateAdPreview();
    } catch {
      /* ignore */
    }
    sessionStorage.removeItem("pendingCheckout");
  }
}

// ── Live Queue ───────────────────────────────────────────────

function queueServedImpressions(c) {
  const total = c.total_impressions || 0;
  const remaining = c.remaining_impressions || 0;
  if (!total) return 0;
  return Math.max(0, total - remaining);
}

function renderQueue(campaigns) {
  const queueEl = document.getElementById("queue-list");
  if (!queueEl) return;

  const active = (campaigns || [])
    .filter(c => c.status === "active" && (c.remaining_impressions || 0) > 0)
    .sort((a, b) => (b.cpm_cents || 0) - (a.cpm_cents || 0))
    .slice(0, 5);

  if (active.length === 0) {
    queueEl.innerHTML = `<div class="queue-empty">No active campaigns. Be the first!</div>`;
    return;
  }

  queueEl.innerHTML = active.map((c, i) => {
    const served = queueServedImpressions(c);
    return `
    <div class="queue-item">
      <div class="q-left">
        <span class="q-rank">#${i + 1}</span>
        <span class="q-text">${escapeHtml(c.ad_text)}</span>
      </div>
      <div class="q-right">
        <span class="q-bid">$${((c.cpm_cents || 0) / 100).toFixed(2)} CPM</span>
        <span class="q-served">${served.toLocaleString()} served</span>
        <span class="q-rem">${(c.remaining_impressions || 0).toLocaleString()} left</span>
      </div>
    </div>
  `;
  }).join("");
}

let queueInterval;
async function fetchQueue() {
  try {
    const res = await fetch(`${API}/api/ads/queue`);
    if (res.ok) {
      const data = await res.json();
      renderQueue(data.campaigns || []);
    } else {
      showDemoQueue();
    }
  } catch {
    showDemoQueue();
  }
}

function showDemoQueue() {
  const demoCampaigns = [
    { ad_text: "Try Acme Pro — 50% off today", cpm_cents: 800, total_impressions: 5000, remaining_impressions: 4200, status: "active" },
    { ad_text: "Ship faster with Turbo CI/CD", cpm_cents: 500, total_impressions: 2000, remaining_impressions: 1100, status: "active" },
    { ad_text: "DevTools Premium — free trial", cpm_cents: 400, total_impressions: 10000, remaining_impressions: 8900, status: "active" },
  ];
  renderQueue(demoCampaigns);
}

function startQueuePolling() {
  fetchQueue();
  if (queueInterval) clearInterval(queueInterval);
  queueInterval = setInterval(fetchQueue, 10000);
}

// ── Helpers ──────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(12px)";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

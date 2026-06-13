/**
 * HitBack Unified Landing App
 * Handles Auth, Developer Earnings, Advertiser Campaigns, and Live Queue
 */

// API URL — see api-config.js (loaded before this script on index.html)
const API = typeof getHitbackApi === "function" ? getHitbackApi() : window.location.origin;

let currentUser = null;
let selectedTierIndex = 0;
let tiers = [];

// ── Init ─────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  // Check if we just came back from auth with pending checkout
  checkPendingCheckout();
  
  await checkAuth();
  await loadTiers();
  startQueuePolling();
});

// ── Auth ─────────────────────────────────────────────────────

async function checkAuth() {
  try {
    const res = await fetch(`${API}/auth/me`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      setupLoggedInState();
    } else {
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
  if (errorEl) errorEl.style.display = "none";
  if (modal) modal.style.display = "flex";
}

function closeSignInModal() {
  const modal = document.getElementById("signin-modal");
  if (modal) modal.style.display = "none";
}

function closeSignInModalOnBackdrop(event) {
  if (event.target.id === "signin-modal") closeSignInModal();
}

function handleGoogleSignIn() {
  saveFormState();
  window.location.href = `${API}/auth/google`;
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
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      if (errorEl) {
        errorEl.textContent = data.error || "Sign in failed";
        errorEl.style.display = "block";
      }
      return;
    }

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
    const res = await fetch(`${API}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      if (errorEl) {
        errorEl.textContent = data.error || "Could not create account";
        errorEl.style.display = "block";
      }
      return;
    }

    if (data.needsConfirmation) {
      showToast(data.message || "Check your email to confirm your account.", "success");
      return;
    }

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
  fetch(`${API}/auth/logout`, { method: "POST", credentials: "include" })
    .finally(() => { window.location.reload(); });
}

function setupLoggedInState() {
  // Update Nav
  const authSection = document.getElementById("auth-section");
  if (authSection && currentUser) {
    authSection.innerHTML = `
      <div class="user-profile">
        <span>${escapeHtml(currentUser.name || currentUser.email)}</span>
        <button class="logout-btn" onclick="handleLogout()">Sign Out</button>
      </div>
    `;
  }

  document.getElementById("dev-logged-in-teaser").style.display = "block";
  document.getElementById("dev-logged-out").style.display = "none";
  document.getElementById("earnings-logged-out").style.display = "none";
  document.getElementById("earnings-dashboard").style.display = "block";
  document.getElementById("checkout-login-hint").style.display = "none";

  loadDevDashboard();
  loadActiveCampaigns();
}

function setupLoggedOutState() {
  document.getElementById("dev-logged-in-teaser").style.display = "none";
  document.getElementById("dev-logged-out").style.display = "block";
  document.getElementById("earnings-logged-out").style.display = "block";
  document.getElementById("earnings-dashboard").style.display = "none";
  document.getElementById("checkout-login-hint").style.display = "block";
  document.getElementById("advertiser-campaigns").style.display = "none";
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
    const res = await fetch(`${API}/api/payouts/dashboard`, { credentials: "include" });
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

    if (statusEl) {
      if (data.stripeConnected) {
        statusEl.textContent = "Stripe Connected";
        statusEl.className = "status-badge status-success";
        if (connectBtn) connectBtn.style.display = "none";
      } else {
        statusEl.textContent = "Not Connected";
        statusEl.className = "status-badge status-warning";
        if (connectBtn) connectBtn.style.display = "inline-flex";
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
  try {
    const res = await fetch(`${API}/api/payouts/connect-onboard`, { method: "POST", credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      if (data.onboardingUrl) window.location.href = data.onboardingUrl;
    } else {
      showToast("Stripe Connect not available in demo mode", "error");
    }
  } catch {
    showToast("Network error", "error");
  }
}

async function handleWithdraw() {
  const btn = document.getElementById("withdraw-btn");
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`${API}/api/payouts/withdraw`, { method: "POST", credentials: "include" });
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

async function loadActiveCampaigns() {
  const container = document.getElementById("advertiser-campaigns");
  const list = document.getElementById("campaigns-list");
  if (!container || !list) return;

  try {
    const res = await fetch(`${API}/api/advertiser/campaigns`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      const campaigns = (data.campaigns || []).filter(c => c.status === 'active' || c.status === 'paused');
      
      if (campaigns.length === 0) {
        container.style.display = "none";
        return;
      }
      
      container.style.display = "block";
      list.innerHTML = campaigns.map(c => {
        const used = (c.total_impressions || 0) - (c.remaining_impressions || 0);
        const pct = c.total_impressions ? Math.round((used / c.total_impressions) * 100) : 0;
        return `
          <div class="campaign-item">
            <div class="camp-info">
              <div class="camp-text">${escapeHtml(c.ad_text)}</div>
              <div class="camp-url">${escapeHtml(c.ad_url)}</div>
            </div>
            <div class="camp-meta">
              <div class="camp-prog">${pct}%</div>
              <div class="camp-stat">${c.status}</div>
            </div>
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
  
  if (!currentUser) {
    handleLogin();
    return;
  }

  const form = e.target;
  const errorEl = document.getElementById("form-error");
  const btn = document.getElementById("checkout-btn");

  const adText = form.adText.value.trim();
  const adUrl = form.adUrl.value.trim();
  const cpmCents = parseInt(form.cpmCents.value) || 1000;

  if (!adText || !adUrl) return;

  btn.disabled = true;
  btn.textContent = "Processing...";
  errorEl.style.display = "none";

  try {
    // 1. Create Campaign
    const res = await fetch(`${API}/api/advertiser/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ adText, adUrl, cpmCents }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create campaign");

    // 2. Checkout
    const checkoutRes = await fetch(`${API}/api/billing/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ campaignId: data.campaign.id, tierIndex: selectedTierIndex }),
    });

    if (checkoutRes.ok) {
      const checkoutData = await checkoutRes.json();
      if (checkoutData.checkoutUrl) {
        window.location.href = checkoutData.checkoutUrl;
        return;
      }
    }
    
    // Demo Mode fallback
    showToast("Campaign created (Demo mode — no Stripe checkout)", "success");
    form.reset();
    await loadActiveCampaigns();
    
  } catch (err) {
    errorEl.textContent = err.message || "Network error. Please try again.";
    errorEl.style.display = "block";
  }
  
  btn.disabled = false;
  btn.textContent = "Checkout securely with Stripe";
}

// ── Pending Checkout (After Auth) ────────────────────────────

function saveFormState() {
  const adText = document.getElementById("ad-text")?.value;
  const adUrl = document.getElementById("ad-url")?.value;
  const cpmCents = document.getElementById("cpm-rate")?.value;
  if (adText || adUrl) {
    sessionStorage.setItem("pendingCheckout", JSON.stringify({
      adText, adUrl, cpmCents, tierIndex: selectedTierIndex
    }));
  }
}

function checkPendingCheckout() {
  const pending = sessionStorage.getItem("pendingCheckout");
  if (pending) {
    try {
      const data = JSON.parse(pending);
      const adTextEl = document.getElementById("ad-text");
      const adUrlEl = document.getElementById("ad-url");
      const cpmEl = document.getElementById("cpm-rate");
      
      if (adTextEl) adTextEl.value = data.adText || "";
      if (adUrlEl) adUrlEl.value = data.adUrl || "";
      if (cpmEl) cpmEl.value = data.cpmCents || "1000";
      if (data.tierIndex !== undefined) selectedTierIndex = data.tierIndex;
      
    } catch (e) {}
    sessionStorage.removeItem("pendingCheckout");
    
    // Check URL params for post-checkout
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("checkout") === "success") {
      showToast("Payment successful! Campaign is now active.", "success");
      history.replaceState({}, "", "index.html");
    }
  }
}

// ── Live Queue ───────────────────────────────────────────────

function renderQueue(campaigns) {
  const queueEl = document.getElementById("queue-list");
  if (!queueEl) return;

  const active = (campaigns || [])
    .filter(c => c.status === "active" && (c.remaining_impressions || 0) > 0)
    .sort((a, b) => (b.cpm_cents || 0) - (a.cpm_cents || 0))
    .slice(0, 5); // top 5

  if (active.length === 0) {
    queueEl.innerHTML = `<div class="queue-empty">No active campaigns. Be the first!</div>`;
    return;
  }

  queueEl.innerHTML = active.map((c, i) => `
    <div class="queue-item">
      <div class="q-left">
        <span class="q-rank">#${i + 1}</span>
        <span class="q-text">${escapeHtml(c.ad_text)}</span>
      </div>
      <div class="q-right">
        <span class="q-bid">$${((c.cpm_cents || 0) / 100).toFixed(2)} CPM</span>
        <span class="q-rem">${(c.remaining_impressions || 0).toLocaleString()} left</span>
      </div>
    </div>
  `).join("");
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
    { ad_text: "Try Acme Pro — 50% off today", cpm_cents: 800, remaining_impressions: 4200, status: 'active' },
    { ad_text: "Ship faster with Turbo CI/CD", cpm_cents: 500, remaining_impressions: 1100, status: 'active' },
    { ad_text: "DevTools Premium — free trial", cpm_cents: 400, remaining_impressions: 8900, status: 'active' }
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

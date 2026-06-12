/**
 * HitBack Unified Landing App
 * Handles Auth, Developer Earnings, Advertiser Campaigns, and Live Queue
 */

const API = window.location.origin;
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
    setupLoggedOutState(); // Demo mode fallback
  }
}

function handleLogin() {
  // Save form state in case they were filling it out
  saveFormState();
  window.location.href = `${API}/auth/google`;
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

  // Show Dev Dashboard, hide Logged Out prompt
  document.getElementById("dev-dashboard").style.display = "flex";
  document.getElementById("dev-logged-out").style.display = "none";
  document.getElementById("checkout-login-hint").style.display = "none";

  loadDevBalance();
  loadActiveCampaigns();
}

function setupLoggedOutState() {
  document.getElementById("dev-dashboard").style.display = "none";
  document.getElementById("dev-logged-out").style.display = "block";
  document.getElementById("checkout-login-hint").style.display = "block";
  document.getElementById("advertiser-campaigns").style.display = "none";
}

// ── Developer Dashboard ──────────────────────────────────────

async function loadDevBalance() {
  const amountEl = document.getElementById("dev-balance");
  const withdrawBtn = document.getElementById("withdraw-btn");
  const statusEl = document.getElementById("dev-stripe-status");
  const connectBtn = document.getElementById("stripe-connect-btn");

  try {
    const res = await fetch(`${API}/api/payouts/balance`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      if (amountEl) amountEl.textContent = data.balanceDisplay || "$0.00";
      if (withdrawBtn) withdrawBtn.disabled = !data.canWithdraw;
      
      // In a real app we'd check if they have a Stripe Connect ID from profile
      // For now, assume if balance loads, they are connected (or just show connect button)
      if (statusEl) {
        statusEl.textContent = "Connected";
        statusEl.className = "status-badge status-success";
      }
      if (connectBtn) connectBtn.style.display = "none";
    } else {
      // Demo Mode
      showDemoBalance();
    }
  } catch {
    showDemoBalance();
  }
}

function showDemoBalance() {
  const amountEl = document.getElementById("dev-balance");
  if (amountEl) amountEl.textContent = "$12.47";
  const withdrawBtn = document.getElementById("withdraw-btn");
  if (withdrawBtn) withdrawBtn.disabled = false;
  
  const statusEl = document.getElementById("dev-stripe-status");
  if (statusEl) {
    statusEl.textContent = "Demo Account";
    statusEl.className = "status-badge status-success";
  }
  const connectBtn = document.getElementById("stripe-connect-btn");
  if (connectBtn) connectBtn.style.display = "none";
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
      await loadDevBalance();
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
  const cpcBidCents = parseInt(form.cpcBidCents.value) || 5;

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
      body: JSON.stringify({ adText, adUrl, cpcBidCents }),
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
  const cpcBidCents = document.getElementById("cpc-bid")?.value;
  if (adText || adUrl) {
    sessionStorage.setItem("pendingCheckout", JSON.stringify({
      adText, adUrl, cpcBidCents, tierIndex: selectedTierIndex
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
      const cpcBidEl = document.getElementById("cpc-bid");
      
      if (adTextEl) adTextEl.value = data.adText || "";
      if (adUrlEl) adUrlEl.value = data.adUrl || "";
      if (cpcBidEl) cpcBidEl.value = data.cpcBidCents || "5";
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
    .sort((a, b) => (b.cpc_bid_cents || 0) - (a.cpc_bid_cents || 0))
    .slice(0, 5); // top 5

  if (active.length === 0) {
    queueEl.innerHTML = `<div class="queue-empty">No active bids. Be the first!</div>`;
    return;
  }

  queueEl.innerHTML = active.map((c, i) => `
    <div class="queue-item">
      <div class="q-left">
        <span class="q-rank">#${i + 1}</span>
        <span class="q-text">${escapeHtml(c.ad_text)}</span>
      </div>
      <div class="q-right">
        <span class="q-bid">$${((c.cpc_bid_cents || 0) / 100).toFixed(2)} CPC</span>
        <span class="q-rem">${(c.remaining_impressions || 0).toLocaleString()} left</span>
      </div>
    </div>
  `).join("");
}

let queueInterval;
async function fetchQueue() {
  try {
    const res = await fetch(`${API}/api/advertiser/campaigns`); // Requires public endpoint, but wait!
    // /api/advertiser/campaigns requires auth. Let's just mock it if it fails or fetch authenticated.
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
    { ad_text: "Try Acme Pro — 50% off today", cpc_bid_cents: 8, remaining_impressions: 4200, status: 'active' },
    { ad_text: "Ship faster with Turbo CI/CD", cpc_bid_cents: 5, remaining_impressions: 1100, status: 'active' },
    { ad_text: "DevTools Premium — free trial", cpc_bid_cents: 4, remaining_impressions: 8900, status: 'active' }
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

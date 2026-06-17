import express from "express";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import adsRouter from "./routes/ads";
import clicksRouter from "./routes/clicks";
import impressionsRouter from "./routes/impressions";
import authRouter from "./routes/auth";
import billingRouter from "./routes/billing";
import payoutsRouter from "./routes/payouts";
import webhooksRouter from "./routes/webhooks";
import advertiserRouter from "./routes/advertiser";
import adminRouter from "./routes/admin";
import { isSupabaseConfigured } from "./lib/supabase";
import { isStripeConfigured } from "./lib/stripe";

// Load environment variables
dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

// --- Stripe webhook route MUST come before express.json() ---
// Raw body is required for signature verification
app.use("/api/webhooks", express.raw({ type: "application/json" }), webhooksRouter);

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// --- API Routes ---
app.use("/api/ads", adsRouter);
app.use("/api/clicks", clicksRouter);
app.use("/api/impressions", impressionsRouter);
app.use("/auth", authRouter);
app.use("/api/billing", billingRouter);
app.use("/api/payouts", payoutsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/advertiser", advertiserRouter);

// --- Portal (static files) ---
// Depending on if we are running from src/ or dist/, we go up 2 levels to packages/backend, then up 1 level to root, so ../../../frontend.
// Wait: __dirname is packages/backend/src or packages/backend/dist.
// To get to root, it's path.join(__dirname, "../../../frontend")
const portalDir = path.join(__dirname, "../../../frontend");
app.use("/portal", express.static(portalDir));

// Root redirect
app.get("/", (_req, res) => {
  res.redirect("/portal/index.html");
});

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "hitback-backend",
    version: "0.3.0",
    supabase: isSupabaseConfigured() ? "connected" : "demo-mode",
    stripe: isStripeConfigured() ? "connected" : "not-configured",
  });
});

// Start server (0.0.0.0 required for Fly.io / Docker)
app.listen(PORT, "0.0.0.0", () => {
  const sb = isSupabaseConfigured() ? "✅ Supabase" : "⚠️  No Supabase";
  const st = isStripeConfigured() ? "✅ Stripe" : "⚠️  No Stripe";

  console.log(`
  ╔══════════════════════════════════════════╗
  ║  HitBack Backend v0.3.0                 ║
  ║  http://localhost:${PORT}                  ║
  ║  ${sb.padEnd(38)}║
  ║  ${st.padEnd(38)}║
  ╚══════════════════════════════════════════╝
  `);
  console.log("  Routes:");
  console.log("    GET  /api/ads/current          — fetch ad + serve tokens");
  console.log("    POST /api/impressions          — record impression (token required)");
  console.log("    POST /api/clicks               — report click (token required)");
  console.log("    GET  /auth/google              — OAuth login");
  console.log("    POST /auth/exchange-code       — OAuth PKCE code exchange");
  console.log("    GET  /auth/me                  — current user");
  console.log("    POST /api/billing/checkout      — Stripe checkout");
  console.log("    GET  /api/billing/tiers         — pricing tiers");
  console.log("    GET  /api/advertiser/campaigns  — list campaigns");
  console.log("    POST /api/advertiser/campaigns  — create campaign");
  console.log("    GET  /api/advertiser/stats      — campaign stats");
  console.log("    GET  /api/payouts/dashboard       — developer earnings portal");
  console.log("    GET  /api/payouts/balance         — developer balance");
  console.log("    POST /api/payouts/connect-onboard — Stripe Connect");
  console.log("    GET  /portal/                  — advertiser portal");
  console.log("    GET  /health                   — health check");
  console.log("");
});

export default app;

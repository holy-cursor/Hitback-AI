import { Router, Request, Response } from "express";
import {
  isSupabaseConfigured,
  isSupabaseAnonConfigured,
  getSupabase,
  getSupabaseAnon,
} from "../lib/supabase";
import { getPortalUrl } from "../lib/portalUrl";
import { extractAuthToken } from "../lib/resolveUser";

const router = Router();

function confirmationRedirectUrl(): string {
  return `${getPortalUrl()}/auth-callback.html`;
}

function setAuthCookie(res: Response, accessToken: string): void {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie("hb_token", accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

async function upsertUserProfile(
  sb: ReturnType<typeof getSupabase>,
  user: { id: string; email?: string; user_metadata?: Record<string, unknown> },
  role = "advertiser"
): Promise<void> {
  const { error } = await sb.from("user_profiles").upsert(
    {
      id: user.id,
      email: user.email,
      display_name:
        (user.user_metadata?.full_name as string) ||
        user.email?.split("@")[0] ||
        "User",
      role,
    },
    { onConflict: "id" }
  );

  if (error) {
    console.error("[Auth] Profile upsert error:", error.message);
  }
}

function isEmailNotConfirmed(message: string | undefined): boolean {
  const m = (message || "").toLowerCase();
  return m.includes("email not confirmed") || m.includes("email_not_confirmed");
}

async function resendSignupConfirmation(email: string): Promise<{ ok: boolean; error?: string }> {
  const anon = getSupabaseAnon();
  const { error } = await anon.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: confirmationRedirectUrl() },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * GET /auth/google
 * Initiates Google OAuth flow via Supabase.
 * Redirects the user to Google's consent screen.
 */
router.get("/google", async (req: Request, res: Response) => {
  if (!isSupabaseConfigured()) {
    res.status(503).json({ error: "Auth not available (Supabase not configured)" });
    return;
  }

  try {
    const sb = getSupabase();
    const context = req.query.context as string;
    const editor =
      context === "cursor" ? "cursor" : context === "vscode" ? "vscode" : undefined;

    const portalUrl = getPortalUrl();
    let redirectTo = `${portalUrl}/auth-callback.html`;

    if (context === "vscode" || context === "cursor") {
      redirectTo = editor
        ? `${portalUrl}/vscode-callback.html?editor=${editor}`
        : `${portalUrl}/vscode-callback.html`;
    }

    const { data, error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error || !data.url) {
      console.error("[Auth] OAuth initiation error:", error?.message);
      res.status(500).json({ error: "Failed to initiate OAuth" });
      return;
    }

    res.redirect(data.url);
  } catch (err) {
    console.error("[Auth] Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /auth/login
 * Email + password sign-in via Supabase.
 */
router.post("/login", async (req: Request, res: Response) => {
  if (!isSupabaseConfigured()) {
    res.status(503).json({ error: "Auth not available" });
    return;
  }

  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  try {
    const sb = getSupabase();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });

    if (error || !data.session || !data.user) {
      if (isEmailNotConfirmed(error?.message)) {
        res.status(401).json({
          error: "Please confirm your email before signing in.",
          needsConfirmation: true,
        });
        return;
      }
      res.status(401).json({ error: error?.message || "Invalid email or password" });
      return;
    }

    setAuthCookie(res, data.session.access_token);
    await upsertUserProfile(sb, data.user);

    console.log(`[Auth] Email login: ${data.user.email}`);

    res.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        name:
          data.user.user_metadata?.full_name ||
          data.user.email?.split("@")[0],
      },
      accessToken: data.session.access_token,
    });
  } catch (err) {
    console.error("[Auth] Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /auth/signup
 * Create account with email + password. Sends Supabase confirmation email.
 */
router.post("/signup", async (req: Request, res: Response) => {
  if (!isSupabaseConfigured()) {
    res.status(503).json({ error: "Auth not available" });
    return;
  }

  if (!isSupabaseAnonConfigured()) {
    res.status(503).json({
      error: "Email signup not configured. Set SUPABASE_ANON_KEY on the server.",
    });
    return;
  }

  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const emailRedirectTo = confirmationRedirectUrl();
  const confirmationMessage =
    "We sent a confirmation link to your email. Click it to activate your account, then sign in.";

  try {
    const anon = getSupabaseAnon();
    const { data, error } = await anon.auth.signUp({
      email,
      password,
      options: { emailRedirectTo },
    });

    if (error) {
      const msg = error.message || "Could not create account";
      const lower = msg.toLowerCase();
      if (lower.includes("rate limit") || lower.includes("too many")) {
        res.status(429).json({
          error: "Too many emails sent. Please wait a few minutes and try again.",
        });
        return;
      }
      if (lower.includes("already") || lower.includes("registered")) {
        res.status(409).json({
          error: "An account with this email already exists. Try signing in.",
        });
        return;
      }
      res.status(400).json({ error: msg });
      return;
    }

    // Supabase obfuscates duplicate signups: empty identities = email already taken
    if (data.user && (!data.user.identities || data.user.identities.length === 0)) {
      const resent = await resendSignupConfirmation(email);
      if (!resent.ok) {
        res.status(409).json({
          error: "An account with this email already exists. Try signing in.",
        });
        return;
      }
      console.log(`[Auth] Resent confirmation for existing unconfirmed user: ${email}`);
      res.json({ needsConfirmation: true, message: confirmationMessage });
      return;
    }

    if (data.session) {
      console.warn("[Auth] Signup returned session — Confirm email may be disabled in Supabase");
      res.status(400).json({
        error:
          "Email confirmation is required. Enable Confirm email in Supabase Auth settings.",
      });
      return;
    }

    if (!data.user) {
      res.status(400).json({ error: "Could not create account" });
      return;
    }

    console.log(`[Auth] Signup pending confirmation: ${email}`);
    res.json({ needsConfirmation: true, message: confirmationMessage });
  } catch (err) {
    console.error("[Auth] Signup error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /auth/resend-confirmation
 * Resend signup confirmation email.
 */
router.post("/resend-confirmation", async (req: Request, res: Response) => {
  if (!isSupabaseAnonConfigured()) {
    res.status(503).json({ error: "Email resend not configured" });
    return;
  }

  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  try {
    const result = await resendSignupConfirmation(email);
    if (!result.ok) {
      const lower = (result.error || "").toLowerCase();
      if (lower.includes("rate limit") || lower.includes("too many")) {
        res.status(429).json({
          error: "Too many emails sent. Please wait a few minutes and try again.",
        });
        return;
      }
      res.status(400).json({ error: result.error || "Could not resend confirmation email" });
      return;
    }

    res.json({
      success: true,
      message: "Confirmation email sent. Check your inbox and spam folder.",
    });
  } catch (err) {
    console.error("[Auth] Resend confirmation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /auth/confirm
 * Completes email confirmation from the link Supabase sends.
 * Body: { token_hash: string, type: string }
 */
router.post("/confirm", async (req: Request, res: Response) => {
  if (!isSupabaseConfigured()) {
    res.status(503).json({ error: "Auth not available" });
    return;
  }

  const { token_hash, type } = req.body;
  if (!token_hash || !type) {
    res.status(400).json({ error: "Missing confirmation token" });
    return;
  }

  const allowed = new Set(["signup", "email", "invite", "magiclink", "recovery", "email_change"]);
  if (!allowed.has(type)) {
    res.status(400).json({ error: "Invalid confirmation type" });
    return;
  }

  try {
    const sb = getSupabase();
    const { data, error } = await sb.auth.verifyOtp({
      token_hash,
      type: type as "signup" | "email" | "invite" | "magiclink" | "recovery" | "email_change",
    });

    if (error || !data.session || !data.user) {
      res.status(401).json({ error: error?.message || "Invalid or expired confirmation link" });
      return;
    }

    setAuthCookie(res, data.session.access_token);
    await upsertUserProfile(sb, data.user);

    res.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        name:
          data.user.user_metadata?.full_name ||
          data.user.email?.split("@")[0],
      },
      accessToken: data.session.access_token,
    });
  } catch (err) {
    console.error("[Auth] Confirm error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /auth/session
 * Exchanges a Supabase access token for a session.
 * Called by the frontend after OAuth callback.
 *
 * Body: { access_token: string, refresh_token: string }
 */
router.post("/session", async (req: Request, res: Response) => {
  if (!isSupabaseConfigured()) {
    res.status(503).json({ error: "Auth not available" });
    return;
  }

  const { access_token, refresh_token } = req.body;

  if (!access_token || !refresh_token) {
    res.status(400).json({ error: "Missing tokens" });
    return;
  }

  try {
    const sb = getSupabase();

    const { data, error } = await sb.auth.setSession({
      access_token,
      refresh_token,
    });

    if (error || !data.user) {
      res.status(401).json({ error: "Invalid tokens" });
      return;
    }

    setAuthCookie(res, access_token);
    await upsertUserProfile(sb, data.user);

    console.log(`[Auth] Session created for: ${data.user.email}`);

    res.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        name:
          data.user.user_metadata?.full_name ||
          data.user.email?.split("@")[0],
      },
      accessToken: access_token,
    });
  } catch (err) {
    console.error("[Auth] Session error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /auth/me
 * Returns the currently authenticated user, or 401.
 */
router.get("/me", async (req: Request, res: Response) => {
  if (!isSupabaseConfigured()) {
    res.status(503).json({ error: "Auth not available" });
    return;
  }

  const token = extractAuthToken(req);

  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    const sb = getSupabase();
    const { data, error } = await sb.auth.getUser(token);

    if (error || !data.user) {
      res.clearCookie("hb_token");
      res.status(401).json({ error: "Invalid or expired session" });
      return;
    }

    // Fetch profile for role
    const { data: profile } = await sb
      .from("user_profiles")
      .select("role, display_name")
      .eq("id", data.user.id)
      .single();

    res.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        name: profile?.display_name || data.user.email?.split("@")[0],
        role: profile?.role || "advertiser",
      },
    });
  } catch (err) {
    console.error("[Auth] /me error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /auth/logout
 * Clears the session cookie.
 */
router.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie("hb_token");
  res.json({ success: true });
});

export default router;

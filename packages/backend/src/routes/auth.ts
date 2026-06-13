import { Router, Request, Response } from "express";
import { isSupabaseConfigured, getSupabase } from "../lib/supabase";
import { getPortalUrl } from "../lib/portalUrl";
import { extractAuthToken } from "../lib/resolveUser";

const router = Router();

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
    });
  } catch (err) {
    console.error("[Auth] Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /auth/signup
 * Create account with email + password.
 */
router.post("/signup", async (req: Request, res: Response) => {
  if (!isSupabaseConfigured()) {
    res.status(503).json({ error: "Auth not available" });
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

  try {
    const sb = getSupabase();
    const { data, error } = await sb.auth.signUp({ email, password });

    if (error || !data.user) {
      res.status(400).json({ error: error?.message || "Could not create account" });
      return;
    }

    if (!data.session) {
      res.json({
        needsConfirmation: true,
        message: "Check your email to confirm your account, then sign in.",
      });
      return;
    }

    setAuthCookie(res, data.session.access_token);
    await upsertUserProfile(sb, data.user);

    res.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        name: data.user.email?.split("@")[0],
      },
    });
  } catch (err) {
    console.error("[Auth] Signup error:", err);
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

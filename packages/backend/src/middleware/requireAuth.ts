import { Request, Response, NextFunction } from "express";
import { isSupabaseConfigured, getSupabase } from "../lib/supabase";
import { extractAuthToken } from "../lib/resolveUser";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
      };
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!isSupabaseConfigured()) {
    res.status(503).json({ error: "Auth not available (Supabase not configured)" });
    return;
  }

  const token = extractAuthToken(req);

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const sb = getSupabase();
    const { data, error } = await sb.auth.getUser(token);

    if (error || !data.user) {
      res.status(401).json({ error: "Invalid or expired session" });
      return;
    }

    const { data: profile } = await sb
      .from("user_profiles")
      .select("role")
      .eq("id", data.user.id)
      .single();

    req.user = {
      id: data.user.id,
      email: data.user.email || "",
      role: profile?.role || "developer",
    };

    next();
  } catch (err) {
    console.error("[Auth] Middleware error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

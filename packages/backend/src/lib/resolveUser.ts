import { Request } from "express";
import { isSupabaseConfigured, getSupabase } from "./supabase";

/** Extract JWT from Bearer header or session cookie. */
export function extractAuthToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return req.cookies?.hb_token;
}

/**
 * Resolve authenticated Supabase user ID from request, if any.
 * Ensures a developer profile exists when logging in via the extension.
 */
export async function resolveAuthUserId(req: Request): Promise<string | null> {
  const token = extractAuthToken(req);
  if (!token || !isSupabaseConfigured()) {
    return null;
  }

  try {
    const sb = getSupabase();
    const { data, error } = await sb.auth.getUser(token);

    if (error || !data.user) {
      return null;
    }

    await sb.from("user_profiles").upsert(
      {
        id: data.user.id,
        email: data.user.email,
        display_name:
          data.user.user_metadata?.full_name ||
          data.user.email?.split("@")[0] ||
          "Developer",
        role: "developer",
      },
      { onConflict: "id" }
    );

    return data.user.id;
  } catch {
    return null;
  }
}

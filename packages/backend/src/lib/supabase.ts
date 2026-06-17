import { createClient, SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

/**
 * Singleton Supabase client for the HitBack backend.
 *
 * Uses SUPABASE_URL and SUPABASE_SERVICE_KEY from environment.
 * Falls back gracefully — callers should check isSupabaseConfigured()
 * before making queries.
 */

let _client: SupabaseClient | null = null;
let _anonClient: SupabaseClient | null = null;
let _oauthClient: SupabaseClient | null = null;

/**
 * Returns true if Supabase credentials are configured in the environment.
 */
export function isSupabaseConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

/** Anon key required for signUp / resend confirmation emails. */
export function isSupabaseAnonConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

/**
 * Get the Supabase client. Throws if not configured.
 * Always check isSupabaseConfigured() first.
 */
export function getSupabase(): SupabaseClient {
  if (_client) {
    return _client;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env"
    );
  }

  _client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      transport: ws as any,
    },
  });

  return _client;
}

/**
 * Public Supabase client for auth flows that send confirmation emails.
 */
export function getSupabaseAnon(): SupabaseClient {
  if (_anonClient) {
    return _anonClient;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase anon key not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env"
    );
  }

  _anonClient = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      transport: ws as any,
    },
  });

  return _anonClient;
}

/**
 * Anon client with implicit OAuth flow — returns tokens in the callback URL hash
 * (required for our static auth-callback.html; PKCE codes cannot be exchanged server-side).
 */
export function getSupabaseOAuth(): SupabaseClient {
  if (_oauthClient) {
    return _oauthClient;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase anon key not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env"
    );
  }

  _oauthClient = createClient(url, key, {
    auth: {
      flowType: "implicit",
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      transport: ws as any,
    },
  });

  return _oauthClient;
}

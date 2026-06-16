import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { isSupabaseConfigured, getSupabase } from "./supabase";

export type ServeTokenType = "imp" | "clk";

export interface ServeTokenPayload {
  jti: string;
  cid: string;
  euid: string;
  auid?: string;
  exp: number;
  typ: ServeTokenType;
}

export interface IssuedServeTokens {
  jti: string;
  impressionToken: string;
  clickToken: string;
}

interface DemoServeRecord {
  jti: string;
  campaignId: string;
  extensionUserId: string;
  authUserId: string | null;
  impressionUsed: boolean;
  clickUsed: boolean;
  expiresAt: number;
}

const IMPRESSION_TTL_SEC = 120;
const CLICK_TTL_SEC = 300;

const demoServeRecords = new Map<string, DemoServeRecord>();

function getSigningSecret(): string {
  const secret =
    process.env.IMPRESSION_TOKEN_SECRET ||
    process.env.SESSION_SECRET ||
    "hitback-dev-insecure-secret";
  if (secret === "change-me-to-a-random-string" || secret === "hitback-dev-insecure-secret") {
    console.warn("[ServeToken] Using default signing secret — set IMPRESSION_TOKEN_SECRET in production");
  }
  return secret;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(encodedPayload: string): string {
  return createHmac("sha256", getSigningSecret()).update(encodedPayload).digest("base64url");
}

function buildToken(payload: ServeTokenPayload): string {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function parseToken(token: string): ServeTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [encodedPayload, signature] = parts;
  const expected = signPayload(encodedPayload);

  try {
    const sigBuf = Buffer.from(signature, "base64url");
    const expectedBuf = Buffer.from(expected, "base64url");
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as ServeTokenPayload;
    if (
      !payload.jti ||
      !payload.cid ||
      !payload.euid ||
      !payload.exp ||
      (payload.typ !== "imp" && payload.typ !== "clk")
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function isExpired(payload: ServeTokenPayload): boolean {
  return payload.exp * 1000 <= Date.now();
}

export async function issueServeTokens(params: {
  campaignId: string;
  extensionUserId: string;
  authUserId?: string | null;
}): Promise<IssuedServeTokens> {
  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const base = {
    jti,
    cid: params.campaignId,
    euid: params.extensionUserId,
    ...(params.authUserId ? { auid: params.authUserId } : {}),
  };

  const impressionToken = buildToken({
    ...base,
    exp: now + IMPRESSION_TTL_SEC,
    typ: "imp",
  });

  const clickToken = buildToken({
    ...base,
    exp: now + CLICK_TTL_SEC,
    typ: "clk",
  });

  const expiresAt = new Date((now + CLICK_TTL_SEC) * 1000).toISOString();

  if (isSupabaseConfigured()) {
    const sb = getSupabase();
    const { error } = await sb.from("serve_tokens").insert({
      jti,
      campaign_id: params.campaignId,
      extension_user_id: params.extensionUserId,
      auth_user_id: params.authUserId ?? null,
      expires_at: expiresAt,
    });

    if (error) {
      throw new Error(`Failed to persist serve token: ${error.message}`);
    }
  } else {
    demoServeRecords.set(jti, {
      jti,
      campaignId: params.campaignId,
      extensionUserId: params.extensionUserId,
      authUserId: params.authUserId ?? null,
      impressionUsed: false,
      clickUsed: false,
      expiresAt: (now + CLICK_TTL_SEC) * 1000,
    });
  }

  return { jti, impressionToken, clickToken };
}

export interface ConsumedServeToken {
  jti: string;
  campaignId: string;
  extensionUserId: string;
  authUserId: string | null;
}

/** Parse and verify signature/expiry without consuming. */
export function validateServeToken(
  token: string,
  expectedType: ServeTokenType
): ServeTokenPayload | null {
  const payload = parseToken(token);
  if (!payload || payload.typ !== expectedType || isExpired(payload)) {
    return null;
  }
  return payload;
}

async function loadServeRecord(jti: string): Promise<{
  campaignId: string;
  extensionUserId: string;
  authUserId: string | null;
  impressionUsed: boolean;
  clickUsed: boolean;
  expiresAt: string;
} | null> {
  if (isSupabaseConfigured()) {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("serve_tokens")
      .select(
        "campaign_id, extension_user_id, auth_user_id, impression_used, click_used, expires_at"
      )
      .eq("jti", jti)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return {
      campaignId: data.campaign_id,
      extensionUserId: data.extension_user_id,
      authUserId: data.auth_user_id,
      impressionUsed: data.impression_used,
      clickUsed: data.click_used,
      expiresAt: data.expires_at,
    };
  }

  const record = demoServeRecords.get(jti);
  if (!record) {
    return null;
  }

  return {
    campaignId: record.campaignId,
    extensionUserId: record.extensionUserId,
    authUserId: record.authUserId,
    impressionUsed: record.impressionUsed,
    clickUsed: record.clickUsed,
    expiresAt: new Date(record.expiresAt).toISOString(),
  };
}

/** Check token is valid and unused without consuming it. */
export async function peekServeToken(
  token: string,
  expectedType: ServeTokenType
): Promise<ConsumedServeToken | null> {
  const payload = validateServeToken(token, expectedType);
  if (!payload) {
    return null;
  }

  const record = await loadServeRecord(payload.jti);
  if (!record) {
    return null;
  }

  if (record.expiresAt <= new Date().toISOString()) {
    return null;
  }

  if (record.campaignId !== payload.cid || record.extensionUserId !== payload.euid) {
    return null;
  }

  if (payload.auid && record.authUserId && payload.auid !== record.authUserId) {
    return null;
  }

  const alreadyUsed =
    expectedType === "imp" ? record.impressionUsed : record.clickUsed;
  if (alreadyUsed) {
    return null;
  }

  return {
    jti: payload.jti,
    campaignId: record.campaignId,
    extensionUserId: record.extensionUserId,
    authUserId: record.authUserId,
  };
}

export async function consumeServeToken(
  token: string,
  expectedType: ServeTokenType
): Promise<ConsumedServeToken | null> {
  const payload = parseToken(token);
  if (!payload || payload.typ !== expectedType || isExpired(payload)) {
    return null;
  }

  if (isSupabaseConfigured()) {
    const sb = getSupabase();
    const usedField = expectedType === "imp" ? "impression_used" : "click_used";

    const { data, error } = await sb
      .from("serve_tokens")
      .update({ [usedField]: true })
      .eq("jti", payload.jti)
      .eq(usedField, false)
      .eq("campaign_id", payload.cid)
      .eq("extension_user_id", payload.euid)
      .gt("expires_at", new Date().toISOString())
      .select("jti, campaign_id, extension_user_id, auth_user_id")
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    if (payload.auid && data.auth_user_id && payload.auid !== data.auth_user_id) {
      return null;
    }

    return {
      jti: data.jti,
      campaignId: data.campaign_id,
      extensionUserId: data.extension_user_id,
      authUserId: data.auth_user_id,
    };
  }

  const record = demoServeRecords.get(payload.jti);
  if (!record || record.expiresAt <= Date.now()) {
    return null;
  }

  if (record.campaignId !== payload.cid || record.extensionUserId !== payload.euid) {
    return null;
  }

  if (expectedType === "imp") {
    if (record.impressionUsed) {
      return null;
    }
    record.impressionUsed = true;
  } else {
    if (record.clickUsed) {
      return null;
    }
    record.clickUsed = true;
  }

  return {
    jti: record.jti,
    campaignId: record.campaignId,
    extensionUserId: record.extensionUserId,
    authUserId: record.authUserId,
  };
}

/**
 * HitBack ads API smoke test
 *
 * Exercises the full serve → impression → click flow against the live API.
 *
 * Run:
 *   npx tsx hitback-ads-test.ts
 *
 * Optional env:
 *   HITBACK_API_URL=https://api.hitback.xyz
 */

const API_URL = (process.env.HITBACK_API_URL || "https://api.hitback.xyz").replace(/\/$/, "");
const TEST_USER_ID = `smoke-test-${Date.now()}`;

interface AdResponse {
  id: string;
  text: string;
  url: string;
  imageUrl?: string;
  impressionToken: string;
  clickToken: string;
}

function ok(cond: boolean, label: string): void {
  if (!cond) {
    throw new Error(`FAIL: ${label}`);
  }
  console.log(`ok ${label}`);
}

async function fetchJson(
  path: string,
  options: RequestInit = {}
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${API_URL}${path}`, options);
  let body: unknown = null;

  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return { status: response.status, body };
}

async function testHealth(): Promise<void> {
  const { status, body } = await fetchJson("/health");
  ok(status === 200, "GET /health returns 200");

  const data = body as { status?: string; supabase?: string };
  ok(data.status === "ok", "health status is ok");
  console.log(`   supabase: ${data.supabase ?? "unknown"}`);
}

async function testCurrentAdRequiresUserId(): Promise<void> {
  const { status } = await fetchJson("/api/ads/current");
  ok(status === 400, "GET /api/ads/current without user id returns 400");
}

async function testFetchCurrentAd(): Promise<AdResponse> {
  const { status, body } = await fetchJson("/api/ads/current", {
    headers: {
      Accept: "application/json",
      "X-HitBack-User-Id": TEST_USER_ID,
    },
  });

  ok(status === 200, "GET /api/ads/current returns 200");

  const ad = body as AdResponse;
  ok(typeof ad.id === "string" && ad.id.length > 0, "ad has id");
  ok(typeof ad.text === "string" && ad.text.length > 0, "ad has text");
  ok(typeof ad.url === "string" && ad.url.startsWith("http"), "ad has url");
  ok(typeof ad.impressionToken === "string" && ad.impressionToken.includes("."), "ad has impressionToken");
  ok(typeof ad.clickToken === "string" && ad.clickToken.includes("."), "ad has clickToken");

  console.log(`   served: "${ad.text}" (${ad.id})`);
  return ad;
}

async function testRecordImpression(impressionToken: string): Promise<void> {
  const { status, body } = await fetchJson("/api/impressions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ impressionToken }),
  });

  ok(status === 200, "POST /api/impressions returns 200");

  const data = body as { success?: boolean };
  ok(data.success === true, "impression recorded successfully");
}

async function testImpressionTokenIsSingleUse(impressionToken: string): Promise<void> {
  const { status } = await fetchJson("/api/impressions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ impressionToken }),
  });

  ok(status === 401 || status === 409, "reused impressionToken is rejected");
}

async function testRecordClick(clickToken: string): Promise<void> {
  const { status, body } = await fetchJson("/api/clicks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clickToken }),
  });

  ok(status === 200, "POST /api/clicks returns 200");

  const data = body as { success?: boolean; adId?: string };
  ok(data.success === true, "click recorded successfully");
  ok(typeof data.adId === "string", "click response includes adId");
}

async function testLegacyImpressionBodyRejected(): Promise<void> {
  const { status } = await fetchJson("/api/impressions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      campaignId: "fake-campaign",
      extensionUserId: TEST_USER_ID,
    }),
  });

  ok(status === 400, "legacy campaignId body is rejected");
}

async function runAdsSmokeTest(): Promise<void> {
  console.log(`HitBack ads smoke test`);
  console.log(`API: ${API_URL}`);
  console.log(`User: ${TEST_USER_ID}\n`);

  await testHealth();
  await testCurrentAdRequiresUserId();
  await testLegacyImpressionBodyRejected();

  const ad = await testFetchCurrentAd();
  await testRecordImpression(ad.impressionToken);
  await testImpressionTokenIsSingleUse(ad.impressionToken);

  // Fresh serve for click token (impression token from first serve is consumed)
  const ad2 = await testFetchCurrentAd();
  await testRecordClick(ad2.clickToken);

  console.log("\nAll ads smoke tests passed.");
}

runAdsSmokeTest().catch((err) => {
  console.error("\nAds smoke test failed.");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

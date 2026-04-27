// Lightweight smoke check for the canonical operational spine REST APIs.
// Run with `npm run smoke:canonical-apis`. Set BASE_URL (required) and
// optionally COOKIE for authenticated checks.
//
// Exit codes:
//   0  every endpoint returned an acceptable status
//        - With COOKIE  : 200 OK
//        - Without COOKIE: 401 (auth wall is the expected response — proves
//                          the route is mounted and gate is working)
//   1  BASE_URL missing, network/server failure, or any unexpected status

const ENDPOINTS = [
  "/api/execution-cases?limit=1",
  "/api/patient-journey-events?limit=1",
  "/api/global-schedule-events?limit=1",
  "/api/scheduling-triage-cases?limit=1",
  "/api/insurance-eligibility-reviews?limit=1",
  "/api/cooldown-records?limit=1",
  "/api/document-requirements?limit=1",
  "/api/case-document-readiness?limit=1",
  "/api/procedure-events?limit=1",
  "/api/procedure-notes?limit=1",
  "/api/billing-readiness-checks?limit=1",
  "/api/billing-document-requests?limit=1",
  "/api/completed-billing-packages?limit=1",
  "/api/cash-price-settings?limit=1",
  "/api/projected-invoice-rows?limit=1",
  "/api/ancillary-document-templates?limit=1",
  "/api/admin-settings?limit=1",
] as const;

type CheckResult = {
  endpoint: string;
  status: number | null;
  ok: boolean;
  note: string;
};

function trimTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

async function checkOne(
  baseUrl: string,
  endpoint: string,
  cookie: string | null,
): Promise<CheckResult> {
  const url = `${baseUrl}${endpoint}`;
  const headers: Record<string, string> = {};
  if (cookie) headers["cookie"] = cookie;

  try {
    const res = await fetch(url, { method: "GET", headers });
    const expectedAuthed = 200;
    const expectedAnon = 401;

    if (cookie) {
      if (res.status === expectedAuthed) {
        return { endpoint, status: res.status, ok: true, note: "OK" };
      }
      return {
        endpoint,
        status: res.status,
        ok: false,
        note: `expected 200 (authed), got ${res.status}`,
      };
    }

    if (res.status === expectedAnon) {
      return { endpoint, status: res.status, ok: true, note: "401 (auth wall — expected without COOKIE)" };
    }
    if (res.status === expectedAuthed) {
      return { endpoint, status: res.status, ok: true, note: "200 (route is open or session detected)" };
    }
    return {
      endpoint,
      status: res.status,
      ok: false,
      note: `expected 200 or 401, got ${res.status}`,
    };
  } catch (err: any) {
    return {
      endpoint,
      status: null,
      ok: false,
      note: `network error: ${err.message ?? String(err)}`,
    };
  }
}

async function main() {
  const baseUrlRaw = process.env.BASE_URL;
  if (!baseUrlRaw) {
    console.error("[smoke:canonical-apis] BASE_URL is not set (e.g. http://localhost:5000)");
    process.exit(1);
  }
  const baseUrl = trimTrailingSlash(baseUrlRaw);
  const cookie = process.env.COOKIE ? process.env.COOKIE.trim() : null;

  console.log(`[smoke:canonical-apis] base=${baseUrl} authed=${cookie ? "yes" : "no"} endpoints=${ENDPOINTS.length}`);

  const results: CheckResult[] = [];
  for (const ep of ENDPOINTS) {
    const r = await checkOne(baseUrl, ep, cookie);
    results.push(r);
    const symbol = r.ok ? "✓" : "✗";
    const statusStr = r.status == null ? "ERR" : String(r.status);
    console.log(`  ${symbol} [${statusStr}] ${r.endpoint} — ${r.note}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`[smoke:canonical-apis] passed=${results.length - failed.length} failed=${failed.length}`);

  if (failed.length > 0) {
    console.error("[smoke:canonical-apis] FAIL");
    process.exit(1);
  }
  console.log("[smoke:canonical-apis] OK");
  process.exit(0);
}

main().catch((err) => {
  console.error("[smoke:canonical-apis] unexpected failure:", err);
  process.exit(1);
});

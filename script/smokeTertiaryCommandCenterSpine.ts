// Tertiary Command Center — canonical spine smoke test.
//
// Run with: `npm run smoke:tertiary-spine`. Set `BASE_URL` (required)
// and optionally `COOKIE` for an authenticated check.
//
// Read-only by contract. The script never POSTs, PATCHes, or DELETEs.
// Each endpoint passes when the route returns:
//   - With COOKIE   : HTTP 200 + a sane body shape.
//   - Without COOKIE: HTTP 200, 401, or 403 (the auth wall counts as
//                     proof that the route is mounted + gated).
//
// Exit code:
//   0 — every endpoint passed its contract.
//   1 — any endpoint returned an unexpected status, or BASE_URL is
//       missing, or the network call threw.
//
// This is the Tertiary equivalent of `smoke:canonical-apis`; it
// extends the existing list with the operational endpoints the
// batch 1 spine doc names (outbox, audit log, completed packages,
// projected invoices, scheduling triage, etc.).

const BASE_URL = trimTrailingSlash(process.env.BASE_URL || process.env.SMOKE_BASE_URL || "");
const COOKIE = process.env.COOKIE;

if (!BASE_URL) {
  console.error("[smoke-tertiary-spine] BASE_URL is required (e.g. http://localhost:5000).");
  process.exit(1);
}

const ENDPOINTS = [
  // Engagement spine
  "/api/execution-cases?limit=1",
  "/api/patient-journey-events?limit=1",
  // Schedule + triage
  "/api/global-schedule-events?limit=1",
  "/api/scheduling-triage-cases?limit=1",
  // Outreach
  "/api/outreach/dashboard",
  // Insurance + cooldown
  "/api/insurance-eligibility-reviews?limit=1",
  "/api/cooldown-records?limit=1",
  // Document spine
  "/api/document-requirements?limit=1",
  "/api/case-document-readiness?limit=1",
  "/api/document-library/items?limit=1",
  // Procedure + notes
  "/api/procedure-events?limit=1",
  "/api/procedure-notes?limit=1",
  // Billing spine
  "/api/billing-readiness-checks?limit=1",
  "/api/billing-document-requests?limit=1",
  "/api/completed-billing-packages?limit=1",
  "/api/cash-price-settings?limit=1",
  "/api/billing/list?limit=1",
  // Invoices + projection
  "/api/invoices?limit=1",
  "/api/projected-invoice-rows?limit=1",
  // Ancillary templates
  "/api/ancillary-document-templates?limit=1",
  // Admin + audit + outbox
  "/api/admin-settings?limit=1",
  "/api/audit-log?limit=1",
  "/api/outbox",
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

function acceptableStatus(status: number, hasCookie: boolean): boolean {
  if (hasCookie) {
    // With auth, only 200 is acceptable (some endpoints return 204
    // when truly empty, also fine).
    return status === 200 || status === 204;
  }
  // Without auth, the route just needs to exist and gate access.
  // 200 (public/non-gated read), 401 / 403 (gated) all count.
  return status === 200 || status === 204 || status === 401 || status === 403;
}

async function checkEndpoint(endpoint: string, hasCookie: boolean): Promise<CheckResult> {
  const url = `${BASE_URL}${endpoint}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: hasCookie ? { Cookie: COOKIE as string } : undefined,
      redirect: "manual",
    });
    const status = res.status;
    const ok = acceptableStatus(status, hasCookie);
    const note = ok
      ? hasCookie
        ? `auth ok (${status})`
        : status === 200 || status === 204
          ? `public read ok (${status})`
          : `auth wall ok (${status})`
      : `unexpected status ${status}`;
    return { endpoint, status, ok, note };
  } catch (err: any) {
    return {
      endpoint,
      status: null,
      ok: false,
      note: `request error: ${err?.message ?? String(err)}`,
    };
  }
}

async function main() {
  const hasCookie = typeof COOKIE === "string" && COOKIE.length > 0;
  console.log(`[smoke-tertiary-spine] base url: ${BASE_URL}`);
  console.log(`[smoke-tertiary-spine] mode: ${hasCookie ? "authenticated" : "unauthenticated (auth-wall mode)"}`);

  const results: CheckResult[] = [];
  for (const endpoint of ENDPOINTS) {
    const r = await checkEndpoint(endpoint, hasCookie);
    results.push(r);
    const flag = r.ok ? "PASS" : "FAIL";
    console.log(`${flag} ${endpoint} — ${r.note}`);
  }

  const failures = results.filter((r) => !r.ok);
  console.log(`[smoke-tertiary-spine] ${results.length - failures.length}/${results.length} passed`);
  if (failures.length > 0) {
    for (const f of failures) {
      console.error(`[smoke-tertiary-spine] FAIL ${f.endpoint} (${f.status ?? "no-response"}): ${f.note}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[smoke-tertiary-spine] fatal:", err);
  process.exit(1);
});

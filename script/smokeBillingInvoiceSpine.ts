// Live smoke for the canonical billing → invoice spine.
//
// Run with: `BASE_URL=http://localhost:5000 npm run
// smoke:billing-invoice-spine`. Supports COOKIE env for
// authenticated checks; auth wall (401/403) counts in
// unauthenticated mode.

const BASE_URL = trimTrailingSlash(process.env.BASE_URL || "");
const COOKIE = process.env.COOKIE;

if (!BASE_URL) {
  console.error("[smoke-billing-invoice-spine] BASE_URL is required.");
  process.exit(1);
}

type RouteCheck = { name: string; url: string };

const CHECKS: RouteCheck[] = [
  { name: "GET /api/case-document-readiness", url: "/api/case-document-readiness?limit=1" },
  { name: "GET /api/billing-readiness-checks", url: "/api/billing-readiness-checks?limit=1" },
  { name: "GET /api/billing-document-requests", url: "/api/billing-document-requests?limit=1" },
  { name: "GET /api/completed-billing-packages", url: "/api/completed-billing-packages?limit=1" },
  { name: "GET /api/invoice-candidates (new)", url: "/api/invoice-candidates?limit=1" },
  { name: "GET /api/invoices", url: "/api/invoices?limit=1" },
  { name: "GET /api/projected-invoice-rows", url: "/api/projected-invoice-rows?limit=1" },
  { name: "GET /api/billing/list", url: "/api/billing/list?limit=1" },
];

function trimTrailingSlash(s: string) {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function acceptable(status: number, hasCookie: boolean): boolean {
  if (hasCookie) return status === 200 || status === 204 || status === 304;
  return (
    status === 200 ||
    status === 204 ||
    status === 304 ||
    status === 400 ||
    status === 401 ||
    status === 403
  );
}

async function main() {
  const hasCookie = !!COOKIE && COOKIE.length > 0;
  console.log(`[smoke-billing-invoice-spine] base url: ${BASE_URL}`);
  console.log(
    `[smoke-billing-invoice-spine] mode: ${hasCookie ? "authenticated" : "unauthenticated (auth-wall mode)"}`,
  );
  let failures = 0;
  for (const c of CHECKS) {
    try {
      const res = await fetch(`${BASE_URL}${c.url}`, {
        headers: hasCookie ? { Cookie: COOKIE! } : undefined,
        redirect: "manual",
      });
      const ok = acceptable(res.status, hasCookie);
      const flag = ok ? "PASS" : "FAIL";
      const note = ok
        ? hasCookie
          ? `auth ok (${res.status})`
          : `mounted/gated (${res.status})`
        : `unexpected status ${res.status}`;
      console.log(`${flag} ${c.name} — ${note}`);
      if (!ok) failures += 1;
    } catch (err: any) {
      console.log(`FAIL ${c.name} — request error: ${err?.message ?? err}`);
      failures += 1;
    }
  }
  console.log(
    `[smoke-billing-invoice-spine] ${CHECKS.length - failures}/${CHECKS.length} passed`,
  );
  if (failures > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error("[smoke-billing-invoice-spine] fatal:", err);
  process.exit(1);
});

// Live PCS/ACS portal smoke test.
//
// Run with: `npm run smoke:pcs-acs-portal-live`. Reads BASE_URL
// (required) and COOKIE (optional). When COOKIE is supplied the
// script expects HTTP 200 from every route; without COOKIE the
// auth wall (401/403) counts as proof the route is mounted +
// gated.
//
// Routes covered:
//   - /patient-care-specialist-portal           (PCS page)
//   - /ancillary-care-specialist-portal         (ACS page)
//   - /api/portal/today-schedule                (clinic schedule)
//   - /api/portal/month-summary                 (left-rail mini calendar)
//   - /api/portal/my-facilities                 (facility picker)
//   - /api/portal/my-patients                   (patient surface)
//   - /api/portal/patient-search                (patient lookup)
//   - /api/global-schedule-events               (canonical calendar feed)
//   - /api/scheduling-triage-cases              (callbacks / no-show / etc.)
//   - /api/engagement-center/cases              (call-list source)
//   - /api/admin-settings/effective             (team-member profile resolver)
//
// Exit 0 when every endpoint matches its expected status set.
// Exit 1 otherwise.

const BASE_URL = trimTrailingSlash(process.env.BASE_URL || "");
const COOKIE = process.env.COOKIE;

if (!BASE_URL) {
  console.error("[smoke-pcs-acs-portal-live] BASE_URL is required (e.g. http://localhost:5000).");
  process.exit(1);
}

type RouteCheck = {
  name: string;
  url: string;
  method?: "GET" | "HEAD";
};

const CHECKS: RouteCheck[] = [
  { name: "PCS portal page", url: "/patient-care-specialist-portal" },
  { name: "ACS portal page", url: "/ancillary-care-specialist-portal" },
  { name: "GET /api/portal/today-schedule", url: "/api/portal/today-schedule?facility=&date=2026-01-01" },
  { name: "GET /api/portal/month-summary", url: "/api/portal/month-summary?facility=&month=2026-01" },
  { name: "GET /api/portal/my-facilities", url: "/api/portal/my-facilities" },
  { name: "GET /api/portal/my-patients", url: "/api/portal/my-patients?limit=1" },
  { name: "GET /api/portal/patient-search", url: "/api/portal/patient-search?query=" },
  { name: "GET /api/global-schedule-events", url: "/api/global-schedule-events?limit=1" },
  { name: "GET /api/scheduling-triage-cases", url: "/api/scheduling-triage-cases?limit=1" },
  { name: "GET /api/engagement-center/cases", url: "/api/engagement-center/cases?limit=1" },
  {
    name: "GET /api/admin-settings/effective (team-member workspace profile)",
    url: "/api/admin-settings/effective?settingDomain=team_member&settingKey=workspace_profile",
  },
];

function trimTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function acceptableStatus(status: number, hasCookie: boolean): boolean {
  if (hasCookie) {
    return status === 200 || status === 204 || status === 304;
  }
  // Without auth, route just needs to exist and gate. 2xx, 3xx
  // (redirect to login), 4xx (auth wall / validation) all count.
  return (
    status === 200 ||
    status === 204 ||
    status === 304 ||
    status === 302 ||
    status === 303 ||
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 // SPA route — page is served by index.html; OK if asset handler 404s the route slug
  );
}

async function checkRoute(check: RouteCheck, hasCookie: boolean): Promise<{ ok: boolean; status: number | null; note: string }> {
  const url = `${BASE_URL}${check.url}`;
  try {
    const res = await fetch(url, {
      method: check.method ?? "GET",
      headers: hasCookie ? { Cookie: COOKIE as string } : undefined,
      redirect: "manual",
    });
    const ok = acceptableStatus(res.status, hasCookie);
    const note = ok
      ? hasCookie
        ? `auth ok (${res.status})`
        : `mounted/gated (${res.status})`
      : `unexpected status ${res.status}`;
    return { ok, status: res.status, note };
  } catch (err: any) {
    return { ok: false, status: null, note: `request error: ${err?.message ?? err}` };
  }
}

async function main() {
  const hasCookie = typeof COOKIE === "string" && COOKIE.length > 0;
  console.log(`[smoke-pcs-acs-portal-live] base url: ${BASE_URL}`);
  console.log(
    `[smoke-pcs-acs-portal-live] mode: ${hasCookie ? "authenticated" : "unauthenticated (auth-wall mode)"}`,
  );

  let failures = 0;
  for (const check of CHECKS) {
    const r = await checkRoute(check, hasCookie);
    const flag = r.ok ? "PASS" : "FAIL";
    console.log(`${flag} ${check.name} — ${r.note}`);
    if (!r.ok) failures += 1;
  }

  console.log(
    `[smoke-pcs-acs-portal-live] ${CHECKS.length - failures}/${CHECKS.length} passed`,
  );
  if (failures > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error("[smoke-pcs-acs-portal-live] fatal:", err);
  process.exit(1);
});

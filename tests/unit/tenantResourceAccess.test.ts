// ADR-002 Stage B — reusable table-driven tenant/IDOR access tests.
//
// Because every high-risk PHI resource family (patients, documents, orders,
// procedure notes, billing, schedule, engagement, portal cases) enforces
// ownership through the SAME helper `checkTenantResourceAccess(ctx, clinicId)`,
// one table-driven suite proves the policy for ALL of them — no need for
// hundreds of duplicated per-route tests. Route handlers apply the helper via
// `enforceTenantResource(req,res,resourceClinicId)`.
//
// Run: npx tsx tests/unit/tenantResourceAccess.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkTenantResourceAccess,
  type TenantContext,
} from "../../server/lib/tenantContext";

const ROOT = process.cwd();
let failures = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL  ${name}: ${(e as Error).message}`);
  }
};

const clinicA: TenantContext = { kind: "clinic", clinicId: 1 };
const clinicB: TenantContext = { kind: "clinic", clinicId: 2 };
const platform: TenantContext = { kind: "platform" };
const denied: TenantContext = { kind: "denied", reason: "no_clinic_assigned" };
const unauth: TenantContext = { kind: "denied", reason: "unauthenticated" };

// Policy matrix — applies identically to patients/documents/orders/procedures/
// billing/schedule/engagement/portal cases.
const cases: Array<{
  name: string;
  ctx: TenantContext;
  resourceClinicId: number | null;
  expect: "ok" | 403 | 404;
}> = [
  { name: "clinic A → own-clinic resource (A) = allowed", ctx: clinicA, resourceClinicId: 1, expect: "ok" },
  { name: "clinic A → cross-clinic resource (B) = 404 (no existence leak)", ctx: clinicA, resourceClinicId: 2, expect: 404 },
  { name: "clinic B → cross-clinic resource (A) = 404", ctx: clinicB, resourceClinicId: 1, expect: 404 },
  { name: "clinic A → resource with NO clinic (null) = 404", ctx: clinicA, resourceClinicId: null, expect: 404 },
  { name: "platform/admin → any clinic = allowed", ctx: platform, resourceClinicId: 2, expect: "ok" },
  { name: "platform/admin → null-clinic resource = allowed", ctx: platform, resourceClinicId: null, expect: "ok" },
  { name: "denied (no clinic) → 403", ctx: denied, resourceClinicId: 1, expect: 403 },
  { name: "denied (unauthenticated) → 403", ctx: unauth, resourceClinicId: 1, expect: 403 },
];

for (const c of cases) {
  check(c.name, () => {
    const r = checkTenantResourceAccess(c.ctx, c.resourceClinicId);
    if (c.expect === "ok") {
      assert.equal(r.ok, true);
    } else {
      assert.equal(r.ok, false);
      assert.equal((r as any).httpStatus, c.expect);
      // No PHI in denial responses.
      assert.ok(!/name|dob|mrn|patient/i.test((r as any).error), "denial error is generic");
    }
  });
}

// Guard: cross-clinic must NEVER be "ok".
check("no context+resource combination allows cross-clinic clinic access", () => {
  for (const a of [1, 2, 3]) {
    for (const b of [1, 2, 3]) {
      const r = checkTenantResourceAccess({ kind: "clinic", clinicId: a }, b);
      if (a !== b) assert.equal(r.ok, false, `clinic ${a} must not access clinic ${b}`);
    }
  }
});

// The patient detail route actually applies the helper before returning PHI.
check("GET /api/patients/:id enforces tenant BEFORE returning the patient", () => {
  const src = readFileSync(join(ROOT, "server/routes/patients.ts"), "utf8");
  // enforceTenantResource must appear between the getPatientScreening load and res.json(patient)
  assert.ok(src.includes("enforceTenantResource(req, res"), "route applies enforcement helper");
  // Scope to the GET-by-id handler specifically (the read-by-id IDOR path).
  const getStart = src.indexOf('app.get("/api/patients/:id"');
  assert.ok(getStart > 0, "GET /api/patients/:id handler present");
  const getHandler = src.slice(getStart, getStart + 900);
  const enforceIdx = getHandler.indexOf("enforceTenantResource(req, res");
  const jsonIdx = getHandler.indexOf("res.json(patient)");
  assert.ok(enforceIdx > 0, "GET-by-id applies enforcement helper");
  assert.ok(jsonIdx > 0, "GET-by-id returns res.json(patient)");
  assert.ok(enforceIdx < jsonIdx, "enforcement must run before res.json(patient)");
});

check("patient audit no longer logs patient name (PHI) into changes", () => {
  const src = readFileSync(join(ROOT, "server/routes/patients.ts"), "utf8");
  assert.ok(!/logAudit\(req, "delete", "patient", id, \{ name:/.test(src), "delete audit must not log patient name");
});

// Screening-keyed clinical sub-resources (clinical-data, encounters, prior-tests,
// admin-review, episode-documents, communications GET+POST) must all enforce
// tenant ownership via the shared guard before returning/writing PHI.
check("clinicalData family enforces tenant on every screening-keyed route", () => {
  const src = readFileSync(join(ROOT, "server/routes/clinicalData.ts"), "utf8");
  const routeCount = (src.match(/app\.(get|post)\(/g) || []).length;
  const guardCount = (src.match(/enforceScreeningTenant\(req, res/g) || []).length;
  assert.ok(routeCount >= 7, `expected >=7 routes, found ${routeCount}`);
  assert.equal(
    guardCount,
    routeCount,
    `every route must enforce tenant (routes=${routeCount}, guards=${guardCount})`,
  );
  // No raw error.message leaks remain in this family.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/error:\s*error\.message/.test(code), "no raw error.message leaks");
});

check("enforceScreeningTenant guard loads screening then enforces (order matters)", () => {
  const src = readFileSync(join(ROOT, "server/middleware/tenantResourceGuards.ts"), "utf8");
  assert.ok(
    src.indexOf("getPatientScreening(screeningId)") < src.indexOf("enforceTenantResource(req, res"),
    "must load screening (to get clinicId) before enforcing",
  );
  assert.ok(src.includes('res.status(404)'), "not-found / cross-clinic returns 404 (no existence leak)");
});

if (failures > 0) {
  console.error(`\ntenantResourceAccess.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`\ntenantResourceAccess.test.ts: all tests passed`);

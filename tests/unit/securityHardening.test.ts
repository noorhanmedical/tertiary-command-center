// Security hardening regression tests (ADR-002 Stage A + PHI-safe error/headers
// + request observability). Pure/unit — no DB required.
//
// Run: npx tsx tests/unit/securityHardening.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveTenantContext,
  tenantAllowsClinic,
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

// ── ADR-002 TenantContext (fail-closed) ─────────────────────────────────────
check("unauthenticated → denied", () => {
  const c = resolveTenantContext(null);
  assert.equal(c.kind, "denied");
  assert.equal((c as any).reason, "unauthenticated");
});

check("authenticated non-admin WITH clinic → clinic scope", () => {
  const c = resolveTenantContext({ userId: "u1", role: "scheduler", clinicId: 7 });
  assert.equal(c.kind, "clinic");
  assert.equal((c as any).clinicId, 7);
});

check("authenticated non-admin WITHOUT clinic → denied (fail-closed, never all)", () => {
  const c = resolveTenantContext({ userId: "u1", role: "scheduler", clinicId: null });
  assert.equal(c.kind, "denied");
  assert.equal((c as any).reason, "no_clinic_assigned");
});

check("null/undefined clinic NEVER means platform/all-clinics", () => {
  for (const clinicId of [null, undefined] as const) {
    const c = resolveTenantContext({ userId: "u1", role: "clinician", clinicId });
    assert.notEqual(c.kind, "platform");
    assert.equal(c.kind, "denied");
  }
});

check("platform roles → platform scope", () => {
  for (const role of ["admin", "platform_admin", "technical_admin"]) {
    assert.equal(resolveTenantContext({ userId: "a", role }).kind, "platform");
  }
});

check("forged/non-platform role cannot escalate to platform", () => {
  const c = resolveTenantContext({ userId: "u1", role: "superuser_fake", clinicId: null });
  assert.equal(c.kind, "denied");
});

check("tenantAllowsClinic: clinic scope only its own; platform any; denied none", () => {
  const clinic: TenantContext = { kind: "clinic", clinicId: 7 };
  assert.equal(tenantAllowsClinic(clinic, 7), true);
  assert.equal(tenantAllowsClinic(clinic, 8), false, "cross-clinic must be refused");
  assert.equal(tenantAllowsClinic(clinic, null), false);
  assert.equal(tenantAllowsClinic({ kind: "platform" }, 999), true);
  assert.equal(
    tenantAllowsClinic({ kind: "denied", reason: "unauthenticated" }, 7),
    false,
  );
});

check("resolver ignores any client-supplied clinic — only session identity is used", () => {
  // The resolver's input type only accepts a SessionIdentity; there is no code
  // path that reads a clinic id from body/query/params. Assert the source file
  // never references req.body/query/params for scope.
  const src = readFileSync(join(ROOT, "server/lib/tenantContext.ts"), "utf8");
  assert.ok(!/req\.(body|query|params)/.test(src), "must not read client-supplied clinic");
  assert.ok(src.includes("session"), "resolves from session identity");
});

// ── PHI-safe error handler ──────────────────────────────────────────────────
check("error handler does not leak raw error / stack to client in production", () => {
  const src = readFileSync(join(ROOT, "server/middleware/errorHandler.ts"), "utf8");
  // Client body uses a generic message for 5xx (exposeMessage gate); never sends stack.
  assert.ok(src.includes('"Internal Server Error"'), "generic 5xx message present");
  assert.ok(/expose === true \|\| status < 500/.test(src), "expose gate present");
  assert.ok(!/res\.[a-z]+\([^)]*err\.stack/.test(src), "must not send stack to client");
  assert.ok(src.includes("request_id"), "correlates via request_id");
});

// ── Security headers ────────────────────────────────────────────────────────
check("security headers set + HSTS gated (off unless ENABLE_HSTS)", () => {
  const src = readFileSync(join(ROOT, "server/middleware/securityHeaders.ts"), "utf8");
  for (const h of [
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Content-Security-Policy",
    "Permissions-Policy",
  ]) {
    assert.ok(src.includes(h), `sets ${h}`);
  }
  assert.ok(/ENABLE_HSTS/.test(src), "HSTS gated behind ENABLE_HSTS");
  assert.ok(
    src.indexOf("Strict-Transport-Security") > src.indexOf("enableHsts"),
    "HSTS only emitted when enabled",
  );
});

// ── Request observability (PHI-safe) ────────────────────────────────────────
check("request observability never logs body/query; logs structural only", () => {
  const src = readFileSync(join(ROOT, "server/middleware/requestObservability.ts"), "utf8");
  assert.ok(!/req\.body/.test(src), "must not log request body");
  assert.ok(src.includes("request_id") && src.includes("route"), "logs safe metadata");
  assert.ok(src.includes("coarseTemplate") || src.includes("req.route"), "uses route template, not raw path");
});

// ── Wiring ──────────────────────────────────────────────────────────────────
check("server/index.ts wires securityHeaders, requestObservability, tenantContext", () => {
  const src = readFileSync(join(ROOT, "server/index.ts"), "utf8");
  assert.ok(src.includes("app.use(securityHeaders)"), "securityHeaders wired");
  assert.ok(src.includes("app.use(requestObservability)"), "requestObservability wired");
  assert.ok(src.includes("app.use(tenantContext)"), "tenantContext wired");
  assert.ok(src.includes('app.disable("x-powered-by")'), "x-powered-by disabled");
});

if (failures > 0) {
  console.error(`\nsecurityHardening.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`\nsecurityHardening.test.ts: all tests passed`);

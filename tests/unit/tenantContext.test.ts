import assert from "node:assert/strict";
import {
  resolveTenantContext,
  requireClinicId,
  isPlatformScope,
  getTenantScope,
  withSystemScope,
  runWithScope,
  resolveScopedClinicId,
} from "../../server/middleware/tenantContext";

// ADR-002 C.1: the tenant context must be fail-closed. `null`/absent scope must
// resolve to `denied`, NEVER to an unscoped (all-clinic) query. Admin is the only
// path to platform (unscoped) access.

function testResolver(): void {
  // Admin → explicit platform scope (the only unscoped path).
  assert.deepEqual(
    resolveTenantContext({ userId: "u1", role: "admin", clinicId: null }),
    { kind: "platform" },
  );
  // Admin with a clinicId still resolves to platform (role wins).
  assert.deepEqual(
    resolveTenantContext({ userId: "u1", role: "admin", clinicId: 5 }),
    { kind: "platform" },
  );

  // Authenticated non-admin with a valid clinic → clinic scope.
  assert.deepEqual(
    resolveTenantContext({ userId: "u2", role: "clinician", clinicId: 7 }),
    { kind: "clinic", clinicId: 7 },
  );

  // Authenticated non-admin WITHOUT a clinic → denied (fail-closed), NOT platform.
  for (const bad of [null, undefined, 0, -1, 1.5, "3", Number.NaN]) {
    const ctx = resolveTenantContext({ userId: "u3", role: "clinician", clinicId: bad as unknown });
    assert.equal(ctx.kind, "denied", `clinicId=${String(bad)} must deny, not widen scope`);
    if (ctx.kind === "denied") assert.equal(ctx.reason, "no_clinic_assigned");
  }

  // Unauthenticated → denied.
  const anon = resolveTenantContext({ userId: undefined, role: undefined, clinicId: undefined });
  assert.equal(anon.kind, "denied");
  if (anon.kind === "denied") assert.equal(anon.reason, "unauthenticated");

  // A non-admin role must never reach platform scope regardless of clinicId.
  for (const role of ["clinician", "scheduler", "biller", "technician", "liaison", undefined]) {
    const ctx = resolveTenantContext({ userId: "u", role, clinicId: null });
    assert.notEqual(ctx.kind, "platform", `role=${String(role)} must not get platform scope`);
  }
}

function testRequireClinicId(): void {
  assert.equal(requireClinicId({ kind: "clinic", clinicId: 9 }), 9);
  assert.equal(requireClinicId({ kind: "platform" }), null); // unscoped, intentional
  assert.equal(isPlatformScope({ kind: "platform" }), true);
  assert.equal(isPlatformScope({ kind: "clinic", clinicId: 1 }), false);

  // Denied scope must THROW so a repository can never accidentally run unscoped.
  assert.throws(
    () => requireClinicId({ kind: "denied", reason: "no_clinic_assigned" }),
    (err: unknown) => (err as { code?: string }).code === "TENANT_SCOPE_DENIED",
  );
}

async function testAsyncScopeGuard(): Promise<void> {
  // ADR-006: resolveScopedClinicId() reads the async tenant store.

  // No active store → fail closed (throws), NOT unscoped.
  assert.equal(getTenantScope(), undefined);
  assert.throws(
    () => resolveScopedClinicId(),
    (err: unknown) => (err as { code?: string }).code === "TENANT_SCOPE_DENIED",
    "missing scope must throw, never run unscoped",
  );

  // System scope → platform (unscoped), and it must survive across awaits.
  const clinicIdUnderSystem = await withSystemScope(async () => {
    const before = resolveScopedClinicId();
    await Promise.resolve();
    const after = resolveScopedClinicId();
    assert.equal(before, null);
    assert.equal(after, null, "system scope must persist across await boundaries");
    return after;
  });
  assert.equal(clinicIdUnderSystem, null);

  // After the system-scope callback returns, we are unscoped again → fail closed.
  assert.throws(() => resolveScopedClinicId());
}

async function testDetachedScopeReestablishment(): Promise<void> {
  // ADR-006: a detached background job (like the batch analysis runner) captures
  // the request scope at kickoff and re-establishes it via runWithScope so it does
  // NOT depend on implicit propagation surviving the request.

  // Simulate a request under "Clinic 7" scope and capture the scope at kickoff,
  // exactly as the batch runner does. runWithScope is the module's public
  // scope-establishing primitive, so seeding the "request" scope with it keeps the
  // test aligned with production semantics.
  const captured = await runWithScope({ kind: "clinic", clinicId: 7 }, async () =>
    getTenantScope(),
  );
  assert.deepEqual(captured, { kind: "clinic", clinicId: 7 });

  // We are now OUTSIDE any scope (fail-closed).
  assert.throws(() => resolveScopedClinicId());

  // Detached work re-establishes the captured scope: sees clinic 7, across awaits.
  await runWithScope(captured, async () => {
    assert.equal(resolveScopedClinicId(), 7);
    await Promise.resolve();
    assert.equal(resolveScopedClinicId(), 7, "captured clinic scope must persist across await");
  });

  // A different clinic's captured scope must not leak into an unrelated run.
  await runWithScope({ kind: "clinic", clinicId: 99 }, async () => {
    assert.equal(resolveScopedClinicId(), 99);
  });

  // runWithScope(undefined) → no store established → fail closed if a guard is hit.
  await runWithScope(undefined, async () => {
    assert.throws(() => resolveScopedClinicId(), "undefined captured scope must fail closed");
  });

  // Platform captured scope → unscoped.
  await runWithScope({ kind: "platform" }, async () => {
    assert.equal(resolveScopedClinicId(), null);
  });

  // Denied captured scope → throws (never runs unscoped).
  await runWithScope({ kind: "denied", reason: "no_clinic_assigned" }, async () => {
    assert.throws(() => resolveScopedClinicId());
  });
}

async function main(): Promise<void> {
  testResolver();
  testRequireClinicId();
  await testAsyncScopeGuard();
  await testDetachedScopeReestablishment();
  console.log("tenantContext.test.ts: all tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

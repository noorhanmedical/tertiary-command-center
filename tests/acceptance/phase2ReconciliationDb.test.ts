// Phase 2 — REAL-DB checks for the clinic-local 5 AM canonical reconciliation
// (gating, per-clinic timezone, clinic-scoped pool, no fabricated attempts).
// Phase 2B updates: durable run-once (ledger), fail-closed invalid timezone.
// Honest skip when DATABASE_URL is unset/unreachable.
//
// Run: DATABASE_URL=... npx tsx tests/acceptance/phase2ReconciliationDb.test.ts

import assert from "node:assert/strict";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("SKIP phase2ReconciliationDb: DATABASE_URL not set.");
    return;
  }
  const { sql, eq, inArray } = await import("drizzle-orm");
  const { db } = await import("../../server/db");
  try {
    await db.execute(sql`select 1`);
  } catch (e) {
    console.log(`SKIP phase2ReconciliationDb: cannot reach database — ${(e as Error).message}`);
    return;
  }

  const { clinics } = await import("../../shared/schema/clinics");
  const { patientScreenings, screeningBatches } = await import("../../shared/schema/screening");
  const { patientExecutionCases, patientJourneyEvents } = await import("../../shared/schema/executionCase");
  const { outreachCalls } = await import("../../shared/schema/outreach");
  const { engagementReconciliationRuns } = await import("../../shared/schema/reconciliationRuns");
  const { gatherEligibleCases } = await import("../../server/services/engagement/distributionService");
  const { reconcileClinic } = await import("../../server/services/engagement/dailyReconciliation");
  const { __resetClinicTimeZoneCacheForTests } = await import("../../server/services/engagement/clinicTimeZone");

  // Deterministic no-op allocator so gating/timezone/run-once checks never touch
  // real distribution/members. Real applyDistribution wiring is covered by
  // phase2bReconciliationLedgerDb + the distribution suites.
  const noopReconcile = async () => ({ applied: 0, skipped: 0 });

  const marker = `__P2REC_${Date.now()}`;
  const clinicIds: number[] = [];
  const scrIds: number[] = [];
  const caseIds: number[] = [];
  let batchId: number | null = null;

  const insClinic = async (suffix: string, timezone: string) => {
    const [c] = await db
      .insert(clinics)
      .values({ name: `${marker}_${suffix}`, slug: `${marker.toLowerCase().replace(/_/g, "-")}-${suffix}`, timezone, active: true } as never)
      .returning();
    clinicIds.push(c.id);
    return c;
  };
  const insCase = async (clinicId: number, suffix: string) => {
    const [s] = await db
      .insert(patientScreenings)
      .values({ batchId: batchId as number, name: `${marker}_${suffix}`, isTest: true } as never)
      .returning();
    scrIds.push(s.id);
    const [c] = await db
      .insert(patientExecutionCases)
      .values({
        patientName: `${marker}_${suffix}`,
        patientScreeningId: s.id,
        clinicId,
        facilityId: `${marker}_fac_${suffix}`,
        engagementBucket: "outreach",
        engagementStatus: "new",
        lifecycleStatus: "active",
      } as never)
      .returning();
    caseIds.push(c.id);
    return { screening: s, execCase: c };
  };

  try {
    __resetClinicTimeZoneCacheForTests();
    const [batch] = await db.insert(screeningBatches).values({ name: marker } as never).returning();
    batchId = batch.id;

    const clinicNY = await insClinic("NY", "America/New_York");
    const clinicLA = await insClinic("LA", "America/Los_Angeles");
    const clinicBad = await insClinic("BAD", "Not/AZone"); // explicit INVALID value

    const a = await insCase(clinicNY.id, "A");
    const b = await insCase(clinicLA.id, "B");

    // ── Clinic-scoped eligible-case pool ──────────────────────────────────────
    const poolNY = await gatherEligibleCases(db, { clinicId: clinicNY.id });
    const poolLA = await gatherEligibleCases(db, { clinicId: clinicLA.id });
    assert.ok(poolNY.some((c) => c.executionCaseId === a.execCase.id), "NY pool includes caseA");
    assert.ok(!poolNY.some((c) => c.executionCaseId === b.execCase.id), "NY pool EXCLUDES caseB (other clinic)");
    assert.ok(poolLA.some((c) => c.executionCaseId === b.execCase.id), "LA pool includes caseB");
    assert.ok(!poolLA.some((c) => c.executionCaseId === a.execCase.id), "LA pool EXCLUDES caseA (other clinic)");
    const poolNone = await gatherEligibleCases(db, { clinicId: -999999 });
    assert.ok(!poolNone.some((c) => c.executionCaseId === a.execCase.id || c.executionCaseId === b.execCase.id), "nonexistent clinic → empty scope");

    // ── Per-clinic timezone gating (SAME instant, DIFFERENT decisions) ────────
    // 2026-06-15T10:30Z → New York 06:30 (EDT, past 5 AM) / Los Angeles 03:30
    // (PDT, before 5 AM). Same instant, opposite reconcile decisions.
    const now = new Date("2026-06-15T10:30:00Z");
    const rNY = await reconcileClinic({ id: clinicNY.id, name: clinicNY.name }, now, null, { reconcile: noopReconcile });
    assert.equal(rNY.timeZone, "America/New_York", "NY tz resolved from clinics.timezone");
    assert.equal(rNY.timeZoneStatus, "valid");
    assert.equal(rNY.localHour, 6, "NY local hour 06 at 10:30Z (EDT)");
    assert.equal(rNY.status, "reconciled", "NY reconciled (past 5 AM local)");
    assert.equal(rNY.triggerType, "catch_up", "06:00 (past the 5 o'clock hour) → catch_up");

    const rLA = await reconcileClinic({ id: clinicLA.id, name: clinicLA.name }, now, null, { reconcile: noopReconcile });
    assert.equal(rLA.timeZone, "America/Los_Angeles");
    assert.equal(rLA.localHour, 3, "LA local hour 03 at 10:30Z (PDT)");
    assert.equal(rLA.status, "skipped_before_hour", "LA NOT reconciled (before 5 AM local) — proves per-clinic timing");

    // ── Run-once per clinic per local day (DURABLE — via the ledger) ──────────
    const rNY2 = await reconcileClinic({ id: clinicNY.id, name: clinicNY.name }, now, null, { reconcile: noopReconcile });
    assert.equal(rNY2.status, "skipped_already_succeeded", "NY second run same local day skipped (durable success)");

    // ── Invalid timezone → FAIL CLOSED (does NOT reconcile in Central) ────────
    const rBad = await reconcileClinic({ id: clinicBad.id, name: clinicBad.name }, now, null, { reconcile: noopReconcile });
    assert.equal(rBad.status, "configuration_error", "invalid tz → clinic does NOT reconcile (fail closed)");
    assert.equal(rBad.timeZoneStatus, "invalid_timezone");
    assert.equal(rBad.failureCode, "invalid_timezone");

    // ── No fabricated call attempts / dispositions ────────────────────────────
    const callsA = await db.select().from(outreachCalls).where(eq(outreachCalls.patientScreeningId, a.screening.id));
    assert.equal(callsA.length, 0, "reconciliation created NO outreach_calls (no fabricated attempts)");
    const [ecA] = await db.select().from(patientExecutionCases).where(eq(patientExecutionCases.id, a.execCase.id));
    assert.equal(ecA?.callAttemptCount ?? 0, 0, "attempt count unchanged");
    assert.equal(ecA?.lastCallOutcome ?? null, null, "no disposition fabricated");

    console.log("phase2ReconciliationDb: all real-DB reconciliation checks passed.");
  } finally {
    try {
      if (clinicIds.length) await db.delete(engagementReconciliationRuns).where(inArray(engagementReconciliationRuns.clinicId, clinicIds));
      if (scrIds.length) await db.delete(outreachCalls).where(inArray(outreachCalls.patientScreeningId, scrIds));
      if (caseIds.length) await db.delete(patientJourneyEvents).where(inArray(patientJourneyEvents.executionCaseId, caseIds));
      if (scrIds.length) await db.delete(patientJourneyEvents).where(inArray(patientJourneyEvents.patientScreeningId, scrIds));
      if (caseIds.length) await db.delete(patientExecutionCases).where(inArray(patientExecutionCases.id, caseIds));
      if (scrIds.length) await db.delete(patientScreenings).where(inArray(patientScreenings.id, scrIds));
      if (batchId != null) await db.delete(screeningBatches).where(eq(screeningBatches.id, batchId));
      if (clinicIds.length) await db.delete(clinics).where(inArray(clinics.id, clinicIds));
    } catch (cleanupErr) {
      console.error("phase2ReconciliationDb cleanup warning:", (cleanupErr as Error).message);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

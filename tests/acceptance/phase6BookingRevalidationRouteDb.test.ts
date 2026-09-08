// Phase 6 — REAL-DB, ROUTE-level proof that booking revalidation FAILS CLOSED.
//
// Exercises the canonical scheduleAncillaryCore path (via scheduleAncillary
// CoreShared) and asserts:
//   §1 feasible slot        → NOT blocked (proceeds past revalidation).
//   §2 KNOWN conflict (outage) → 409 slot_unavailable + ZERO appointment writes
//      + NO scheduled-state advancement.
//   §3 feasibility read ERROR → 503 revalidation_unavailable (FAIL CLOSED) +
//      ZERO appointment writes + NO scheduled-state advancement.
//      UNKNOWN AVAILABILITY ≠ AVAILABLE.
//   §4 after the error clears → retry proceeds (recovers).
//   §5 an authorized OVERRIDE bypasses revalidation even under an injected
//      error — proving an ordinary system failure never behaves like an
//      override (override is the ONLY sanctioned bypass).
//
// Honest skip when DATABASE_URL is unset/unreachable. Fixtures deleted in
// `finally`. Run: DATABASE_URL=... npx tsx tests/acceptance/phase6BookingRevalidationRouteDb.test.ts

import assert from "node:assert/strict";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("SKIP phase6BookingRevalidationRouteDb: DATABASE_URL not set.");
    return;
  }
  const { sql, eq, inArray } = await import("drizzle-orm");
  const { db } = await import("../../server/db");
  try { await db.execute(sql`select 1`); }
  catch (e) { console.log(`SKIP phase6BookingRevalidationRouteDb: cannot reach database — ${(e as Error).message}`); return; }
  const reg = await db.execute(sql`SELECT 1 FROM information_schema.tables WHERE table_name='telephony_sessions' LIMIT 1`);
  if (!((reg.rows?.length ?? 0) > 0)) { console.log("SKIP: apply migration 0085."); return; }

  const express = (await import("express")).default;
  const { registerGlobalScheduleRoutes, scheduleAncillaryCoreShared } = await import("../../server/routes/globalSchedule");
  const { __setRevalidationErrorForTest } = await import("../../server/services/scheduling/availabilityService");
  const { createOverride, deactivateOverride } = await import("../../server/repositories/schedulingCapacity.repo");
  const { clinics } = await import("../../shared/schema/clinics");
  const { patientScreenings, screeningBatches } = await import("../../shared/schema/screening");
  const { patientExecutionCases } = await import("../../shared/schema/executionCase");

  // Initialize the shared core (sets the module-level _scheduleAncillaryCore).
  registerGlobalScheduleRoutes(express());

  const marker = `__P6REVAL_${Date.now()}`;
  const DATE = "2030-02-12";
  const startsAt = `${DATE}T10:00:00`;
  let clinicId = 0; let batchId = 0; let screeningId = 0; let caseId = 0; let overrideId: number | null = null;
  let failures = 0;
  const check = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); console.log(`ok   ${name}`); }
    catch (e) { failures++; console.error(`FAIL ${name}: ${(e as Error).message}`); }
  };

  const eventCount = async (): Promise<number> => {
    const r = await db.execute(
      sql`SELECT count(*)::int AS n FROM global_schedule_events WHERE execution_case_id=${caseId} OR patient_screening_id=${screeningId}`,
    );
    return Number((r.rows?.[0] as { n?: number })?.n ?? 0);
  };
  const engagementStatus = async (): Promise<string | null> => {
    const [row] = await db.select({ s: patientExecutionCases.engagementStatus }).from(patientExecutionCases).where(eq(patientExecutionCases.id, caseId)).limit(1);
    return (row?.s as string | null) ?? null;
  };

  try {
    const [clinic] = await db.insert(clinics).values({ name: `${marker}_c`, slug: `${marker.toLowerCase().replace(/_/g, "-")}`, timezone: "America/Chicago", active: true } as never).returning();
    clinicId = clinic.id;
    const [batch] = await db.insert(screeningBatches).values({ name: `${marker}_b` } as never).returning();
    batchId = batch.id;
    const [scr] = await db.insert(patientScreenings).values({ batchId, name: `${marker}_p`, isTest: true } as never).returning();
    screeningId = scr.id;
    const [ec] = await db.insert(patientExecutionCases).values({
      patientName: `${marker}_p`, patientDob: "1980-02-02", patientScreeningId: screeningId,
      clinicId, facilityId: `${marker}_fac`, engagementBucket: "outreach",
      engagementStatus: "not_reached", lifecycleStatus: "active", assignedTeamMemberId: null,
      selectedServices: ["BrainWave"], qualificationStatus: "qualified",
    } as never).returning();
    caseId = ec.id;

    const callCore = (extraMeta?: Record<string, unknown>) =>
      scheduleAncillaryCoreShared(
        {
          executionCaseId: caseId, patientScreeningId: screeningId,
          serviceType: "BrainWave", startsAt, facilityId: `${marker}_fac`,
          metadata: { source: "phase6_test", ...(extraMeta ?? {}) },
        } as never,
        null,
        clinicId,
      );

    await check("§1 feasible slot → NOT blocked by revalidation (proceeds)", async () => {
      const r = await callCore();
      assert.notEqual(r.httpStatus, 409, `should not be 409; got ${JSON.stringify(r)}`);
      assert.notEqual(r.httpStatus, 503, `should not be 503; got ${JSON.stringify(r)}`);
    });

    await check("§2 KNOWN conflict (outage) → 409 + ZERO writes + no scheduled advance", async () => {
      // Clear any event/state the feasible §1 may have created, then force outage.
      await db.execute(sql`DELETE FROM global_schedule_events WHERE execution_case_id=${caseId} OR patient_screening_id=${screeningId}`);
      await db.update(patientExecutionCases).set({ engagementStatus: "not_reached" } as never).where(eq(patientExecutionCases.id, caseId));
      const ov = await createOverride({ clinicId, resourceType: "brainwave", startDate: DATE, endDate: DATE, availableCapacity: 0, reason: "test", active: true } as never);
      overrideId = ov.id;
      const before = await eventCount();
      const r = await callCore();
      assert.equal(r.httpStatus, 409, `expected 409; got ${JSON.stringify(r)}`);
      assert.equal((r.body as { code?: string }).code, "slot_unavailable");
      assert.equal(await eventCount(), before, "no appointment write on conflict");
      assert.notEqual(await engagementStatus(), "scheduled", "no scheduled advance on conflict");
      if (overrideId != null) { await deactivateOverride(overrideId); overrideId = null; }
    });

    await check("§3 feasibility read ERROR → 503 FAIL CLOSED + ZERO writes + no advance", async () => {
      await db.execute(sql`DELETE FROM global_schedule_events WHERE execution_case_id=${caseId} OR patient_screening_id=${screeningId}`);
      await db.update(patientExecutionCases).set({ engagementStatus: "not_reached" } as never).where(eq(patientExecutionCases.id, caseId));
      const before = await eventCount();
      __setRevalidationErrorForTest(() => { throw new Error("simulated capacity read failure"); });
      try {
        const r = await callCore();
        assert.equal(r.httpStatus, 503, `expected 503 fail-closed; got ${JSON.stringify(r)}`);
        assert.equal((r.body as { code?: string }).code, "revalidation_unavailable");
        assert.equal(await eventCount(), before, "NO appointment write when availability cannot be verified");
        assert.notEqual(await engagementStatus(), "scheduled", "NO scheduled advance when cannot verify");
      } finally {
        __setRevalidationErrorForTest(null);
      }
    });

    await check("§4 after the error clears → retry proceeds (recovers)", async () => {
      const r = await callCore();
      assert.notEqual(r.httpStatus, 503, `should recover; got ${JSON.stringify(r)}`);
    });

    await check("§5 authorized OVERRIDE bypasses even under injected error (override ≠ system failure)", async () => {
      __setRevalidationErrorForTest(() => { throw new Error("simulated read failure"); });
      try {
        const r = await callCore({ override: { constraint: "full", reason: "authorized override" } });
        // With an explicit override, revalidation is skipped entirely → NOT a
        // 503/409 from revalidation. (An ordinary failure WITHOUT override was
        // §3's 503 — proving they behave differently.)
        assert.notEqual(r.httpStatus, 503, `override must bypass revalidation; got ${JSON.stringify(r)}`);
        assert.notEqual(r.httpStatus, 409, `override must bypass revalidation; got ${JSON.stringify(r)}`);
      } finally {
        __setRevalidationErrorForTest(null);
      }
    });
  } finally {
    __setRevalidationErrorForTest(null);
    if (overrideId != null) await deactivateOverride(overrideId).catch(() => {});
    try {
      if (caseId) await db.execute(sql`DELETE FROM global_schedule_events WHERE execution_case_id=${caseId} OR patient_screening_id=${screeningId}`);
      if (caseId) await db.delete(patientExecutionCases).where(eq(patientExecutionCases.id, caseId));
      if (screeningId) await db.delete(patientScreenings).where(eq(patientScreenings.id, screeningId));
      if (batchId) await db.delete(screeningBatches).where(eq(screeningBatches.id, batchId));
      if (clinicId) await db.delete(clinics).where(eq(clinics.id, clinicId));
    } catch (e) { console.error("cleanup warn:", (e as Error).message); }
  }

  if (failures > 0) { console.error(`phase6BookingRevalidationRouteDb.test.ts: ${failures} FAILURE(S)`); process.exit(1); }
  console.log("phase6BookingRevalidationRouteDb.test.ts: all tests passed");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

// Phase 2B — REAL-DB checks for the DURABLE reconciliation run ledger +
// fail-closed timezone. Uses an injected reconcile action so run-state,
// multi-instance, catch-up, and failure/retry are deterministic without
// touching real distribution/members. One scenario uses the REAL default
// allocator (clinic with no eligible cases) to prove end-to-end wiring.
//
// Honest skip when DATABASE_URL is unset/unreachable.
// Run: DATABASE_URL=... npx tsx tests/acceptance/phase2bReconciliationLedgerDb.test.ts

import assert from "node:assert/strict";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("SKIP phase2bReconciliationLedgerDb: DATABASE_URL not set.");
    return;
  }
  const { sql, eq, inArray, and } = await import("drizzle-orm");
  const { db } = await import("../../server/db");
  try {
    await db.execute(sql`select 1`);
  } catch (e) {
    console.log(`SKIP phase2bReconciliationLedgerDb: cannot reach database — ${(e as Error).message}`);
    return;
  }
  // Guard: the ledger migration must be applied.
  const reg = await db.execute(sql`SELECT to_regclass('engagement_reconciliation_runs') AS t`);
  if (!(reg.rows?.[0] as { t?: string } | undefined)?.t) {
    console.log("SKIP phase2bReconciliationLedgerDb: engagement_reconciliation_runs missing (apply migration 0082).");
    return;
  }

  const { clinics } = await import("../../shared/schema/clinics");
  const { engagementReconciliationRuns } = await import("../../shared/schema/reconciliationRuns");
  const { reconcileClinic } = await import("../../server/services/engagement/dailyReconciliation");
  const { findRun, hasSucceededRun } = await import("../../server/repositories/reconciliationRuns.repo");
  const { __resetClinicTimeZoneCacheForTests } = await import("../../server/services/engagement/clinicTimeZone");

  const JOB = "daily_engagement_reconciliation";
  const okReconcile = async () => ({ applied: 2, skipped: 1 });
  const failReconcile = async () => { throw new Error("forced reconcile failure"); };
  const slowOkReconcile = async () => { await sleep(200); return { applied: 0, skipped: 0 }; };

  const marker = `__P2BLED_${Date.now()}`;
  const clinicIds: number[] = [];
  const insClinic = async (suffix: string, timezone: string) => {
    const [c] = await db
      .insert(clinics)
      .values({ name: `${marker}_${suffix}`, slug: `${marker.toLowerCase().replace(/_/g, "-")}-${suffix}`, timezone, active: true } as never)
      .returning();
    clinicIds.push(c.id);
    return c;
  };

  // Chicago (CDT in June, UTC-5): local 05:30 = 10:30Z ; local 11:30 = 16:30Z.
  const chi0530 = (d: string) => new Date(`${d}T10:30:00Z`);
  const chi1130 = (d: string) => new Date(`${d}T16:30:00Z`);

  try {
    __resetClinicTimeZoneCacheForTests();
    const chi = await insClinic("CHI", "America/Chicago");
    const phx = await insClinic("PHX", "America/Phoenix");
    const bad = await insClinic("BAD", "Amerca/Los_Angeles"); // explicit typo → invalid

    const C = { id: chi.id, name: chi.name };

    // ── 1) No success → execution allowed (scheduled trigger at 05:30). ───────
    const d1 = "2026-03-16";
    const r1 = await reconcileClinic(C, chi0530(d1), null, { reconcile: okReconcile });
    assert.equal(r1.status, "reconciled", "1: fresh run reconciled");
    assert.equal(r1.triggerType, "scheduled", "1: 05:xx local → scheduled");
    const led1 = await findRun({ clinicId: chi.id, operationalDate: d1, jobType: JOB });
    assert.equal(led1?.status, "succeeded", "1: durable SUCCESS recorded");
    assert.equal(led1?.attemptCount, 1, "1: attempt 1");
    assert.equal(led1?.assignedCount, 2, "1: assignedCount persisted (non-PHI count)");
    assert.equal(led1?.timeZone, "America/Chicago", "1: tz recorded");

    // ── 2) SUCCESS exists → execution skipped (same date). ────────────────────
    const r2 = await reconcileClinic(C, chi0530(d1), null, { reconcile: failReconcile });
    assert.equal(r2.status, "skipped_already_succeeded", "2: success exists → skip (reconcile fn never called)");
    assert.equal((await findRun({ clinicId: chi.id, operationalDate: d1, jobType: JOB }))?.attemptCount, 1, "2: attempt unchanged");

    // ── 3) Restart simulation → durable SUCCESS still prevents rerun (even at
    //       a LATER hour). Clearing the tz cache simulates a fresh process. ────
    __resetClinicTimeZoneCacheForTests();
    const r3 = await reconcileClinic(C, chi1130(d1), null, { reconcile: failReconcile });
    assert.equal(r3.status, "skipped_already_succeeded", "3: durable success survives restart + later hour");

    // ── 4) FAILED → retry allowed → retry SUCCEEDS (new date). ────────────────
    const d2 = "2026-03-17";
    const r4a = await reconcileClinic(C, chi0530(d2), null, { reconcile: failReconcile });
    assert.equal(r4a.status, "error", "4: forced failure surfaced as error");
    const led4a = await findRun({ clinicId: chi.id, operationalDate: d2, jobType: JOB });
    assert.equal(led4a?.status, "failed", "4: ledger FAILED (not succeeded)");
    assert.equal(led4a?.failureCode, "reconcile_error", "4: failureCode recorded");
    assert.equal(await hasSucceededRun({ clinicId: chi.id, operationalDate: d2, jobType: JOB }), false, "4: not succeeded → retry allowed");

    const r4b = await reconcileClinic(C, chi0530(d2), null, { reconcile: okReconcile });
    assert.equal(r4b.status, "reconciled", "4: retry reconciled");
    const led4b = await findRun({ clinicId: chi.id, operationalDate: d2, jobType: JOB });
    assert.equal(led4b?.status, "succeeded", "4: final durable SUCCESS");
    assert.equal(led4b?.attemptCount, 2, "4: attempt incremented on retry (same logical run row)");
    // exactly ONE ledger row for this clinic/date/job (no duplicates).
    const rowsD2 = await db.select().from(engagementReconciliationRuns).where(and(
      eq(engagementReconciliationRuns.clinicId, chi.id),
      eq(engagementReconciliationRuns.operationalDate, d2),
    ));
    assert.equal(rowsD2.length, 1, "4: exactly ONE logical run row for the date");

    // ── 5) Catch-up with PRIOR FAILED at 11:30 (past 5 o'clock hour). ─────────
    const d3 = "2026-03-18";
    await reconcileClinic(C, chi1130(d3), null, { reconcile: failReconcile }); // fail first
    const r5 = await reconcileClinic(C, chi1130(d3), null, { reconcile: okReconcile });
    assert.equal(r5.status, "reconciled", "5: catch-up retry reconciled");
    assert.equal(r5.triggerType, "catch_up", "5: 11:xx local → catch_up");

    // ── 6) Multi-instance: two concurrent workers, exactly ONE runs. ──────────
    const d4 = "2026-03-19";
    const [ra, rb] = await Promise.all([
      reconcileClinic(C, chi0530(d4), null, { reconcile: slowOkReconcile }),
      reconcileClinic(C, chi0530(d4), null, { reconcile: slowOkReconcile }),
    ]);
    const statuses = [ra.status, rb.status].sort();
    const reconciledCount = [ra, rb].filter((r) => r.status === "reconciled").length;
    assert.equal(reconciledCount, 1, "6: exactly ONE concurrent worker reconciled");
    assert.ok(
      statuses.includes("reconciled") &&
        (statuses.includes("skipped_lock_contended") || statuses.includes("skipped_already_succeeded")),
      `6: loser cleanly skipped (got ${statuses.join(",")})`,
    );
    const rowsD4 = await db.select().from(engagementReconciliationRuns).where(and(
      eq(engagementReconciliationRuns.clinicId, chi.id),
      eq(engagementReconciliationRuns.operationalDate, d4),
    ));
    assert.equal(rowsD4.length, 1, "6: exactly ONE success row (no duplicate)");
    assert.equal(rowsD4[0].status, "succeeded", "6: the one row is succeeded");
    assert.equal(rowsD4[0].attemptCount, 1, "6: only one beginRun happened");

    // ── 7) Valid America/Phoenix → normal; invalid tz clinic does NOT stop it. ─
    const d5 = "2026-03-20";
    const rBad = await reconcileClinic({ id: bad.id, name: bad.name }, chi0530(d5), null, { reconcile: okReconcile });
    assert.equal(rBad.status, "configuration_error", "7: invalid tz → fail closed");
    assert.equal(rBad.failureCode, "invalid_timezone");
    // Phoenix (MST -7): 05:30 local = 12:30Z.
    const rPhx = await reconcileClinic({ id: phx.id, name: phx.name }, new Date(`${d5}T12:30:00Z`), null, { reconcile: okReconcile });
    assert.equal(rPhx.status, "reconciled", "7: valid Phoenix reconciles despite the other clinic's bad tz");
    assert.equal(rPhx.timeZone, "America/Phoenix");
    assert.equal(rPhx.localHour, 5);
    // The invalid clinic recorded a durable configuration_error (observable).
    const badRun = await db.select().from(engagementReconciliationRuns).where(eq(engagementReconciliationRuns.clinicId, bad.id));
    assert.ok(badRun.some((r) => r.status === "configuration_error" && r.failureCode === "invalid_timezone"), "7: durable configuration_error row");

    // ── 8) REAL applyDistribution wiring — clinic with no eligible cases. ─────
    const d6 = "2026-03-23";
    const rReal = await reconcileClinic(C, chi0530(d6), null); // DEFAULT reconcile = real allocator
    assert.equal(rReal.status, "reconciled", "8: real applyDistribution path reconciled");
    assert.equal(rReal.applied, 0, "8: no eligible cases for this test clinic → 0 assigned (no side effects)");

    console.log("phase2bReconciliationLedgerDb: all real-DB ledger/timezone checks passed.");
  } finally {
    try {
      if (clinicIds.length) await db.delete(engagementReconciliationRuns).where(inArray(engagementReconciliationRuns.clinicId, clinicIds));
      if (clinicIds.length) await db.delete(clinics).where(inArray(clinics.id, clinicIds));
    } catch (cleanupErr) {
      console.error("phase2bReconciliationLedgerDb cleanup warning:", (cleanupErr as Error).message);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

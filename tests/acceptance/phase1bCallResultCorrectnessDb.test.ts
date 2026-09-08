// Phase 1B — REAL-DB integration checks for the canonical call-result +
// eligibility correctness work. These need real Postgres SQL semantics (the
// shared fake-db harness cannot evaluate the DNC NOT-EXISTS predicate, the
// terminal-state exclusion, or a real transaction rollback), so this suite
// runs against the project's local Postgres.
//
// Honest skip: if DATABASE_URL is unset or the DB is unreachable, the suite
// prints SKIP and exits 0 (never fakes validation).
//
// Run: DATABASE_URL='postgres://localhost:5432/plexus' npx tsx tests/acceptance/phase1bCallResultCorrectnessDb.test.ts

import assert from "node:assert/strict";

const TEST_SCHED = 987654; // a roster id no real case uses

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("SKIP phase1bCallResultCorrectnessDb: DATABASE_URL not set — real-DB checks skipped.");
    return;
  }
  const { sql, eq, inArray } = await import("drizzle-orm");
  const { db } = await import("../../server/db");
  try {
    await db.execute(sql`select 1`);
  } catch (e) {
    console.log(`SKIP phase1bCallResultCorrectnessDb: cannot reach database — ${(e as Error).message}`);
    return;
  }

  const { patientScreenings, screeningBatches } = await import("../../shared/schema/screening");
  const { patientExecutionCases } = await import("../../shared/schema/executionCase");
  const { outreachCalls } = await import("../../shared/schema/outreach");
  const { listSchedulerPortalCases, patientScreeningHasDncColumn } = await import("../../server/repositories/executionCase.repo");
  const { gatherEligibleCases } = await import("../../server/services/engagement/distributionService");
  const { ensureCanonicalCallRecord } = await import("../../server/services/callResult/canonicalCallRecord");

  const marker = `__P1B_${Date.now()}`;
  const scrIds: number[] = [];
  const caseIds: number[] = [];
  let batchId: number | null = null;

  const insScreening = async (suffix: string) => {
    const [s] = await db
      .insert(patientScreenings)
      .values({ batchId: batchId as number, name: `${marker}_${suffix}`, isTest: true })
      .returning();
    scrIds.push(s.id);
    return s;
  };
  const insCase = async (
    scrId: number,
    suffix: string,
    fields: Record<string, unknown>,
  ) => {
    const [c] = await db
      .insert(patientExecutionCases)
      .values({ patientName: `${marker}_${suffix}`, patientScreeningId: scrId, engagementBucket: "outreach", ...fields } as never)
      .returning();
    caseIds.push(c.id);
    return c;
  };

  try {
    const [batch] = await db.insert(screeningBatches).values({ name: marker }).returning();
    batchId = batch.id;

    // ── DNC eligibility exclusion ────────────────────────────────────────────
    const scrA = await insScreening("A");
    const scrB = await insScreening("B");
    const caseA = await insCase(scrA.id, "A", { engagementStatus: "new", lifecycleStatus: "active" }); // unassigned
    const caseB = await insCase(scrB.id, "B", { engagementStatus: "new", lifecycleStatus: "active", assignedTeamMemberId: TEST_SCHED });

    let gather = await gatherEligibleCases();
    assert.ok(gather.some((c) => c.executionCaseId === caseA.id), "caseA eligible for distribution BEFORE DNC");
    let portal = await listSchedulerPortalCases({ assignedTeamMemberId: TEST_SCHED }, 500);
    assert.ok(portal.some((c) => c.id === caseB.id), "caseB on scheduler-portal BEFORE DNC");

    // Record a refusal disposition (the durable DNC signal).
    await db.insert(outreachCalls).values({ patientScreeningId: scrA.id, outcome: "refused_dnc", attemptNumber: 1 });
    await db.insert(outreachCalls).values({ patientScreeningId: scrB.id, outcome: "refused_dnc", attemptNumber: 1 });

    gather = await gatherEligibleCases();
    assert.ok(!gather.some((c) => c.executionCaseId === caseA.id), "caseA EXCLUDED from distribution AFTER DNC");
    portal = await listSchedulerPortalCases({ assignedTeamMemberId: TEST_SCHED }, 500);
    assert.ok(!portal.some((c) => c.id === caseB.id), "caseB EXCLUDED from scheduler-portal AFTER DNC");

    // ── Terminal-state exclusion (the state a terminal disposition writes) ────
    const scrC = await insScreening("C");
    const caseC = await insCase(scrC.id, "C", { engagementStatus: "closed", lifecycleStatus: "archived" }); // unassigned
    assert.ok(
      !(await gatherEligibleCases()).some((c) => c.executionCaseId === caseC.id),
      "terminal-closed case EXCLUDED from distribution",
    );
    const scrD = await insScreening("D");
    const caseD = await insCase(scrD.id, "D", { engagementStatus: "closed", lifecycleStatus: "archived", assignedTeamMemberId: TEST_SCHED });
    assert.ok(
      !(await listSchedulerPortalCases({ assignedTeamMemberId: TEST_SCHED }, 500)).some((c) => c.id === caseD.id),
      "terminal-closed case EXCLUDED from scheduler-portal",
    );

    // Sanity — an ACTIVE, non-DNC, assigned case IS surfaced (no over-exclusion).
    const scrE = await insScreening("E");
    const caseE = await insCase(scrE.id, "E", { engagementStatus: "new", lifecycleStatus: "active", assignedTeamMemberId: TEST_SCHED });
    assert.ok(
      (await listSchedulerPortalCases({ assignedTeamMemberId: TEST_SCHED }, 500)).some((c) => c.id === caseE.id),
      "active non-DNC case IS on the scheduler-portal (no over-exclusion)",
    );

    // ── SCHEDULED exclusion — shared predicate agreement (P0 #4 + Part 6) ─────
    // A successfully-scheduled case (engagementStatus="scheduled", the state
    // scheduleAncillaryCore writes and the state a "scheduled" disposition now
    // resolves to) must NOT be re-distributed NOR shown on the call list.
    // Regression guard for the "scheduled stays callable" leak and the
    // distribution/portal eligibility divergence.
    const scrF = await insScreening("F");
    const caseF = await insCase(scrF.id, "F", { engagementStatus: "scheduled", lifecycleStatus: "active" }); // unassigned
    assert.ok(
      !(await gatherEligibleCases()).some((c) => c.executionCaseId === caseF.id),
      "scheduled case EXCLUDED from distribution (never re-distributed)",
    );
    const scrG = await insScreening("G");
    const caseG = await insCase(scrG.id, "G", { engagementStatus: "scheduled", lifecycleStatus: "active", assignedTeamMemberId: TEST_SCHED });
    assert.ok(
      !(await listSchedulerPortalCases({ assignedTeamMemberId: TEST_SCHED }, 500)).some((c) => c.id === caseG.id),
      "scheduled case EXCLUDED from scheduler-portal call list",
    );

    // ── Terminal LIFECYCLE exclusion agreement ───────────────────────────────
    // cancelled / completed / archived lifecycle must be excluded by BOTH reads
    // even when engagementStatus is otherwise callable — closes the portal
    // blocklist gap that previously missed completed/cancelled lifecycle values
    // (distribution excluded them, the portal did not → the two disagreed).
    for (const lc of ["cancelled", "completed", "archived"]) {
      const scr = await insScreening(`L_${lc}`);
      const cUn = await insCase(scr.id, `L_${lc}_un`, { engagementStatus: "new", lifecycleStatus: lc }); // unassigned
      assert.ok(
        !(await gatherEligibleCases()).some((c) => c.executionCaseId === cUn.id),
        `lifecycle=${lc} EXCLUDED from distribution`,
      );
      const scr2 = await insScreening(`L_${lc}_a`);
      const cAs = await insCase(scr2.id, `L_${lc}_a`, { engagementStatus: "new", lifecycleStatus: lc, assignedTeamMemberId: TEST_SCHED });
      assert.ok(
        !(await listSchedulerPortalCases({ assignedTeamMemberId: TEST_SCHED }, 500)).some((c) => c.id === cAs.id),
        `lifecycle=${lc} EXCLUDED from scheduler-portal`,
      );
    }

    // ── DNC via the do_not_contact COLUMN (migration 0027) ───────────────────
    // The Patient Directory setDoNotContact writes the column WITHOUT a
    // refused_dnc call. When the DB has 0027, the SHARED gate must exclude such
    // a patient too (closes the directory-set-DNC bypass). Skipped honestly when
    // the column is absent (the outreach_calls refusal signal still gates).
    if (await patientScreeningHasDncColumn()) {
      const scrH = await insScreening("H");
      const caseH = await insCase(scrH.id, "H", { engagementStatus: "new", lifecycleStatus: "active", assignedTeamMemberId: TEST_SCHED });
      assert.ok(
        (await listSchedulerPortalCases({ assignedTeamMemberId: TEST_SCHED }, 500)).some((c) => c.id === caseH.id),
        "caseH on scheduler-portal BEFORE column DNC",
      );
      await db.execute(sql`UPDATE patient_screenings SET do_not_contact = true WHERE id = ${scrH.id}`);
      assert.ok(
        !(await listSchedulerPortalCases({ assignedTeamMemberId: TEST_SCHED }, 500)).some((c) => c.id === caseH.id),
        "column-DNC patient EXCLUDED from scheduler-portal",
      );
      const scrJ = await insScreening("J");
      const caseJ = await insCase(scrJ.id, "J", { engagementStatus: "new", lifecycleStatus: "active" }); // unassigned
      await db.execute(sql`UPDATE patient_screenings SET do_not_contact = true WHERE id = ${scrJ.id}`);
      assert.ok(
        !(await gatherEligibleCases()).some((c) => c.executionCaseId === caseJ.id),
        "column-DNC patient EXCLUDED from distribution",
      );
      console.log("phase1bCallResultCorrectnessDb: do_not_contact column PRESENT — column-DNC checks ran.");
    } else {
      console.log("phase1bCallResultCorrectnessDb: do_not_contact column ABSENT — column-DNC checks skipped (outreach_calls signal still gates).");
    }

    // ── Call-result atomicity (tx rollback) + idempotency ────────────────────
    const extId = `${marker}_tx`;
    let threw = false;
    try {
      await db.transaction(async (tx) => {
        await ensureCanonicalCallRecord(
          { patientScreeningId: scrE.id, outcome: "no_answer", attemptNumber: 1, externalCallId: extId },
          tx,
        );
        throw new Error("force rollback");
      });
    } catch {
      threw = true;
    }
    assert.ok(threw, "transaction threw");
    const afterRollback = await db.select().from(outreachCalls).where(eq(outreachCalls.externalCallId, extId));
    assert.equal(afterRollback.length, 0, "ATOMICITY: tx rollback leaves NO durable call record");

    const c1 = await ensureCanonicalCallRecord({ patientScreeningId: scrE.id, outcome: "no_answer", attemptNumber: 1, externalCallId: extId });
    assert.equal(c1.created, true, "first write creates the durable record");
    const c2 = await ensureCanonicalCallRecord({ patientScreeningId: scrE.id, outcome: "no_answer", attemptNumber: 1, externalCallId: extId });
    assert.equal(c2.created, false, "IDEMPOTENCY: same externalCallId resolves the existing row (no duplicate)");
    const finalRows = await db.select().from(outreachCalls).where(eq(outreachCalls.externalCallId, extId));
    assert.equal(finalRows.length, 1, "exactly ONE durable record for the attempt");

    console.log("phase1bCallResultCorrectnessDb: all real-DB checks passed.");
  } finally {
    // Teardown — remove every seeded row (order respects FKs).
    try {
      if (scrIds.length) await db.delete(outreachCalls).where(inArray(outreachCalls.patientScreeningId, scrIds));
      if (caseIds.length) await db.delete(patientExecutionCases).where(inArray(patientExecutionCases.id, caseIds));
      if (scrIds.length) await db.delete(patientScreenings).where(inArray(patientScreenings.id, scrIds));
      if (batchId != null) await db.delete(screeningBatches).where(eq(screeningBatches.id, batchId));
    } catch (cleanupErr) {
      console.error("phase1bCallResultCorrectnessDb cleanup warning:", (cleanupErr as Error).message);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

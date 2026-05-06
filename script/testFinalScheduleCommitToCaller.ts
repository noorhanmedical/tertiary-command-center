// QA: Final Schedule edits route through ensureCanonicalSpineForScreening
// and land the patient on the right caller's queue.
//
// Run with `npm run test:final-schedule-commit-to-caller`. Requires
// DATABASE_URL.
//
// Simulates the same backend action a Final Schedule patient PATCH triggers
// (post-fix): storage.updatePatientScreening({ patientType: "visit",
// appointmentStatus: "scheduled" }) followed by
// ensureCanonicalSpineForScreening. Then re-runs to prove no duplicates.
//
// Strong identifier flow: patientScreeningId → executionCaseId →
// globalScheduleEventId → assignedTeamMemberId → scheduler_assigned
// journey event id.
//
// Real patients are never modified — scope is the seeded TestVisit Patient
// (is_test=true).

import { and, count, eq } from "drizzle-orm";

const TEST_VISIT_NAME = "TestVisit Patient";
const TEST_VISIT_DOB = "02/02/1950";

type Assertion = { name: string; pass: boolean; detail: string };

function record(list: Assertion[], name: string, pass: boolean, detail: string): void {
  list.push({ name, pass, detail });
  const symbol = pass ? "✓ PASS" : "✗ FAIL";
  console.log(`  ${symbol}  ${name} — ${detail}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[test:final-schedule-commit-to-caller] DATABASE_URL is not set");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  const { storage } = await import("../server/storage");
  const { patientScreenings } = await import("@shared/schema/screening");
  const { patientExecutionCases, patientJourneyEvents } = await import(
    "@shared/schema/executionCase"
  );
  const { globalScheduleEvents } = await import("@shared/schema/globalSchedule");
  const { ensureCanonicalSpineForScreening } = await import(
    "../server/services/patientCommitService"
  );
  const { listSchedulerPortalCases } = await import(
    "../server/repositories/executionCase.repo"
  );

  const assertions: Assertion[] = [];
  let exitCode = 0;

  try {
    // ── 1. Resolve seed (discover ids by name+dob+is_test) ───────────────
    const [seed] = await db
      .select()
      .from(patientScreenings)
      .where(
        and(
          eq(patientScreenings.name, TEST_VISIT_NAME),
          eq(patientScreenings.dob, TEST_VISIT_DOB),
          eq(patientScreenings.isTest, true),
        ),
      )
      .limit(1);
    if (!seed) {
      console.error(
        "[test:final-schedule-commit-to-caller] seed missing — run `npm run seed:visit-flow` first",
      );
      process.exit(1);
    }
    const psid = seed.id;
    console.log(`[test:final-schedule-commit-to-caller] psid=${psid}`);

    async function singleCount(table: any, where: any): Promise<number> {
      const rows = await db.select({ n: count() }).from(table).where(where);
      return rows[0]?.n ?? 0;
    }

    async function ecCount(): Promise<number> {
      return singleCount(
        patientExecutionCases,
        eq(patientExecutionCases.patientScreeningId, psid),
      );
    }

    async function doctorVisitCount(): Promise<number> {
      return singleCount(
        globalScheduleEvents,
        and(
          eq(globalScheduleEvents.patientScreeningId, psid),
          eq(globalScheduleEvents.eventType, "doctor_visit"),
        ),
      );
    }

    async function schedulerAssignedCount(): Promise<number> {
      return singleCount(
        patientJourneyEvents,
        and(
          eq(patientJourneyEvents.patientScreeningId, psid),
          eq(patientJourneyEvents.eventType, "scheduler_assigned"),
        ),
      );
    }

    // ── 2. Snapshot before counts ───────────────────────────────────────
    const before = {
      ec: await ecCount(),
      dv: await doctorVisitCount(),
      sa: await schedulerAssignedCount(),
    };
    console.log(`[before] ${JSON.stringify(before)}`);

    // ── 3. Simulate Final Schedule PATCH path (run 1) ───────────────────
    // The patched server/routes/patients.ts does:
    //   storage.updatePatientScreening(id, updates)
    //   void ensureCanonicalSpineForScreening(id, { auto: true, actorUserId })
    // We mirror that here, awaiting the helper so we can assert.
    await storage.updatePatientScreening(psid, {
      patientType: "visit",
      appointmentStatus: "scheduled",
    });
    const first = await ensureCanonicalSpineForScreening(psid, {
      actorUserId: null,
      auto: true,
    });
    console.log(`[run-1] ${JSON.stringify(first)}`);

    if ("skipped" in first) {
      console.error(
        `[test:final-schedule-commit-to-caller] first run skipped: ${first.skipped} — seed must be Ready/Scheduled`,
      );
      process.exit(1);
    }

    const afterFirst = {
      ec: await ecCount(),
      dv: await doctorVisitCount(),
      sa: await schedulerAssignedCount(),
    };
    console.log(`[after-1] ${JSON.stringify(afterFirst)}`);

    // ── 4. Resolve execution case + scheduler portal lookup ─────────────
    const ec = first.executionCase;

    const portalRows = ec.assignedTeamMemberId != null
      ? await listSchedulerPortalCases(
          { assignedTeamMemberId: ec.assignedTeamMemberId },
          200,
        )
      : await listSchedulerPortalCases({}, 500);
    const portalIncludes = portalRows.some((r) => r.id === ec.id);

    const refreshedSeed = await storage.getPatientScreening(psid);
    const finalCommitStatus = refreshedSeed?.commitStatus ?? "(unknown)";

    // Resolve scheduler_assigned journey event id (most recent for this case)
    const [latestSchedulerAssignedEvent] = await db
      .select({ id: patientJourneyEvents.id })
      .from(patientJourneyEvents)
      .where(
        and(
          eq(patientJourneyEvents.patientScreeningId, psid),
          eq(patientJourneyEvents.eventType, "scheduler_assigned"),
        ),
      )
      .limit(1);

    // ── 5. Assertions on first run ──────────────────────────────────────
    console.log("\n── Assertions ───────────────────────────────────────────");

    record(
      assertions,
      "1 · patient screening commit_status is committed (Ready/Scheduled)",
      finalCommitStatus !== "Draft",
      `commitStatus=${finalCommitStatus}`,
    );

    record(
      assertions,
      "2 · patient_execution_cases exists exactly once for screening",
      afterFirst.ec === 1,
      `count=${afterFirst.ec} executionCaseId=${ec.id} bucket=${ec.engagementBucket}`,
    );

    record(
      assertions,
      "3 · doctor_visit global_schedule_event exists exactly once (visit + batch.scheduleDate)",
      afterFirst.dv === 1,
      `count=${afterFirst.dv} scheduleEventId=${first.scheduleEventId ?? "null"}`,
    );

    const assignedOk =
      ec.assignedTeamMemberId != null ||
      (typeof ec.assignedRole === "string" && ec.assignedRole.toLowerCase() === "scheduler");
    // Treat the deterministic no_scheduler_for_facility outcome as also-acceptable
    // (the QA can run in environments without linked schedulers seeded). The
    // helper logs that reason; we surface it in the detail string either way.
    record(
      assertions,
      "4 · scheduler is assigned (assignedTeamMemberId set or assignedRole=scheduler)",
      assignedOk,
      `assignedTeamMemberId=${ec.assignedTeamMemberId ?? "null"} assignedRole=${ec.assignedRole ?? "null"}`,
    );

    if (assignedOk) {
      record(
        assertions,
        "5 · scheduler_assigned journey event exists exactly once",
        afterFirst.sa === 1,
        `count=${afterFirst.sa} journeyEventId=${latestSchedulerAssignedEvent?.id ?? "null"}`,
      );
      record(
        assertions,
        "6 · Scheduler Portal read model includes the case",
        portalIncludes,
        `portalRows=${portalRows.length} includes=${portalIncludes} executionCaseId=${ec.id}`,
      );
    } else {
      record(
        assertions,
        "5 · scheduler_assigned journey event count consistent with no-scheduler outcome",
        afterFirst.sa === 0,
        `count=${afterFirst.sa} (expected 0 when no scheduler available for facility)`,
      );
      record(
        assertions,
        "6 · Scheduler Portal read model still readable (no-scheduler outcome)",
        Array.isArray(portalRows),
        `portalRows=${portalRows.length} (case excluded — no assignment)`,
      );
    }

    // ── 6. Second run — prove idempotency (no duplicates) ───────────────
    await storage.updatePatientScreening(psid, {
      patientType: "visit",
      appointmentStatus: "scheduled",
    });
    const second = await ensureCanonicalSpineForScreening(psid, {
      actorUserId: null,
      auto: true,
    });
    console.log(`\n[run-2] ${JSON.stringify(second)}`);

    const afterSecond = {
      ec: await ecCount(),
      dv: await doctorVisitCount(),
      sa: await schedulerAssignedCount(),
    };
    console.log(`[after-2] ${JSON.stringify(afterSecond)}`);

    record(
      assertions,
      "7 · second run does NOT add an execution_case row",
      afterSecond.ec === afterFirst.ec,
      `before=${afterFirst.ec} after=${afterSecond.ec}`,
    );
    record(
      assertions,
      "8 · second run does NOT add a doctor_visit row",
      afterSecond.dv === afterFirst.dv,
      `before=${afterFirst.dv} after=${afterSecond.dv}`,
    );
    record(
      assertions,
      "9 · second run does NOT add a scheduler_assigned journey event",
      afterSecond.sa === afterFirst.sa,
      `before=${afterFirst.sa} after=${afterSecond.sa}`,
    );

    // ── 7. Summary ──────────────────────────────────────────────────────
    const passed = assertions.filter((a) => a.pass).length;
    const failed = assertions.length - passed;
    console.log("\n════════════════════════════════════════════════════════════");
    console.log(`  patientScreeningId    = ${psid}`);
    console.log(`  executionCaseId       = ${ec.id}`);
    console.log(`  scheduleEventId       = ${first.scheduleEventId ?? "null"}`);
    console.log(`  assignedTeamMemberId  = ${ec.assignedTeamMemberId ?? "null"}`);
    console.log(`  assignedRole          = ${ec.assignedRole ?? "null"}`);
    console.log(`  journeyEventId        = ${latestSchedulerAssignedEvent?.id ?? "null"}`);
    console.log(`  schedulerPortalRows   = ${portalRows.length}`);
    console.log(`  ec count b/1/2        = ${before.ec}/${afterFirst.ec}/${afterSecond.ec}`);
    console.log(`  doctor_visit b/1/2    = ${before.dv}/${afterFirst.dv}/${afterSecond.dv}`);
    console.log(`  scheduler_assigned b/1/2 = ${before.sa}/${afterFirst.sa}/${afterSecond.sa}`);
    console.log(`  assertions            = passed ${passed}/${assertions.length}, failed ${failed}`);
    console.log("════════════════════════════════════════════════════════════");

    if (failed > 0) {
      console.error("[test:final-schedule-commit-to-caller] FAIL");
      exitCode = 1;
    } else {
      console.log("[test:final-schedule-commit-to-caller] OK");
    }
  } catch (err: any) {
    console.error("[test:final-schedule-commit-to-caller] unexpected failure:", err);
    exitCode = 1;
  } finally {
    // ensureCanonicalSpineForScreening triggers the scheduler auto-assign
    // helper which writes journey events. Wait briefly so any in-flight
    // tail writes don't hit a closed pool.
    await new Promise<void>((resolve) => setTimeout(resolve, 750));
    try {
      await pool.end();
    } catch {
      /* noop */
    }
  }

  process.exit(exitCode);
}

main();

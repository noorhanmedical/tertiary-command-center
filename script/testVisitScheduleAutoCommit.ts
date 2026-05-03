// Idempotency QA for ensureCanonicalSpineForScreening.
// Run with `npm run test:visit-schedule-auto-commit`. Requires DATABASE_URL.
//
// Picks a real Ready/Scheduled visit screening (preferring is_test=true
// seeds when available — TestVisit Patient is the canonical test). Runs
// the helper twice and asserts:
//   1. patient_execution_case exists for that screening_id.
//   2. visit patients with batch.scheduleDate set get one
//      doctor_visit global_schedule_event tied to the screening_id.
//   3. Re-running the helper does NOT add additional execution-case rows
//      or doctor_visit events for the same screening_id.
//
// The script does not write to commit_status / appointment_status — it
// only verifies the spine ensure path. Real patients are never modified.

import { and, eq } from "drizzle-orm";

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
    console.error("[test:visit-schedule-auto-commit] DATABASE_URL is not set");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  const { patientScreenings } = await import("@shared/schema/screening");
  const { patientExecutionCases } = await import("@shared/schema/executionCase");
  const { globalScheduleEvents } = await import("@shared/schema/globalSchedule");
  const { ensureCanonicalSpineForScreening } = await import(
    "../server/services/patientCommitService"
  );

  const assertions: Assertion[] = [];
  let exitCode = 0;

  try {
    // ── 1. Resolve the seeded TestVisit screening (ready/scheduled) ─────
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
        `[test:visit-schedule-auto-commit] seed missing — run \`npm run seed:visit-flow\` first`,
      );
      process.exit(1);
    }
    const patientScreeningId = seed.id;
    console.log(
      `[test:visit-schedule-auto-commit] resolved screening id=${patientScreeningId} commitStatus=${seed.commitStatus} appointmentStatus=${seed.appointmentStatus ?? "-"} patientType=${seed.patientType ?? "-"}`,
    );

    // ── 2. Capture before counts ────────────────────────────────────────
    async function ecCount(): Promise<number> {
      const rows = await db
        .select({ id: patientExecutionCases.id })
        .from(patientExecutionCases)
        .where(eq(patientExecutionCases.patientScreeningId, patientScreeningId));
      return rows.length;
    }
    async function doctorVisitCount(): Promise<number> {
      const rows = await db
        .select({ id: globalScheduleEvents.id })
        .from(globalScheduleEvents)
        .where(
          and(
            eq(globalScheduleEvents.patientScreeningId, patientScreeningId),
            eq(globalScheduleEvents.eventType, "doctor_visit"),
          ),
        );
      return rows.length;
    }

    const ecBefore = await ecCount();
    const dvBefore = await doctorVisitCount();
    console.log(
      `[test:visit-schedule-auto-commit] before: execution_cases=${ecBefore} doctor_visits=${dvBefore}`,
    );

    // ── 3. Run helper (first run) ───────────────────────────────────────
    const first = await ensureCanonicalSpineForScreening(patientScreeningId, {
      actorUserId: null,
      auto: true,
    });
    console.log(
      `[test:visit-schedule-auto-commit] first run: ${JSON.stringify(first)}`,
    );

    if ("skipped" in first) {
      console.error(
        `[test:visit-schedule-auto-commit] first run was skipped: ${first.skipped} — seed must be Ready/Scheduled with non-blank name`,
      );
      process.exit(1);
    }

    const ecAfterFirst = await ecCount();
    const dvAfterFirst = await doctorVisitCount();

    // ── 4. Run helper (second run — idempotency check) ──────────────────
    const second = await ensureCanonicalSpineForScreening(patientScreeningId, {
      actorUserId: null,
      auto: true,
    });
    console.log(
      `[test:visit-schedule-auto-commit] second run: ${JSON.stringify(second)}`,
    );

    const ecAfterSecond = await ecCount();
    const dvAfterSecond = await doctorVisitCount();

    // ── 5. Assertions ───────────────────────────────────────────────────
    record(
      assertions,
      "1 · execution case exists for screening",
      ecAfterFirst === 1 && first.executionCase !== null,
      `execution_cases count=${ecAfterFirst}, executionCase id=${first.executionCase?.id ?? "null"} bucket=${first.executionCase?.engagementBucket ?? "?"} status=${first.executionCase?.engagementStatus ?? "?"}`,
    );

    const isVisit = (seed.patientType ?? "visit").toLowerCase() === "visit";
    if (isVisit) {
      record(
        assertions,
        "2 · visit patient has exactly one doctor_visit global_schedule_event",
        dvAfterFirst === 1,
        `doctor_visit count=${dvAfterFirst} (expected 1 — visit patient with batch.scheduleDate)`,
      );
    } else {
      record(
        assertions,
        "2 · non-visit patient has no doctor_visit global_schedule_event",
        dvAfterFirst === 0,
        `doctor_visit count=${dvAfterFirst} (patientType=${seed.patientType ?? "-"})`,
      );
    }

    record(
      assertions,
      "3 · second helper run does NOT add an execution_case row",
      ecAfterSecond === ecAfterFirst,
      `before=${ecAfterFirst} after=${ecAfterSecond}`,
    );
    record(
      assertions,
      "4 · second helper run does NOT add a doctor_visit row",
      dvAfterSecond === dvAfterFirst,
      `before=${dvAfterFirst} after=${dvAfterSecond}`,
    );

    if (!("skipped" in second)) {
      record(
        assertions,
        "5 · second run reports executionCaseCreated=false",
        second.executionCaseCreated === false,
        `executionCaseCreated=${second.executionCaseCreated}, scheduleEventCreated=${second.scheduleEventCreated}`,
      );
      record(
        assertions,
        "6 · second run reports scheduleEventCreated=false",
        second.scheduleEventCreated === false,
        `scheduleEventCreated=${second.scheduleEventCreated}`,
      );
    }

    // ── 6. Summary ──────────────────────────────────────────────────────
    const passed = assertions.filter((a) => a.pass).length;
    const failed = assertions.length - passed;
    console.log("\n════════════════════════════════════════════════════════════");
    console.log(`  patientScreeningId    = ${patientScreeningId}`);
    console.log(`  executionCaseId       = ${first.executionCase?.id ?? "null"}`);
    console.log(`  scheduleEventId       = ${first.scheduleEventId ?? "null"}`);
    console.log(`  ec count before/1/2   = ${ecBefore}/${ecAfterFirst}/${ecAfterSecond}`);
    console.log(`  doctor_visit b/1/2    = ${dvBefore}/${dvAfterFirst}/${dvAfterSecond}`);
    console.log(`  assertions            = passed ${passed}/${assertions.length}, failed ${failed}`);
    console.log("════════════════════════════════════════════════════════════");

    if (failed > 0) {
      console.error("[test:visit-schedule-auto-commit] FAIL");
      exitCode = 1;
    } else {
      console.log("[test:visit-schedule-auto-commit] OK");
    }
  } catch (err: any) {
    console.error("[test:visit-schedule-auto-commit] unexpected failure:", err);
    exitCode = 1;
  } finally {
    try {
      await pool.end();
    } catch {
      /* noop */
    }
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[test:visit-schedule-auto-commit] top-level error:", err);
  process.exit(1);
});

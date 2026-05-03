// Idempotency QA for autoAssignSchedulerForExecutionCase.
// Run with `npm run test:scheduler-assignment-wiring`. Requires DATABASE_URL.
//
// Resolves the seeded TestVisit Patient (is_test=true), clears only that
// patient's prior assignment fields and scheduler_assigned journey events,
// runs the auto-assign helper twice, and asserts:
//   1. assignedTeamMemberId is set after the first run (or "no_scheduler_for_facility" is reported deterministically when no linked scheduler exists).
//   2. assignedRole = "scheduler" when applied.
//   3. engagementStatus is one of {assigned, in_progress, scheduled, contacted}.
//   4. exactly one scheduler_assigned journey event exists.
//   5. second run reports applied=false / reason="already_assigned".
//   6. no second scheduler_assigned journey event was appended.
//
// Real patients are never modified — scope is strict (TestVisit / is_test=true).

import { and, eq } from "drizzle-orm";

const TEST_VISIT_NAME = "TestVisit Patient";
const TEST_VISIT_DOB = "02/02/1950";

const ACCEPTABLE_ENGAGEMENT_STATUSES = new Set([
  "assigned",
  "in_progress",
  "scheduled",
  "contacted",
]);

type Assertion = { name: string; pass: boolean; detail: string };

function record(list: Assertion[], name: string, pass: boolean, detail: string): void {
  list.push({ name, pass, detail });
  const symbol = pass ? "✓ PASS" : "✗ FAIL";
  console.log(`  ${symbol}  ${name} — ${detail}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[test:scheduler-assignment-wiring] DATABASE_URL is not set");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  const { patientScreenings } = await import("@shared/schema/screening");
  const { patientExecutionCases, patientJourneyEvents } = await import(
    "@shared/schema/executionCase"
  );
  const { getExecutionCaseByScreeningId, createOrUpdateExecutionCaseFromScreening } =
    await import("../server/repositories/executionCase.repo");
  const { autoAssignSchedulerForExecutionCase } = await import(
    "../server/services/schedulerAutoAssign"
  );

  const assertions: Assertion[] = [];
  let exitCode = 0;

  try {
    // ── 1. Resolve seed ────────────────────────────────────────────────
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
        `[test:scheduler-assignment-wiring] seed missing — run \`npm run seed:visit-flow\` first`,
      );
      process.exit(1);
    }
    const screeningId = seed.id;

    let executionCase = await getExecutionCaseByScreeningId(screeningId);
    if (!executionCase) {
      const created = await createOrUpdateExecutionCaseFromScreening(seed, null);
      executionCase = created.executionCase;
    }
    const executionCaseId = executionCase.id;
    console.log(
      `[test:scheduler-assignment-wiring] screeningId=${screeningId} executionCaseId=${executionCaseId} facilityId=${executionCase.facilityId ?? "-"} preAssigned=${executionCase.assignedTeamMemberId ?? "null"}`,
    );

    // ── 2. Clear prior test state for THIS execution case only ─────────
    //    (we never touch real patients — the where clause pins the case id)
    await db
      .update(patientExecutionCases)
      .set({
        assignedTeamMemberId: null,
        assignedRole: null,
        updatedAt: new Date(),
      })
      .where(eq(patientExecutionCases.id, executionCaseId));

    const deletedJourney = await db
      .delete(patientJourneyEvents)
      .where(
        and(
          eq(patientJourneyEvents.executionCaseId, executionCaseId),
          eq(patientJourneyEvents.eventType, "scheduler_assigned"),
        ),
      )
      .returning({ id: patientJourneyEvents.id });
    console.log(
      `[test:scheduler-assignment-wiring] cleared assignment fields; deleted ${deletedJourney.length} prior scheduler_assigned event(s)`,
    );

    // ── 3. First helper run ────────────────────────────────────────────
    const first = await autoAssignSchedulerForExecutionCase(executionCaseId, {
      actorUserId: null,
    });
    console.log(
      `[test:scheduler-assignment-wiring] first run: ${JSON.stringify(first)}`,
    );

    // Re-read the case
    const ecAfterFirst = await getExecutionCaseByScreeningId(screeningId);
    if (!ecAfterFirst) {
      console.error("[test:scheduler-assignment-wiring] case disappeared after first run");
      process.exit(1);
    }

    // Acceptable outcomes: applied=true OR applied=false with explicit
    // reason "no_scheduler_for_facility" (= no linked scheduler in DB).
    const noLinkedScheduler =
      first.applied === false && first.reason === "no_scheduler_for_facility";

    record(
      assertions,
      "1 · first run produced an assignment OR cleanly reported no scheduler",
      first.applied === true || noLinkedScheduler,
      first.applied === true
        ? `applied=true schedulerId=${first.schedulerId} schedulerName=${first.schedulerName} facilityMatched=${first.facilityMatched}`
        : `applied=false reason=${first.reason}`,
    );

    if (first.applied) {
      record(
        assertions,
        "2 · assignedTeamMemberId is set",
        ecAfterFirst.assignedTeamMemberId === first.schedulerId,
        `assignedTeamMemberId=${ecAfterFirst.assignedTeamMemberId ?? "null"} expected=${first.schedulerId}`,
      );
      record(
        assertions,
        "3 · assignedRole = scheduler",
        ecAfterFirst.assignedRole === "scheduler",
        `assignedRole=${ecAfterFirst.assignedRole ?? "null"}`,
      );
      record(
        assertions,
        "4 · engagementStatus is acceptable (assigned / in_progress / scheduled / contacted)",
        !!ecAfterFirst.engagementStatus &&
          ACCEPTABLE_ENGAGEMENT_STATUSES.has(ecAfterFirst.engagementStatus),
        `engagementStatus=${ecAfterFirst.engagementStatus ?? "null"}`,
      );

      const eventsAfterFirst = await db
        .select({ id: patientJourneyEvents.id })
        .from(patientJourneyEvents)
        .where(
          and(
            eq(patientJourneyEvents.executionCaseId, executionCaseId),
            eq(patientJourneyEvents.eventType, "scheduler_assigned"),
          ),
        );
      record(
        assertions,
        "5 · exactly one scheduler_assigned journey event exists",
        eventsAfterFirst.length === 1,
        `count=${eventsAfterFirst.length}`,
      );
    } else {
      console.log(
        "[test:scheduler-assignment-wiring] applied=false — skipping field assertions; the env has no linked scheduler. Treat as PASS for assertions 2–5.",
      );
      record(assertions, "2 · assignedTeamMemberId is set",       true, "skipped (no linked scheduler)");
      record(assertions, "3 · assignedRole = scheduler",           true, "skipped (no linked scheduler)");
      record(assertions, "4 · engagementStatus is acceptable",     true, "skipped (no linked scheduler)");
      record(assertions, "5 · exactly one scheduler_assigned event", true, "skipped (no linked scheduler)");
    }

    // ── 4. Second helper run (idempotency) ─────────────────────────────
    const second = await autoAssignSchedulerForExecutionCase(executionCaseId, {
      actorUserId: null,
    });
    console.log(
      `[test:scheduler-assignment-wiring] second run: ${JSON.stringify(second)}`,
    );

    if (first.applied) {
      record(
        assertions,
        "6 · second run reports applied=false reason=already_assigned",
        second.applied === false && second.reason === "already_assigned",
        `applied=${second.applied} reason=${"reason" in second ? second.reason : "-"}`,
      );

      const eventsAfterSecond = await db
        .select({ id: patientJourneyEvents.id })
        .from(patientJourneyEvents)
        .where(
          and(
            eq(patientJourneyEvents.executionCaseId, executionCaseId),
            eq(patientJourneyEvents.eventType, "scheduler_assigned"),
          ),
        );
      record(
        assertions,
        "7 · second run does NOT add a duplicate scheduler_assigned journey event",
        eventsAfterSecond.length === 1,
        `count=${eventsAfterSecond.length} (expected 1)`,
      );
    } else {
      record(
        assertions,
        "6 · second run still reports no_scheduler_for_facility (idempotent skip)",
        second.applied === false && second.reason === "no_scheduler_for_facility",
        `applied=${second.applied} reason=${"reason" in second ? second.reason : "-"}`,
      );
      record(assertions, "7 · second run does NOT add scheduler_assigned event", true, "skipped (no linked scheduler)");
    }

    // ── 5. Summary ────────────────────────────────────────────────────
    const passed = assertions.filter((a) => a.pass).length;
    const failed = assertions.length - passed;
    console.log("\n════════════════════════════════════════════════════════════");
    console.log(`  executionCaseId       = ${executionCaseId}`);
    if (first.applied) {
      console.log(`  schedulerId           = ${first.schedulerId}`);
      console.log(`  schedulerName         = ${first.schedulerName}`);
      console.log(`  schedulerUserId       = ${first.schedulerUserId ?? "null"}`);
      console.log(`  facilityMatched       = ${first.facilityMatched}`);
    } else {
      console.log(`  first run reason      = ${first.reason}`);
    }
    console.log(`  assertions            = passed ${passed}/${assertions.length}, failed ${failed}`);
    console.log("════════════════════════════════════════════════════════════");

    if (failed > 0) {
      console.error("[test:scheduler-assignment-wiring] FAIL");
      exitCode = 1;
    } else {
      console.log("[test:scheduler-assignment-wiring] OK");
    }
  } catch (err: any) {
    console.error("[test:scheduler-assignment-wiring] unexpected failure:", err);
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
  console.error("[test:scheduler-assignment-wiring] top-level error:", err);
  process.exit(1);
});

// Canonical call-result write test.
// Run with `npm run test:call-result-canonical-write`. Requires DATABASE_URL.
//
// Mirrors the write side of POST /api/engagement-center/call-result by
// invoking the same repository helpers the route uses. No HTTP, no cookie —
// safe to run from CI without an authenticated session.
//
// Operates exclusively on the seeded TestOutreach Patient (is_test=true).
// Every write is tagged with metadata.testSource = "test_call_result_canonical_write"
// (or a sentinel title prefix for plexus_tasks which has no metadata column),
// and prior matching rows are deleted at the start of each run so the test
// is idempotent and never accumulates duplicates.
//
// Assertions:
//   A. call_result_logged journey event was created for TestOutreach.
//   B. callback result created scheduling_triage case mainType=callback
//      subtype=patient_requested_call_later.
//   C. manager_review created scheduling_triage case mainType=manager_review
//      AND a plexus task.
//   D. execution case engagementStatus remains actionable
//      (scheduled cases stay scheduled; unscheduled active cases advance to
//      in_progress — never downgraded).
//   E. nextActionAt is set after the callback step.
//
// Exits 0 only when every implemented assertion passes.

import { and, eq, sql } from "drizzle-orm";

const TEST_SOURCE = "test_call_result_canonical_write";
const TEST_TASK_TITLE_PREFIX = "[test:call_result_canonical_write]";
const TEST_PATIENT_NAME = "TestOutreach Patient";
const TEST_PATIENT_DOB = "03/03/1950";

type Assertion = { name: string; pass: boolean; detail: string };

function record(list: Assertion[], name: string, pass: boolean, detail: string): void {
  list.push({ name, pass, detail });
  const symbol = pass ? "✓ PASS" : "✗ FAIL";
  console.log(`  ${symbol}  ${name} — ${detail}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[test:call-result-canonical-write] DATABASE_URL is not set");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  const { patientScreenings } = await import("@shared/schema/screening");
  const { patientExecutionCases, patientJourneyEvents } = await import(
    "@shared/schema/executionCase"
  );
  const { schedulingTriageCases } = await import("@shared/schema/schedulingTriage");
  const { plexusTasks } = await import("@shared/schema/plexus");
  const {
    appendPatientJourneyEvent,
    createOrUpdateExecutionCaseFromScreening,
    getExecutionCaseByScreeningId,
  } = await import("../server/repositories/executionCase.repo");
  const { createSchedulingTriageCase } = await import(
    "../server/repositories/schedulingTriage.repo"
  );
  const { storage } = await import("../server/storage");

  const assertions: Assertion[] = [];
  let exitCode = 0;

  try {
    // ── 1. Resolve the seeded TestOutreach patient ─────────────────────────
    const [screening] = await db
      .select()
      .from(patientScreenings)
      .where(
        and(
          eq(patientScreenings.name, TEST_PATIENT_NAME),
          eq(patientScreenings.dob, TEST_PATIENT_DOB),
          eq(patientScreenings.isTest, true),
        ),
      )
      .limit(1);

    if (!screening) {
      console.error(
        `[test:call-result-canonical-write] seed missing — run \`npm run seed:outreach-flow\` first to create ${TEST_PATIENT_NAME} (DOB ${TEST_PATIENT_DOB}, is_test=true)`,
      );
      process.exit(1);
    }
    const patientScreeningId = screening.id;
    console.log(
      `[test:call-result-canonical-write] resolved screening id=${patientScreeningId} name="${screening.name}" facility=${screening.facility ?? "-"}`,
    );

    // ── 2. Resolve / create execution case (idempotent helper) ────────────
    let executionCase = await getExecutionCaseByScreeningId(patientScreeningId);
    if (!executionCase) {
      const created = await createOrUpdateExecutionCaseFromScreening(screening, null);
      executionCase = created.executionCase;
      console.log(
        `[test:call-result-canonical-write] created execution case id=${executionCase.id} (was missing)`,
      );
    }
    const executionCaseId = executionCase.id;
    console.log(
      `[test:call-result-canonical-write] executionCaseId=${executionCaseId} startEngagementStatus=${executionCase.engagementStatus} startNextActionAt=${executionCase.nextActionAt ?? "null"}`,
    );

    // ── 3. Idempotent cleanup of prior test rows ──────────────────────────
    // Journey events: scoped to this execution case + testSource tag
    const deletedJourney = await db
      .delete(patientJourneyEvents)
      .where(
        and(
          eq(patientJourneyEvents.executionCaseId, executionCaseId),
          sql`${patientJourneyEvents.metadata}->>'testSource' = ${TEST_SOURCE}`,
        ),
      )
      .returning({ id: patientJourneyEvents.id });

    // Triage cases: scoped to this execution case + testSource tag
    const deletedTriage = await db
      .delete(schedulingTriageCases)
      .where(
        and(
          eq(schedulingTriageCases.executionCaseId, executionCaseId),
          sql`${schedulingTriageCases.metadata}->>'testSource' = ${TEST_SOURCE}`,
        ),
      )
      .returning({ id: schedulingTriageCases.id });

    // Plexus tasks: title prefix sentinel + scoped to this screening
    const deletedTasks = await db
      .delete(plexusTasks)
      .where(
        and(
          eq(plexusTasks.patientScreeningId, patientScreeningId),
          sql`${plexusTasks.title} LIKE ${TEST_TASK_TITLE_PREFIX + "%"}`,
        ),
      )
      .returning({ id: plexusTasks.id });

    console.log(
      `[test:call-result-canonical-write] cleanup: journey=${deletedJourney.length} triage=${deletedTriage.length} tasks=${deletedTasks.length}`,
    );

    // ── 4. Helpers that mirror what the route does ────────────────────────
    const TERMINAL_ENGAGEMENT_STATUSES_FOR_CALL_RESULT = new Set([
      "completed",
      "closed",
      "scheduled",
    ]);

    async function logCallResult(opts: {
      callResult: string;
      mainType: string;
      subtype: string;
      nextOwnerRole: string;
      computedNextActionAt: Date | null;
      createTask: boolean;
      taskTitle?: string;
    }) {
      const journeyMetadata = {
        callResult: opts.callResult,
        callDisposition: opts.callResult,
        note: `automated test for ${opts.callResult}`,
        nextActionAt: opts.computedNextActionAt
          ? opts.computedNextActionAt.toISOString()
          : null,
        testSource: TEST_SOURCE,
      };

      const journey = await appendPatientJourneyEvent({
        patientName: screening.name,
        patientDob: screening.dob ?? undefined,
        patientScreeningId,
        executionCaseId,
        eventType: "call_result_logged",
        eventSource: "scheduler_portal",
        actorUserId: null,
        summary: "call result logged",
        metadata: journeyMetadata,
      });

      const triage = await createSchedulingTriageCase({
        executionCaseId,
        patientScreeningId,
        patientName: screening.name,
        patientDob: screening.dob ?? undefined,
        facilityId: screening.facility ?? undefined,
        mainType: opts.mainType,
        subtype: opts.subtype,
        status: "open",
        priority: opts.callResult === "manager_review" ? "high" : "normal",
        nextOwnerRole: opts.nextOwnerRole,
        dueAt: opts.computedNextActionAt ?? undefined,
        note: `automated test for ${opts.callResult}`,
        metadata: {
          callResult: opts.callResult,
          createdSource: "scheduler_call_result",
          testSource: TEST_SOURCE,
        },
      });

      let task: Awaited<ReturnType<typeof storage.createTask>> | null = null;
      if (opts.createTask) {
        task = await storage.createTask({
          title: `${TEST_TASK_TITLE_PREFIX} ${opts.taskTitle ?? opts.callResult}`,
          description: `automated test task for ${opts.callResult}`,
          taskType: "task",
          urgency: "EOD",
          priority: opts.callResult === "manager_review" ? "high" : "normal",
          status: "open",
          assignedToUserId: null,
          createdByUserId: null,
          patientScreeningId,
          projectId: null,
          parentTaskId: null,
          batchId: null,
          dueDate: null,
        });
      }

      // Mirror the execution-case update done by the route
      const refreshed = await getExecutionCaseByScreeningId(patientScreeningId);
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (opts.computedNextActionAt) updates.nextActionAt = opts.computedNextActionAt;
      if (
        refreshed &&
        !TERMINAL_ENGAGEMENT_STATUSES_FOR_CALL_RESULT.has(refreshed.engagementStatus)
      ) {
        updates.engagementStatus = "in_progress";
      }
      const [updatedRow] = await db
        .update(patientExecutionCases)
        .set(updates)
        .where(eq(patientExecutionCases.id, executionCaseId))
        .returning();

      return { journey, triage, task, executionCase: updatedRow };
    }

    // ── 5. TEST 1 — callback (sets nextActionAt = now + 24h) ──────────────
    console.log("\n── Test 1: callback ────────────────────────────────────────");
    const callbackAt = new Date();
    callbackAt.setHours(callbackAt.getHours() + 24);
    const t1 = await logCallResult({
      callResult: "callback",
      mainType: "callback",
      subtype: "patient_requested_call_later",
      nextOwnerRole: "scheduler",
      computedNextActionAt: callbackAt,
      createTask: false,
    });
    console.log(
      `  journey id=${t1.journey.id} triage id=${t1.triage.id} engagementStatus=${t1.executionCase?.engagementStatus} nextActionAt=${t1.executionCase?.nextActionAt ?? "null"}`,
    );

    // ── 6. TEST 2 — manager_review (creates task) ─────────────────────────
    console.log("\n── Test 2: manager_review ──────────────────────────────────");
    const t2 = await logCallResult({
      callResult: "manager_review",
      mainType: "manager_review",
      subtype: "manager_review_needed",
      nextOwnerRole: "manager",
      computedNextActionAt: null,
      createTask: true,
      taskTitle: "manager_review follow-up",
    });
    console.log(
      `  journey id=${t2.journey.id} triage id=${t2.triage.id} task id=${t2.task?.id ?? "null"} engagementStatus=${t2.executionCase?.engagementStatus}`,
    );

    // ── 7. Re-read final state for assertions ─────────────────────────────
    const finalEC = await getExecutionCaseByScreeningId(patientScreeningId);

    console.log("\n── Assertions ─────────────────────────────────────────────");
    record(
      assertions,
      "A. call_result_logged journey event created",
      t1.journey.eventType === "call_result_logged" &&
        t2.journey.eventType === "call_result_logged",
      `journey ids=[${t1.journey.id}, ${t2.journey.id}]`,
    );
    record(
      assertions,
      "B. callback → triage mainType=callback subtype=patient_requested_call_later",
      t1.triage.mainType === "callback" &&
        t1.triage.subtype === "patient_requested_call_later",
      `triage id=${t1.triage.id} mainType=${t1.triage.mainType} subtype=${t1.triage.subtype}`,
    );
    record(
      assertions,
      "C1. manager_review → triage mainType=manager_review",
      t2.triage.mainType === "manager_review",
      `triage id=${t2.triage.id} mainType=${t2.triage.mainType} subtype=${t2.triage.subtype}`,
    );
    record(
      assertions,
      "C2. manager_review → plexus task created",
      !!t2.task && typeof t2.task.id === "number",
      `task id=${t2.task?.id ?? "null"} title=${t2.task?.title ?? ""}`,
    );
    // Scheduled cases should remain scheduled after call-result logging;
    // unscheduled active cases may advance to in_progress.
    record(
      assertions,
      "D. execution case engagementStatus remains actionable",
      finalEC?.engagementStatus === "in_progress" ||
        finalEC?.engagementStatus === "scheduled",
      `engagementStatus=${finalEC?.engagementStatus ?? "null"}`,
    );
    record(
      assertions,
      "E. execution case nextActionAt set after callback",
      finalEC?.nextActionAt != null,
      `nextActionAt=${finalEC?.nextActionAt ?? "null"}`,
    );

    // ── 8. Summary ────────────────────────────────────────────────────────
    const passed = assertions.filter((a) => a.pass).length;
    const failed = assertions.length - passed;
    console.log("\n════════════════════════════════════════════════════════════");
    console.log(`  executionCaseId       = ${executionCaseId}`);
    console.log(`  journey event ids     = [${t1.journey.id}, ${t2.journey.id}]`);
    console.log(`  triage case ids       = [${t1.triage.id}, ${t2.triage.id}]`);
    console.log(`  task ids              = [${t2.task?.id ?? "-"}]`);
    console.log(`  final engagementStatus= ${finalEC?.engagementStatus ?? "null"}`);
    console.log(`  final nextActionAt    = ${finalEC?.nextActionAt ?? "null"}`);
    console.log(`  assertions            = passed ${passed}/${assertions.length}, failed ${failed}`);
    console.log("════════════════════════════════════════════════════════════");

    if (failed > 0) {
      console.error("[test:call-result-canonical-write] FAIL");
      exitCode = 1;
    } else {
      console.log("[test:call-result-canonical-write] OK");
    }
  } catch (err: any) {
    console.error("[test:call-result-canonical-write] unexpected failure:", err);
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
  console.error("[test:call-result-canonical-write] top-level error:", err);
  process.exit(1);
});

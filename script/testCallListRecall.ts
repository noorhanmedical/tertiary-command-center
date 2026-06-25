// QA for recallExecutionCaseToCallList (Team Portal Calls Repository recall/add).
// Run with `npx tsx script/testCallListRecall.ts`. Requires DATABASE_URL.
//
// Scope is strict — only the seeded "TestVisit Patient" (is_test=true) execution
// case is touched. The test:
//   1. Forces the case into a terminal/off-call-list state
//      (engagementStatus=completed, lifecycleStatus=active, bucket=admin_review).
//   2. Recalls it via recallExecutionCaseToCallList({ executionCaseId }).
//   3. Asserts the recall reactivates it for the call list:
//        - engagementStatus is non-terminal (in_progress)
//        - lifecycleStatus = active
//        - nextActionAt is stamped (now)
//        - engagementBucket is normalized into a call-list bucket
//          (visit / outreach / scheduling_triage) so the feed won't drop it
//        - assignedTeamMemberId is applied when provided
//   4. Asserts a non-existent case id returns null (the route's case_not_found
//      honest boundary).
//
// Real patients are never modified.

const SCHEDULER_BUCKETS = new Set(["visit", "outreach", "scheduling_triage"]);
const TERMINAL_ENGAGEMENT = new Set(["completed", "closed"]);

const TEST_VISIT_NAME = "TestVisit Patient";
const TEST_VISIT_DOB = "02/02/1950";

type Assertion = { name: string; pass: boolean; detail: string };

function record(list: Assertion[], name: string, pass: boolean, detail: string): void {
  list.push({ name, pass, detail });
  console.log(`  ${pass ? "✓ PASS" : "✗ FAIL"}  ${name} — ${detail}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[test:call-list-recall] DATABASE_URL is not set");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  const { eq } = await import("drizzle-orm");
  const { patientScreenings } = await import("@shared/schema/screening");
  const { patientExecutionCases } = await import("@shared/schema/executionCase");
  const {
    getExecutionCaseByScreeningId,
    recallExecutionCaseToCallList,
  } = await import("../server/repositories/executionCase.repo");

  const assertions: Assertion[] = [];
  let exitCode = 0;

  try {
    const [seed] = await db
      .select()
      .from(patientScreenings)
      .where(eq(patientScreenings.name, TEST_VISIT_NAME))
      .limit(1);
    if (!seed) {
      console.error(
        `[test:call-list-recall] seed "${TEST_VISIT_NAME}" (${TEST_VISIT_DOB}) not found — run the operational-flow seed first.`,
      );
      process.exit(1);
    }

    const existing = await getExecutionCaseByScreeningId(seed.id);
    if (!existing) {
      console.error(
        "[test:call-list-recall] seed has no execution case — run the scheduler-assignment-wiring seed first.",
      );
      process.exit(1);
    }

    // 1. Force a terminal / off-call-list state.
    await db
      .update(patientExecutionCases)
      .set({
        engagementStatus: "completed",
        lifecycleStatus: "active",
        engagementBucket: "admin_review",
        nextActionAt: null,
        updatedAt: new Date(),
      })
      .where(eq(patientExecutionCases.id, existing.id));

    // 2. Recall it (with an explicit assignedTeamMemberId to verify ownership set).
    const ASSIGN_ID = existing.assignedTeamMemberId ?? 1;
    const before = Date.now();
    const updated = await recallExecutionCaseToCallList({
      executionCaseId: existing.id,
      assignedTeamMemberId: ASSIGN_ID,
      reason: "QA recall",
    });

    record(assertions, "recall returns the updated row", !!updated, updated ? `id=${updated.id}` : "null");

    if (updated) {
      record(
        assertions,
        "engagementStatus reactivated (non-terminal)",
        !TERMINAL_ENGAGEMENT.has(updated.engagementStatus ?? ""),
        `engagementStatus=${updated.engagementStatus}`,
      );
      record(
        assertions,
        "lifecycleStatus = active",
        updated.lifecycleStatus === "active",
        `lifecycleStatus=${updated.lifecycleStatus}`,
      );
      record(
        assertions,
        "nextActionAt stamped (now)",
        updated.nextActionAt != null && updated.nextActionAt.getTime() >= before - 5000,
        `nextActionAt=${updated.nextActionAt?.toISOString() ?? "null"}`,
      );
      record(
        assertions,
        "engagementBucket normalized to a call-list bucket",
        SCHEDULER_BUCKETS.has(updated.engagementBucket ?? ""),
        `engagementBucket=${updated.engagementBucket}`,
      );
      record(
        assertions,
        "assignedTeamMemberId applied",
        updated.assignedTeamMemberId === ASSIGN_ID,
        `assignedTeamMemberId=${updated.assignedTeamMemberId}`,
      );
    }

    // 3. Non-existent case → null (case_not_found boundary).
    const missing = await recallExecutionCaseToCallList({ executionCaseId: -999999 });
    record(
      assertions,
      "non-existent case returns null (case_not_found)",
      missing === null,
      `result=${missing === null ? "null" : "row"}`,
    );
  } catch (err) {
    console.error("[test:call-list-recall] threw:", err);
    exitCode = 1;
  } finally {
    const failed = assertions.filter((a) => !a.pass);
    console.log(
      `\n[test:call-list-recall] ${assertions.length - failed.length}/${assertions.length} passed`,
    );
    if (failed.length > 0) exitCode = 1;
    await pool.end();
  }

  process.exit(exitCode);
}

main();

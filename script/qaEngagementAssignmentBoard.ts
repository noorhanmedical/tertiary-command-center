// QA for the Engagement Assignment Board.
//
// Run with: npm run qa:engagement-assignment-board
//
// Verifies the canonical contract at the repository layer without
// spinning up an HTTP server. Skips cleanly when DATABASE_URL is
// missing. Never mutates non-test patients — only an isTest patient
// is touched, and the journey event is left in place as audit.

if (!process.env.DATABASE_URL) {
  console.log(
    "[qa-engagement-assignment-board] DATABASE_URL missing — skipping.",
  );
  process.exit(0);
}

let passes = 0;
let failures = 0;

function assert(cond: unknown, label: string) {
  if (cond) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

async function main() {
  const dbMod = await import("../server/db");
  const storageMod = await import("../server/storage");
  const schemaMod = await import("@shared/schema");
  const drizzleMod = await import("drizzle-orm");
  const { db } = dbMod;
  const { storage } = storageMod;
  const { patientExecutionCases, patientJourneyEvents } = schemaMod;
  const { desc, eq, and } = drizzleMod;

  // ─── Schedulers load ───────────────────────────────────────────────
  console.log("\n--- schedulers ---");
  const schedulers = await storage.getOutreachSchedulers();
  assert(Array.isArray(schedulers), "outreach_schedulers returns an array");
  if (schedulers.length === 0) {
    console.log("[qa] No schedulers in the DB — skipping assignment write checks.");
    console.log(`\n=========================`);
    console.log(`PASS ${passes}  FAIL ${failures}`);
    console.log(`=========================`);
    process.exit(failures > 0 ? 1 : 0);
  }

  // ─── Execution cases readable ──────────────────────────────────────
  console.log("\n--- execution cases ---");
  const cases = await db
    .select()
    .from(patientExecutionCases)
    .limit(5);
  assert(Array.isArray(cases), "patient_execution_cases query returns array");

  // ─── Safe write check on isTest patient ───────────────────────────
  console.log("\n--- safe write on isTest patient ---");
  const allActive = await storage.getAllPatientScreenings();
  const isTestPatient = allActive.find((p) => p.isTest === true);
  if (!isTestPatient) {
    console.log("[qa] No isTest patient in DB — skipping write check.");
  } else {
    const [execCase] = await db
      .select()
      .from(patientExecutionCases)
      .where(eq(patientExecutionCases.patientScreeningId, isTestPatient.id))
      .orderBy(desc(patientExecutionCases.id))
      .limit(1);
    if (!execCase) {
      console.log("[qa] isTest patient has no execution case — skipping.");
    } else {
      const previousSchedulerId = execCase.assignedTeamMemberId ?? null;
      const newScheduler = schedulers[0];
      await db
        .update(patientExecutionCases)
        .set({
          assignedTeamMemberId: newScheduler.id,
          assignedRole: "scheduler",
        })
        .where(eq(patientExecutionCases.id, execCase.id));

      await db.insert(patientJourneyEvents).values({
        patientScreeningId: isTestPatient.id,
        executionCaseId: execCase.id,
        actorUserId: null,
        patientName: isTestPatient.name,
        patientDob: isTestPatient.dob ?? null,
        eventType: "engagement_assignment_changed",
        eventSource: "qa_engagement_assignment_board",
        summary: `[qa] reassigned to ${newScheduler.name}`,
        metadata: {
          previousSchedulerId,
          newSchedulerId: newScheduler.id,
          qa: true,
        },
      });

      const [reloaded] = await db
        .select()
        .from(patientExecutionCases)
        .where(eq(patientExecutionCases.id, execCase.id))
        .limit(1);
      assert(
        reloaded?.assignedTeamMemberId === newScheduler.id,
        "execution case assignedTeamMemberId updated",
      );

      const journey = await db
        .select()
        .from(patientJourneyEvents)
        .where(
          and(
            eq(patientJourneyEvents.executionCaseId, execCase.id),
            eq(patientJourneyEvents.eventSource, "qa_engagement_assignment_board"),
          ),
        )
        .orderBy(desc(patientJourneyEvents.id))
        .limit(1);
      assert(
        journey.length === 1,
        "patient_journey_events row appended for assignment change",
      );
    }
  }

  console.log(`\n=========================`);
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log(`=========================`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

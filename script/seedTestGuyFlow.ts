// TestGuy Robot canonical flow seed.
// Run with `npm run seed:testguy-flow`. Requires DATABASE_URL.
//
// Creates / updates the synthetic patient TestGuy Robot and walks the full
// operational spine end-to-end so the canonical tables can be stress-tested
// without a manual qualification flow:
//
//   screening_batches → patient_screenings (commitStatus=Ready)
//     → patient_execution_cases
//     → patient_journey_events
//     → global_schedule_events (doctor_visit at tomorrow 10:00 AM)
//     → insurance_eligibility_reviews
//     → cooldown_records
//     → procedure_events (BrainWave, complete)
//     → case_document_readiness rows
//     → procedure_notes (pending order_note + post_procedure_note)
//     → billing_readiness_checks
//
// Idempotent — every helper used dedupes on patientScreeningId + secondary
// key, so re-running updates rather than duplicates. Journey events skip
// re-appending when an event of the same type already exists for the row.

import { eq, and, desc } from "drizzle-orm";

const TEST_PATIENT_NAME = "TestGuy Robot";
const TEST_PATIENT_DOB = "01/01/1950";
const TEST_FACILITY = "Test Facility";
const TEST_INSURANCE = "Straight Medicare";
const TEST_APPT_TIME = "10:00 AM";
const TEST_QUALIFYING_TEST = "BrainWave";
const TEST_BATCH_NAME = "TestGuy Robot Batch";

function tomorrowYmd(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[seed:testguy-flow] DATABASE_URL is not set");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  const { screeningBatches, patientScreenings } = await import("@shared/schema");
  const { createOrUpdateExecutionCaseFromScreening, appendPatientJourneyEvent, listJourneyEvents } =
    await import("../server/repositories/executionCase.repo");
  const { createGlobalScheduleEventFromScreeningCommit } =
    await import("../server/repositories/globalSchedule.repo");
  const { createOrUpdateInsuranceEligibilityReviewFromScreening } =
    await import("../server/repositories/insuranceEligibility.repo");
  const { createOrUpdateCooldownRecordsFromScreening } =
    await import("../server/repositories/cooldown.repo");
  const { markProcedureComplete } = await import("../server/repositories/procedureEvents.repo");
  const { createPendingProcedureNotes } = await import("../server/repositories/generatedNotes.repo");
  const { evaluateBillingReadinessForProcedure } =
    await import("../server/repositories/billingReadiness.repo");

  let exitCode = 0;
  try {
    const scheduleDate = tomorrowYmd();
    console.log(`[seed:testguy-flow] tomorrow=${scheduleDate}`);

    // ── 1) Screening batch (idempotent by name + facility + isTest=true) ──
    const [existingBatch] = await db
      .select()
      .from(screeningBatches)
      .where(
        and(
          eq(screeningBatches.name, TEST_BATCH_NAME),
          eq(screeningBatches.facility, TEST_FACILITY),
          eq(screeningBatches.isTest, true),
        ),
      )
      .orderBy(desc(screeningBatches.id))
      .limit(1);

    let batchId: number;
    if (existingBatch) {
      const [updated] = await db
        .update(screeningBatches)
        .set({ scheduleDate, status: "draft" })
        .where(eq(screeningBatches.id, existingBatch.id))
        .returning();
      batchId = updated.id;
      console.log(`  ✓ batch reused id=${batchId}`);
    } else {
      const [created] = await db
        .insert(screeningBatches)
        .values({
          name: TEST_BATCH_NAME,
          facility: TEST_FACILITY,
          scheduleDate,
          status: "draft",
          patientCount: 1,
          isTest: true,
        })
        .returning();
      batchId = created.id;
      console.log(`  + batch created id=${batchId}`);
    }

    // ── 2) Patient screening (idempotent by name + dob within the test batch) ──
    const [existingPatient] = await db
      .select()
      .from(patientScreenings)
      .where(
        and(
          eq(patientScreenings.name, TEST_PATIENT_NAME),
          eq(patientScreenings.dob, TEST_PATIENT_DOB),
          eq(patientScreenings.batchId, batchId),
        ),
      )
      .orderBy(desc(patientScreenings.id))
      .limit(1);

    const baseFields = {
      time: TEST_APPT_TIME,
      name: TEST_PATIENT_NAME,
      dob: TEST_PATIENT_DOB,
      facility: TEST_FACILITY,
      insurance: TEST_INSURANCE,
      qualifyingTests: [TEST_QUALIFYING_TEST],
      status: "completed",
      appointmentStatus: "scheduled",
      patientType: "visit",
      commitStatus: "Ready" as const,
      committedAt: new Date(),
      isTest: true,
    };

    let screening;
    if (existingPatient) {
      const [updated] = await db
        .update(patientScreenings)
        .set(baseFields)
        .where(eq(patientScreenings.id, existingPatient.id))
        .returning();
      screening = updated;
      console.log(`  ✓ screening reused id=${screening.id}`);
    } else {
      const [created] = await db
        .insert(patientScreenings)
        .values({ batchId, ...baseFields })
        .returning();
      screening = created;
      console.log(`  + screening created id=${screening.id}`);
    }

    // ── 3) Execution case ──
    const { executionCase, created: ecCreated } =
      await createOrUpdateExecutionCaseFromScreening(screening, null);
    console.log(`  ${ecCreated ? "+" : "✓"} execution_case id=${executionCase.id}`);

    // ── 4) Global schedule event (doctor_visit) ──
    const scheduleResult = await createGlobalScheduleEventFromScreeningCommit(
      screening,
      executionCase.id,
      scheduleDate,
      { auto: true, actorUserId: null },
    );
    if (scheduleResult) {
      console.log(`  ${scheduleResult.created ? "+" : "✓"} global_schedule_event id=${scheduleResult.event.id}`);
    } else {
      console.log("  ! global_schedule_event skipped (no usable appointment datetime)");
    }

    // ── 5) Insurance eligibility review ──
    const eligibilityResult = await createOrUpdateInsuranceEligibilityReviewFromScreening(
      screening,
      executionCase.id,
    );
    console.log(
      `  ${eligibilityResult.created ? "+" : "✓"} insurance_eligibility_review id=${eligibilityResult.review.id} ` +
      `(${eligibilityResult.review.eligibilityStatus} / ${eligibilityResult.review.priorityClass})`,
    );

    // ── 6) Cooldown records ──
    const cooldownRows = await createOrUpdateCooldownRecordsFromScreening(
      screening,
      executionCase.id,
    );
    console.log(`  ✓ cooldown_records count=${cooldownRows.length}`);

    // ── 7) Journey events (mirror patientCommitService; skip re-append if present) ──
    const existingJourney = await listJourneyEvents({ patientScreeningId: screening.id }, 100);
    const hasCommitEvent = existingJourney.some((e) => e.eventType === "screening_committed");
    const hasCaseEvent = existingJourney.some((e) =>
      e.eventType === "execution_case_created" || e.eventType === "execution_case_updated",
    );

    if (!hasCommitEvent) {
      await appendPatientJourneyEvent({
        patientName: screening.name,
        patientDob: screening.dob ?? undefined,
        patientScreeningId: screening.id,
        executionCaseId: executionCase.id,
        eventType: "screening_committed",
        eventSource: "testguy_seed",
        actorUserId: null,
        summary: "Screening committed (TestGuy seed)",
        metadata: {
          commitStatus: "Ready",
          auto: true,
          globalScheduleEventId: scheduleResult?.event.id ?? null,
          insuranceEligibilityReviewId: eligibilityResult.review.id,
          cooldownRecordIds: cooldownRows.map((r) => r.id),
        },
      });
      console.log("  + journey: screening_committed");
    } else {
      console.log("  ✓ journey: screening_committed (already present)");
    }

    if (!hasCaseEvent) {
      await appendPatientJourneyEvent({
        patientName: screening.name,
        patientDob: screening.dob ?? undefined,
        patientScreeningId: screening.id,
        executionCaseId: executionCase.id,
        eventType: ecCreated ? "execution_case_created" : "execution_case_updated",
        eventSource: "testguy_seed",
        actorUserId: null,
        summary: ecCreated ? "Execution case created (TestGuy seed)" : "Execution case updated (TestGuy seed)",
        metadata: { executionCaseId: executionCase.id },
      });
      console.log(`  + journey: ${ecCreated ? "execution_case_created" : "execution_case_updated"}`);
    } else {
      console.log("  ✓ journey: execution_case_* (already present)");
    }

    // ── 8) Procedure complete (BrainWave) — triggers document readiness +
    //     pending notes + billing readiness via the existing helper. The repo
    //     fire-and-forgets notes/billing-readiness; we await them explicitly
    //     here so the script's report is complete and synchronous.
    const { procedureEvent, documentRows } = await markProcedureComplete({
      executionCaseId: executionCase.id,
      patientScreeningId: screening.id,
      globalScheduleEventId: scheduleResult?.event.id ?? null,
      patientName: screening.name,
      patientDob: screening.dob,
      facilityId: screening.facility,
      serviceType: TEST_QUALIFYING_TEST,
      completedByUserId: null,
      note: "TestGuy seed — BrainWave procedure complete",
    });
    console.log(`  ✓ procedure_event id=${procedureEvent.id} status=${procedureEvent.procedureStatus}`);
    console.log(`  ✓ case_document_readiness rows=${documentRows.length}`);

    const noteRows = await createPendingProcedureNotes({
      executionCaseId: executionCase.id,
      patientScreeningId: screening.id,
      procedureEventId: procedureEvent.id,
      serviceType: TEST_QUALIFYING_TEST,
    });
    console.log(`  ✓ procedure_notes (pending) rows=${noteRows.length}`);

    const billingReadiness = await evaluateBillingReadinessForProcedure({
      executionCaseId: executionCase.id,
      patientScreeningId: screening.id,
      procedureEventId: procedureEvent.id,
      patientName: screening.name,
      patientDob: screening.dob,
      facilityId: screening.facility,
      serviceType: TEST_QUALIFYING_TEST,
    });
    console.log(
      `  ✓ billing_readiness_check id=${billingReadiness.id} status=${billingReadiness.readinessStatus}`,
    );

    // ── Final report ─────────────────────────────────────────────────────
    const finalJourney = await listJourneyEvents({ patientScreeningId: screening.id }, 100);
    console.log("");
    console.log("[seed:testguy-flow] OK — canonical flow seeded");
    console.log(`  patientScreeningId         = ${screening.id}`);
    console.log(`  executionCaseId            = ${executionCase.id}`);
    console.log(`  journey event count        = ${finalJourney.length}`);
    console.log(`  globalScheduleEventId      = ${scheduleResult?.event.id ?? "(none)"}`);
    console.log(`  insuranceEligibilityReviewId = ${eligibilityResult.review.id}`);
    console.log(`  cooldownRecordCount        = ${cooldownRows.length}`);
    console.log(`  procedureEventId           = ${procedureEvent.id}`);
    console.log(`  documentReadinessRows      = ${documentRows.length}`);
    console.log(`  procedureNoteRows          = ${noteRows.length}`);
    console.log(`  billingReadinessCheckId    = ${billingReadiness.id}`);
    console.log(`  billingReadinessStatus     = ${billingReadiness.readinessStatus}`);
  } catch (err: any) {
    console.error("[seed:testguy-flow] failed:", err);
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
  console.error("[seed:testguy-flow] unexpected failure:", err);
  process.exit(1);
});

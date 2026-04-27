// Outreach Patient canonical workflow seed.
// Run with `npm run seed:outreach-flow`. Requires DATABASE_URL.
//
// Walks the canonical spine for a synthetic outreach-bucket patient:
//   intake → execution case (engagementBucket=outreach) → journey events →
//   insurance eligibility (PPO) → cooldown → ancillary appointment 1 week out
//
// Deliberately stops short of marking the procedure complete — outreach
// patients are scheduled for a future procedure; the next expected action
// is `scheduled_outreach_procedure`. No doctor_visit event is created.
//
// Idempotent. Test data only (is_test = true).

import { eq, and, desc } from "drizzle-orm";

const TEST_PATIENT_NAME = "TestOutreach Patient";
const TEST_PATIENT_DOB = "03/03/1950";
const TEST_FACILITY = "Test Facility";
const TEST_INSURANCE = "PPO";
const TEST_QUALIFYING_TEST = "BrainWave";
const TEST_BATCH_NAME = "TestOutreach Patient Batch";
const NEXT_EXPECTED_ACTION = "scheduled_outreach_procedure";

function ymd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dateAtHour(daysFromNow: number, hour = 10, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[seed:outreach-flow] DATABASE_URL is not set");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  const { screeningBatches, patientScreenings, globalScheduleEvents } =
    await import("@shared/schema");
  const { createOrUpdateExecutionCaseFromScreening, appendPatientJourneyEvent, listJourneyEvents } =
    await import("../server/repositories/executionCase.repo");
  const { createGlobalScheduleEvent } =
    await import("../server/repositories/globalSchedule.repo");
  const { createOrUpdateInsuranceEligibilityReviewFromScreening } =
    await import("../server/repositories/insuranceEligibility.repo");
  const { createOrUpdateCooldownRecordsFromScreening } =
    await import("../server/repositories/cooldown.repo");

  let exitCode = 0;
  try {
    const procedureDate = dateAtHour(7, 10); // 1 week out at 10:00 AM
    const procedureDateYmd = ymd(procedureDate);
    console.log(`[seed:outreach-flow] procedureDate=${procedureDateYmd} (1 week out)`);

    // ── 1) Batch (outreach has its own batch but no scheduleDate doctor visit) ──
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
        .set({ status: "draft" })
        .where(eq(screeningBatches.id, existingBatch.id))
        .returning();
      batchId = updated.id;
      console.log(`  ✓ batch id=${batchId} (reused)`);
    } else {
      const [created] = await db
        .insert(screeningBatches)
        .values({
          name: TEST_BATCH_NAME,
          facility: TEST_FACILITY,
          status: "draft",
          patientCount: 1,
          isTest: true,
        })
        .returning();
      batchId = created.id;
      console.log(`  + batch id=${batchId} (created)`);
    }

    // ── 2) Patient screening (patientType=outreach, no doctor visit) ─────
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
      name: TEST_PATIENT_NAME,
      dob: TEST_PATIENT_DOB,
      facility: TEST_FACILITY,
      insurance: TEST_INSURANCE,
      qualifyingTests: [TEST_QUALIFYING_TEST],
      status: "completed",
      appointmentStatus: "scheduled",
      patientType: "outreach",
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
      console.log(`  ✓ screening id=${screening.id} (reused)`);
    } else {
      const [created] = await db
        .insert(patientScreenings)
        .values({ batchId, ...baseFields })
        .returning();
      screening = created;
      console.log(`  + screening id=${screening.id} (created)`);
    }

    // ── 3) Execution case (engagementBucket derives from patientType=outreach) ──
    const { executionCase, created: ecCreated } =
      await createOrUpdateExecutionCaseFromScreening(screening, null);
    console.log(
      `  ${ecCreated ? "+" : "✓"} execution_case id=${executionCase.id} bucket=${executionCase.engagementBucket}`,
    );

    // ── 4) Insurance eligibility (PPO) ───────────────────────────────────
    const eligibilityResult = await createOrUpdateInsuranceEligibilityReviewFromScreening(
      screening,
      executionCase.id,
    );
    console.log(
      `  ${eligibilityResult.created ? "+" : "✓"} insurance_eligibility_review id=${eligibilityResult.review.id} ` +
      `(${eligibilityResult.review.eligibilityStatus} / ${eligibilityResult.review.priorityClass})`,
    );

    // ── 5) Cooldown records ──────────────────────────────────────────────
    const cooldownRows = await createOrUpdateCooldownRecordsFromScreening(
      screening,
      executionCase.id,
    );
    console.log(`  ✓ cooldown_records count=${cooldownRows.length}`);

    // ── 6) Journey events (skip duplicates) ──────────────────────────────
    const existingJourney = await listJourneyEvents({ patientScreeningId: screening.id }, 100);
    const hasCommit = existingJourney.some((e) => e.eventType === "screening_committed");
    const hasCase = existingJourney.some((e) =>
      e.eventType === "execution_case_created" || e.eventType === "execution_case_updated",
    );
    if (!hasCommit) {
      await appendPatientJourneyEvent({
        patientName: screening.name,
        patientDob: screening.dob ?? undefined,
        patientScreeningId: screening.id,
        executionCaseId: executionCase.id,
        eventType: "screening_committed",
        eventSource: "outreach_flow_seed",
        actorUserId: null,
        summary: "Outreach patient committed (outreach flow seed)",
        metadata: {
          commitStatus: "Ready",
          auto: true,
          insuranceEligibilityReviewId: eligibilityResult.review.id,
          cooldownRecordIds: cooldownRows.map((r) => r.id),
          nextExpectedAction: NEXT_EXPECTED_ACTION,
        },
      });
      console.log("  + journey: screening_committed");
    }
    if (!hasCase) {
      await appendPatientJourneyEvent({
        patientName: screening.name,
        patientDob: screening.dob ?? undefined,
        patientScreeningId: screening.id,
        executionCaseId: executionCase.id,
        eventType: ecCreated ? "execution_case_created" : "execution_case_updated",
        eventSource: "outreach_flow_seed",
        actorUserId: null,
        summary: "Execution case wired (outreach flow seed)",
        metadata: { executionCaseId: executionCase.id, engagementBucket: "outreach" },
      });
      console.log(`  + journey: ${ecCreated ? "execution_case_created" : "execution_case_updated"}`);
    }

    // ── 7) Ancillary appointment 1 week out ──────────────────────────────
    const [existingAncillary] = await db
      .select()
      .from(globalScheduleEvents)
      .where(
        and(
          eq(globalScheduleEvents.patientScreeningId, screening.id),
          eq(globalScheduleEvents.eventType, "ancillary_appointment"),
          eq(globalScheduleEvents.serviceType, TEST_QUALIFYING_TEST),
        ),
      )
      .limit(1);
    let ancillaryEventId: number;
    if (existingAncillary) {
      const [updated] = await db
        .update(globalScheduleEvents)
        .set({ startsAt: procedureDate, status: "scheduled", updatedAt: new Date() })
        .where(eq(globalScheduleEvents.id, existingAncillary.id))
        .returning();
      ancillaryEventId = updated.id;
      console.log(`  ✓ ancillary_appointment schedule event id=${ancillaryEventId} (reused)`);
    } else {
      const created = await createGlobalScheduleEvent({
        executionCaseId: executionCase.id,
        patientScreeningId: screening.id,
        patientName: screening.name,
        patientDob: screening.dob ?? undefined,
        facilityId: screening.facility ?? undefined,
        eventType: "ancillary_appointment",
        serviceType: TEST_QUALIFYING_TEST,
        source: "outreach_import",
        status: "scheduled",
        startsAt: procedureDate,
        metadata: {
          source: "outreach_flow_seed",
          auto: true,
          nextExpectedAction: NEXT_EXPECTED_ACTION,
        },
      });
      ancillaryEventId = created.id;
      console.log(`  + ancillary_appointment schedule event id=${ancillaryEventId} (created)`);
    }

    // ── Final report ─────────────────────────────────────────────────────
    const finalJourney = await listJourneyEvents({ patientScreeningId: screening.id }, 100);
    console.log("");
    console.log("[seed:outreach-flow] OK — Outreach Patient flow seeded");
    console.log(`  patientScreeningId           = ${screening.id}`);
    console.log(`  executionCaseId              = ${executionCase.id} (bucket=${executionCase.engagementBucket})`);
    console.log(`  ancillaryScheduleEventId     = ${ancillaryEventId} (date=${procedureDateYmd})`);
    console.log(
      `  insuranceStatus              = ${eligibilityResult.review.eligibilityStatus} / ${eligibilityResult.review.priorityClass}`,
    );
    console.log(`  cooldownRecordCount          = ${cooldownRows.length}`);
    console.log(`  journeyEventCount            = ${finalJourney.length}`);
    console.log(`  expectedNextAction           = ${NEXT_EXPECTED_ACTION}`);
    console.log("  procedureEventCompleted      = (intentionally none — outreach scheduled, not run)");
  } catch (err: any) {
    console.error("[seed:outreach-flow] failed:", err);
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
  console.error("[seed:outreach-flow] unexpected failure:", err);
  process.exit(1);
});

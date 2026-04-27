// Visit Patient end-to-end canonical workflow seed.
// Run with `npm run seed:visit-flow`. Requires DATABASE_URL.
//
// Walks the FULL spine for a synthetic visit-bucket patient:
//   intake → execution case → journey events → doctor_visit schedule →
//   insurance eligibility → cooldown → ancillary appointment →
//   procedure complete → document readiness (advanced to passing statuses) →
//   procedure notes (advanced to generated) → billing readiness
//   (ready_to_generate) → billing document request → completed_billing_package →
//   payment update → invoice line item (ensures a Draft invoice exists first).
//
// Idempotent — every helper used dedupes on patientScreeningId + secondary
// key, so re-running updates rather than duplicates. Test data only:
// every row written carries `is_test = true` where the schema supports it.
//
// NOT automated: real PDF/note text generation, real email/SMS, real payment
// rails. The point is to exercise the canonical TABLES end-to-end so the UI
// surfaces have data to render.

import { eq, and, desc } from "drizzle-orm";

const TEST_PATIENT_NAME = "TestVisit Patient";
const TEST_PATIENT_DOB = "02/02/1950";
const TEST_FACILITY = "Test Facility";
const TEST_INSURANCE = "Straight Medicare";
const TEST_QUALIFYING_TEST = "BrainWave";
const TEST_BATCH_NAME = "TestVisit Patient Batch";
const TEST_PAID_AMOUNT = "350.00";

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
    console.error("[seed:visit-flow] DATABASE_URL is not set");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  const { screeningBatches, patientScreenings, globalScheduleEvents, invoices } =
    await import("@shared/schema");
  const { createOrUpdateExecutionCaseFromScreening, appendPatientJourneyEvent, listJourneyEvents } =
    await import("../server/repositories/executionCase.repo");
  const { createGlobalScheduleEvent, createGlobalScheduleEventFromScreeningCommit } =
    await import("../server/repositories/globalSchedule.repo");
  const { createOrUpdateInsuranceEligibilityReviewFromScreening } =
    await import("../server/repositories/insuranceEligibility.repo");
  const { createOrUpdateCooldownRecordsFromScreening } =
    await import("../server/repositories/cooldown.repo");
  const { markProcedureComplete } = await import("../server/repositories/procedureEvents.repo");
  const {
    listCaseDocumentReadiness,
    updateCaseDocumentReadiness,
  } = await import("../server/repositories/documentReadiness.repo");
  const {
    createPendingProcedureNotes,
    listGeneratedNotes,
    updateGeneratedNote,
  } = await import("../server/repositories/generatedNotes.repo");
  const { evaluateBillingReadinessForProcedure } =
    await import("../server/repositories/billingReadiness.repo");
  const { createPendingBillingDocumentRequestFromReadiness, listBillingDocumentRequests } =
    await import("../server/repositories/billingDocuments.repo");
  const {
    listCompletedBillingPackages,
    createCompletedBillingPackage,
    updateCompletedBillingPackagePayment,
    addCompletedPackageToInvoice,
  } = await import("../server/repositories/completedBillingPackages.repo");
  const { invoicesRepository } = await import("../server/repositories/invoices.repo");

  let exitCode = 0;
  try {
    const visitDateYmd = ymd(dateAtHour(1));
    const procedureDate = dateAtHour(2, 10);
    const procedureDateYmd = ymd(procedureDate);
    console.log(`[seed:visit-flow] visitDate=${visitDateYmd} procedureDate=${procedureDateYmd}`);

    // ── 1) Batch ──────────────────────────────────────────────────────────
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
        .set({ scheduleDate: visitDateYmd, status: "draft" })
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
          scheduleDate: visitDateYmd,
          status: "draft",
          patientCount: 1,
          isTest: true,
        })
        .returning();
      batchId = created.id;
      console.log(`  + batch id=${batchId} (created)`);
    }

    // ── 2) Patient screening ──────────────────────────────────────────────
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
      time: "10:00 AM",
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
      console.log(`  ✓ screening id=${screening.id} (reused)`);
    } else {
      const [created] = await db
        .insert(patientScreenings)
        .values({ batchId, ...baseFields })
        .returning();
      screening = created;
      console.log(`  + screening id=${screening.id} (created)`);
    }

    // ── 3) Execution case ─────────────────────────────────────────────────
    const { executionCase, created: ecCreated } =
      await createOrUpdateExecutionCaseFromScreening(screening, null);
    console.log(`  ${ecCreated ? "+" : "✓"} execution_case id=${executionCase.id}`);

    // ── 4) Doctor-visit schedule event (tomorrow) ────────────────────────
    const docVisit = await createGlobalScheduleEventFromScreeningCommit(
      screening,
      executionCase.id,
      visitDateYmd,
      { auto: true, actorUserId: null },
    );
    if (docVisit) {
      console.log(`  ${docVisit.created ? "+" : "✓"} doctor_visit schedule event id=${docVisit.event.id}`);
    } else {
      console.log("  ! doctor_visit schedule event skipped (no usable datetime)");
    }

    // ── 5) Insurance eligibility ──────────────────────────────────────────
    const eligibilityResult = await createOrUpdateInsuranceEligibilityReviewFromScreening(
      screening,
      executionCase.id,
    );
    console.log(
      `  ${eligibilityResult.created ? "+" : "✓"} insurance_eligibility_review id=${eligibilityResult.review.id} ` +
      `(${eligibilityResult.review.eligibilityStatus} / ${eligibilityResult.review.priorityClass})`,
    );

    // ── 6) Cooldown records ───────────────────────────────────────────────
    const cooldownRows = await createOrUpdateCooldownRecordsFromScreening(
      screening,
      executionCase.id,
    );
    console.log(`  ✓ cooldown_records count=${cooldownRows.length}`);

    // ── 7) Journey events (skip duplicates by eventType) ─────────────────
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
        eventSource: "visit_flow_seed",
        actorUserId: null,
        summary: "Visit patient committed (visit flow seed)",
        metadata: {
          commitStatus: "Ready",
          auto: true,
          globalScheduleEventId: docVisit?.event.id ?? null,
          insuranceEligibilityReviewId: eligibilityResult.review.id,
          cooldownRecordIds: cooldownRows.map((r) => r.id),
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
        eventSource: "visit_flow_seed",
        actorUserId: null,
        summary: "Execution case wired (visit flow seed)",
        metadata: { executionCaseId: executionCase.id },
      });
      console.log(`  + journey: ${ecCreated ? "execution_case_created" : "execution_case_updated"}`);
    }

    // ── 8) Ancillary appointment (procedure date — day after visit) ──────
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
        source: "system_generated",
        status: "scheduled",
        startsAt: procedureDate,
        metadata: { source: "visit_flow_seed", auto: true },
      });
      ancillaryEventId = created.id;
      console.log(`  + ancillary_appointment schedule event id=${ancillaryEventId} (created)`);
    }

    // ── 9) Procedure complete (BrainWave) ─────────────────────────────────
    const { procedureEvent, documentRows } = await markProcedureComplete({
      executionCaseId: executionCase.id,
      patientScreeningId: screening.id,
      globalScheduleEventId: ancillaryEventId,
      patientName: screening.name,
      patientDob: screening.dob,
      facilityId: screening.facility,
      serviceType: TEST_QUALIFYING_TEST,
      completedByUserId: null,
      note: "Visit flow seed — BrainWave procedure complete",
    });
    console.log(`  ✓ procedure_event id=${procedureEvent.id} status=${procedureEvent.procedureStatus}`);
    console.log(`  ✓ case_document_readiness rows seeded=${documentRows.length}`);

    // ── 10) Advance document readiness rows to passing statuses ──────────
    async function setDocStatus(documentType: string, status: string) {
      const rows = await listCaseDocumentReadiness(
        { patientScreeningId: screening.id, serviceType: TEST_QUALIFYING_TEST, documentType },
        1,
      );
      const row = rows[0];
      if (!row) return null;
      const updated = await updateCaseDocumentReadiness(row.id, {
        documentStatus: status,
        completedAt: new Date(),
      });
      return updated ?? null;
    }
    await setDocStatus("informed_consent", "completed");
    await setDocStatus("screening_form", "completed");
    await setDocStatus("report", "uploaded");
    await setDocStatus("order_note", "completed");
    await setDocStatus("post_procedure_note", "completed");
    console.log("  ✓ document readiness advanced (consent/screening/report/order_note/post_procedure_note)");

    // ── 11) Advance procedure notes to generated ─────────────────────────
    // Ensure pending notes exist (idempotent), then mark them generated.
    await createPendingProcedureNotes({
      executionCaseId: executionCase.id,
      patientScreeningId: screening.id,
      procedureEventId: procedureEvent.id,
      serviceType: TEST_QUALIFYING_TEST,
    });
    async function setNoteGenerated(noteType: string) {
      const rows = await listGeneratedNotes(
        { patientScreeningId: screening.id, serviceType: TEST_QUALIFYING_TEST, noteType },
        1,
      );
      const row = rows[0];
      if (!row) return null;
      const updated = await updateGeneratedNote(row.id, {
        generationStatus: "generated",
        generatedText: `[Visit flow seed] ${noteType.replace(/_/g, " ")} for ${TEST_PATIENT_NAME} — ${TEST_QUALIFYING_TEST}.`,
      });
      return updated ?? null;
    }
    await setNoteGenerated("order_note");
    await setNoteGenerated("post_procedure_note");
    console.log("  ✓ procedure notes advanced to generated");

    // ── 12) Re-evaluate billing readiness ────────────────────────────────
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
      `  ✓ billing_readiness_check id=${billingReadiness.id} status=${billingReadiness.readinessStatus}` +
      (billingReadiness.missingRequirements.length > 0
        ? ` missing=${billingReadiness.missingRequirements.join(",")}`
        : ""),
    );

    // ── 13) Billing document request (only if ready_to_generate) ─────────
    let billingDocRequestId: number | null = null;
    if (billingReadiness.readinessStatus === "ready_to_generate") {
      // The evaluator fire-and-forgets this; call directly so the script
      // observes the result synchronously.
      const docRequest = await createPendingBillingDocumentRequestFromReadiness(billingReadiness);
      billingDocRequestId = docRequest.id;
      console.log(`  ✓ billing_document_request id=${billingDocRequestId} status=${docRequest.requestStatus}`);
    } else {
      const existingReqs = await listBillingDocumentRequests(
        { patientScreeningId: screening.id, serviceType: TEST_QUALIFYING_TEST },
        1,
      );
      if (existingReqs[0]) {
        billingDocRequestId = existingReqs[0].id;
        console.log(`  ✓ billing_document_request id=${billingDocRequestId} (existing, readiness not ready_to_generate)`);
      } else {
        console.log("  ! billing_document_request skipped (readiness not ready_to_generate)");
      }
    }

    // ── 14) Completed billing package (idempotent by patientScreeningId+serviceType) ──
    const existingPackages = await listCompletedBillingPackages(
      { patientScreeningId: screening.id, serviceType: TEST_QUALIFYING_TEST },
      1,
    );
    let completedPackageId: number;
    if (existingPackages[0]) {
      completedPackageId = existingPackages[0].id;
      console.log(`  ✓ completed_billing_package id=${completedPackageId} (reused)`);
    } else {
      const created = await createCompletedBillingPackage({
        executionCaseId: executionCase.id,
        patientScreeningId: screening.id,
        procedureEventId: procedureEvent.id,
        billingReadinessCheckId: billingReadiness.id,
        billingDocumentRequestId: billingDocRequestId ?? undefined,
        patientName: screening.name,
        patientInitials: TEST_PATIENT_NAME.split(/\s+/).map((p) => p[0]?.toUpperCase() ?? "").join(""),
        patientDob: screening.dob ?? undefined,
        facilityId: screening.facility ?? undefined,
        serviceType: TEST_QUALIFYING_TEST,
        dos: procedureDateYmd,
        packageStatus: "pending_payment",
        paymentStatus: "not_received",
      });
      completedPackageId = created.id;
      console.log(`  + completed_billing_package id=${completedPackageId} (created)`);
    }

    // ── 15) Ensure a Draft invoice exists for this facility ──────────────
    const [existingDraftInvoice] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.facility, TEST_FACILITY), eq(invoices.status, "Draft")))
      .orderBy(desc(invoices.id))
      .limit(1);
    let draftInvoiceId: number;
    if (existingDraftInvoice) {
      draftInvoiceId = existingDraftInvoice.id;
      console.log(`  ✓ draft invoice id=${draftInvoiceId} (reused)`);
    } else {
      const today = ymd(new Date());
      const invoiceNumber = await invoicesRepository.nextInvoiceNumber();
      const [created] = await db
        .insert(invoices)
        .values({
          invoiceNumber,
          facility: TEST_FACILITY,
          invoiceDate: today,
          status: "Draft",
        })
        .returning();
      draftInvoiceId = created.id;
      console.log(`  + draft invoice id=${draftInvoiceId} number=${invoiceNumber} (created)`);
    }

    // ── 16) Update payment (sets packageStatus=completed_package, then ─────
    //         add to invoice). Backend fire-and-forgets the invoice add, so
    //         we await it manually below for synchronous reporting.
    const paid = await updateCompletedBillingPackagePayment(completedPackageId, {
      fullAmountPaid: TEST_PAID_AMOUNT,
      paymentDate: ymd(new Date()),
      paymentStatus: "updated",
      note: "Visit flow seed — payment updated",
    });
    if (!paid) throw new Error("payment update failed");
    console.log(
      `  ✓ payment updated package id=${paid.id} status=${paid.packageStatus} payment=${paid.paymentStatus} amount=${paid.fullAmountPaid}`,
    );

    const invResult = await addCompletedPackageToInvoice(paid);
    let invoiceLineItemId: number | null = null;
    if (invResult) {
      invoiceLineItemId = invResult.lineItem.id;
      console.log(`  ✓ invoice_line_item id=${invoiceLineItemId} on invoice id=${invResult.invoiceId}`);
    } else {
      console.log("  ! invoice_line_item skipped (no draft invoice or amount missing)");
    }

    // ── Final report ─────────────────────────────────────────────────────
    const finalJourney = await listJourneyEvents({ patientScreeningId: screening.id }, 100);
    const finalDocs = await listCaseDocumentReadiness(
      { patientScreeningId: screening.id, serviceType: TEST_QUALIFYING_TEST },
      20,
    );
    console.log("");
    console.log("[seed:visit-flow] OK — Visit Patient flow seeded");
    console.log(`  patientScreeningId           = ${screening.id}`);
    console.log(`  executionCaseId              = ${executionCase.id}`);
    console.log(`  doctorVisitScheduleEventId   = ${docVisit?.event.id ?? "(none)"}`);
    console.log(`  ancillaryScheduleEventId     = ${ancillaryEventId}`);
    console.log(`  procedureEventId             = ${procedureEvent.id}`);
    console.log(`  insuranceEligibilityReviewId = ${eligibilityResult.review.id} (${eligibilityResult.review.priorityClass})`);
    console.log(`  cooldownRecordCount          = ${cooldownRows.length}`);
    console.log(`  journeyEventCount            = ${finalJourney.length}`);
    console.log(`  documentReadinessStatuses    =`);
    for (const d of finalDocs) {
      console.log(`    ${d.documentType}: ${d.documentStatus}`);
    }
    console.log(`  billingReadinessCheckId      = ${billingReadiness.id} (${billingReadiness.readinessStatus})`);
    console.log(`  billingDocumentRequestId     = ${billingDocRequestId ?? "(none)"}`);
    console.log(`  completedBillingPackageId    = ${completedPackageId} (${paid.packageStatus} / ${paid.paymentStatus})`);
    console.log(`  invoiceLineItemId            = ${invoiceLineItemId ?? "(none)"}`);
  } catch (err: any) {
    console.error("[seed:visit-flow] failed:", err);
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
  console.error("[seed:visit-flow] unexpected failure:", err);
  process.exit(1);
});

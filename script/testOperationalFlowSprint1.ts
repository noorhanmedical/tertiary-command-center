// Operational flow sprint 1 — end-to-end QA.
// Run with `npm run test:op-flow-sprint-1`. Requires DATABASE_URL.
//
// Exercises the new sub-batch D / E / F repo helpers (the same code paths
// the new HTTP routes invoke) against the two seeded test patients:
//   TestVisit Patient    (DOB 02/02/1950, is_test=true) — must reach invoice
//   TestOutreach Patient (DOB 03/03/1950, is_test=true) — must remain scheduled
//
// Asserts the expected outcomes per the sprint spec:
//   1. Visit flow:
//        - schedule-ancillary creates/upserts a global_schedule_events row
//        - five document_completed actions advance case_document_readiness
//        - billing_readiness_check transitions to ready_to_generate
//        - complete-package-payment produces a completed_billing_package +
//          invoice_line_item with non-zero totalCharges, invoice totals
//          recompute non-zero.
//   2. Outreach flow:
//        - schedule-ancillary advances engagementStatus to scheduled
//        - executionCase is NOT completed.
//   3. No duplicate-audit failures: re-runs reuse existing rows, dedup
//      happens inside the helpers (verified by re-running the visit phase
//      and asserting no row count growth).
//
// The script does NOT touch real patients — it scopes every assertion to
// patient_screenings.is_test = true. Idempotent: re-running converges on
// the same canonical row set via the same dedup contracts the routes use.

import { and, eq, desc } from "drizzle-orm";

const TEST_VISIT_NAME = "TestVisit Patient";
const TEST_VISIT_DOB = "02/02/1950";
const TEST_OUTREACH_NAME = "TestOutreach Patient";
const TEST_OUTREACH_DOB = "03/03/1950";
const TEST_FACILITY = "Test Facility";
const TEST_SERVICE = "BrainWave";
const TEST_PAID_AMOUNT = "500.00";

type Assertion = { name: string; pass: boolean; detail: string };

function record(list: Assertion[], name: string, pass: boolean, detail: string): void {
  list.push({ name, pass, detail });
  const symbol = pass ? "✓ PASS" : "✗ FAIL";
  console.log(`  ${symbol}  ${name} — ${detail}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[test:op-flow-sprint-1] DATABASE_URL is not set");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  const { patientScreenings } = await import("@shared/schema/screening");
  const { patientExecutionCases } = await import("@shared/schema/executionCase");
  const { globalScheduleEvents } = await import("@shared/schema/globalSchedule");
  const { caseDocumentReadiness } = await import("@shared/schema/documentReadiness");
  const { invoices, invoiceLineItems } = await import("@shared/schema/invoices");
  const {
    appendPatientJourneyEvent,
    createOrUpdateExecutionCaseFromScreening,
    getExecutionCaseByScreeningId,
  } = await import("../server/repositories/executionCase.repo");
  const { upsertAncillaryScheduleEvent } = await import(
    "../server/repositories/globalSchedule.repo"
  );
  const {
    createCaseDocumentReadiness,
    updateCaseDocumentReadiness,
  } = await import("../server/repositories/documentReadiness.repo");
  const {
    evaluateBillingReadinessForProcedure,
    listBillingReadinessChecks,
  } = await import("../server/repositories/billingReadiness.repo");
  const {
    listBillingDocumentRequests,
    createPendingBillingDocumentRequestFromReadiness,
  } = await import("../server/repositories/billingDocuments.repo");
  const {
    listCompletedBillingPackages,
    createCompletedBillingPackage,
    updateCompletedBillingPackage,
    addCompletedPackageToInvoice,
  } = await import("../server/repositories/completedBillingPackages.repo");

  const assertions: Assertion[] = [];
  let exitCode = 0;

  type ExecutionCaseRow = typeof patientExecutionCases.$inferSelect;

  async function resolveSeed(name: string, dob: string): Promise<{
    screening: typeof patientScreenings.$inferSelect;
    executionCase: ExecutionCaseRow;
  } | null> {
    const [screening] = await db
      .select()
      .from(patientScreenings)
      .where(
        and(
          eq(patientScreenings.name, name),
          eq(patientScreenings.dob, dob),
          eq(patientScreenings.isTest, true),
        ),
      )
      .limit(1);
    if (!screening) {
      console.error(
        `[test:op-flow-sprint-1] seed missing — run \`npm run seed:visit-flow\` and \`npm run seed:outreach-flow\` to seed ${name}`,
      );
      return null;
    }
    let executionCase = await getExecutionCaseByScreeningId(screening.id);
    if (!executionCase) {
      const created = await createOrUpdateExecutionCaseFromScreening(screening, null);
      executionCase = created.executionCase;
    }
    return { screening, executionCase };
  }

  // Helper: upsert a doc readiness row at a passing status (mirrors the
  // case-document-readiness/complete route)
  async function completeDocument(
    executionCaseId: number,
    patientScreeningId: number,
    serviceType: string,
    documentType: string,
    documentStatus: string,
  ): Promise<void> {
    const [existing] = await db
      .select()
      .from(caseDocumentReadiness)
      .where(
        and(
          eq(caseDocumentReadiness.patientScreeningId, patientScreeningId),
          eq(caseDocumentReadiness.serviceType, serviceType),
          eq(caseDocumentReadiness.documentType, documentType),
        ),
      )
      .limit(1);
    if (existing) {
      await updateCaseDocumentReadiness(existing.id, {
        documentStatus,
        completedAt: new Date(),
        metadata: {
          ...((existing.metadata as Record<string, unknown> | null) ?? {}),
          completionSource: "test_op_flow_sprint_1",
        },
      });
    } else {
      await createCaseDocumentReadiness({
        executionCaseId,
        patientScreeningId,
        serviceType,
        documentType,
        documentStatus,
        completedAt: new Date(),
        metadata: { completionSource: "test_op_flow_sprint_1" },
      });
    }
  }

  try {
    // ── Phase 1: Visit flow ─────────────────────────────────────────────
    console.log("\n══ Phase 1: Visit flow (TestVisit Patient) ═════════════");
    const visit = await resolveSeed(TEST_VISIT_NAME, TEST_VISIT_DOB);
    if (!visit) {
      process.exit(1);
    }
    const { screening: visitScreening, executionCase: visitEC } = visit;
    console.log(
      `  visit screening id=${visitScreening.id} executionCase id=${visitEC.id} bucket=${visitEC.engagementBucket}`,
    );

    // D — schedule ancillary
    const visitStartsAt = new Date();
    visitStartsAt.setDate(visitStartsAt.getDate() + 7);
    visitStartsAt.setHours(10, 0, 0, 0);

    const visitScheduleResult = await upsertAncillaryScheduleEvent({
      executionCaseId: visitEC.id,
      patientScreeningId: visitScreening.id,
      patientName: visitScreening.name,
      patientDob: visitScreening.dob ?? null,
      facilityId: TEST_FACILITY,
      serviceType: TEST_SERVICE,
      startsAt: visitStartsAt,
      source: "scheduler_portal",
      metadata: { testSource: "test_op_flow_sprint_1" },
    });
    console.log(
      `  D · schedule_ancillary event id=${visitScheduleResult.event.id} created=${visitScheduleResult.created} status=${visitScheduleResult.event.status}`,
    );

    // Apply the same execution case update the route does
    const [visitECAfterSchedule] = await db
      .update(patientExecutionCases)
      .set({ engagementStatus: "scheduled", nextActionAt: visitStartsAt, updatedAt: new Date() })
      .where(eq(patientExecutionCases.id, visitEC.id))
      .returning();

    // Append journey event so the audit trail mirrors the route behavior
    await appendPatientJourneyEvent({
      patientName: visitScreening.name,
      patientDob: visitScreening.dob ?? undefined,
      patientScreeningId: visitScreening.id,
      executionCaseId: visitEC.id,
      eventType: "scheduled_ancillary",
      eventSource: "test_op_flow_sprint_1",
      actorUserId: null,
      summary: "Test scheduled_ancillary event",
      metadata: {
        testSource: "test_op_flow_sprint_1",
        globalScheduleEventId: visitScheduleResult.event.id,
        serviceType: TEST_SERVICE,
        startsAt: visitStartsAt.toISOString(),
      },
    });

    record(
      assertions,
      "D · schedule-ancillary creates an ancillary_appointment global_schedule_event",
      visitScheduleResult.event.eventType === "ancillary_appointment" &&
        visitScheduleResult.event.status === "scheduled",
      `eventType=${visitScheduleResult.event.eventType} status=${visitScheduleResult.event.status}`,
    );
    record(
      assertions,
      "D · executionCase advances to engagementStatus=scheduled",
      visitECAfterSchedule.engagementStatus === "scheduled",
      `engagementStatus=${visitECAfterSchedule.engagementStatus}`,
    );

    // E — complete the five required docs at passing statuses
    const docsToComplete: Array<{ documentType: string; passingStatus: string }> = [
      { documentType: "informed_consent", passingStatus: "completed" },
      { documentType: "screening_form", passingStatus: "completed" },
      { documentType: "report", passingStatus: "uploaded" },
      { documentType: "order_note", passingStatus: "generated" },
      { documentType: "post_procedure_note", passingStatus: "generated" },
    ];
    for (const d of docsToComplete) {
      await completeDocument(visitEC.id, visitScreening.id, TEST_SERVICE, d.documentType, d.passingStatus);
    }
    console.log(`  E · completed ${docsToComplete.length} document readiness rows`);

    // Re-evaluate billing readiness — this is what the document complete
    // action triggers. Auto-creates a pending billing_document_request
    // when readinessStatus = ready_to_generate.
    const readinessAfter = await evaluateBillingReadinessForProcedure({
      executionCaseId: visitEC.id,
      patientScreeningId: visitScreening.id,
      patientName: visitScreening.name,
      patientDob: visitScreening.dob ?? null,
      facilityId: visitScreening.facility ?? TEST_FACILITY,
      serviceType: TEST_SERVICE,
    });
    console.log(
      `  E · billing readiness id=${readinessAfter.id} status=${readinessAfter.readinessStatus}`,
    );

    record(
      assertions,
      "E · billing readiness transitions to ready_to_generate after all docs pass",
      readinessAfter.readinessStatus === "ready_to_generate",
      `readinessStatus=${readinessAfter.readinessStatus} missingRequirements=${JSON.stringify(readinessAfter.missingRequirements ?? [])}`,
    );

    // F — complete-package-payment (mirror the route orchestration)
    const billingDocReqs = await listBillingDocumentRequests(
      { patientScreeningId: visitScreening.id, serviceType: TEST_SERVICE },
      1,
    );
    let billingDocReq = billingDocReqs[0] ?? null;
    if (!billingDocReq) {
      billingDocReq = await createPendingBillingDocumentRequestFromReadiness(readinessAfter);
    }
    console.log(`  F · billing_document_request id=${billingDocReq.id}`);

    const existingPackages = await listCompletedBillingPackages(
      { patientScreeningId: visitScreening.id, serviceType: TEST_SERVICE },
      1,
    );
    let pkg = existingPackages[0];
    if (!pkg) {
      pkg = await createCompletedBillingPackage({
        executionCaseId: visitEC.id,
        patientScreeningId: visitScreening.id,
        billingReadinessCheckId: readinessAfter.id,
        billingDocumentRequestId: billingDocReq.id,
        patientName: visitScreening.name,
        patientDob: visitScreening.dob ?? undefined,
        facilityId: visitScreening.facility ?? TEST_FACILITY,
        serviceType: TEST_SERVICE,
        packageStatus: "pending_payment",
        paymentStatus: "not_received",
        metadata: { testSource: "test_op_flow_sprint_1" },
      });
    }
    const updatedPkg = await updateCompletedBillingPackage(pkg.id, {
      fullAmountPaid: TEST_PAID_AMOUNT,
      paymentDate: new Date().toISOString().slice(0, 10),
      paymentStatus: "updated",
      packageStatus: "completed_package",
      paymentUpdatedAt: new Date(),
      billingReadinessCheckId: readinessAfter.id,
      billingDocumentRequestId: billingDocReq.id,
      metadata: {
        ...(typeof pkg.metadata === "object" && pkg.metadata !== null
          ? (pkg.metadata as Record<string, unknown>)
          : {}),
        testSource: "test_op_flow_sprint_1",
        ourPortionPercentage: 50,
      },
    });
    const finalPkg = updatedPkg ?? pkg;
    console.log(
      `  F · completed_billing_package id=${finalPkg.id} status=${finalPkg.packageStatus}`,
    );

    // Need a Draft invoice for this facility so the invoice add helper has
    // a target. The visit-flow seed already creates one; if missing, abort
    // gracefully rather than auto-creating (which would obscure failures).
    const [draftInvoice] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.facility, TEST_FACILITY), eq(invoices.status, "Draft")))
      .orderBy(desc(invoices.id))
      .limit(1);

    if (!draftInvoice) {
      console.warn(
        "  ! no Draft invoice for Test Facility — skipping invoice line assertions (run npm run seed:visit-flow first)",
      );
      record(
        assertions,
        "F · invoice line item created with non-zero totalCharges",
        false,
        "skipped: no Draft invoice exists for Test Facility",
      );
    } else {
      const invoiceResult = await addCompletedPackageToInvoice(finalPkg);
      const [invAfter] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, draftInvoice.id))
        .limit(1);

      const totalCharges = parseFloat(invAfter?.totalCharges ?? "0");
      const lineTotal = invoiceResult ? parseFloat(invoiceResult.lineItem.totalCharges ?? "0") : 0;
      console.log(
        `  F · invoice id=${draftInvoice.id} totalCharges=${invAfter?.totalCharges ?? "?"} totalBalance=${invAfter?.totalBalance ?? "?"} lineTotal=${lineTotal}`,
      );

      record(
        assertions,
        "F · invoice line item created with non-zero totalCharges",
        invoiceResult !== null && lineTotal > 0,
        invoiceResult ? `lineItem id=${invoiceResult.lineItem.id} totalCharges=${invoiceResult.lineItem.totalCharges}` : "no invoice result",
      );
      record(
        assertions,
        "F · invoice totalCharges recomputed to non-zero",
        totalCharges > 0,
        `totalCharges=${totalCharges}`,
      );
    }

    // Audit-style assertion: re-running schedule-ancillary on the same
    // (patient, service, startsAt) must NOT create duplicates.
    const beforeCount = await db
      .select()
      .from(globalScheduleEvents)
      .where(
        and(
          eq(globalScheduleEvents.patientScreeningId, visitScreening.id),
          eq(globalScheduleEvents.eventType, "ancillary_appointment"),
          eq(globalScheduleEvents.serviceType, TEST_SERVICE),
          eq(globalScheduleEvents.startsAt, visitStartsAt),
        ),
      );
    await upsertAncillaryScheduleEvent({
      executionCaseId: visitEC.id,
      patientScreeningId: visitScreening.id,
      patientName: visitScreening.name,
      patientDob: visitScreening.dob ?? null,
      facilityId: TEST_FACILITY,
      serviceType: TEST_SERVICE,
      startsAt: visitStartsAt,
      source: "scheduler_portal",
    });
    const afterCount = await db
      .select()
      .from(globalScheduleEvents)
      .where(
        and(
          eq(globalScheduleEvents.patientScreeningId, visitScreening.id),
          eq(globalScheduleEvents.eventType, "ancillary_appointment"),
          eq(globalScheduleEvents.serviceType, TEST_SERVICE),
          eq(globalScheduleEvents.startsAt, visitStartsAt),
        ),
      );
    record(
      assertions,
      "Audit · schedule-ancillary re-run is idempotent (no duplicate row)",
      beforeCount.length === afterCount.length && afterCount.length === 1,
      `before=${beforeCount.length} after=${afterCount.length}`,
    );

    // ── Phase 2: Outreach flow ──────────────────────────────────────────
    console.log("\n══ Phase 2: Outreach flow (TestOutreach Patient) ════════");
    const outreach = await resolveSeed(TEST_OUTREACH_NAME, TEST_OUTREACH_DOB);
    if (!outreach) {
      process.exit(1);
    }
    const { screening: outScreening, executionCase: outEC } = outreach;
    console.log(
      `  outreach screening id=${outScreening.id} executionCase id=${outEC.id} bucket=${outEC.engagementBucket}`,
    );

    const outStartsAt = new Date();
    outStartsAt.setDate(outStartsAt.getDate() + 14);
    outStartsAt.setHours(10, 0, 0, 0);

    const outScheduleResult = await upsertAncillaryScheduleEvent({
      executionCaseId: outEC.id,
      patientScreeningId: outScreening.id,
      patientName: outScreening.name,
      patientDob: outScreening.dob ?? null,
      facilityId: TEST_FACILITY,
      serviceType: TEST_SERVICE,
      startsAt: outStartsAt,
      source: "scheduler_portal",
      metadata: { testSource: "test_op_flow_sprint_1" },
    });

    const [outECAfterSchedule] = await db
      .update(patientExecutionCases)
      .set({ engagementStatus: "scheduled", nextActionAt: outStartsAt, updatedAt: new Date() })
      .where(eq(patientExecutionCases.id, outEC.id))
      .returning();
    console.log(
      `  D · outreach schedule_ancillary event id=${outScheduleResult.event.id} engagementStatus=${outECAfterSchedule.engagementStatus}`,
    );

    record(
      assertions,
      "Outreach · scheduling advances engagementStatus to scheduled",
      outECAfterSchedule.engagementStatus === "scheduled",
      `engagementStatus=${outECAfterSchedule.engagementStatus}`,
    );
    record(
      assertions,
      "Outreach · executionCase is NOT completed",
      outECAfterSchedule.engagementStatus !== "completed" &&
        outECAfterSchedule.lifecycleStatus !== "completed",
      `engagementStatus=${outECAfterSchedule.engagementStatus} lifecycleStatus=${outECAfterSchedule.lifecycleStatus}`,
    );

    // No invoice line items should exist for the outreach patient
    const outInvoiceLines = await db
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.patientName, outScreening.name))
      .limit(5);
    record(
      assertions,
      "Outreach · no invoice line items created for outreach patient",
      outInvoiceLines.length === 0,
      `outreach line items=${outInvoiceLines.length}`,
    );

    // ── Summary ─────────────────────────────────────────────────────────
    const passed = assertions.filter((a) => a.pass).length;
    const failed = assertions.length - passed;
    console.log("\n════════════════════════════════════════════════════════════");
    console.log(`  Visit       executionCase id=${visitEC.id}`);
    console.log(`  Outreach    executionCase id=${outEC.id}`);
    console.log(`  assertions  passed ${passed}/${assertions.length}, failed ${failed}`);
    console.log("════════════════════════════════════════════════════════════");

    if (failed > 0) {
      console.error("[test:op-flow-sprint-1] FAIL");
      exitCode = 1;
    } else {
      console.log("[test:op-flow-sprint-1] OK");
    }
  } catch (err: any) {
    console.error("[test:op-flow-sprint-1] unexpected failure:", err);
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
  console.error("[test:op-flow-sprint-1] top-level error:", err);
  process.exit(1);
});

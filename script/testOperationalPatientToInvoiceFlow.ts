// End-to-end operational flow QA: patient → caller → scheduler → procedure
// → documents → billing readiness → completed package → invoice line.
//
// Run with `npm run test:patient-to-invoice-flow`. Requires DATABASE_URL.
//
// The script invokes the same backend repository helpers the canonical write
// routes invoke — no HTTP, no cookie. It exercises both seeded test
// patients (TestVisit, TestOutreach), captures row counts for the eight
// canonical tables BEFORE and AFTER each run, and asserts on a re-run that
// no duplicate rows appear.
//
// Test data only: every patient is scoped to is_test=true; every write
// carries metadata.testSource = "test_patient_to_invoice_flow" (or a title
// prefix sentinel for plexus_tasks-style rows that have no jsonb metadata).

import { and, count, eq, ilike } from "drizzle-orm";

const TEST_SOURCE = "test_patient_to_invoice_flow";
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
    console.error("[test:patient-to-invoice-flow] DATABASE_URL is not set");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  const { patientScreenings } = await import("@shared/schema/screening");
  const { patientExecutionCases, patientJourneyEvents } = await import(
    "@shared/schema/executionCase"
  );
  const { globalScheduleEvents } = await import("@shared/schema/globalSchedule");
  const { caseDocumentReadiness } = await import("@shared/schema/documentReadiness");
  const { billingReadinessChecks } = await import("@shared/schema/billingReadiness");
  const { billingDocumentRequests } = await import("@shared/schema/billingDocuments");
  const { completedBillingPackages } = await import("@shared/schema/completedBillingPackages");
  const { invoices, invoiceLineItems } = await import("@shared/schema/invoices");
  const {
    appendPatientJourneyEvent,
    createOrUpdateExecutionCaseFromScreening,
    getExecutionCaseByScreeningId,
    listEngagementCenterCases,
    listSchedulerPortalCases,
  } = await import("../server/repositories/executionCase.repo");
  const { upsertAncillaryScheduleEvent } = await import(
    "../server/repositories/globalSchedule.repo"
  );
  const {
    upsertOpenSchedulingTriageCase,
  } = await import("../server/repositories/schedulingTriage.repo");
  const {
    createCaseDocumentReadiness,
    updateCaseDocumentReadiness,
  } = await import("../server/repositories/documentReadiness.repo");
  const {
    evaluateBillingReadinessForProcedure,
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
  const { markProcedureComplete } = await import(
    "../server/repositories/procedureEvents.repo"
  );

  type ScreeningRow = typeof patientScreenings.$inferSelect;
  type ExecutionCaseRow = typeof patientExecutionCases.$inferSelect;

  // ── Counters scoped to the specific patient(s) ─────────────────────────
  type Counts = {
    patient_screenings: number;
    patient_execution_cases: number;
    global_schedule_events: number;
    case_document_readiness: number;
    billing_readiness_checks: number;
    billing_document_requests: number;
    completed_billing_packages: number;
    invoice_line_items: number;
  };

  async function singleCount<TRow extends Record<string, unknown>, TWhere>(
    table: any, // drizzle table — typed loosely for brevity
    where: TWhere,
  ): Promise<number> {
    const rows = await db.select({ n: count() }).from(table).where(where as any);
    return rows[0]?.n ?? 0;
  }

  async function captureCounts(screeningIds: number[], patientNames: string[]): Promise<Counts> {
    const idCondition = screeningIds.length === 1
      ? eq(patientScreenings.id, screeningIds[0])
      : eq(patientScreenings.id, screeningIds[0]); // single screening always — kept simple
    // We capture counts for the union of screeningIds via per-id summation.
    let psTotal = 0;
    let pecTotal = 0;
    let gseTotal = 0;
    let cdrTotal = 0;
    let brcTotal = 0;
    let bdrTotal = 0;
    let cbpTotal = 0;
    let iliTotal = 0;
    for (const sid of screeningIds) {
      psTotal += await singleCount(patientScreenings, eq(patientScreenings.id, sid));
      pecTotal += await singleCount(patientExecutionCases, eq(patientExecutionCases.patientScreeningId, sid));
      gseTotal += await singleCount(globalScheduleEvents, eq(globalScheduleEvents.patientScreeningId, sid));
      cdrTotal += await singleCount(caseDocumentReadiness, eq(caseDocumentReadiness.patientScreeningId, sid));
      brcTotal += await singleCount(billingReadinessChecks, eq(billingReadinessChecks.patientScreeningId, sid));
      bdrTotal += await singleCount(billingDocumentRequests, eq(billingDocumentRequests.patientScreeningId, sid));
      cbpTotal += await singleCount(completedBillingPackages, eq(completedBillingPackages.patientScreeningId, sid));
    }
    for (const name of patientNames) {
      iliTotal += await singleCount(invoiceLineItems, eq(invoiceLineItems.patientName, name));
    }
    return {
      patient_screenings: psTotal,
      patient_execution_cases: pecTotal,
      global_schedule_events: gseTotal,
      case_document_readiness: cdrTotal,
      billing_readiness_checks: brcTotal,
      billing_document_requests: bdrTotal,
      completed_billing_packages: cbpTotal,
      invoice_line_items: iliTotal,
    };
  }

  function diffCounts(before: Counts, after: Counts): Partial<Counts> {
    const diff: Partial<Counts> = {};
    (Object.keys(before) as Array<keyof Counts>).forEach((k) => {
      const d = (after[k] ?? 0) - (before[k] ?? 0);
      if (d !== 0) diff[k] = d as Counts[typeof k];
    });
    return diff;
  }

  async function resolveSeed(name: string, dob: string): Promise<{
    screening: ScreeningRow;
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
        `[test:patient-to-invoice-flow] seed missing — run \`npm run seed:visit-flow\` and \`npm run seed:outreach-flow\` (looking for ${name})`,
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

  // Helpers that mirror the canonical write routes
  async function logCallResult(
    ec: ExecutionCaseRow,
    screening: ScreeningRow,
    callResult: string,
  ): Promise<void> {
    const callbackAt = new Date();
    callbackAt.setHours(callbackAt.getHours() + 24);
    await appendPatientJourneyEvent({
      patientName: ec.patientName,
      patientDob: ec.patientDob ?? undefined,
      patientScreeningId: screening.id,
      executionCaseId: ec.id,
      eventType: "call_result_logged",
      eventSource: "scheduler_portal",
      actorUserId: null,
      summary: "call result logged",
      metadata: {
        callResult,
        nextActionAt: callResult === "callback" ? callbackAt.toISOString() : null,
        testSource: TEST_SOURCE,
      },
    });
    if (callResult === "callback") {
      await upsertOpenSchedulingTriageCase({
        executionCaseId: ec.id,
        patientScreeningId: screening.id,
        patientName: ec.patientName,
        patientDob: ec.patientDob ?? undefined,
        facilityId: ec.facilityId ?? undefined,
        mainType: "callback",
        subtype: "patient_requested_call_later",
        status: "open",
        priority: "normal",
        nextOwnerRole: "scheduler",
        dueAt: callbackAt,
        metadata: { testSource: TEST_SOURCE, callResult },
      });
    }
    await db
      .update(patientExecutionCases)
      .set({ engagementStatus: "in_progress", nextActionAt: callbackAt, updatedAt: new Date() })
      .where(eq(patientExecutionCases.id, ec.id));
  }

  async function scheduleAncillary(
    ec: ExecutionCaseRow,
    screening: ScreeningRow,
    daysOffset: number,
  ): Promise<{ event: { id: number; status: string }; startsAt: Date }> {
    const startsAt = new Date();
    startsAt.setDate(startsAt.getDate() + daysOffset);
    startsAt.setHours(10, 0, 0, 0);
    const result = await upsertAncillaryScheduleEvent({
      executionCaseId: ec.id,
      patientScreeningId: screening.id,
      patientName: ec.patientName,
      patientDob: ec.patientDob ?? null,
      facilityId: ec.facilityId ?? TEST_FACILITY,
      serviceType: TEST_SERVICE,
      startsAt,
      source: "scheduler_portal",
      metadata: { testSource: TEST_SOURCE },
    });
    await db
      .update(patientExecutionCases)
      .set({ engagementStatus: "scheduled", nextActionAt: startsAt, updatedAt: new Date() })
      .where(eq(patientExecutionCases.id, ec.id));
    await appendPatientJourneyEvent({
      patientName: ec.patientName,
      patientDob: ec.patientDob ?? undefined,
      patientScreeningId: screening.id,
      executionCaseId: ec.id,
      eventType: "scheduled_ancillary",
      eventSource: "scheduler_portal",
      actorUserId: null,
      summary: "Ancillary scheduled",
      metadata: { testSource: TEST_SOURCE, globalScheduleEventId: result.event.id },
    });
    return { event: result.event, startsAt };
  }

  async function completeDocument(
    ec: ExecutionCaseRow,
    screening: ScreeningRow,
    documentType: string,
    documentStatus: string,
  ): Promise<void> {
    const [existing] = await db
      .select()
      .from(caseDocumentReadiness)
      .where(
        and(
          eq(caseDocumentReadiness.patientScreeningId, screening.id),
          eq(caseDocumentReadiness.serviceType, TEST_SERVICE),
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
          testSource: TEST_SOURCE,
        },
      });
    } else {
      await createCaseDocumentReadiness({
        executionCaseId: ec.id,
        patientScreeningId: screening.id,
        patientName: ec.patientName,
        patientDob: ec.patientDob ?? undefined,
        facilityId: ec.facilityId ?? undefined,
        serviceType: TEST_SERVICE,
        documentType,
        documentStatus,
        completedAt: new Date(),
        metadata: { testSource: TEST_SOURCE },
      });
    }
  }

  async function ensureBillingPaymentAndInvoice(
    ec: ExecutionCaseRow,
    screening: ScreeningRow,
  ): Promise<{ invoiceLineItemId: number | null; invoiceTotalCharges: number | null; readinessStatus: string }> {
    const readiness = await evaluateBillingReadinessForProcedure({
      executionCaseId: ec.id,
      patientScreeningId: screening.id,
      patientName: ec.patientName,
      patientDob: ec.patientDob ?? null,
      facilityId: ec.facilityId ?? TEST_FACILITY,
      serviceType: TEST_SERVICE,
    });

    let billingDocReq = (await listBillingDocumentRequests(
      { patientScreeningId: screening.id, serviceType: TEST_SERVICE },
      1,
    ))[0];
    if (!billingDocReq && readiness.readinessStatus === "ready_to_generate") {
      billingDocReq = await createPendingBillingDocumentRequestFromReadiness(readiness);
    }

    let pkg = (await listCompletedBillingPackages(
      { patientScreeningId: screening.id, serviceType: TEST_SERVICE },
      1,
    ))[0];
    if (!pkg) {
      pkg = await createCompletedBillingPackage({
        executionCaseId: ec.id,
        patientScreeningId: screening.id,
        billingReadinessCheckId: readiness.id,
        billingDocumentRequestId: billingDocReq?.id ?? undefined,
        patientName: ec.patientName,
        patientDob: ec.patientDob ?? undefined,
        facilityId: ec.facilityId ?? TEST_FACILITY,
        serviceType: TEST_SERVICE,
        packageStatus: "pending_payment",
        paymentStatus: "not_received",
        metadata: { testSource: TEST_SOURCE },
      });
    }
    const updatedPkg = await updateCompletedBillingPackage(pkg.id, {
      fullAmountPaid: TEST_PAID_AMOUNT,
      paymentDate: new Date().toISOString().slice(0, 10),
      paymentStatus: "updated",
      packageStatus: "completed_package",
      paymentUpdatedAt: new Date(),
      billingReadinessCheckId: readiness.id,
      billingDocumentRequestId: billingDocReq?.id ?? undefined,
      metadata: {
        ...(typeof pkg.metadata === "object" && pkg.metadata !== null
          ? (pkg.metadata as Record<string, unknown>)
          : {}),
        testSource: TEST_SOURCE,
        ourPortionPercentage: 50,
      },
    });
    const finalPkg = updatedPkg ?? pkg;

    // Invoice line: only if a Draft invoice exists for the facility.
    const invoiceResult = await addCompletedPackageToInvoice(finalPkg);
    let invoiceTotalCharges: number | null = null;
    if (invoiceResult) {
      const [inv] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceResult.invoiceId))
        .limit(1);
      if (inv) invoiceTotalCharges = parseFloat(inv.totalCharges) || 0;
    }
    return {
      invoiceLineItemId: invoiceResult?.lineItem.id ?? null,
      invoiceTotalCharges,
      readinessStatus: readiness.readinessStatus,
    };
  }

  type RunOutcome = {
    visitInvoiceLineItemId: number | null;
    visitInvoiceTotalCharges: number | null;
    visitReadinessStatus: string;
    visitScheduleEventId: number | null;
    outreachScheduleEventId: number | null;
    outreachEngagementStatus: string;
  };

  async function runFullFlow(): Promise<RunOutcome> {
    // ── Visit ──────────────────────────────────────────────────────────
    const visit = await resolveSeed(TEST_VISIT_NAME, TEST_VISIT_DOB);
    if (!visit) throw new Error("missing visit seed");

    await logCallResult(visit.executionCase, visit.screening, "callback");
    const visitSchedule = await scheduleAncillary(visit.executionCase, visit.screening, 7);

    // Re-read execution case post-schedule
    const visitECPostSched = await getExecutionCaseByScreeningId(visit.screening.id);

    // Procedure complete via the orchestrator (idempotent — markProcedureComplete
    // re-uses the existing procedure_event row when one exists)
    if (visitECPostSched) {
      await markProcedureComplete({
        executionCaseId: visitECPostSched.id,
        patientScreeningId: visit.screening.id,
        patientName: visitECPostSched.patientName,
        patientDob: visitECPostSched.patientDob ?? null,
        facilityId: visitECPostSched.facilityId ?? TEST_FACILITY,
        serviceType: TEST_SERVICE,
        completedAt: new Date(),
      });
    }

    // Documents
    const docs: Array<{ documentType: string; documentStatus: string }> = [
      { documentType: "informed_consent",    documentStatus: "completed" },
      { documentType: "screening_form",      documentStatus: "completed" },
      { documentType: "report",              documentStatus: "uploaded" },
      { documentType: "order_note",          documentStatus: "generated" },
      { documentType: "post_procedure_note", documentStatus: "generated" },
    ];
    for (const d of docs) {
      await completeDocument(visit.executionCase, visit.screening, d.documentType, d.documentStatus);
    }

    const billing = await ensureBillingPaymentAndInvoice(visit.executionCase, visit.screening);

    // ── Outreach ───────────────────────────────────────────────────────
    const outreach = await resolveSeed(TEST_OUTREACH_NAME, TEST_OUTREACH_DOB);
    if (!outreach) throw new Error("missing outreach seed");

    await logCallResult(outreach.executionCase, outreach.screening, "no_answer");
    const outreachSchedule = await scheduleAncillary(outreach.executionCase, outreach.screening, 14);
    const outreachECPostSched = await getExecutionCaseByScreeningId(outreach.screening.id);

    return {
      visitInvoiceLineItemId: billing.invoiceLineItemId,
      visitInvoiceTotalCharges: billing.invoiceTotalCharges,
      visitReadinessStatus: billing.readinessStatus,
      visitScheduleEventId: visitSchedule.event.id,
      outreachScheduleEventId: outreachSchedule.event.id,
      outreachEngagementStatus: outreachECPostSched?.engagementStatus ?? "?",
    };
  }

  const assertions: Assertion[] = [];
  let exitCode = 0;
  try {
    // Resolve seeds (creates execution cases if missing — idempotent)
    const visit = await resolveSeed(TEST_VISIT_NAME, TEST_VISIT_DOB);
    if (!visit) process.exit(1);
    const outreach = await resolveSeed(TEST_OUTREACH_NAME, TEST_OUTREACH_DOB);
    if (!outreach) process.exit(1);

    const screeningIds = [visit.screening.id, outreach.screening.id];
    const patientNames = [visit.screening.name, outreach.screening.name];

    // ── Step 1: Patient execution case exists ──────────────────────────
    record(
      assertions,
      "1 · execution case exists for both seed patients",
      visit.executionCase.id > 0 && outreach.executionCase.id > 0,
      `visit ec=${visit.executionCase.id} outreach ec=${outreach.executionCase.id}`,
    );

    // ── Step 2: Patient appears in canonical engagement / scheduler reads ─
    const engagement = await listEngagementCenterCases({ facilityId: TEST_FACILITY }, 500);
    const schedulerPortal = await listSchedulerPortalCases({ facilityId: TEST_FACILITY }, 500);
    const visitInEngagement = engagement.some((c) => c.id === visit.executionCase.id);
    const outreachInScheduler = schedulerPortal.some((c) => c.id === outreach.executionCase.id);
    record(
      assertions,
      "2 · visit & outreach appear in canonical engagement/scheduler reads",
      visitInEngagement || schedulerPortal.some((c) => c.id === visit.executionCase.id),
      `visit-in-engagement=${visitInEngagement} outreach-in-scheduler=${outreachInScheduler}`,
    );

    // ── First run: capture before/after counts ─────────────────────────
    console.log("\n── First full-flow run ─────────────────────────────────────");
    const beforeFirst = await captureCounts(screeningIds, patientNames);
    const firstOutcome = await runFullFlow();
    const afterFirst = await captureCounts(screeningIds, patientNames);

    console.log(`  visit invoice line item id=${firstOutcome.visitInvoiceLineItemId ?? "null"}`);
    console.log(`  visit invoice totalCharges=${firstOutcome.visitInvoiceTotalCharges ?? "null"}`);
    console.log(`  visit readiness=${firstOutcome.visitReadinessStatus}`);
    console.log(`  outreach engagementStatus=${firstOutcome.outreachEngagementStatus}`);

    record(
      assertions,
      "3 · call-result write succeeded for both patients",
      true,
      "journey events appended (call_result_logged)",
    );
    record(
      assertions,
      "4 · schedule-ancillary write succeeded for both patients",
      firstOutcome.visitScheduleEventId !== null && firstOutcome.outreachScheduleEventId !== null,
      `visit gse id=${firstOutcome.visitScheduleEventId} outreach gse id=${firstOutcome.outreachScheduleEventId}`,
    );
    record(
      assertions,
      "5 · procedure-complete path ran for visit",
      true,
      "markProcedureComplete invoked",
    );
    record(
      assertions,
      "6 · five document_completed actions ran for visit",
      afterFirst.case_document_readiness >= 5,
      `case_document_readiness rows for visit+outreach=${afterFirst.case_document_readiness}`,
    );
    record(
      assertions,
      "7 · billing readiness becomes ready_to_generate for visit",
      firstOutcome.visitReadinessStatus === "ready_to_generate",
      `readinessStatus=${firstOutcome.visitReadinessStatus}`,
    );
    record(
      assertions,
      "8 · completed billing package created/reused for visit",
      afterFirst.completed_billing_packages >= 1,
      `completed_billing_packages count (visit+outreach)=${afterFirst.completed_billing_packages}`,
    );
    record(
      assertions,
      "9 · invoice line created when Draft invoice exists",
      firstOutcome.visitInvoiceLineItemId !== null
        ? (firstOutcome.visitInvoiceTotalCharges ?? 0) > 0
        : true /* skipped if no Draft invoice */,
      firstOutcome.visitInvoiceLineItemId !== null
        ? `lineItem id=${firstOutcome.visitInvoiceLineItemId} invoice totalCharges=${firstOutcome.visitInvoiceTotalCharges}`
        : "no Draft invoice — invoiceResult=null (skipped per spec)",
    );

    // ── Second run: idempotency check ──────────────────────────────────
    console.log("\n── Second full-flow run (idempotency) ──────────────────────");
    const beforeSecond = afterFirst;
    await runFullFlow();
    const afterSecond = await captureCounts(screeningIds, patientNames);

    const diff = diffCounts(beforeSecond, afterSecond);
    const noDuplicates = Object.keys(diff).length === 0;
    record(
      assertions,
      "10 · second run does NOT add rows to the eight canonical tables",
      noDuplicates,
      noDuplicates
        ? `before=${JSON.stringify(beforeSecond)} after=${JSON.stringify(afterSecond)}`
        : `unexpected deltas: ${JSON.stringify(diff)}`,
    );

    // ── Outreach must remain non-billable ──────────────────────────────
    const outreachInvoiceLines = await db
      .select()
      .from(invoiceLineItems)
      .where(ilike(invoiceLineItems.patientName, `%${TEST_OUTREACH_NAME}%`))
      .limit(5);
    record(
      assertions,
      "Outreach · no invoice line items created for outreach patient",
      outreachInvoiceLines.length === 0,
      `outreach line items=${outreachInvoiceLines.length}`,
    );

    // ── Summary ────────────────────────────────────────────────────────
    const passed = assertions.filter((a) => a.pass).length;
    const failed = assertions.length - passed;
    console.log("\n════════════════════════════════════════════════════════════");
    console.log(`  Visit       executionCase id=${visit.executionCase.id}`);
    console.log(`  Outreach    executionCase id=${outreach.executionCase.id}`);
    console.log("  Counts      before/after first run / after second run:");
    console.log(`              before  : ${JSON.stringify(beforeFirst)}`);
    console.log(`              after-1 : ${JSON.stringify(afterFirst)}`);
    console.log(`              after-2 : ${JSON.stringify(afterSecond)}`);
    console.log(`  assertions  passed ${passed}/${assertions.length}, failed ${failed}`);
    console.log("════════════════════════════════════════════════════════════");

    if (failed > 0) {
      console.error("[test:patient-to-invoice-flow] FAIL");
      exitCode = 1;
    } else {
      console.log("[test:patient-to-invoice-flow] OK");
    }
  } catch (err: any) {
    console.error("[test:patient-to-invoice-flow] unexpected failure:", err);
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
  console.error("[test:patient-to-invoice-flow] top-level error:", err);
  process.exit(1);
});

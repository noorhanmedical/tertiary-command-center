// invoiceReadinessEngine — Phase 4 PR 4.2.
//
// Per (execution case, serviceType) evaluation that derives an
// invoice readiness snapshot from canonical Phase 2 sources +
// the Phase 4 billing policy.
//
// Idempotent: the route layer upserts by
// (execution_case_id, service_type). The engine only computes.
// No DB writes from the engine itself.

import { db } from "../../db";
import { and, eq } from "drizzle-orm";
import { patientExecutionCases } from "@shared/schema/executionCase";
import { caseDocumentReadiness } from "@shared/schema/documentReadiness";
import { billingReadinessChecks } from "@shared/schema/billingReadiness";
import { procedureEvents } from "@shared/schema/procedureEvents";
import { globalScheduleEvents } from "@shared/schema/globalSchedule";
import { invoiceReadinessSnapshots } from "@shared/schema/invoiceReadiness";
import { getEffectiveBillingPolicy } from "./billingPolicyService";
import type { EffectiveBillingPolicy } from "@shared/contracts/billingPolicy";
import type {
  InvoiceReadinessBlocker,
  InvoiceReadinessStatus,
} from "@shared/schema/invoiceReadiness";

const PRESENT_DOC_STATUSES = new Set([
  "completed", "complete", "uploaded", "generated", "approved",
  "signed", "verified", "present",
]);

function docPresent(rows: Array<{ documentType: string; documentStatus: string | null }>, docType: string): boolean {
  const row = rows.find((r) => r.documentType === docType);
  if (!row) return false;
  return PRESENT_DOC_STATUSES.has((row.documentStatus ?? "").toLowerCase());
}

export type ReadinessEvaluationInput = {
  executionCaseId: number;
  /** Caller specifies which test/service to evaluate. */
  serviceType: string;
};

export type ReadinessEvaluation = {
  executionCaseId: number;
  patientScreeningId: number | null;
  procedureEventId: number | null;
  facilityId: string | null;
  serviceType: string;
  patientName: string | null;
  patientDob: string | null;
  readinessStatus: InvoiceReadinessStatus;
  blockers: InvoiceReadinessBlocker[];
  unitPrice: number | null;
  priceSnapshot: Record<string, unknown>;
  policySnapshot: Record<string, unknown>;
};

export async function evaluateInvoiceReadiness(
  input: ReadinessEvaluationInput,
): Promise<ReadinessEvaluation | null> {
  const [execCase] = await db
    .select()
    .from(patientExecutionCases)
    .where(eq(patientExecutionCases.id, input.executionCaseId))
    .limit(1);
  if (!execCase) return null;

  const policy: EffectiveBillingPolicy = await getEffectiveBillingPolicy({
    facilityId: execCase.facilityId ?? null,
    testType: input.serviceType,
  });

  const docs = await db
    .select()
    .from(caseDocumentReadiness)
    .where(and(
      eq(caseDocumentReadiness.executionCaseId, input.executionCaseId),
      eq(caseDocumentReadiness.serviceType, input.serviceType),
    ));
  const billingChecks = await db
    .select()
    .from(billingReadinessChecks)
    .where(and(
      eq(billingReadinessChecks.executionCaseId, input.executionCaseId),
      eq(billingReadinessChecks.serviceType, input.serviceType),
    ));
  const procs = await db
    .select()
    .from(procedureEvents)
    .where(and(
      eq(procedureEvents.executionCaseId, input.executionCaseId),
      eq(procedureEvents.serviceType, input.serviceType),
    ));
  const nextEvents = await db
    .select()
    .from(globalScheduleEvents)
    .where(and(
      eq(globalScheduleEvents.executionCaseId, input.executionCaseId),
      eq(globalScheduleEvents.eventType, "ancillary_appointment"),
    ))
    .limit(5);

  // Already invoiced? — a prior snapshot for this case+service is
  // already linked to an invoice. We don't scan invoice_line_items
  // here because the legacy `service` column is plain text and the
  // safe canonical signal is the previous snapshot's invoiceId.
  // (Batch builder will block re-inclusion at draft time as well.)
  const [priorSnapshot] = await db
    .select()
    .from(invoiceReadinessSnapshots)
    .where(and(
      eq(invoiceReadinessSnapshots.executionCaseId, input.executionCaseId),
      eq(invoiceReadinessSnapshots.serviceType, input.serviceType),
    ))
    .limit(1);
  const existingLines: Array<{ id: number }> = priorSnapshot?.invoiceId != null ? [{ id: priorSnapshot.invoiceId }] : [];

  const blockers = new Set<InvoiceReadinessBlocker>();

  // policy presence checks
  if (!policy.scope.facilityId && execCase.facilityId) {
    // policy resolved from globals only — that's fine.
  }
  if (policy.pricing.perTestPrice == null && policy.pricing.bundledPrice == null) {
    blockers.add("missing_price");
  }
  if (!policy.recipients.primaryEmail && !policy.recipients.fallbackToFacilityContact) {
    blockers.add("missing_recipient");
  }

  // readiness rules
  if (policy.readiness.holdMissingReport && !docPresent(docs, "report")) {
    blockers.add("missing_report");
  }
  if (policy.readiness.holdMissingConsent && !docPresent(docs, "informed_consent")) {
    blockers.add("missing_consent");
  }
  if (policy.readiness.holdMissingScreening && !docPresent(docs, "screening_form")) {
    blockers.add("missing_screening");
  }
  if (policy.readiness.holdMissingOrderNote && !docPresent(docs, "order_note")) {
    blockers.add("missing_order_note");
  }
  if (policy.readiness.holdMissingProcedureNote && !docPresent(docs, "post_procedure_note")) {
    blockers.add("missing_procedure_note");
  }
  if (policy.readiness.holdPendingPhysicianSignature && !docPresent(docs, "physician_signed_order")) {
    blockers.add("physician_signature_pending");
  }

  // billing readiness checks (Phase 1 source)
  const allBillingChecksReady = billingChecks.length > 0 &&
    billingChecks.every((c) => (c.readinessStatus ?? "").toLowerCase() === "ready");
  if (policy.readiness.holdPendingBillingReadiness && !allBillingChecksReady) {
    blockers.add("billing_readiness_pending");
  }

  // procedure complete
  const procedureComplete = procs.some((p) => (p.procedureStatus ?? "").toLowerCase() === "completed");
  if (!procedureComplete) blockers.add("procedure_not_complete");

  // cancelled / no-show
  const hasCancelled = nextEvents.some((e) => e.status === "cancelled");
  const hasNoShow = nextEvents.some((e) => e.status === "no_show");
  if (policy.readiness.excludeCancelled && hasCancelled) blockers.add("cancelled");
  if (policy.readiness.excludeNoShows && hasNoShow && !policy.readiness.billableNoShow) {
    blockers.add("no_show_not_billable");
  }

  // already invoiced
  if (existingLines.length > 0) blockers.add("already_invoiced");

  // status
  let status: InvoiceReadinessStatus;
  if ((policy.readiness.excludeCancelled && hasCancelled) || blockers.has("no_show_not_billable")) {
    status = "excluded";
  } else if (blockers.size === 0) {
    status = "ready_to_invoice";
  } else {
    status = "blocked";
  }

  const unitPrice = policy.pricing.bundledPrice ?? policy.pricing.perTestPrice ?? null;

  return {
    executionCaseId: execCase.id,
    patientScreeningId: execCase.patientScreeningId ?? null,
    procedureEventId: procs[0]?.id ?? null,
    facilityId: execCase.facilityId ?? null,
    serviceType: input.serviceType,
    patientName: execCase.patientName,
    patientDob: execCase.patientDob ?? null,
    readinessStatus: status,
    blockers: Array.from(blockers),
    unitPrice,
    priceSnapshot: {
      perTestPrice: policy.pricing.perTestPrice,
      bundledPrice: policy.pricing.bundledPrice,
      minimumMonthlyFee: policy.pricing.minimumMonthlyFee,
      revenueSplit: policy.pricing.revenueSplit,
    },
    policySnapshot: {
      readiness: policy.readiness,
      approval: policy.approval,
      deliveryMethod: policy.recipients.deliveryMethod,
      paymentTerms: policy.paymentTerms,
      sources: policy.sources,
    },
  };
}

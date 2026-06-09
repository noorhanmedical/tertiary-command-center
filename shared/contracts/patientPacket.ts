// Patient packet — canonical response contract (Batch 2).
//
// Single source of truth for the patient-packet response shape. Both
// the server route (`GET /api/patient-packet` and its two aliases) and
// every client consumer import this type. The runtime shape is
// preserved byte-for-byte; this is a type-only extraction.
//
// SOURCE (canonical aggregation logic): server/repositories/patientPacket.repo.ts
//
// SOURCE (route): server/routes/patientPacket.ts (3 aliased routes —
//   GET /api/patient-packet, /api/scheduler-portal/patient-packet,
//   /api/technician-liaison/patient-packet)
//
// SOURCE (client): client/src/lib/workflow/patientPacketApi.ts
//   (fetchPatientPacket + patientPacketQueryKey)
//
// Invariants (cross-reference docs/architecture/portals-route-parity-inventory.md §3):
//   - The lookup precedence is fixed: executionCaseId → patientScreeningId
//     → (patientName + patientDob optional).
//   - All array fields are non-null (empty array when no rows).
//   - lookupWarning is "name_only_fallback" only when the name-only
//     fallback path resolved a patient via findLatestCanonicalScreeningByName.
//   - Six UI consumers depend on this shape being byte-stable; any
//     additive field is safe, any removed or renamed field is a
//     breaking change to the PDF + Team Portal pipelines.

import type { PatientScreening } from "../schema/screening";
import type {
  PatientExecutionCase,
  PatientJourneyEvent,
} from "../schema/executionCase";
import type { GlobalScheduleEvent } from "../schema/globalSchedule";
import type { SchedulingTriageCase } from "../schema/schedulingTriage";
import type { InsuranceEligibilityReview } from "../schema/insuranceEligibility";
import type { CooldownRecord } from "../schema/cooldown";
import type { CaseDocumentReadiness } from "../schema/documentReadiness";
import type { ProcedureEvent } from "../schema/procedureEvents";
import type { ProcedureNote } from "../schema/generatedNotes";
import type { BillingReadinessCheck } from "../schema/billingReadiness";
import type { BillingDocumentRequest } from "../schema/billingDocuments";
import type { CompletedBillingPackage } from "../schema/completedBillingPackages";
import type { ProjectedInvoiceRow } from "../schema/projectedInvoices";

export type PatientPacketLookup = {
  executionCaseId?: number;
  patientScreeningId?: number;
  patientName?: string;
  patientDob?: string;
};

/** Warning values surfaced when the resolution chain didn't produce a
 *  strict identifier match. Currently only "name_only_fallback" is
 *  emitted (when findLatestCanonicalScreeningByName was the resolver). */
export type PatientPacketLookupWarning = "name_only_fallback";

export type PatientPacket = {
  resolvedPatientScreeningId: number | null;
  resolvedExecutionCaseId: number | null;
  lookupWarning: PatientPacketLookupWarning | null;
  patientScreening: PatientScreening | null;
  executionCase: PatientExecutionCase | undefined | null;
  journeyEvents: PatientJourneyEvent[];
  globalScheduleEvents: GlobalScheduleEvent[];
  schedulingTriageCases: SchedulingTriageCase[];
  insuranceEligibilityReviews: InsuranceEligibilityReview[];
  cooldownRecords: CooldownRecord[];
  caseDocumentReadiness: CaseDocumentReadiness[];
  procedureEvents: ProcedureEvent[];
  procedureNotes: ProcedureNote[];
  billingReadinessChecks: BillingReadinessCheck[];
  billingDocumentRequests: BillingDocumentRequest[];
  completedBillingPackages: CompletedBillingPackage[];
  projectedInvoiceRows: ProjectedInvoiceRow[];
};

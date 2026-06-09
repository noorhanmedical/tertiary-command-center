// Journey-events spine — read-only contracts (Batch 12 read-only foundation).
//
// `patient_journey_events` is the canonical audit-event timeline per
// patient. Today it is written by many call sites with varying coverage
// (see backend-route-parity-inventory.md §12 and the original review §3.9).
// This module exposes typed READ helpers + the canonical event-kind
// catalogue + a centralized-writer design doc; it does NOT introduce
// a writer. Batch 12b implements the writer.
//
// See:
//   docs/architecture/journey-event-standardization-design.md
//   shared/contracts/journeyEvents.ts (Batch 2)
//   shared/schema/executionCase.ts:70-95

/**
 * Canonical event-kind catalogue. Mirrors the values observed in the
 * codebase TODAY (see shared/contracts/journeyEvents.ts). Future writers
 * MUST emit one of these kinds; new kinds need a separate batch + an
 * update here.
 */
export const JOURNEY_EVENT_KINDS = [
  "screening_committed",
  "execution_case_created",
  "execution_case_updated",
  "engagement_assigned",
  "engagement_assignment_changed",
  "engagement_assignment_cancelled",
  "scheduler_assigned",
  "call_result_logged",
  "scheduled_ancillary",
  "task_created",
  "document_sent",
  "document_completed",
  "billing_payment_updated",
  "added_to_invoice",
  "admin_approval_updated",
] as const;

export type JourneyEventKind = (typeof JOURNEY_EVENT_KINDS)[number];

/**
 * Typed read-side view of a journey event row.
 */
export type JourneyEventSnapshot = {
  id: number;
  patientName: string;
  patientDob: string | null;
  patientScreeningId: number | null;
  executionCaseId: number | null;
  eventType: string; // free-form text at DB layer; matches a JourneyEventKind in practice
  eventSource: string;
  actorUserId: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

export type ListJourneyEventsFilters = {
  patientScreeningId?: number;
  executionCaseId?: number;
  eventType?: string;
  eventSource?: string;
  // Inclusive ISO date strings (YYYY-MM-DD); converted to timestamp range.
  dateFrom?: string;
  dateTo?: string;
};

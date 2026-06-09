// Patient journey event contract.
//
// SOURCE (canonical): shared/schema/executionCase.ts:70-95
//   - patientJourneyEvents table (lines 70-87)
//   - PatientJourneyEvent row type (line 94)
//   - InsertPatientJourneyEvent input type (line 95)
//
// SOURCE (event-type literals observed at writer call sites):
//   - server/services/patientCommitService.ts:130           "screening_committed"
//   - server/services/patientCommitService.ts:160           "execution_case_created" | "execution_case_updated"
//   - server/services/patientCommitService.ts:330           "execution_case_created" | "execution_case_updated"
//   - server/repositories/executionCase.repo.ts:527         "engagement_assigned"
//   - server/services/schedulerAutoAssign.ts:166            "scheduler_assigned"
//   - server/routes/executionCases.ts:281                   "call_result_logged"
//   - server/routes/globalSchedule.ts:259                   "scheduled_ancillary"
//   - server/routes/plexusTasks.ts:519                      "task_created"
//   - server/routes/documentLibrary.ts:647                  "document_sent"
//   - server/routes/documentReadiness.ts:254                "document_completed"
//   - server/routes/completedBillingPackages.ts:338         "billing_payment_updated"
//   - server/routes/completedBillingPackages.ts:365         "added_to_invoice"
//
// Invariants (cross-reference docs/architecture/protected-flows.md):
//   - Events are append-only. No code path mutates an existing row.
//   - Some legitimate writes today are fire-and-forget; coverage is uneven
//     (see review §3.9 / §4.6). Batch 12 standardizes the writer; events here
//     are the union of what already exists.
//   - This union is conservative: a writer using a kind NOT in this list is
//     legal at runtime (the column is plain `text`), but adding a new kind
//     should also add it here.

export const PATIENT_JOURNEY_EVENT_TYPES = [
  "screening_committed",
  "execution_case_created",
  "execution_case_updated",
  "engagement_assigned",
  "scheduler_assigned",
  "call_result_logged",
  "scheduled_ancillary",
  "task_created",
  "document_sent",
  "document_completed",
  "billing_payment_updated",
  "added_to_invoice",
] as const;

export type PatientJourneyEventType = (typeof PATIENT_JOURNEY_EVENT_TYPES)[number];

// Structural mirror of the patient_journey_events table row.
// SOURCE: shared/schema/executionCase.ts:70-87
export type PatientJourneyEventRow = {
  id: number;
  patientName: string;
  patientDob: string | null;
  patientScreeningId: number | null;
  executionCaseId: number | null;
  eventType: string;
  eventSource: string;
  actorUserId: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

// Insert shape (omits id + createdAt).
// SOURCE: shared/schema/executionCase.ts:89-92
export type PatientJourneyEventInsert = {
  patientName: string;
  patientDob?: string | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  eventType: string;
  eventSource: string;
  actorUserId?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
};

// Patient Directory audit event types (Batch B10).
//
// Client-side mirror of the PatientDirectoryEvent shape exported by
// server/services/patientDirectory/patientDirectoryService.ts.
// Kept in client/src/lib so client components don't need to reach
// across the server boundary.

export type PatientDirectoryAuditEventKind =
  | "patient_created"
  | "imported"
  | "qualification_generated"
  | "admin_review_approved"
  | "admin_review_rejected"
  | "admin_review_needs_info"
  | "sent_to_engagement"
  | "added_to_call_list"
  | "call_completed"
  | "call_callback_scheduled"
  | "dnc_set"
  | "dnc_cleared"
  | "cooldown_set"
  | "cooldown_cleared"
  | "prior_test_logged"
  | "packet_generated"
  | "document_uploaded"
  | "soft_deleted"
  | "restored"
  | "other";

export type PatientDirectoryEvent = {
  kind: PatientDirectoryAuditEventKind | string;
  occurredAt: string;
  actorUserId?: string | null;
  payload?: Record<string, unknown>;
};

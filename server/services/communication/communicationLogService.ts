// communicationLogService — Phase 2 PR 2.8.
//
// Centralized writer that appends a `patient_journey_events` row for
// every outbound patient communication (email, marketing material,
// SMS scaffold). Returns the appended row for the caller to embed in
// its response.
//
// The journey event types used are existing canonical types:
//   - "document_sent"   for emails + marketing materials + SMS scaffold.
//   - "call_result_logged" for call results (already wired by PR C / 2.2).
//
// PHI hygiene: the body of an email is NOT included in the journey
// metadata; only the subject + recipient + (for marketing) materialId.
// The journey event is meant as an audit timeline, not a content store.

import { appendJourneyEvent } from "../journey/appendJourneyEvent";

// "sms" is a GENUINE provider-accepted send (Twilio adapter, Task #648).
// "sms_scaffold" remains the dormant/no-provider path and is still labeled
// "not sent" by the CommunicationTimeline.
export type LogCommunicationKind = "email" | "marketing_material" | "sms_scaffold" | "sms";

export type LogCommunicationInput = {
  patientScreeningId: number;
  patientName: string;
  patientDob?: string | null;
  executionCaseId?: number | null;
  kind: LogCommunicationKind;
  actorUserId: string | null;
  subject?: string | null;
  recipient?: string | null;
  /** For marketing materials. */
  materialId?: string | null;
  materialTitle?: string | null;
  /** Provider-side identifier when available. */
  messageId?: string | null;
  /** When the provider returns a message timestamp. */
  sentAt?: string | null;
  /** Free-form metadata; callers can pass extra audit fields. */
  metadata?: Record<string, unknown>;
};

export async function logPatientCommunicationEvent(
  input: LogCommunicationInput,
): Promise<void> {
  const eventType = "document_sent";
  const kindLabel: Record<LogCommunicationKind, string> = {
    email: "Email",
    marketing_material: "Marketing material",
    sms_scaffold: "SMS (scaffold)",
    sms: "SMS",
  };
  const summary = `${kindLabel[input.kind]} sent${input.subject ? ` — ${input.subject}` : ""}`;
  await appendJourneyEvent({
    patientName: input.patientName,
    patientDob: input.patientDob ?? undefined,
    patientScreeningId: input.patientScreeningId,
    executionCaseId: input.executionCaseId ?? undefined,
    eventType,
    eventSource: "scheduler_portal",
    actorUserId: input.actorUserId,
    summary,
    metadata: {
      communication_kind: input.kind,
      recipient: input.recipient ?? null,
      subject: input.subject ?? null,
      material_id: input.materialId ?? null,
      material_title: input.materialTitle ?? null,
      message_id: input.messageId ?? null,
      sent_at: input.sentAt ?? new Date().toISOString(),
      ...(input.metadata ?? {}),
    },
  });
}

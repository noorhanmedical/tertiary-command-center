// acsWorkflowApi — Phase 2 PR 2.5
//
// Thin client over /api/acs-workflow/:executionCaseId.

export type AcsWorkflowStatus =
  | "assigned"
  | "scheduled"
  | "confirmed"
  | "consent_needed"
  | "consent_signed"
  | "screening_needed"
  | "screening_completed"
  | "report_needed"
  | "report_uploaded"
  | "order_note_needed"
  | "order_note_present"
  | "procedure_note_needed"
  | "procedure_note_present"
  | "physician_signature_pending"
  | "billing_readiness_pending"
  | "billing_ready"
  | "completed";

export type AcsWorkflowSnapshot = {
  executionCaseId: number;
  patientName: string | null;
  facilityId: string | null;
  engagementStatus: string | null;
  statuses: AcsWorkflowStatus[];
  documentReadiness: Array<{
    documentType: string;
    documentStatus: string;
    completedAt: string | null;
    blocksBilling: boolean;
  }>;
  billingChecks: Array<{
    serviceType: string;
    readinessStatus: string;
    missingRequirements: unknown;
  }>;
  nextScheduleEvent: {
    id: number;
    status: string;
    startsAt: string;
    serviceType: string | null;
  } | null;
};

export async function fetchAcsWorkflowSnapshot(executionCaseId: number): Promise<AcsWorkflowSnapshot | null> {
  const res = await fetch(`/api/acs-workflow/${executionCaseId}`, { credentials: "include" });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as AcsWorkflowSnapshot;
}

export const ACS_STATUS_LABELS: Record<AcsWorkflowStatus, string> = {
  assigned: "Assigned",
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  consent_needed: "Consent needed",
  consent_signed: "Consent signed",
  screening_needed: "Screening needed",
  screening_completed: "Screening complete",
  report_needed: "Report needed",
  report_uploaded: "Report uploaded",
  order_note_needed: "Order note needed",
  order_note_present: "Order note present",
  procedure_note_needed: "Procedure note needed",
  procedure_note_present: "Procedure note present",
  physician_signature_pending: "Physician signature pending",
  billing_readiness_pending: "Billing readiness pending",
  billing_ready: "Billing ready",
  completed: "Completed",
};

export function statusTone(s: AcsWorkflowStatus): "good" | "pending" | "warn" {
  if (
    s === "consent_signed" ||
    s === "screening_completed" ||
    s === "report_uploaded" ||
    s === "order_note_present" ||
    s === "procedure_note_present" ||
    s === "billing_ready" ||
    s === "completed" ||
    s === "confirmed" ||
    s === "scheduled" ||
    s === "assigned"
  )
    return "good";
  if (s === "physician_signature_pending" || s === "billing_readiness_pending") return "warn";
  return "pending";
}

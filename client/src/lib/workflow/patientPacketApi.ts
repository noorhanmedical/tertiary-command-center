import { requestJson } from "@/lib/workflow/safeFetch";

export type PatientPacketLookup = {
  executionCaseId?: number;
  patientScreeningId?: number;
  patientName?: string;
  patientDob?: string;
};

export type PatientPacket = {
  resolvedPatientScreeningId: number | null;
  resolvedExecutionCaseId: number | null;
  patientScreening: Record<string, unknown> | null;
  executionCase: Record<string, unknown> | null;
  journeyEvents: Array<Record<string, unknown>>;
  globalScheduleEvents: Array<Record<string, unknown>>;
  schedulingTriageCases: Array<Record<string, unknown>>;
  insuranceEligibilityReviews: Array<Record<string, unknown>>;
  cooldownRecords: Array<Record<string, unknown>>;
  caseDocumentReadiness: Array<Record<string, unknown>>;
  procedureEvents: Array<Record<string, unknown>>;
  procedureNotes: Array<Record<string, unknown>>;
  billingReadinessChecks: Array<Record<string, unknown>>;
  billingDocumentRequests: Array<Record<string, unknown>>;
  completedBillingPackages: Array<Record<string, unknown>>;
  projectedInvoiceRows: Array<Record<string, unknown>>;
};

function buildQueryString(lookup: PatientPacketLookup): string {
  const params = new URLSearchParams();
  if (lookup.executionCaseId != null) params.set("executionCaseId", String(lookup.executionCaseId));
  if (lookup.patientScreeningId != null) params.set("patientScreeningId", String(lookup.patientScreeningId));
  if (lookup.patientName) params.set("patientName", lookup.patientName);
  if (lookup.patientDob) params.set("patientDob", lookup.patientDob);
  return params.toString();
}

export function patientPacketQueryKey(lookup: PatientPacketLookup): string[] {
  const qs = buildQueryString(lookup);
  return ["/api/patient-packet", qs];
}

export async function fetchPatientPacket(lookup: PatientPacketLookup): Promise<PatientPacket> {
  const hasLookup = lookup.executionCaseId != null
    || lookup.patientScreeningId != null
    || !!lookup.patientName;
  if (!hasLookup) {
    throw new Error("fetchPatientPacket requires executionCaseId, patientScreeningId, or patientName (DOB optional)");
  }

  const qs = buildQueryString(lookup);
  return requestJson<PatientPacket>("GET", `/api/patient-packet${qs ? `?${qs}` : ""}`);
}

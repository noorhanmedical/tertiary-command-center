import { requestJson } from "@/lib/workflow/safeFetch";

// Patient-packet response shape lives in the shared contract so the
// server route, this client API helper, and every UI consumer share
// one canonical type. See shared/contracts/patientPacket.ts.
import type {
  PatientPacket,
  PatientPacketLookup,
} from "@shared/contracts/patientPacket";

export type { PatientPacket, PatientPacketLookup };

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

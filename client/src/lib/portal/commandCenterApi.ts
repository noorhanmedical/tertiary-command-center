// Thin fetch helpers for the Patient Command Center read model and the
// two left-rail tools (My Patients + Patient Search). All three routes
// are read-only over canonical tables.

export type CommandCenterPatient = {
  patientScreeningId: number;
  batchId: number | null;
  name: string;
  dob: string | null;
  age: number | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  insurance: string | null;
  facility: string | null;
  patientType: string | null;
  appointmentStatus: string | null;
  commitStatus: string | null;
  engagementStatus: string | null;
  engagementBucket: string | null;
  qualificationStatus: string | null;
  lifecycleStatus: string | null;
  assignedTeamMemberId: number | null;
  assignedRole: string | null;
  executionCaseId: number | null;
  nextActionAt: string | null;
};

export type CommandCenterClinicalProfile = {
  diagnoses: string | null;
  history: string | null;
  medications: string | null;
  notes: string | null;
  previousTests: string | null;
  previousTestsDate: string | null;
  noPreviousTests: boolean | null;
  qualifyingTests: string[];
  cooldownTests: unknown;
  reasoning: unknown;
};

export type PatientCommunicationType =
  | "call"
  | "sms"
  | "email"
  | "marketing_email"
  | "marketing_sms"
  | "internal_note"
  | "system_note";

export type CommandCenterCommunication = {
  id: number;
  patientScreeningId: number | null;
  executionCaseId: number | null;
  communicationType: PatientCommunicationType;
  direction: "outbound" | "inbound" | "internal";
  status: string;
  outcome: string | null;
  subject: string | null;
  summary: string;
  bodyPreview: string | null;
  bodyFull: string | null;
  toAddress: string | null;
  phoneNumber: string | null;
  actorUserId: string | null;
  actorNameSnapshot: string | null;
  facility: string | null;
  relatedDocumentIds: unknown;
  metadata: Record<string, unknown> | null;
  occurredAt: string | null;
  createdAt: string | null;
};

export type CommandCenterResponse = {
  patient: CommandCenterPatient;
  clinicalProfile: CommandCenterClinicalProfile;
  latestActivity: {
    communication: CommandCenterCommunication | null;
    call: any | null;
    text: CommandCenterCommunication | null;
    email: CommandCenterCommunication | null;
    marketing: CommandCenterCommunication | null;
    note: CommandCenterCommunication | null;
    appointment: any | null;
    ancillary: any | null;
    journeyEvent: any | null;
  };
  histories: {
    communications: CommandCenterCommunication[];
    calls: any[];
    texts: CommandCenterCommunication[];
    emails: CommandCenterCommunication[];
    marketing: CommandCenterCommunication[];
    notes: Array<{
      id: number;
      source: string;
      createdAt: string | null;
      text: string | null;
      serviceType: string | null;
      actorUserId?: string | null;
      actorNameSnapshot?: string | null;
    }>;
    appointments: any[];
    ancillaries: any[];
    journeyEvents: any[];
    testHistory: any[];
    eligibility: any[];
  };
  tasks: any[];
  documents: any[];
  documentReadiness?: CommandCenterDocumentReadinessRow[];
  billingReadinessChecks?: CommandCenterBillingReadinessCheck[];
};

export type CommandCenterDocumentReadinessRow = {
  id: number;
  executionCaseId: number | null;
  patientScreeningId: number | null;
  serviceType: string;
  documentType: string;
  documentStatus: string | null;
  documentId: number | null;
  storageKey: string | null;
  generatedByAi: boolean | null;
  uploadedByUserId: string | null;
  completedAt: string | null;
  blocksBilling?: boolean | null;
  patientName?: string | null;
  patientDob?: string | null;
  facilityId?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type CommandCenterBillingReadinessCheck = {
  id: number;
  executionCaseId: number | null;
  patientScreeningId: number | null;
  procedureEventId: number | null;
  serviceType: string | null;
  readinessStatus: string;
  missingDocuments?: unknown;
  metadata?: Record<string, unknown> | null;
  evaluatedAt: string | null;
};

export type LogCommunicationInput = {
  patientScreeningId: number;
  communicationType: PatientCommunicationType;
  direction?: "outbound" | "inbound" | "internal";
  status?: "logged" | "sent" | "queued" | "failed" | "completed";
  outcome?: string;
  subject?: string;
  summary: string;
  bodyPreview?: string;
  bodyFull?: string;
  toAddress?: string;
  phoneNumber?: string;
  relatedDocumentIds?: Array<string | number>;
  metadata?: Record<string, unknown>;
};

export type MyPatientsRow = {
  patientScreeningId: number;
  name: string;
  dob: string | null;
  facility: string | null;
  appointmentStatus: string | null;
  commitStatus: string | null;
  lastActivityAt: string | null;
  lastActivityType: string | null;
  lastActivitySummary: string | null;
};

export type PatientSearchRow = {
  patientScreeningId: number;
  name: string;
  dob: string | null;
  facility: string | null;
  insurance: string | null;
  phone: string | null;
  appointmentStatus: string | null;
  commitStatus: string | null;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error ?? "";
    } catch {
      /* noop */
    }
    throw new Error(`Request failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json()) as T;
}

export async function fetchPatientCommandCenter(
  patientScreeningId: number,
): Promise<CommandCenterResponse> {
  return getJson<CommandCenterResponse>(
    `/api/portal/patient-command-center/${patientScreeningId}`,
  );
}

export async function fetchMyPatients(params: {
  query?: string;
  facility?: string;
  limit?: number;
} = {}): Promise<MyPatientsRow[]> {
  const qs = new URLSearchParams();
  if (params.query?.trim()) qs.set("query", params.query.trim());
  if (params.facility?.trim()) qs.set("facility", params.facility.trim());
  if (params.limit) qs.set("limit", String(params.limit));
  const url = `/api/portal/my-patients${qs.toString() ? `?${qs}` : ""}`;
  return getJson<MyPatientsRow[]>(url);
}

export async function searchPatients(params: {
  query: string;
  facility?: string;
  limit?: number;
}): Promise<PatientSearchRow[]> {
  const qs = new URLSearchParams();
  qs.set("query", params.query);
  if (params.facility?.trim()) qs.set("facility", params.facility.trim());
  if (params.limit) qs.set("limit", String(params.limit));
  return getJson<PatientSearchRow[]>(`/api/portal/patient-search?${qs}`);
}

export async function fetchMarketingMaterials(): Promise<
  Array<{ id: string | number; title: string; description: string | null; filename: string }>
> {
  return getJson(`/api/outreach/materials`);
}

export async function logPatientCommunication(
  input: LogCommunicationInput,
): Promise<{ ok: boolean; communication: CommandCenterCommunication }> {
  const res = await fetch(`/api/portal/patient-communications`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error ?? "";
    } catch {
      /* noop */
    }
    throw new Error(`Log failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json()) as { ok: boolean; communication: CommandCenterCommunication };
}

export async function sendMarketingMaterial(input: {
  patientScreeningId: number;
  materialId: string | number;
  to?: string;
}): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/outreach/send-material`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error ?? "";
    } catch {
      /* noop */
    }
    throw new Error(`Send failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json()) as { ok: boolean };
}

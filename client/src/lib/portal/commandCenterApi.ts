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

export type CommandCenterResponse = {
  patient: CommandCenterPatient;
  clinicalProfile: CommandCenterClinicalProfile;
  latestActivity: {
    call: any | null;
    text: null;
    email: null;
    note: null;
    appointment: any | null;
    ancillary: any | null;
    journeyEvent: any | null;
  };
  histories: {
    calls: any[];
    texts: any[];
    emails: any[];
    notes: Array<{ id: number; source: string; createdAt: string | null; text: string | null; serviceType: string | null }>;
    appointments: any[];
    ancillaries: any[];
    journeyEvents: any[];
    testHistory: any[];
    eligibility: any[];
  };
  tasks: any[];
  documents: any[];
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

export async function sendMarketingMaterial(input: {
  patientScreeningId: number;
  materialId: string | number;
  to?: string;
}): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/email/send-material`, {
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

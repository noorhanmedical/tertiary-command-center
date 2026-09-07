// Read-only fetch helpers for the Team Member Workspace right-panel modes.
//
// Each helper is a thin wrapper around an existing canonical endpoint —
// this batch does not add any new backend routes. All three helpers
// surface canonical rows directly so PortalShell can render them in the
// right panel.
//
// Mode → endpoint:
//   Clinic Schedule    → /api/technician-liaison/clinic-visits
//                        (global_schedule_events doctor_visit + same_day_add)
//   Ancillary Schedule → /api/technician-liaison/ancillary-schedule
//                        (global_schedule_events ancillary_appointment)
//   Call List          → /api/scheduler-portal/cases
//                        (patient_execution_cases.nextActionAt /
//                         patient_journey_events). Both PCS and ACS read
//                        this — call list is a shared capability.

export type TeamWorkspaceClinicVisit = {
  id: string | number;
  patientName?: string | null;
  patientDob?: string | null;
  facilityId?: string | null;
  startsAt?: string | null;
  serviceType?: string | null;
  status?: string | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
};

export type AncillaryReadinessItemState = "complete" | "missing" | "not_required";

export type AncillaryReadinessProvenance = {
  completedAt: string | null;
  completedByUserId: string | null;
};

export type AncillaryReadinessSummary = {
  informedConsent: AncillaryReadinessItemState;
  screeningForm: AncillaryReadinessItemState;
  brainwavePdf: AncillaryReadinessItemState;
  report: AncillaryReadinessItemState;
  informedConsentDocId: number | null;
  screeningFormDocId: number | null;
  // Provenance (who/when) for completed items; null when missing/not_required.
  informedConsentProvenance?: AncillaryReadinessProvenance | null;
  screeningFormProvenance?: AncillaryReadinessProvenance | null;
  reportProvenance?: AncillaryReadinessProvenance | null;
  // True when the row has no execution-case link → readiness is not
  // episode-accurate (honest legacy signal for the UI).
  legacyUnlinked?: boolean;
};

export type TeamWorkspaceAncillaryAppointment = {
  id: string | number;
  patientName?: string | null;
  patientDob?: string | null;
  facilityId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  serviceType?: string | null;
  status?: string | null;
  assignedUserId?: string | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  /** Durable per-service ancillary occurrence id (patient_ancillary_cases.id).
   *  Present once the canonical ancillary-case flag/migration is live; null in
   *  the pre-canonical world. Used as the preferred identity for per-occurrence
   *  readiness ownership and threaded into the doc workflows. */
  ancillaryCaseId?: number | null;
  readiness?: AncillaryReadinessSummary | null;
};

export type TeamWorkspaceCallListItem = {
  id: string | number;
  patientName?: string | null;
  patientDob?: string | null;
  facilityId?: string | null;
  nextActionAt?: string | null;
  assignedTeamMemberId?: number | string | null;
  assignedRole?: string | null;
  engagementStatus?: string | null;
  lifecycleStatus?: string | null;
  qualificationStatus?: string | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  /** Phase 2E-B3 — EXACT ancillary-case id when the row represents a single
   *  ancillary case (one service). Absent for multi-service rows; consumers
   *  must NOT guess a case from the screening. */
  ancillaryCaseId?: number | null;
  /** Target ancillary/workflow services on the execution case (drives the
   *  human-readable call reason). */
  selectedServices?: string[] | null;
  /** Most recent call outcome — used to refine the call reason (e.g. a
   *  missed-call follow-up vs. a fresh outreach). */
  lastCallOutcome?: string | null;
  /** Engagement bucket: 'visit' | 'outreach' | 'scheduling_triage'. */
  engagementBucket?: string | null;
  /** CANONICAL attempt count for THIS execution case / outreach objective
   *  (patient_execution_cases.call_attempt_count). This is the ONLY correct
   *  source for an "Attempt N" label — never all-time patient calls.length,
   *  which spans every service/objective. Already emitted by
   *  /api/scheduler-portal/cases (full execution-case row). */
  callAttemptCount?: number | null;
  /** Timestamp of the most recent call attempt for THIS execution case
   *  (patient_execution_cases.last_attempt_at). Emitted by the same full-row
   *  /api/scheduler-portal/cases response; drives the header "last contact". */
  lastAttemptAt?: string | null;
  /** Phase 5B — active-work claim columns (patient_execution_cases). The portal
   *  read already SUPPRESSES cases claimed by a NON-owner, so on the caller's
   *  own queue an active claim here means the CALLER is actively working the
   *  case (activeClaimBy === assignedTeamMemberId). Drives a subtle "working
   *  now" indicator; never a claim dashboard. */
  activeClaimBy?: number | null;
  activeClaimExpiresAt?: string | null;
  // ── Historical snapshot fields (present only for past-date views, sourced
  //    from the read-only scheduler_assignments snapshot + that day's calls).
  /** True when this row is a historical snapshot entry, not current work. */
  historical?: boolean;
  /** The snapshot date (YYYY-MM-DD) this row belonged to. */
  asOfDate?: string | null;
  /** Snapshot assignment status that day (active/released/reassigned/completed). */
  assignmentStatus?: string | null;
  /** Number of calls the PCS logged for this patient that day. */
  historicalCallCount?: number | null;
  /** Callback requested on that day's last call, if any. */
  historicalCallbackAt?: string | null;
  /** Timestamp of the last call activity that day. */
  historicalLastActivityAt?: string | null;
  /** True when at least one call was logged that day. */
  completed?: boolean;
};

// Human-readable "why am I calling?" — ALWAYS combines the SERVICE with the
// current operational reason so the employee never loses service context
// (Phase 5A, Part 2). Derived entirely from existing execution-case fields (no
// new backend data). Shape: "Service · Reason" (e.g. "VitalWave · Callback
// requested"), or just the reason when no service is attached to the case.
// Examples: "VitalWave · New qualified patient", "BrainWave · Missed-call
// follow-up", "Ultrasound · Patient requested callback".
export function niceServiceLabel(s: string): string {
  const v = s.toLowerCase();
  if (v.includes("brainwave") || v.includes("brain")) return "BrainWave";
  if (v.includes("vitalwave") || v.includes("vital")) return "VitalWave";
  if (
    v.includes("ultrasound") ||
    v.includes("duplex") ||
    v.includes("doppler") ||
    v.includes("echo") ||
    v.includes("carotid")
  )
    return "Ultrasound";
  return s;
}

/** The current operational reason WITHOUT the service prefix. */
function deriveReasonPhrase(item: TeamWorkspaceCallListItem): string {
  const outcome = (item.lastCallOutcome ?? "").toLowerCase();
  // Outcome-driven reasons take priority — they describe the next action.
  if (outcome) {
    if (outcome.includes("no_answer") || outcome.includes("missed")) return "Missed-call follow-up";
    if (outcome.includes("voicemail")) return "Voicemail follow-up";
    if (outcome.includes("callback") || outcome.includes("call_later")) return "Patient requested callback";
    if (outcome.includes("reschedule")) return "Reschedule follow-up";
    if (outcome.includes("needs_records") || outcome.includes("document")) return "Document follow-up";
    if (outcome.includes("reached")) return "Scheduling follow-up";
  }
  const bucket = (item.engagementBucket ?? "").toLowerCase();
  if (bucket === "scheduling_triage") return "Scheduling follow-up";
  switch ((item.engagementStatus ?? "").toLowerCase()) {
    case "new":
    case "ready":
      return item.qualificationStatus === "qualified" ? "New qualified patient" : "New patient";
    case "contacted":
      return "Follow-up";
    case "scheduled":
      return "Confirm appointment";
    default:
      return "Outreach";
  }
}

export function deriveCallReason(item: TeamWorkspaceCallListItem): string {
  const services = (item.selectedServices ?? []).filter(Boolean);
  const primary = services[0] ?? null;
  const reason = deriveReasonPhrase(item);
  if (!primary) return reason;
  const service = niceServiceLabel(primary);
  // Never let the reason hide the service — service always leads.
  return `${service} · ${reason}`;
}

type ScheduleParams = {
  facilityId?: string | null;
  assignedUserId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  limit?: number;
  /** ADMIN VIEW-AS — only honored when the caller is admin. The
   *  backend ignores it for non-admin callers (defense in depth). */
  viewAsTeamMemberId?: string | null;
};

type AncillaryParams = ScheduleParams & {
  serviceType?: string | null;
};

type CallListParams = {
  facilityId?: string | null;
  assignedTeamMemberId?: number | string | null;
  assignedRole?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  /** Operational day (YYYY-MM-DD). When set, the SERVER scopes the call list
   *  to cases whose nextActionAt falls on that local day, including backlog
   *  (null nextActionAt) only for today/future. Preferred over client-side
   *  startDate/endDate filtering. */
  date?: string | null;
  limit?: number;
  /** ADMIN VIEW-AS — only honored when the caller is admin. */
  viewAsTeamMemberId?: string | null;
  /** Tells the server which workspace ("pcs"|"acs") is requesting the
   *  shared call list. Affects admin view-as role-compat: when
   *  workspace="acs" the viewed-as user must be a technician; when
   *  "pcs" they must be a liaison. When omitted the server allows any
   *  active team member (legacy permissive behavior). */
  workspace?: "pcs" | "acs" | null;
};

function appendIf(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null) return;
  if (typeof value === "string" && value.trim() === "") return;
  params.set(key, String(value));
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}) for ${url}`);
  }
  return (await res.json()) as T;
}

export async function fetchWorkspaceClinicSchedule(
  params: ScheduleParams = {},
): Promise<TeamWorkspaceClinicVisit[]> {
  const qs = new URLSearchParams();
  appendIf(qs, "facilityId", params.facilityId);
  appendIf(qs, "assignedUserId", params.assignedUserId);
  appendIf(qs, "startDate", params.startDate);
  appendIf(qs, "endDate", params.endDate);
  appendIf(qs, "limit", params.limit ?? 100);
  appendIf(qs, "viewAsTeamMemberId", params.viewAsTeamMemberId);
  const url = `/api/technician-liaison/clinic-visits${qs.toString() ? `?${qs}` : ""}`;
  const rows = await fetchJson<unknown[]>(url);
  return Array.isArray(rows) ? (rows as TeamWorkspaceClinicVisit[]) : [];
}

export async function fetchWorkspaceAncillarySchedule(
  params: AncillaryParams = {},
): Promise<TeamWorkspaceAncillaryAppointment[]> {
  const qs = new URLSearchParams();
  appendIf(qs, "facilityId", params.facilityId);
  appendIf(qs, "assignedUserId", params.assignedUserId);
  appendIf(qs, "serviceType", params.serviceType);
  appendIf(qs, "startDate", params.startDate);
  appendIf(qs, "endDate", params.endDate);
  appendIf(qs, "limit", params.limit ?? 100);
  appendIf(qs, "viewAsTeamMemberId", params.viewAsTeamMemberId);
  const url = `/api/technician-liaison/ancillary-schedule${qs.toString() ? `?${qs}` : ""}`;
  const rows = await fetchJson<unknown[]>(url);
  return Array.isArray(rows) ? (rows as TeamWorkspaceAncillaryAppointment[]) : [];
}

// Per-day scheduling context for the patient-specific Schedule Patient
// dialog + the center Playground expanded scheduling view. Reads from the
// existing /api/global-schedule-events feed and buckets events client-side
// so we don't introduce a new backend route in this batch.

export type PatientScheduleDayContext = {
  clinicEvents: unknown[];
  ancillaryEvents: unknown[];
  availabilityBlocks: unknown[];
  patientEvents: unknown[];
  procedureCompleteEvents: unknown[];
  allEvents: unknown[];
};

export async function fetchPatientScheduleDayContext(params: {
  facilityId?: string | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  selectedDate: string;
  limit?: number;
}): Promise<PatientScheduleDayContext> {
  const day = params.selectedDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return {
      clinicEvents: [],
      ancillaryEvents: [],
      availabilityBlocks: [],
      patientEvents: [],
      procedureCompleteEvents: [],
      allEvents: [],
    };
  }
  const startsAt = `${day}T00:00:00.000Z`;
  const endsAt = `${day}T23:59:59.999Z`;
  const qs = new URLSearchParams();
  appendIf(qs, "facilityId", params.facilityId);
  appendIf(qs, "startDate", startsAt);
  appendIf(qs, "endDate", endsAt);
  appendIf(qs, "limit", params.limit ?? 500);
  const url = `/api/global-schedule-events${qs.toString() ? `?${qs}` : ""}`;
  const all = await fetchJson<unknown[]>(url);
  const events = Array.isArray(all) ? all : [];
  const clinicEvents: unknown[] = [];
  const ancillaryEvents: unknown[] = [];
  const availabilityBlocks: unknown[] = [];
  const procedureCompleteEvents: unknown[] = [];
  const patientEvents: unknown[] = [];
  for (const evt of events) {
    const e = evt as {
      eventType?: string;
      patientScreeningId?: number | null;
      executionCaseId?: number | null;
    };
    switch (e.eventType) {
      case "doctor_visit":
      case "same_day_add":
        clinicEvents.push(evt);
        break;
      case "ancillary_appointment":
        ancillaryEvents.push(evt);
        break;
      case "team_member_availability":
      case "unavailable_block":
      case "pto_block":
      case "sick_day":
        availabilityBlocks.push(evt);
        break;
      case "procedure_complete":
        procedureCompleteEvents.push(evt);
        break;
      default:
        break;
    }
    const matchesScreening =
      params.patientScreeningId != null &&
      e.patientScreeningId === params.patientScreeningId;
    const matchesCase =
      params.executionCaseId != null &&
      e.executionCaseId === params.executionCaseId;
    if (matchesScreening || matchesCase) {
      patientEvents.push(evt);
    }
  }
  return {
    clinicEvents,
    ancillaryEvents,
    availabilityBlocks,
    patientEvents,
    procedureCompleteEvents,
    allEvents: events,
  };
}

// Schedule a patient-specific ancillary appointment by writing to the
// canonical /api/global-schedule-events/schedule-ancillary route. No new
// route is added; the existing endpoint owns global_schedule_events writes.
export async function schedulePatientAncillary(input: {
  executionCaseId?: number | null;
  patientScreeningId?: number | null;
  // For brand-new patients with no case yet: the server creates a minimal
  // execution case stub when neither id resolves but a name is provided.
  patientName?: string | null;
  patientDob?: string | null;
  serviceType: string;
  startsAt: string;
  endsAt?: string | null;
  facilityId?: string | null;
  assignedUserId?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<unknown> {
  const res = await fetch("/api/global-schedule-events/schedule-ancillary", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      executionCaseId: input.executionCaseId ?? null,
      patientScreeningId: input.patientScreeningId ?? null,
      patientName: input.patientName ?? null,
      patientDob: input.patientDob ?? null,
      serviceType: input.serviceType,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      facilityId: input.facilityId ?? null,
      assignedUserId: input.assignedUserId ?? null,
      note: input.note ?? null,
      metadata: input.metadata ?? {},
    }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error ?? "";
    } catch {
      /* noop */
    }
    throw new Error(`schedulePatientAncillary failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  return res.json();
}

// Call list day scoping. PREFERRED: pass `date=YYYY-MM-DD` — the SERVER scopes
// by nextActionAt and includes backlog (null nextActionAt) only for
// today/future (see /api/scheduler-portal/cases). LEGACY fallback: when only
// startDate/endDate are given (no `date`), the old client-side nextActionAt
// filter still applies and keeps null-nextActionAt backlog on every day.
export async function fetchWorkspaceCallList(
  params: CallListParams = {},
): Promise<TeamWorkspaceCallListItem[]> {
  const qs = new URLSearchParams();
  appendIf(qs, "facilityId", params.facilityId);
  appendIf(qs, "assignedTeamMemberId", params.assignedTeamMemberId);
  appendIf(qs, "assignedRole", params.assignedRole);
  appendIf(qs, "date", params.date);
  appendIf(qs, "limit", params.limit ?? 100);
  appendIf(qs, "viewAsTeamMemberId", params.viewAsTeamMemberId);
  appendIf(qs, "workspace", params.workspace);
  const url = `/api/scheduler-portal/cases${qs.toString() ? `?${qs}` : ""}`;
  const rows = await fetchJson<unknown[]>(url);
  if (!Array.isArray(rows)) return [];
  let out = rows as TeamWorkspaceCallListItem[];
  // Server-side date scoping is authoritative when `date` is supplied — do NOT
  // re-filter client-side. The legacy startDate/endDate client filter only runs
  // for callers that still pass a window without `date`.
  if (!params.date && (params.startDate || params.endDate)) {
    const startMs = params.startDate ? new Date(params.startDate).getTime() : -Infinity;
    const endMs = params.endDate ? new Date(params.endDate).getTime() : Infinity;
    out = out.filter((row) => {
      if (!row.nextActionAt) return true;
      const t = new Date(row.nextActionAt).getTime();
      return Number.isFinite(t) && t >= startMs && t <= endMs;
    });
  }
  return out;
}

// Call List BADGE count — reuses the SAME server filter as the call list
// (/api/scheduler-portal/cases/count) so the badge and the visible queue can
// never disagree. `facilityId` omitted → All Clinics (authorized set).
export async function fetchWorkspaceCallListCount(
  params: { facilityId?: string | null; date?: string | null; viewAsTeamMemberId?: string | null; workspace?: "pcs" | "acs" | null } = {},
): Promise<number> {
  const qs = new URLSearchParams();
  appendIf(qs, "facilityId", params.facilityId);
  appendIf(qs, "date", params.date);
  appendIf(qs, "viewAsTeamMemberId", params.viewAsTeamMemberId);
  appendIf(qs, "workspace", params.workspace);
  const url = `/api/scheduler-portal/cases/count${qs.toString() ? `?${qs}` : ""}`;
  try {
    const body = await fetchJson<{ count?: number }>(url);
    return typeof body?.count === "number" ? body.count : 0;
  } catch {
    return 0;
  }
}

// Multi-clinic scope for the current team member: authorized clinics +
// per-clinic PCS/ACS capability (from facility-scoped teams).
export type ClinicCapability = { pcs: boolean; acs: boolean };
export type TeamPortalClinicScope = {
  authorizedFacilities: string[];
  perClinicCapability: Record<string, ClinicCapability>;
  hasTeamCapability: boolean;
  globalWorkspaceType: "patientCareSpecialist" | "ancillaryCareSpecialist" | null;
};

export async function fetchTeamPortalClinicScope(): Promise<TeamPortalClinicScope> {
  try {
    const body = await fetchJson<TeamPortalClinicScope>("/api/portal/clinic-scope");
    return {
      authorizedFacilities: Array.isArray(body?.authorizedFacilities) ? body.authorizedFacilities : [],
      perClinicCapability: body?.perClinicCapability ?? {},
      hasTeamCapability: !!body?.hasTeamCapability,
      globalWorkspaceType: body?.globalWorkspaceType ?? null,
    };
  } catch {
    return { authorizedFacilities: [], perClinicCapability: {}, hasTeamCapability: false, globalWorkspaceType: null };
  }
}

// ADMIN VIEW-AS — list of team members the admin observer can select
// for the named workspace. Backend returns 403 for non-admin callers.
export type ViewAsWorkspaceType = "pcs" | "acs";

export type ViewAsTeamMember = {
  id: string;
  username: string;
  role: string;
  active: boolean;
  /** The clinic the roster member belongs to. */
  facility?: string | null;
  /** Optional linked login account (null when the roster member has no
   *  login). Used to target the workspace profile during view-as. */
  userId?: string | null;
  /** Soft per-day assignment target set in the Engagement Center; null
   *  when no target has been set. Surfaced in the view-as picker. */
  dailyTarget?: number | null;
};

export async function fetchTeamMembersForWorkspace(
  workspace: ViewAsWorkspaceType,
): Promise<ViewAsTeamMember[]> {
  const res = await fetch(`/api/portal/team-members?workspace=${workspace}`, {
    credentials: "include",
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { teamMembers?: ViewAsTeamMember[] };
  return Array.isArray(body.teamMembers) ? body.teamMembers : [];
}

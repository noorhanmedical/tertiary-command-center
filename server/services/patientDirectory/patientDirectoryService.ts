// Patient EHR service scaffold (Batch B4).
//
// Pure, dependency-injected projection over the existing schema. A
// future approved batch will wire this scaffold into a route file
// (`server/routes/patientDirectory.ts`) and add the four small
// migrations called out in `patient-directory-runtime-blockers.md`.
//
// Today: no route imports this module; production behavior is
// unchanged. The audit-trail modal, run comparison engine, and
// import-preview helpers can already use the projection shape to
// stay forward-compatible.

import type { PatientIdentityInput } from "../../../shared/patientIdentity";

export type PatientDirectoryProfile = {
  patientScreeningId: number;
  identity: PatientIdentityInput & {
    facility?: string | null;
    name: string;
    dob: string | null;
    phoneNumber: string | null;
    email: string | null;
    insurance: string | null;
  };
  patientType: "visit" | "outreach" | string;
  adminApprovalStatus: string;
  adminApprovedAt: string | null;
  adminApprovedByUserId: string | null;
  createdAt: string;
  source: {
    batchId: number;
    batchName: string | null;
    batchCreatedAt: string;
    sourceFileName: string | null; // null until migration adds the column
  };
};

export type PatientDirectoryEngagementSummary = {
  patientScreeningId: number;
  currentAssignmentId: number | null;
  currentAssignmentStatus: string | null;
  currentAssignedTo: string | null;
  lastEngagementUpdate: string | null;
};

export type PatientDirectoryCallHistoryEntry = {
  id: number;
  patientScreeningId: number;
  startedAt: string;
  outcome: string;
  notes: string | null;
  callbackAt: string | null;
  attemptNumber: number | null;
  durationSeconds: number | null;
  isDncOutcome: boolean;
};

export type PatientDirectoryCooldown = {
  patientScreeningId: number;
  active: boolean;
  intervalLabel: string;
  startsAt: string | null;
  endsAt: string | null;
  reason: string | null;
  setByUserId: string | null;
};

export type PatientDirectoryPriorTest = {
  patientScreeningId: number | null;
  patientName: string;
  testName: string;
  dateOfService: string | null;
  facility: string | null;
  source: string | null;
  notes: string | null;
};

export type PatientDirectoryEvent = {
  kind:
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
  occurredAt: string;
  actorUserId: string | null;
  payload: Record<string, unknown>;
};

export type PatientDirectorySnapshot = {
  profile: PatientDirectoryProfile;
  engagement: PatientDirectoryEngagementSummary;
  callHistory: ReadonlyArray<PatientDirectoryCallHistoryEntry>;
  cooldown: PatientDirectoryCooldown | null;
  priorTests: ReadonlyArray<PatientDirectoryPriorTest>;
  events: ReadonlyArray<PatientDirectoryEvent>;
  flags: {
    doNotContact: boolean;
    doNotContactReason: string | null;
    everSentToEngagement: boolean;
    everAdminApproved: boolean;
  };
};

export type PatientDirectoryDeps = {
  loadProfile(id: number): Promise<PatientDirectoryProfile | null>;
  loadEngagement(id: number): Promise<PatientDirectoryEngagementSummary | null>;
  loadCallHistory(id: number): Promise<ReadonlyArray<PatientDirectoryCallHistoryEntry>>;
  loadCooldown(id: number): Promise<PatientDirectoryCooldown | null>;
  loadPriorTests(id: number): Promise<ReadonlyArray<PatientDirectoryPriorTest>>;
  loadEvents(id: number): Promise<ReadonlyArray<PatientDirectoryEvent>>;
};

const DNC_OUTCOMES = new Set(["refused_dnc", "dnc", "do_not_contact"]);

export function isPatientDirectoryServiceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.USE_PATIENT_DIRECTORY_SERVICE;
  return v === "1" || v === "true" || v === "yes";
}

export async function getPatientDirectorySnapshot(
  id: number,
  deps: PatientDirectoryDeps,
): Promise<PatientDirectorySnapshot | null> {
  const profile = await deps.loadProfile(id);
  if (!profile) return null;
  const [engagement, callHistory, cooldown, priorTests, events] = await Promise.all([
    deps.loadEngagement(id),
    deps.loadCallHistory(id),
    deps.loadCooldown(id),
    deps.loadPriorTests(id),
    deps.loadEvents(id),
  ]);

  // Derive flags from existing signals (until B4 schema migration lands).
  const dncCall = callHistory.find((c) => DNC_OUTCOMES.has(c.outcome));
  const everSentToEngagement = events.some((e) => e.kind === "sent_to_engagement")
    || (engagement?.currentAssignmentId ?? null) != null;
  const everAdminApproved = events.some((e) => e.kind === "admin_review_approved")
    || profile.adminApprovalStatus === "approved";

  return {
    profile,
    engagement: engagement ?? {
      patientScreeningId: id,
      currentAssignmentId: null,
      currentAssignmentStatus: null,
      currentAssignedTo: null,
      lastEngagementUpdate: null,
    },
    callHistory,
    cooldown,
    priorTests,
    events,
    flags: {
      doNotContact: !!dncCall,
      doNotContactReason: dncCall?.notes ?? null,
      everSentToEngagement,
      everAdminApproved,
    },
  };
}

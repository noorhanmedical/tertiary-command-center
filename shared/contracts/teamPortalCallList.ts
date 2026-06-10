// Team Portal call-list read-model contract (Batch J).
//
// Type-only product contract for the canonical Team Portal call-list
// surface. Uses the product terminology pinned in Batch D:
//   - assignedTeamMember (NOT assignedScheduler).
//   - teamMemberId (NOT schedulerId).
//   - callListAssignment (NOT scheduler_assignment).
//   - workAssignment (NOT scheduler_assignment for broader work).
//
// Legacy DB column names are exposed ONLY through clearly-named
// `legacy*` mapping fields so a future runtime adopter can re-derive
// links into the legacy `scheduler_assignments` row when needed
// without leaking the legacy naming into product code.
//
// NOT WIRED to any route or UI in this batch. Pins the shape so a
// future Batch H Step 5 (Portal call-list v2 read route) adopts a
// single import path.
//
// Cross-references:
//   - engagement-call-list-canonicalization-contract.md (Batch A)
//   - team-member-assignment-terminology-contract.md (Batch D)
//   - call-history-readonly-envelope-contract.md (Batch G)
//   - call-list-runtime-implementation-plan.md (Batch H Step 5)
//   - shared/schema/outreach.ts:75-103 (legacy scheduler_assignments
//     table, NOT imported here — keeps this contract pure).

/**
 * Role profile a Team Member holds. Both PCS and ACS may receive
 * assigned call/work lists.
 */
export type TeamMemberRoleProfile =
  | "patient_care_specialist"
  | "ancillary_care_specialist"
  | "admin";

/**
 * Status of a CallListAssignment. Mirrors the legacy
 * `scheduler_assignments.status` enum but renamed at the product
 * layer.
 */
export type CallListAssignmentStatus =
  | "active"
  | "completed"
  | "reassigned"
  | "released";

/**
 * Source that produced the assignment. Mirrors the legacy
 * `scheduler_assignments.source` enum.
 */
export type CallListAssignmentSource = "auto" | "manual" | "reassigned";

/**
 * Outcome of the last call recorded for the assignment, if any.
 * Subset of `CALL_RESULT_OUTCOMES_FIXTURE` (Batch B); the call-list
 * surface only carries the latest outcome string for display.
 */
export type CallListAssignmentLastOutcome =
  | "scheduled"
  | "callback"
  | "no_answer"
  | "voicemail"
  | "wrong_number"
  | "declined"
  | "needs_records"
  | "insurance_prior_auth_issue"
  | "manager_review"
  | "facility_specific_issue"
  | null;

/**
 * One CallListAssignment item exposed to Team Portal. Pins the
 * product field names; the matching legacy mapping fields document
 * the bridge into `scheduler_assignments`.
 */
export type TeamPortalCallListItem = {
  // ─── Product identity ───────────────────────────────────────
  /** Stable composite id (e.g. `cl:<scheduler_assignments.id>`). */
  id: string;
  /** Patient screening id (legacy column preserved verbatim — the
   *  product identifier is the canonical patientCanonicalId once
   *  Patient Directory adoption ships per Bundle 49). */
  patientScreeningId: number;
  /** Canonical patient id when the Patient Directory shadow read is
   *  enabled; otherwise null. */
  canonicalPatientId: string | null;

  // ─── Assignment ─────────────────────────────────────────────
  /** Team Member id (the user id of the assignee). */
  assignedTeamMemberId: string | null;
  /** Display name of the assigned Team Member. */
  assignedTeamMember: {
    displayName: string | null;
    roleProfile: TeamMemberRoleProfile | null;
    facility: string | null;
  } | null;
  /** Same Team Member identity for the row's ORIGINAL assignment
   *  before any reassignment. Null for the first assignment. */
  originalAssignedTeamMemberId: string | null;

  // ─── Lifecycle ──────────────────────────────────────────────
  status: CallListAssignmentStatus;
  source: CallListAssignmentSource | null;
  reason: string | null;
  asOfDate: string; // YYYY-MM-DD
  assignedAt: string; // ISO 8601
  completedAt: string | null;

  // ─── Last-call snapshot ─────────────────────────────────────
  /** Latest outcome recorded for this patient on the asOfDate; null
   *  if no call yet. */
  lastOutcome: CallListAssignmentLastOutcome;
  /** When the last call was started. Null if no call yet. */
  lastStartedAt: string | null;
  /** Number of call attempts logged today against this patient. */
  attemptCount: number;
  /** When a callback is due. Null if no callback set. */
  callbackAt: string | null;
  /** Next scheduled action for the engagement-case spine (mirrors
   *  patient_execution_cases.nextActionAt). */
  nextActionAt: string | null;

  // ─── Display context ────────────────────────────────────────
  /** Patient display name. Surfaced per the Batch G role rules. */
  patientName: string;
  /** Patient phone number. May be null when not on file. */
  phoneNumber: string | null;
  /** Patient's facility for the day's queue. */
  facility: string | null;
  /** Qualifying tests on the patient screening. */
  qualifyingTests: ReadonlyArray<string>;

  // ─── Legacy mapping fields (per Batch D §2) ─────────────────
  legacySchedulerAssignmentId: number;
  legacySchedulerId: number;
  legacyOriginalSchedulerId: number | null;
};

/**
 * Envelope returned by the future v2 call-list read endpoint.
 */
export type TeamPortalCallListResponse = {
  /** As-of date the queue was built for. */
  asOfDate: string;
  /** Facility scope of the queue. */
  facility: string | null;
  /** Capacity context surfaced to the UI. */
  capacity: {
    heavyDay: boolean;
    cap: number;
    baseCap: number;
    heavyDayFactor: number;
  };
  /** Total pool size (after filters, before capacity slice). */
  totalPool: number;
  /** Items in the slice assigned to the viewer. */
  items: ReadonlyArray<TeamPortalCallListItem>;
};

// ────────────────────────────────────────────────────────────
// Call-history item (Batch G envelope at the type layer)
// ────────────────────────────────────────────────────────────

/**
 * One row of prior call history exposed to Team Portal /
 * Playground. Mirrors the envelope in
 * docs/architecture/call-history-readonly-envelope-contract.md §1.
 * Adds a redaction marker for note bodies hidden per Batch G §3.
 */
export type CallHistoryItem = {
  id: number;
  patientScreeningId: number;
  outcome: CallResultOutcome;
  /** Note body, or null when hidden per Batch G §3. */
  notes: string | null;
  /** True when the note was redacted (hidden) for this viewer. */
  notesRedacted: boolean;
  callbackAt: string | null;
  attemptNumber: number | null;
  durationSeconds: number | null;
  startedAt: string;
  /** Display-only Team Member context. May be null if the user
   *  record was deleted. */
  teamMember: {
    displayName: string;
    roleProfile: TeamMemberRoleProfile | null;
  } | null;
};

// ────────────────────────────────────────────────────────────
// Call-result types (product layer over the Batch B fixture)
// ────────────────────────────────────────────────────────────

/**
 * Canonical call-result outcome set. Mirrors
 * tests/fixtures/callResultCanonicalization.fixture.ts.
 */
export type CallResultOutcome =
  | "scheduled"
  | "callback"
  | "no_answer"
  | "voicemail"
  | "wrong_number"
  | "declined"
  | "needs_records"
  | "insurance_prior_auth_issue"
  | "manager_review"
  | "facility_specific_issue";

/**
 * Next-action hint for the assignee after a call result. Pinned by
 * Batch B for callback-style outcomes; null for terminal outcomes.
 */
export type CallResultNextAction = {
  /** Whether the assignee should follow up. */
  followUpRequired: boolean;
  /** When the assignee should follow up. Null when followUpRequired
   *  is false. */
  followUpAt: string | null;
  /** Short reason for the follow-up. */
  reason: string | null;
};

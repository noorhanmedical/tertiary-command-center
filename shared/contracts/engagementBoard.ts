// Engagement Center assignment-board row contract.
//
// SOURCE (canonical): server/routes/engagementAssignmentBoard.ts:106-127
// (inline `type BoardRow = { … }` used by the GET /api/engagement/assignment-board
// handler).
//
// SOURCE (canonical): server/routes/engagementAssignmentBoard.ts:129-136
// (assignBoardSchema — POST /api/engagement/assignment-board/assign body)
//
// The board row is the read-side shape returned by the legacy Engagement
// Center endpoint. The conflict-guard logic
// (`findConflictingActiveAssignment`, ~lines 29-88) is *not* part of this
// contract — it operates on execution-case rows, not board rows.
//
// Invariants (cross-reference docs/architecture/protected-flows.md):
//   - missingInfo is computed by computeMissingInfo() — see
//     server/routes/engagementAssignmentBoard.ts:151+ for the rules.
//   - Outreach patients with null scheduleDate are exempt from the conflict
//     guard at assignment time.
//
// This contract mirrors the inline type structurally. Any consumer that wants
// to depend on this contract instead of the inline definition can do so in a
// later batch.

export type EngagementBoardRow = {
  patientScreeningId: number | null;
  executionCaseId: number;
  patientName: string;
  patientDob: string | null;
  phoneNumber: string | null;
  facility: string | null;
  scheduleDate: string | null;
  patientType: string | null;
  engagementBucket: string | null;
  engagementStatus: string | null;
  commitStatus: string | null;
  assignedTeamMemberId: number | null;
  assignedRole: string | null;
  assignedName: string | null;
  assignedFacility: string | null;
  nextActionAt: string | null;
  lastActivityAt: string | null;
  lastActivitySummary: string | null;
  /** Canonical last call outcome from the execution case (may differ from the
   *  latest journey summary). Null when no call has been logged. */
  lastCallOutcome: string | null;
  missingInfo: string[];
  selectedServices: string[];
  /**
   * Phase 2C — service-level eligibility. When
   * FEATURE_ENGAGEMENT_ADMIN_REVIEW_SYNC is ON, this reflects the
   * approved-and-membership-active services only. When OFF, this
   * mirrors selectedServices (legacy).
   */
  eligibleServices?: string[];
  // ─── Server-derived display taxonomy (honest nulls) ───────────────
  // Derived from the fields above by deriveEngagementTaxonomy() so the
  // client + server agree on one mapping. Gaps are honest: Patient Support
  // call types have no backing data today, so `category` stays null and the
  // UI renders "—" rather than fabricating a type.
  /** "Ancillary Scheduling" when derivable, else null (e.g. Patient Support). */
  category: string | null;
  /** "Visit Patient Scheduling" | "Outreach Patient Scheduling" |
   *  "Repeat Test Due" | null. */
  callType: string | null;
  /** "Admin Review" | "Repeat Eligibility" | null. */
  source: string | null;
  /** Compact, derived status trail (Admin Review Approved → … → current). */
  statusTrail: string[];
};

// ─── Derivation (pure, shared by client + server) ────────────────────
//
// The Engagement Center enriches each row with a display taxonomy
// (Category / Call Type / Source) and a compact Status Trail. All of it
// is DERIVED from fields the execution case already carries — no schema,
// no new columns. Gaps stay honest (null / "—") rather than fabricated.
//
// engagementBucket is only ever "visit" | "outreach" | "scheduling_triage"
// (shared/schema/executionCase.ts). Repeat/re-eligibility work is not a
// bucket — it is detected from the case's status/summary/outcome text.

const REPEAT_ELIGIBLE_RE =
  /re[- _]?elig|eligible again|re-?qualif|repeat (test|screen)|cooldown (over|complete|ended)|due (again|for repeat)/i;

export type EngagementTaxonomyInput = {
  engagementBucket: string | null;
  engagementStatus: string | null;
  lastActivitySummary: string | null;
  lastCallOutcome: string | null;
  assignedTeamMemberId: number | null;
};

export type EngagementTaxonomy = {
  category: string | null;
  callType: string | null;
  source: string | null;
  statusTrail: string[];
};

function deriveStatusTrail(
  input: EngagementTaxonomyInput,
  callType: string | null,
): string[] {
  const trail: string[] = ["Admin Review Approved"];
  if (callType) trail.push(callType);

  if (input.assignedTeamMemberId == null) {
    trail.push("In Assignment Pool");
    trail.push("Awaiting Assignment");
    return trail;
  }

  trail.push("Assigned");
  const status = (input.engagementStatus ?? "").toLowerCase();
  const outcome = (input.lastCallOutcome ?? "").toLowerCase();
  const both = `${status} ${outcome}`;
  const unreached = /no[ _-]?answer|unable|unreachable|voicemail/.test(both);

  if (/scheduled/.test(both)) {
    trail.push("Patient Reached", "Scheduled");
  } else if (/declin/.test(both)) {
    trail.push("Patient Reached", "Declined");
  } else if (/completed/.test(status)) {
    trail.push("Completed");
  } else if (/contacted|reached|answered/.test(both) && !unreached) {
    trail.push("Patient Reached", "In Progress");
  } else if (unreached) {
    trail.push("On Call List", "Attempted");
  } else {
    trail.push("On Call List");
  }
  return trail;
}

/** Derive Category / Call Type / Source / Status Trail from an execution
 *  case's honest fields. Never fabricates a Patient Support type. */
export function deriveEngagementTaxonomy(
  input: EngagementTaxonomyInput,
): EngagementTaxonomy {
  const bucket = (input.engagementBucket ?? "").toLowerCase();
  const both = `${input.engagementStatus ?? ""} ${
    input.lastActivitySummary ?? ""
  } ${input.lastCallOutcome ?? ""}`;
  const isRepeat = REPEAT_ELIGIBLE_RE.test(both);

  let category: string | null = null;
  let callType: string | null = null;
  let source: string | null = null;

  const isSchedulingBucket =
    bucket === "visit" || bucket === "outreach" || bucket === "scheduling_triage";

  if (isSchedulingBucket) {
    category = "Ancillary Scheduling";
    source = "Admin Review";
    if (isRepeat) {
      callType = "Repeat Test Due";
      source = "Repeat Eligibility";
    } else if (bucket === "visit") {
      callType = "Visit Patient Scheduling";
    } else if (bucket === "outreach") {
      callType = "Outreach Patient Scheduling";
    } else {
      // scheduling_triage with no repeat signal: category is known but the
      // specific call type is not — keep it an honest gap.
      callType = null;
    }
  } else if (isRepeat) {
    category = "Ancillary Scheduling";
    callType = "Repeat Test Due";
    source = "Repeat Eligibility";
  }
  // Patient Support: no backing data — category/callType/source stay null.

  return {
    category,
    callType,
    source,
    statusTrail: deriveStatusTrail(input, callType),
  };
}

// Assignment role union — mirrors the literal options in assignBoardSchema.
// SOURCE: server/routes/engagementAssignmentBoard.ts:132-134
export type EngagementAssignedRole =
  | "scheduler"
  | "patientCareSpecialist"
  | "ancillaryCareSpecialist";

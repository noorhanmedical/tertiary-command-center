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
  missingInfo: string[];
  selectedServices: string[];
};

// Assignment role union — mirrors the literal options in assignBoardSchema.
// SOURCE: server/routes/engagementAssignmentBoard.ts:132-134
export type EngagementAssignedRole =
  | "scheduler"
  | "patientCareSpecialist"
  | "ancillaryCareSpecialist";

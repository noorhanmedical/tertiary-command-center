// Admin review status contract.
//
// SOURCE (canonical): shared/schema/screening.ts:91-97 (ADMIN_APPROVAL_STATUSES + AdminApprovalStatus)
// SOURCE (canonical): client/src/lib/adminReviewStatus.ts:17-40
//   - AdminApprovalStatus (line 17)
//   - AdminReviewStatus (lines 19-24)
//   - AdminReviewMissing (lines 26-31)
//   - AdminReviewResult (lines 33-40)
//
// These types are pure structural mirrors of the inline definitions above.
// Any consumer that wishes to depend on this contract instead of the inline
// definition can do so in a later batch without runtime impact (types are
// erased at compile time).
//
// Invariant: if shared/schema/screening.ts or client/src/lib/adminReviewStatus.ts
// changes the shape, this contract must change to match (or be removed).

export const ADMIN_APPROVAL_STATUSES = [
  "pending",
  "approved",
  "needs_info",
  "rejected",
] as const;

export type AdminApprovalStatus = (typeof ADMIN_APPROVAL_STATUSES)[number];

export type AdminReviewStatus =
  | "incomplete"
  | "ready_for_review"
  | "approved"
  | "rejected"
  | "needs_info";

export type AdminReviewMissing =
  | "name"
  | "DOB"
  | "phone"
  | "facility"
  | "qualification";

export type AdminReviewResult = {
  status: AdminReviewStatus;
  approval: AdminApprovalStatus;
  missing: AdminReviewMissing[];
  hasQualification: boolean;
  isPatientSent: boolean;
  readyForAdminReview: boolean;
};

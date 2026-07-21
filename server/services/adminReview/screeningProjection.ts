/**
 * Phase 2C — Screening-level compatibility projection.
 *
 * `patient_screenings.admin_approval_status` remains readable for
 * every legacy consumer. Its value is now DERIVED from the current
 * ancillary_case.admin_review_status set across all active ancillary
 * cases for the screening.
 *
 * Projection rule:
 *   • approved     — every active ancillary case is 'approved'
 *   • needs_info   — any active ancillary case is 'needs_info'
 *   • rejected     — every active ancillary case is 'rejected'
 *   • pending      — everything else
 *
 * When there are NO active ancillary cases, the projected status is
 * 'pending'.
 *
 * When FEATURE_SERVICE_SPECIFIC_ADMIN_REVIEW is OFF the projection
 * is a no-op — the legacy screening column drives itself. When ON,
 * this projection runs after every appended review event so the
 * legacy column stays consistent with the per-service truth.
 */

import type { AncillaryReviewStatus } from "@shared/schema/adminReviewEvents";

export function projectScreeningStatusFromAncillaryStatuses(
  activeAncillaryStatuses: AncillaryReviewStatus[],
): AncillaryReviewStatus {
  if (activeAncillaryStatuses.length === 0) return "pending";
  const allApproved = activeAncillaryStatuses.every((s) => s === "approved");
  if (allApproved) return "approved";
  const anyNeedsInfo = activeAncillaryStatuses.some((s) => s === "needs_info");
  if (anyNeedsInfo) return "needs_info";
  const allRejected = activeAncillaryStatuses.every((s) => s === "rejected");
  if (allRejected) return "rejected";
  return "pending";
}

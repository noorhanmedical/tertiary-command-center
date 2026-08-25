/**
 * Phase 2C — Admin Review authorization guard.
 *
 * ─── RESOLUTION (canonical reviewer role now exists) ──────────────
 *
 * Admin Review must be performed by AUTHORIZED PLEXUS-INTERNAL
 * CLINICAL PERSONNEL. The canonical role `plexus_internal_clinical_reviewer`
 * is now part of USER_ROLES (shared/schema/users.ts) and is the ONLY
 * role this guard permits (in addition to the feature flag being ON).
 * Clinic `admin` is deliberately NOT permitted — the reviewer role is
 * provisioned only for Plexus-internal clinical reviewers.
 *
 *   • `checkAdminReviewAccess()` permits ONLY that role.
 *   • `assertAdminReviewAccess()` throws (403) for any other role.
 *   • `FEATURE_SERVICE_SPECIFIC_ADMIN_REVIEW` must be ON.
 *
 * The legacy screening-level route
 *   POST /api/patient-screenings/:id/admin-approval
 * REMAINS unchanged.
 */

import type { Request, Response, NextFunction } from "express";
import { featureFlags } from "../../lib/featureFlags";

export const ADMIN_REVIEW_ROLE_BLOCKER = {
  reason: "no_plexus_internal_clinical_reviewer_role_defined",
  proposedRole: "plexus_internal_clinical_reviewer",
  currentUserRoles: [
    "admin",
    "clinician",
    "scheduler",
    "biller",
    "technician",
    "liaison",
  ] as const,
  resolution:
    "Add plexus_internal_clinical_reviewer to USER_ROLES; ensure it is provisionable ONLY by Plexus platform operators; then update this file to permit that role only.",
} as const;

export type AdminReviewAccessResult =
  | { permitted: true; role: "plexus_internal_clinical_reviewer" }
  | { permitted: false; reason: string };

export function checkAdminReviewAccess(session?: {
  role?: string | null;
  userId?: string | null;
}): AdminReviewAccessResult {
  if (!featureFlags.serviceSpecificAdminReview) {
    return {
      permitted: false,
      reason: "feature_flag_off:FEATURE_SERVICE_SPECIFIC_ADMIN_REVIEW",
    };
  }
  const role = session?.role ?? null;
  if (role !== ("plexus_internal_clinical_reviewer" as unknown as string)) {
    return {
      permitted: false,
      reason: ADMIN_REVIEW_ROLE_BLOCKER.reason,
    };
  }
  return { permitted: true, role: "plexus_internal_clinical_reviewer" };
}

export function assertAdminReviewAccess(session: {
  role?: string | null;
  userId?: string | null;
}): void {
  const r = checkAdminReviewAccess(session);
  if (!r.permitted) {
    const err = new Error(`admin_review_access_denied: ${r.reason}`) as Error & { code?: string; status?: number };
    err.code = "ADMIN_REVIEW_ACCESS_DENIED";
    err.status = 403;
    throw err;
  }
}

export function requireAdminReviewAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const session = (req as unknown as { session?: { role?: string; userId?: string } }).session;
  const r = checkAdminReviewAccess(session);
  if (!r.permitted) {
    res.status(403).json({
      error: "Plexus-internal Admin Review access denied.",
      code: r.reason,
    });
    return;
  }
  next();
}

/**
 * Phase 2C — Admin Review authorization guard.
 *
 * ─── UNRESOLVED BLOCKER (Phase 2C) ────────────────────────────────
 *
 * Admin Review must be performed by AUTHORIZED PLEXUS-INTERNAL
 * CLINICAL PERSONNEL. The current USER_ROLES enum
 *   ["admin", "clinician", "scheduler", "biller", "technician", "liaison"]
 * has no such role:
 *   • `admin`     → clinic administrator, NOT Plexus internal.
 *   • `clinician` → clinic-side physician; not a Plexus reviewer.
 *   • The remaining roles are clinic operational roles.
 *
 * Per the Phase 2C rule this file does NOT invent a broad
 * authorization rule to make the routes functional. Instead:
 *
 *   • `assertAdminReviewAccess()` throws until the internal role exists.
 *   • The Express guard `requireAdminReviewAccess` always responds 403.
 *   • The new service-specific review routes stay UNREGISTERED in
 *     server/routes.ts.
 *   • `FEATURE_SERVICE_SPECIFIC_ADMIN_REVIEW` stays OFF.
 *
 * The legacy screening-level route
 *   POST /api/patient-screenings/:id/admin-approval
 * REMAINS unchanged (it is the only Admin Review the runtime uses
 * today). Phase 2C does not restrict or modify that route.
 *
 * When a Plexus-internal role is introduced (proposed name:
 * `plexus_internal_clinical_reviewer`), swap the always-deny logic
 * for a role check, register the new routes, and flip the flag ON.
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

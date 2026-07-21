/**
 * Plexus-internal identity access guard.
 *
 * ─── UNRESOLVED BLOCKER (Phase 2A) ────────────────────────────────
 *
 * The Plexus identity model requires a Plexus-INTERNAL user role
 * (an operator of the Plexus platform, NOT a clinic user, NOT a
 * general clinic administrator). Only Plexus-internal users may:
 *   • view global_plexus_patients rows
 *   • view patient_identity_match_candidates
 *   • confirm / reject match candidates
 *   • create patient_identity_merge_events
 *   • manage plexus_id_aliases
 *
 * The current USER_ROLES set is:
 *
 *   ["admin", "clinician", "scheduler", "biller", "technician", "liaison"]
 *
 * None of these roles safely map to "Plexus-internal reviewer":
 *   • `admin` in this codebase = clinic administrator, not Plexus staff.
 *   • The remaining five roles are clinic-side workflow roles.
 *
 * Per the Phase 2A governance rule, this file does NOT invent a broad
 * authorization rule (e.g. "role === 'admin'") to make the identity
 * routes functional. Instead:
 *
 *   • `assertPlexusIdentityAccess()` always throws.
 *   • The Express guard `requirePlexusIdentityAccess` always responds 403.
 *   • Identity-review routes stay UNREGISTERED in server/routes.ts.
 *   • `FEATURE_PLEXUS_IDENTITY_REVIEW` stays OFF.
 *
 * When a Plexus-internal role is introduced (proposed name:
 * `plexus_internal_reviewer`), swap the always-deny logic below for a
 * role check, register the routes, and flip the flag ON.
 */

import type { Request, Response, NextFunction } from "express";
import { featureFlags } from "../../lib/featureFlags";

export const PLEXUS_INTERNAL_ROLE_BLOCKER = {
  reason:
    "no_plexus_internal_role_defined_in_user_roles_enum",
  proposedRole: "plexus_internal_reviewer",
  currentUserRoles: [
    "admin",
    "clinician",
    "scheduler",
    "biller",
    "technician",
    "liaison",
  ] as const,
  resolution:
    "Add plexus_internal_reviewer to USER_ROLES; ensure it is provisionable ONLY by Plexus platform operators, never by clinics; then update this file to permit that role only.",
} as const;

export type PlexusIdentityAccessCheckResult =
  | { permitted: true; role: "plexus_internal_reviewer" }
  | { permitted: false; reason: string };

/**
 * Assert whether the given session may access Plexus-internal
 * identity endpoints. Currently always denies pending role introduction.
 */
export function checkPlexusIdentityAccess(
  session: { role?: string | null; userId?: string | null } | undefined,
): PlexusIdentityAccessCheckResult {
  if (!featureFlags.plexusIdentityReview) {
    return {
      permitted: false,
      reason: "feature_flag_off:FEATURE_PLEXUS_IDENTITY_REVIEW",
    };
  }
  // Even if the flag were flipped ON, deny until the role exists.
  const role = session?.role ?? null;
  if (role !== ("plexus_internal_reviewer" as unknown as string)) {
    return {
      permitted: false,
      reason: PLEXUS_INTERNAL_ROLE_BLOCKER.reason,
    };
  }
  return { permitted: true, role: "plexus_internal_reviewer" };
}

/**
 * Throwing form for use in service-layer code paths that reach identity
 * mutations from a non-route call site.
 */
export function assertPlexusIdentityAccess(session: {
  role?: string | null;
  userId?: string | null;
}): void {
  const r = checkPlexusIdentityAccess(session);
  if (!r.permitted) {
    const err = new Error(
      `plexus_identity_access_denied: ${r.reason}`,
    ) as Error & { code?: string; status?: number };
    err.code = "PLEXUS_IDENTITY_ACCESS_DENIED";
    err.status = 403;
    throw err;
  }
}

/**
 * Express middleware. Refuses every request until:
 *   1. USER_ROLES includes a Plexus-internal role
 *   2. FEATURE_PLEXUS_IDENTITY_REVIEW is ON
 *   3. This file is updated to permit that role
 */
export function requirePlexusIdentityAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const session = (req as unknown as { session?: { role?: string; userId?: string } }).session;
  const r = checkPlexusIdentityAccess(session);
  if (!r.permitted) {
    res.status(403).json({
      error: "Plexus-internal identity review access denied.",
      code: r.reason,
    });
    return;
  }
  next();
}

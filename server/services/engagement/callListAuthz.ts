// Scope-bound authorization helpers for the Engagement Call List package
// surface. Built ON TOP of the canonical manager-scope system
// (services/teams/managerScope): authority is admin (org-wide) OR a manager's
// team scope (facilities + roster scheduler ids). The server is authoritative;
// the client-supplied facility id is NEVER trusted.
//
// These are PURE (given a resolved ManagerScope + the roster-id set) so they
// are unit-testable without a DB. The DB-backed pieces (resolveManagerScope,
// schedulerIdsInScope) are resolved by the route/middleware and passed in.

import type { ManagerScope } from "../teams/managerScope";

/** True when the caller may operate on `facility`. Admin → any; manager → only
 *  facilities in their team scope. Empty/blank facility is never in scope for a
 *  non-admin. */
export function facilityInScope(scope: ManagerScope, facility: string | null | undefined): boolean {
  if (scope.isAdmin) return true;
  const f = (facility ?? "").trim();
  if (!f) return false;
  return scope.facilityIds.has(f);
}

/** True when the caller may operate on a package with the given facility. */
export function packageFacilityInScope(
  scope: ManagerScope,
  pkgFacilityId: string | null | undefined,
): boolean {
  return facilityInScope(scope, pkgFacilityId);
}

/**
 * True when EVERY proposed team-member (roster scheduler id) is within the
 * caller's assignment scope. `allowedSchedulerIds === null` means admin (no
 * restriction). For a manager, the set is their in-scope roster ids; an empty
 * set means the manager can assign to no one → deny any non-empty mapping.
 */
export function allMembersInScope(
  scope: ManagerScope,
  teamMemberIds: number[],
  allowedSchedulerIds: number[] | null,
): boolean {
  if (scope.isAdmin || allowedSchedulerIds === null) return true;
  const allowed = new Set(allowedSchedulerIds);
  return teamMemberIds.every((id) => allowed.has(id));
}

/** Resolve the facility filter a LIST query should use for this caller:
 *   • admin + requested facility → [requested] (honor filter)
 *   • admin + no facility        → null (all)
 *   • manager + requested facility (in scope) → [requested]
 *   • manager + requested facility (out of scope) → throws-worthy (caller checks)
 *   • manager + no facility → the manager's full in-scope facility set
 *  Returns { facilityIds } where facilityIds null = unrestricted (admin all). */
export function resolveListFacilityScope(
  scope: ManagerScope,
  requestedFacility: string | null,
): { facilityIds: string[] | null } {
  if (scope.isAdmin) {
    return { facilityIds: requestedFacility ? [requestedFacility] : null };
  }
  if (requestedFacility) {
    return { facilityIds: [requestedFacility] };
  }
  return { facilityIds: [...scope.facilityIds] };
}

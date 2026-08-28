// Manager authorization scope (Phase 4 / decisions K3, K4).
//
// Management authority is CANONICAL — derived only from active
// manager_relationships, never from role/title/email/facility. Admin is
// organization-wide; a manager is authorized for their team(s) (and any
// explicit user-scoped overrides). This is the single backend gate for
// manager-scoped workforce features (tasks, needs-coverage, handoffs,
// timeline, redistribution, workload, team messaging).

import { teamsRepository } from "../../repositories/teams.repo";

export interface ManagerScope {
  isAdmin: boolean;
  // Team ids the manager is authorized for (empty for a plain staff user).
  teamIds: number[];
  // User ids in the manager's scope (union of team members + direct overrides).
  userIds: Set<string>;
  // Facilities the manager's teams are scoped to (empty = no facility narrowing).
  facilityIds: Set<string>;
}

/**
 * Resolve what a caller may manage. Admins get `isAdmin=true` (org-wide).
 * A non-admin gets the teams they actively manage + the users in those teams
 * + any explicit user-scoped overrides.
 */
export async function resolveManagerScope(
  userId: string | null,
  role: string | null,
): Promise<ManagerScope> {
  const isAdmin = role === "admin";
  const scope: ManagerScope = { isAdmin, teamIds: [], userIds: new Set(), facilityIds: new Set() };
  if (isAdmin || !userId) return scope;

  const rels = await teamsRepository.listManagerRelationships(userId, true);
  const teamIds = new Set<number>();
  for (const r of rels) {
    if (r.scopeType === "team" && r.teamId != null) {
      teamIds.add(r.teamId);
      if (r.facilityId) scope.facilityIds.add(r.facilityId);
    } else if (r.scopeType === "user" && r.subordinateUserId) {
      scope.userIds.add(r.subordinateUserId);
    }
  }
  scope.teamIds = [...teamIds];

  // Expand team scope → member user ids.
  for (const teamId of scope.teamIds) {
    const members = await teamsRepository.listMembershipsForTeam(teamId, true);
    for (const m of members) scope.userIds.add(m.userId);
  }
  return scope;
}

/** True when the caller may manage `targetUserId` (admin, or target is in the
 *  manager's scope, or the manager is acting on themselves is NOT implied). */
export function scopeCoversUser(scope: ManagerScope, targetUserId: string): boolean {
  return scope.isAdmin || scope.userIds.has(targetUserId);
}

/** True when the caller may manage `teamId`. */
export function scopeCoversTeam(scope: ManagerScope, teamId: number): boolean {
  return scope.isAdmin || scope.teamIds.includes(teamId);
}

/** True when the caller has ANY management authority (admin or a manager). */
export function isManagerOrAdmin(scope: ManagerScope): boolean {
  return scope.isAdmin || scope.teamIds.length > 0 || scope.userIds.size > 0;
}

// Team Portal multi-clinic scope — DB assembly.
//
// Thin DB wrapper over teamPortalScope.pure.ts. Fetches the user's team
// memberships (+ their teams for type/facility), canonical facility coverage,
// and the outreach roster, then delegates ALL decisions to the pure functions.
//
// Deliberately does NOT deepen legacy auth: it reads canonical team membership
// (teams.type + teams.facilityId), canonical facility coverage, and the roster
// only for (a) the ASSIGNMENT id set and (b) as one access source. It never
// gates on users.role beyond the compatibility fallback baked into the pure
// capabilityForClinic (used only when the user has no PCS/ACS team at all).

import { teamsRepository } from "../repositories/teams.repo";
import { facilityCoverageRepository } from "../repositories/facilityCoverage.repo";
import { storage } from "../storage";
import { fallbackWorkspaceTypeForRole } from "@shared/teamMemberProfile";
import {
  resolveAuthorizedFacilities,
  resolvePerClinicCapabilities,
  resolveRosterIdsForFacilities,
  resolveRequestedFacilityScope,
  capabilityForClinic,
  hasAnyTeamCapability,
  type ClinicCapability,
  type GlobalWorkspaceType,
  type TeamMembershipLite,
} from "./teamPortalScope.pure";

export type TeamPortalScope = {
  userId: string;
  /** ACCESS — every facility the user may work (roster ∪ coverage ∪ teams). */
  authorizedFacilities: string[];
  /** CAPABILITY — PCS/ACS per authorized facility (team-derived). */
  perClinicCapability: Record<string, ClinicCapability>;
  hasTeamCapability: boolean;
  globalWorkspaceType: GlobalWorkspaceType;
  /** Raw roster rows (for ASSIGNMENT id resolution). */
  rosterRows: { id: number; userId: string | null; facility: string }[];
};

/** Assemble the multi-clinic scope for a login user. */
export async function resolveTeamPortalScope(userId: string): Promise<TeamPortalScope> {
  const [memberships, coverageFacilities, allRoster, user] = await Promise.all([
    teamsRepository.listMembershipsForUser(userId, true),
    facilityCoverageRepository.coveredFacilityIdsForUser(userId),
    storage.getOutreachSchedulers(),
    storage.getUser(userId),
  ]);

  // Resolve each membership's team (type + facilityId). Batched by unique id.
  const teamIds = [...new Set(memberships.map((m) => m.teamId))];
  const teamPairs = await Promise.all(teamIds.map((id) => teamsRepository.getTeam(id)));
  const teamById = new Map(
    teamPairs.filter((t): t is NonNullable<typeof t> => !!t).map((t) => [t.id, t]),
  );

  const membershipLite: TeamMembershipLite[] = memberships.map((m) => {
    const t = teamById.get(m.teamId);
    // A capability is granted only when BOTH the membership AND the team are
    // active — a deactivated team must never confer PCS/ACS capability even if
    // the membership row is still active.
    return {
      teamType: t?.type ?? null,
      facilityId: t?.facilityId ?? null,
      active: m.active !== false && t?.active !== false,
    };
  });

  const rosterRows = allRoster.map((r) => ({ id: r.id, userId: r.userId, facility: r.facility }));
  const rosterFacilities = rosterRows.filter((r) => r.userId === userId).map((r) => r.facility);
  const teamFacilities = membershipLite
    .filter((m) => m.active !== false && (m.teamType === "PCS" || m.teamType === "ACS") && m.facilityId)
    .map((m) => m.facilityId as string);

  const authorizedFacilities = resolveAuthorizedFacilities({
    rosterFacilities,
    coverageFacilities,
    teamFacilities,
  });

  const perClinicCapability = resolvePerClinicCapabilities(membershipLite, authorizedFacilities);
  const hasTeamCapability = hasAnyTeamCapability(membershipLite);
  const globalWorkspaceType: GlobalWorkspaceType = hasTeamCapability
    ? null
    : fallbackWorkspaceTypeForRole(user?.role ?? null);

  return {
    userId,
    authorizedFacilities,
    perClinicCapability,
    hasTeamCapability,
    globalWorkspaceType,
    rosterRows,
  };
}

/** Narrow the authorized set to an optional requested clinic (All Clinics =
 *  null requested). Returns null when the requested clinic is not authorized. */
export function scopeFacilityIds(
  scope: TeamPortalScope,
  requestedFacilityId: string | null,
): string[] | null {
  const r = resolveRequestedFacilityScope(scope.authorizedFacilities, requestedFacilityId);
  return r.ok ? r.facilityIds : null;
}

/** All of the user's roster ids across the given facilities (ASSIGNMENT set). */
export function scopeRosterIds(scope: TeamPortalScope, facilityIds: string[] | null): number[] {
  return resolveRosterIdsForFacilities(scope.rosterRows, scope.userId, facilityIds);
}

/** Capability at a specific clinic, with the legacy fallback baked in. */
export function scopeCapabilityForClinic(
  scope: TeamPortalScope,
  facilityId: string | null,
): ClinicCapability {
  return capabilityForClinic(scope.perClinicCapability, facilityId, {
    hasAnyTeamCapability: scope.hasTeamCapability,
    globalWorkspaceType: scope.globalWorkspaceType,
  });
}

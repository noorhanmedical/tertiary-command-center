// Team Portal multi-clinic scope — PURE resolution logic.
//
// Zero I/O, zero DB imports. Deterministically unit-testable. The DB-touching
// wrapper (teamPortalScope.ts) fetches team memberships, facility coverage, and
// the outreach roster, then delegates ALL decisions to these functions.
//
// Concepts kept strictly separate (per product decision):
//   • ACCESS      — which facilities a user may work (authorizedFacilities).
//   • ASSIGNMENT  — which specific cases are the user's (roster ids → the call
//                   list's patient_execution_cases.assignedTeamMemberId filter).
//   • CAPABILITY  — PCS / ACS at a SPECIFIC clinic, derived from facility-scoped
//                   teams (teams.type + teams.facilityId) via team memberships.
//
// Per-clinic capability rule:
//   • A facility-scoped PCS/ACS team grants that capability at that facility.
//   • An org-wide PCS/ACS team (facilityId null) grants that capability at ALL
//     authorized facilities.
//   • If the user has ANY team-derived capability anywhere, a clinic with no
//     PCS/ACS team grants NO specialist capability there (no silent fallback).
//   • Only when the user has NO PCS/ACS team membership at all (orgs not yet
//     using teams) do we fall back to the global workspaceType for
//     compatibility.

export type TeamMembershipLite = {
  teamType: string | null;
  facilityId: string | null;
  active?: boolean | null;
};

export type ClinicCapability = { pcs: boolean; acs: boolean };

export type GlobalWorkspaceType =
  | "patientCareSpecialist"
  | "ancillaryCareSpecialist"
  | null;

/** Does the user hold ANY facility-scoped or org-wide PCS/ACS team membership? */
export function hasAnyTeamCapability(
  memberships: readonly TeamMembershipLite[],
): boolean {
  return memberships.some(
    (m) => m.active !== false && (m.teamType === "PCS" || m.teamType === "ACS"),
  );
}

/**
 * Resolve PCS/ACS capability per facility from team memberships, seeded with
 * every authorized facility so a clinic with no PCS/ACS team still appears
 * (with both false). Org-wide teams (null facilityId) apply to every seeded
 * facility.
 */
export function resolvePerClinicCapabilities(
  memberships: readonly TeamMembershipLite[],
  authorizedFacilities: readonly string[],
): Record<string, ClinicCapability> {
  const out: Record<string, ClinicCapability> = {};
  const ensure = (f: string): ClinicCapability =>
    (out[f] ??= { pcs: false, acs: false });

  for (const f of authorizedFacilities) if (f) ensure(f);

  const orgWide: ClinicCapability = { pcs: false, acs: false };
  for (const m of memberships) {
    if (m.active === false) continue;
    if (m.teamType !== "PCS" && m.teamType !== "ACS") continue;
    const fac = m.facilityId != null && m.facilityId.trim() !== "" ? m.facilityId : null;
    if (fac == null) {
      if (m.teamType === "PCS") orgWide.pcs = true;
      else orgWide.acs = true;
    } else {
      const cap = ensure(fac);
      if (m.teamType === "PCS") cap.pcs = true;
      else cap.acs = true;
    }
  }

  if (orgWide.pcs || orgWide.acs) {
    for (const f of Object.keys(out)) {
      if (orgWide.pcs) out[f].pcs = true;
      if (orgWide.acs) out[f].acs = true;
    }
  }
  return out;
}

/**
 * Capability at a specific clinic. Prefers the team-derived per-clinic map.
 * Falls back to the global workspaceType ONLY when the user has no PCS/ACS team
 * membership at all (compatibility for orgs not yet using teams).
 */
export function capabilityForClinic(
  perClinic: Record<string, ClinicCapability>,
  facilityId: string | null,
  opts: {
    hasAnyTeamCapability: boolean;
    globalWorkspaceType?: GlobalWorkspaceType;
  },
): ClinicCapability {
  // Legacy fallback FIRST: when the user holds NO PCS/ACS team membership at
  // all (orgs not yet using teams), the single global workspace type drives
  // capability at every clinic. Otherwise the team-derived per-clinic map is
  // authoritative — including "both false" for an authorized clinic that has
  // no PCS/ACS team.
  if (!opts.hasAnyTeamCapability) {
    const wt = opts.globalWorkspaceType ?? null;
    return {
      pcs: wt !== "ancillaryCareSpecialist",
      acs: wt === "ancillaryCareSpecialist",
    };
  }
  if (facilityId && perClinic[facilityId]) {
    return { ...perClinic[facilityId] };
  }
  return { pcs: false, acs: false };
}

/** Union of every facility a user may work, across the three access sources. */
export function resolveAuthorizedFacilities(sources: {
  rosterFacilities?: readonly string[];
  coverageFacilities?: readonly string[];
  teamFacilities?: readonly string[];
}): string[] {
  const set = new Set<string>();
  for (const f of sources.rosterFacilities ?? []) if (f) set.add(f);
  for (const f of sources.coverageFacilities ?? []) if (f) set.add(f);
  for (const f of sources.teamFacilities ?? []) if (f) set.add(f);
  return [...set].sort();
}

/**
 * All outreach_schedulers.id (roster ids) belonging to the user across the
 * given facilities. When `facilities` is null, matches every facility. This is
 * the ASSIGNMENT filter set for the multi-clinic call list.
 */
export function resolveRosterIdsForFacilities(
  rosterRows: readonly { id: number; userId: string | null; facility: string }[],
  userId: string,
  facilities: readonly string[] | null,
): number[] {
  const fset = facilities ? new Set(facilities) : null;
  const ids = new Set<number>();
  for (const r of rosterRows) {
    if (r.userId !== userId) continue;
    if (fset && !fset.has(r.facility)) continue;
    ids.add(r.id);
  }
  return [...ids].sort((a, b) => a - b);
}

/**
 * Narrow an authorized-facility set to an optional requested single clinic.
 * Returns the requested clinic (as a 1-element list) when it is authorized,
 * the full authorized set when no clinic is requested ("All Clinics"), or null
 * when the requested clinic is NOT authorized (caller returns 403).
 */
export function resolveRequestedFacilityScope(
  authorizedFacilities: readonly string[],
  requestedFacilityId: string | null,
): { ok: true; facilityIds: string[] } | { ok: false } {
  if (!requestedFacilityId) return { ok: true, facilityIds: [...authorizedFacilities] };
  if (authorizedFacilities.includes(requestedFacilityId)) {
    return { ok: true, facilityIds: [requestedFacilityId] };
  }
  return { ok: false };
}

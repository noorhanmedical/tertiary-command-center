// Phase 2I — PCS clinic-membership identity boundary (§3).
//
// A case's global-patient PHI (display name / DOB) may be resolved ONLY THROUGH a
// verified exact active clinic membership — never from a bare case.globalPlexusPatientId.
// The membership must belong to THIS clinic, be active, and name the SAME global
// patient as the case; the global patient must be current (active, not merged away).
// Any failure → identity unavailable, all display fields null, a PHI-free warning,
// and the case is NEVER grouped with another patient (it stays keyed by its own
// ancillaryCaseId).

import type { PatientClinicMembership, GlobalPlexusPatient } from "@shared/schema/plexusIdentity";

export type IdentityResolution = {
  resolved: boolean;
  patientDisplay: string | null;
  patientDob: string | null;
  clinicMrn: string | null;
  warnings: string[];
  /** Stable grouping key `${globalPatientId}|${membershipId}` when resolved, else null. */
  groupKey: string | null;
};

function unresolved(warnings: string[]): IdentityResolution {
  return { resolved: false, patientDisplay: null, patientDob: null, clinicMrn: null, warnings, groupKey: null };
}

export function verifyCaseIdentity(args: {
  clinicId: number;
  caseGlobalPatientId: number | null;
  caseMembershipId: number | null;
  membership?: PatientClinicMembership;
  globalPatient?: GlobalPlexusPatient;
}): IdentityResolution {
  if (args.caseMembershipId == null) return unresolved(["identity_membership_missing"]);
  const m = args.membership;
  if (!m || m.id !== args.caseMembershipId) return unresolved(["identity_membership_missing"]);
  if (m.clinicId !== args.clinicId) return unresolved(["identity_membership_wrong_clinic"]);
  if (m.membershipStatus !== "active") return unresolved(["identity_membership_inactive"]);
  // The membership must name the SAME global patient the case names.
  if (args.caseGlobalPatientId == null || m.globalPlexusPatientId !== args.caseGlobalPatientId) return unresolved(["identity_patient_membership_conflict"]);
  const g = args.globalPatient;
  if (!g || g.id !== m.globalPlexusPatientId) return unresolved(["identity_global_patient_missing"]);
  if (g.identityStatus !== "active" || g.mergedIntoPatientId != null) return unresolved(["identity_global_patient_not_current"]);
  // Fully verified — resolve display THROUGH the verified membership relationship.
  return {
    resolved: true,
    patientDisplay: g.displayName ?? null,
    patientDob: g.dob ?? null,
    clinicMrn: m.clinicMrn ?? null,
    warnings: [],
    groupKey: `${g.id}|${m.id}`,
  };
}

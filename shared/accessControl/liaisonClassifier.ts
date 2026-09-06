// Pure classifier for resolving an ambiguous legacy `liaison` role from
// CANONICAL team membership. Side-effect free and DB-free so it can be unit
// tested and reused by the backfill without triggering any DB work.
//
// Rules (locked by product — never a silent guess):
//   • PCS-only membership                         → "pcs"
//   • ACS-only membership                         → "acs"
//   • explicit authoritative PRIMARY PCS team     → "pcs"
//   • explicit authoritative PRIMARY ACS team     → "acs"
//   • BOTH PCS and ACS with no unambiguous primary → conflict (needs review)
//   • dual PRIMARY (both PCS and ACS primary)      → conflict (needs review)
//   • neither PCS nor ACS                          → none (needs review)
//
// The caller assigns a neutral "patient_support" role and raises an audit flag
// for both `conflict` and `none`. Ordering of the input rows is IRRELEVANT —
// the decision never depends on database row order.

export interface TeamMembershipRow {
  teamType: string | null;
  primaryTeam: boolean | null;
}

export type LiaisonDecision =
  | { role: "pcs" | "acs"; reason?: undefined }
  | { role: null; reason: "conflict" | "none" };

export function classifyLiaisonMemberships(
  memberships: readonly TeamMembershipRow[],
): LiaisonDecision {
  const hasPCS = memberships.some((m) => m.teamType === "PCS");
  const hasACS = memberships.some((m) => m.teamType === "ACS");

  if (!hasPCS && !hasACS) return { role: null, reason: "none" };

  const primaryPCS = memberships.some((m) => m.teamType === "PCS" && m.primaryTeam === true);
  const primaryACS = memberships.some((m) => m.teamType === "ACS" && m.primaryTeam === true);

  // An unambiguous authoritative primary team wins.
  if (primaryPCS && !primaryACS) return { role: "pcs" };
  if (primaryACS && !primaryPCS) return { role: "acs" };
  // Dual primary is a genuine conflict.
  if (primaryPCS && primaryACS) return { role: null, reason: "conflict" };

  // No primary flag on either side: single-type membership is unambiguous;
  // dual-type membership with no authoritative primary is a conflict.
  if (hasPCS && !hasACS) return { role: "pcs" };
  if (hasACS && !hasPCS) return { role: "acs" };
  return { role: null, reason: "conflict" };
}

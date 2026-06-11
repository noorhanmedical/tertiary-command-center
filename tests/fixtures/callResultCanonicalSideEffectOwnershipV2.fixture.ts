// Canonical call-result side-effect ownership matrix — v2 (Batch G).
//
// Master matrix stating which SURFACE owns which side effect.
// Cross-references the per-surface executors (engagement Batch B,
// outreach Batch C) and the canonical fixture (Batch B of the
// engagement run).
//
// Data-only fixture. No PHI.

export const CALL_RESULT_SURFACES = [
  "engagement",
  "outreach",
  "team_portal_future",
] as const;
export type CallResultSurface = (typeof CALL_RESULT_SURFACES)[number];

export const CALL_RESULT_SIDE_EFFECTS = [
  "outreachCallCreated",
  "appointmentStatusUpdated",
  "journeyEventAppended",
  "executionCaseUpdated",
  "assignmentCompleted",
  "triageCaseUpserted",
  "followUpTaskCreated",
  "canonicalSpineEnsured",
] as const;
export type CallResultSideEffect = (typeof CALL_RESULT_SIDE_EFFECTS)[number];

/**
 * Ownership of each (surface × side-effect) cell.
 *
 *   "owned"      — surface invokes this side effect today (or under
 *                  the future delegation flag).
 *   "suppressed" — surface explicitly does NOT own this side effect.
 *                  Adapter marks step as skipped with reason
 *                  "surface does not own".
 *   "future"     — surface does not own today; under design (see
 *                  individual Ali-decision docs Batch D + Batch E).
 *   "out_of_band" — side effect is performed by a non-adapter path
 *                   (e.g. fire-and-forget canonical-spine sync from
 *                   the outreach route).
 */
export type OwnershipCell = "owned" | "suppressed" | "future" | "out_of_band";

export const CALL_RESULT_SIDE_EFFECT_OWNERSHIP_V2: Readonly<
  Record<CallResultSurface, Readonly<Record<CallResultSideEffect, OwnershipCell>>>
> = {
  engagement: {
    outreachCallCreated: "suppressed",
    appointmentStatusUpdated: "owned",
    journeyEventAppended: "owned",
    executionCaseUpdated: "owned",
    assignmentCompleted: "suppressed",
    triageCaseUpserted: "owned",
    followUpTaskCreated: "owned",
    canonicalSpineEnsured: "future",
  },
  outreach: {
    outreachCallCreated: "owned",
    appointmentStatusUpdated: "owned",
    journeyEventAppended: "suppressed",
    executionCaseUpdated: "suppressed",
    assignmentCompleted: "owned",
    triageCaseUpserted: "suppressed",
    followUpTaskCreated: "suppressed",
    canonicalSpineEnsured: "out_of_band",
  },
  team_portal_future: {
    outreachCallCreated: "owned",
    appointmentStatusUpdated: "owned",
    journeyEventAppended: "owned",
    executionCaseUpdated: "owned",
    assignmentCompleted: "owned",
    triageCaseUpserted: "owned",
    followUpTaskCreated: "owned",
    canonicalSpineEnsured: "out_of_band",
  },
};

/** Per-surface lookup helpers — used by the parity test. */
export function ownedSideEffects(surface: CallResultSurface): ReadonlyArray<CallResultSideEffect> {
  const row = CALL_RESULT_SIDE_EFFECT_OWNERSHIP_V2[surface];
  return CALL_RESULT_SIDE_EFFECTS.filter((se) => row[se] === "owned");
}
export function suppressedSideEffects(surface: CallResultSurface): ReadonlyArray<CallResultSideEffect> {
  const row = CALL_RESULT_SIDE_EFFECT_OWNERSHIP_V2[surface];
  return CALL_RESULT_SIDE_EFFECTS.filter((se) => row[se] === "suppressed");
}

// Import-time sanity check.
{
  const surfaceSeen = new Set<string>();
  for (const surface of CALL_RESULT_SURFACES) {
    if (surfaceSeen.has(surface)) throw new Error(`v2 matrix: duplicate surface "${surface}"`);
    surfaceSeen.add(surface);
    const row = CALL_RESULT_SIDE_EFFECT_OWNERSHIP_V2[surface];
    for (const se of CALL_RESULT_SIDE_EFFECTS) {
      if (!(se in row)) throw new Error(`v2 matrix: surface "${surface}" missing side effect "${se}"`);
    }
  }
}

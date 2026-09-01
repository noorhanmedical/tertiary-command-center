// Phase 2I — shared ACS (Ancillary Care Specialist) canonical view DTO.
//
// Ancillary-case operational and service-episode-centric: ONE row per exact
// ancillaryCaseId. No grouping by patient+service, screening+service, or
// facility/date; repeated same-service cases remain distinct rows. Read-only,
// clinic-scoped, bounded. `currentStage` is deterministic or null.

import {
  CANONICAL_STAGE_VECTOR_VERSION, type CaseStageVector, type CanonicalViewEnvelope,
  type StageAvailability,
} from "./canonicalStageVector";

export const ACS_CANONICAL_VIEW_VERSION = CANONICAL_STAGE_VECTOR_VERSION;
export const ACS_DEFAULT_LIMIT = 25;
export const ACS_MAX_LIMIT = 100;

/** One ACS row IS the exact ancillary-case stage vector (one row per case). */
export type AcsCaseRow = CaseStageVector;

export type AcsCanonicalView = CanonicalViewEnvelope<AcsCaseRow>;

/** Explicit disabled contract returned when the ACS flag is OFF — before reads. */
export function disabledAcsCanonicalView(generatedAt: string, limit: number): AcsCanonicalView {
  return {
    disabled: true, generatedAt, dataVersion: ACS_CANONICAL_VIEW_VERSION, clinicScoped: true,
    availability: "disabled_flag_off" as StageAvailability, warnings: [], rows: [],
    pageInfo: { limit, nextCursor: null, returned: 0 },
  };
}

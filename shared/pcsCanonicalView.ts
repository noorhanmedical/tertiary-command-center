// Phase 2I — shared PCS (Patient Care Specialist) canonical view DTO.
//
// Patient-CENTRIC but episode-PRESERVING: rows are grouped under one exact
// canonical patient identity (globalPlexusPatientId + patientClinicMembershipId),
// and every ancillaryCaseId is kept as a distinct child episode (repeated
// same-service episodes never merged). Read-only, clinic-scoped, bounded.

import {
  CANONICAL_STAGE_VECTOR_VERSION, type CaseStageVector, type CanonicalViewEnvelope,
  type StageAvailability,
} from "./canonicalStageVector";

export const PCS_CANONICAL_VIEW_VERSION = CANONICAL_STAGE_VECTOR_VERSION;
export const PCS_DEFAULT_LIMIT = 25;
export const PCS_MAX_LIMIT = 100;

/** One PCS patient group. Identity is opaque canonical ids; display fields are
 *  authorized display only. Episodes are the distinct stage vectors. */
export type PcsPatientGroup = {
  globalPlexusPatientId: number | null;
  patientClinicMembershipId: number | null;
  patientDisplay: string | null;
  patientDob: string | null;
  clinicMrn: string | null;
  identityAvailable: boolean;
  identityWarnings: string[];
  episodes: CaseStageVector[];
};

export type PcsCanonicalView = CanonicalViewEnvelope<PcsPatientGroup>;

/** Explicit disabled contract returned when the PCS flag is OFF — before reads. */
export function disabledPcsCanonicalView(generatedAt: string, limit: number): PcsCanonicalView {
  return {
    disabled: true, generatedAt, dataVersion: PCS_CANONICAL_VIEW_VERSION, clinicScoped: true,
    availability: "disabled_flag_off" as StageAvailability, warnings: [], rows: [],
    pageInfo: { limit, nextCursor: null, returned: 0 },
  };
}

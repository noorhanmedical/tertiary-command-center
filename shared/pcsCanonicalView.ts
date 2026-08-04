// Phase 2I — shared PCS (Patient Care Specialist) canonical view DTO.
//
// Patient-CENTRIC but episode-PRESERVING, and RETRIEVABLE: rows are grouped under
// one exact VERIFIED canonical patient identity (globalPlexusPatientId +
// patientClinicMembershipId, proven through an active same-clinic membership), and
// every ancillaryCaseId is kept as a distinct child episode (repeated same-service
// episodes never merged). Two independently-paginated streams (distinct cursors):
//   • verified patients   → `rows` + `pageInfo` (membership-id cursor); a single
//     patient whose episodes exceed the per-patient bound carries an
//     `episodesNextCursor` for a bounded episode continuation.
//   • identity-unresolved → `unresolved.rows` + `unresolved.pageInfo` (exact
//     ancillaryCaseId cursor). EVERY same-clinic case with an invalid membership
//     (null / missing / inactive / wrong-clinic / merged / conflicting patient /
//     non-current global patient) is surfaced here, never silently dropped, with
//     all identity/PHI fields null and its exact PHI-free warning, kept separate
//     by ancillaryCaseId.

import {
  CANONICAL_STAGE_VECTOR_VERSION, type CaseStageVector, type CanonicalViewEnvelope,
  type StageAvailability,
} from "./canonicalStageVector";

export const PCS_CANONICAL_VIEW_VERSION = CANONICAL_STAGE_VECTOR_VERSION;
export const PCS_DEFAULT_LIMIT = 25;
export const PCS_MAX_LIMIT = 100;
// Hard bound on episodes returned for ONE patient per page; the group carries an
// `episodesNextCursor` for the remainder (nested episode continuation).
export const PCS_MAX_EPISODES_PER_PATIENT = 100;
export const PCS_UNRESOLVED_DEFAULT_LIMIT = 50;
export const PCS_UNRESOLVED_MAX_LIMIT = 200;

// `returned` = rows actually returned in this page. `scanned` (optional) = rows
// examined to build the page (the unresolved stream scans over verified cases it
// skips, so scanned ≥ returned there). The cursor may advance over scanned-but-
// not-returned rows; the UI must describe `returned`, never `scanned`.
export type PcsPageInfo = { limit: number; nextCursor: string | null; returned: number; scanned?: number };

/** One PCS patient group. Identity is opaque canonical ids; display fields are
 *  authorized display only, and are non-null ONLY for a verified patient. */
export type PcsPatientGroup = {
  globalPlexusPatientId: number | null;
  patientClinicMembershipId: number | null;
  patientDisplay: string | null;
  patientDob: string | null;
  clinicMrn: string | null;
  identityAvailable: boolean;
  identityWarnings: string[];
  episodes: CaseStageVector[];
  // When this verified patient has more episodes than the per-page bound, an
  // opaque ancillaryCaseId cursor to fetch the remainder (else null).
  episodesNextCursor: string | null;
};

export type PcsCanonicalView = CanonicalViewEnvelope<PcsPatientGroup> & {
  // Separate, independently-cursored identity-unresolved stream.
  unresolved: { rows: PcsPatientGroup[]; pageInfo: PcsPageInfo };
};

/** Explicit disabled contract returned when the PCS flag is OFF — before reads. */
export function disabledPcsCanonicalView(generatedAt: string, limit: number): PcsCanonicalView {
  return {
    disabled: true, generatedAt, dataVersion: PCS_CANONICAL_VIEW_VERSION, clinicScoped: true,
    availability: "disabled_flag_off" as StageAvailability, warnings: [], rows: [],
    pageInfo: { limit, nextCursor: null, returned: 0 },
    unresolved: { rows: [], pageInfo: { limit: PCS_UNRESOLVED_DEFAULT_LIMIT, nextCursor: null, returned: 0 } },
  };
}

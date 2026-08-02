// Phase 2I — shared canonical lifecycle STAGE VECTOR for one ancillary-case
// episode. Server-computed truth rendered directly by PCS/ACS (never recomputed
// on the client). PHI-free: no document bodies, no note text, no global identity
// beyond the opaque ids the UI needs, no claims/invoice/payment/revenue fields.

import type { CodeCount, EngagementMembershipRow } from "./clinicianPortalOverview";

export type { CodeCount, EngagementMembershipRow };

export const CANONICAL_STAGE_VECTOR_VERSION = "canonical_stage_vector_v1";

/** Per-surface / per-section availability — never a silent zero. */
export type StageAvailability =
  | "available"
  | "disabled_flag_off"     // the Phase 2I surface flag is OFF
  | "upstream_flag_off"     // this stage's required upstream canonical flag is OFF
  | "migration_missing"     // a required canonical migration is not applied
  | "unavailable";          // this stage's read failed (ordinary, non-migration)

/** One canonical lifecycle stage. `available=false` + a truthful status/warnings
 *  is NEVER collapsed to a false "current" or a zero. */
export type StageStatus = {
  status: string | null;           // canonical stage status, or null when unresolved
  availability: StageAvailability;  // per-stage truth (upstream_flag_off / unavailable / available)
  available: boolean;               // convenience: availability === "available" AND a current source exists
  sourceId: number | null;          // exact source id for a same-clinic/case navigation, when safe
  at: string | null;                // ISO timestamp where applicable
  warnings: string[];               // PHI-free reason codes
};

export type EngagementStage = StageStatus & {
  memberships: EngagementMembershipRow[];
  lastSentAt: string | null;
};
export type BillingReadinessStage = StageStatus & {
  billingBlockers: CodeCount[];
  claimBlockers: CodeCount[];
};

export type CaseIdentity = {
  globalPlexusPatientId: number | null;
  patientClinicMembershipId: number | null;
  // Authorized display fields only (never identity). Null when unavailable.
  patientDisplay: string | null;
  patientDob: string | null;
  clinicMrn: string | null;
  available: boolean;               // exact canonical identity resolvable
  warnings: string[];
};

/** The 10-stage canonical vector for one distinct ancillary-case episode. */
export type CaseStageVector = {
  ancillaryCaseId: number;
  serviceType: string;
  lifecycleStatus: string | null;
  adminReviewStatus: string | null;
  identity: CaseIdentity;
  adminReview: StageStatus;
  engagement: EngagementStage;
  appointment: StageStatus;
  orderNote: StageStatus;
  procedure: StageStatus;
  report: StageStatus;
  procedureNote: StageStatus;
  signature: StageStatus;
  billingReadiness: BillingReadinessStage;
  billingDocument: StageStatus;
  // Deterministic earliest-incomplete stage key, or null when evidence is
  // conflicting/incomplete (an explicit integrity state — never most-advanced).
  currentStage: CanonicalStageKey | null;
  currentStageIntegrity: "resolved" | "unresolved" | "conflicting";
};

/** Canonical stage order — the ONLY basis for a deterministic currentStage. */
export const CANONICAL_STAGE_ORDER = [
  "adminReview",
  "engagement",
  "appointment",
  "orderNote",
  "procedure",
  "report",
  "procedureNote",
  "signature",
  "billingReadiness",
  "billingDocument",
] as const;
export type CanonicalStageKey = (typeof CANONICAL_STAGE_ORDER)[number];

/** Shared paginated envelope for a canonical surface read model. */
export type CanonicalViewEnvelope<Row> = {
  disabled: boolean;
  generatedAt: string;
  dataVersion: string;
  clinicScoped: true;
  availability: StageAvailability;   // section-level availability of the row set
  warnings: string[];
  rows: Row[];
  pageInfo: { limit: number; nextCursor: string | null; returned: number };
};

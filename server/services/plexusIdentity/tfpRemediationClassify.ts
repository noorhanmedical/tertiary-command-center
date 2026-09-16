/**
 * PURE classification + guards for the one-time TFP identity remediation
 * (Option B — full canonical identity build for the 1,819 contaminated,
 * clinic-null screenings from import job 124).
 *
 * No DB, no I/O — so the decision logic is unit-testable in isolation. The
 * remediation SCRIPT (script/remediateTfpIdentity.ts) wires this to the live
 * DB + the canonical identity orchestrator.
 *
 * Contamination shape being corrected:
 *   patient_screenings.mrn currently holds the 43-char EXTERNAL Patient ID
 *   (== source file `patient_id`). The true 5–6 char MRN lives only in the
 *   source file `mrn` column. Remediation writes the true MRN onto the
 *   screening + membership and preserves the external id as `ehr_patient_id`.
 */

export type RemediationRowState = {
  screeningId: number;
  /** current patient_screenings.mrn (contaminated pre-remediation) */
  dbMrn: string | null;
  dbClinicId: number | null;
  dbMembershipId: number | null;
  dbGlobalId: number | null;
  /** true MRN from the authoritative source file */
  sourceMrn: string | null;
  /** external Patient ID from the authoritative source file */
  sourcePatientId: string | null;
  /** true when this screeningId is on the explicit manual-review hold list */
  isOutlier: boolean;
};

export type RemediationClassification =
  | "SAFE_REMEDIATE"
  | "ALREADY_REMEDIATED"
  | "OUTLIER_MANUAL_REVIEW"
  | "BLOCKED_MISSING_SOURCE"
  | "BLOCKED_UNEXPECTED_STATE";

export type RemediationDecision = {
  classification: RemediationClassification;
  reason: string;
};

const norm = (s: string | null | undefined): string => (s ?? "").trim();

/**
 * Decide what to do with a single matched (source ↔ screening) row. Deterministic
 * and side-effect-free. The script re-checks these preconditions immediately
 * before every write.
 */
export function classifyRemediation(row: RemediationRowState): RemediationDecision {
  // 1. The known outlier is NEVER auto-touched.
  if (row.isOutlier) {
    return { classification: "OUTLIER_MANUAL_REVIEW", reason: "explicit_outlier_hold" };
  }

  const dbMrn = norm(row.dbMrn);
  const srcMrn = norm(row.sourceMrn);
  const srcPid = norm(row.sourcePatientId);

  // 2. Source must carry BOTH the true MRN and the external Patient ID, and
  //    they MUST be distinct (never fold Patient ID into MRN).
  if (!srcMrn || !srcPid) {
    return { classification: "BLOCKED_MISSING_SOURCE", reason: "missing_source_mrn_or_patient_id" };
  }
  if (srcMrn === srcPid) {
    return { classification: "BLOCKED_UNEXPECTED_STATE", reason: "source_mrn_equals_patient_id" };
  }

  // 3. Idempotency: fully remediated already (MRN corrected AND linked).
  if (dbMrn === srcMrn && row.dbMembershipId != null && row.dbGlobalId != null) {
    return { classification: "ALREADY_REMEDIATED", reason: "mrn_corrected_and_linked" };
  }

  // 4. Safe to remediate: the canonical contamination pattern (DB.mrn holds the
  //    external Patient ID), OR a resumable partial (MRN already corrected but
  //    identity linkage not yet complete).
  if (dbMrn === srcPid) {
    return { classification: "SAFE_REMEDIATE", reason: "contaminated_mrn_equals_source_patient_id" };
  }
  if (dbMrn === srcMrn) {
    return { classification: "SAFE_REMEDIATE", reason: "resume_mrn_corrected_linkage_incomplete" };
  }

  // 5. Anything else is an unexpected state — never guess.
  return { classification: "BLOCKED_UNEXPECTED_STATE", reason: "db_mrn_matches_neither_source_value" };
}

/**
 * MRN collision guard (pure). Given the target true MRN and an index of
 * currently-owned (clinic-scoped) MRNs → membershipId, decide whether writing
 * the target would collide with a DIFFERENT membership. Comparison is
 * case-insensitive/trim (mirrors normalizeMrn's uppercase+trim).
 */
export function wouldMrnCollide(args: {
  targetMrn: string;
  clinicId: number;
  /** map of `${clinicId}::${UPPER(trimmed mrn)}` -> owning membershipId */
  ownedByClinicMrn: Map<string, number>;
  /** the membership this screening already owns, if any (self is not a collision) */
  selfMembershipId: number | null;
}): boolean {
  const key = `${args.clinicId}::${args.targetMrn.replace(/\s+/g, " ").trim().toUpperCase()}`;
  const owner = args.ownedByClinicMrn.get(key);
  if (owner == null) return false;
  return owner !== args.selfMembershipId;
}

/**
 * External Patient ID (ehr_patient_id) collision guard (pure). Given the set of
 * global patient ids that already own an ehr_patient_id with this normalized
 * value, writing is safe iff that set is empty OR it is exactly {selfGlobalId}.
 * A value owned by a DIFFERENT global patient is a hard block (never reassign).
 */
export function wouldExternalIdCollide(args: {
  ownerGlobalIds: number[];
  selfGlobalId: number | null;
}): boolean {
  const others = args.ownerGlobalIds.filter((g) => g !== args.selfGlobalId);
  return others.length > 0;
}

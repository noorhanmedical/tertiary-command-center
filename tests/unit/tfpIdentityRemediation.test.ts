// Focused tests for the PURE TFP identity-remediation classifier + guards.
// No DB. Covers: contaminated->safe, already-remediated (idempotent),
// outlier hold, missing/degenerate source blocks, unexpected-state block,
// MRN collision guard, and ehr_patient_id collision guard.
import assert from "node:assert/strict";
import {
  classifyRemediation,
  wouldMrnCollide,
  wouldExternalIdCollide,
  type RemediationRowState,
} from "../../server/services/plexusIdentity/tfpRemediationClassify";

const base: RemediationRowState = {
  screeningId: 1000,
  dbMrn: "EXT-43CHAR-ID",       // contaminated: holds the external Patient ID
  dbClinicId: null,
  dbMembershipId: null,
  dbGlobalId: null,
  sourceMrn: "A12345",           // true MRN
  sourcePatientId: "EXT-43CHAR-ID",
  isOutlier: false,
};

function main() {
  // 1. canonical contamination -> SAFE_REMEDIATE
  {
    const d = classifyRemediation(base);
    assert.equal(d.classification, "SAFE_REMEDIATE");
    assert.equal(d.reason, "contaminated_mrn_equals_source_patient_id");
  }

  // 2. outlier is always held, even if it otherwise looks contaminated
  {
    const d = classifyRemediation({ ...base, isOutlier: true });
    assert.equal(d.classification, "OUTLIER_MANUAL_REVIEW");
  }

  // 3. fully remediated (mrn corrected + linked) -> ALREADY_REMEDIATED (idempotent)
  {
    const d = classifyRemediation({ ...base, dbMrn: "A12345", dbMembershipId: 55, dbGlobalId: 77 });
    assert.equal(d.classification, "ALREADY_REMEDIATED");
  }

  // 3b. mrn corrected but linkage incomplete -> resumable SAFE_REMEDIATE
  {
    const d = classifyRemediation({ ...base, dbMrn: "A12345", dbMembershipId: null, dbGlobalId: null });
    assert.equal(d.classification, "SAFE_REMEDIATE");
    assert.equal(d.reason, "resume_mrn_corrected_linkage_incomplete");
  }

  // 4. missing source values -> BLOCKED_MISSING_SOURCE
  {
    assert.equal(classifyRemediation({ ...base, sourceMrn: null }).classification, "BLOCKED_MISSING_SOURCE");
    assert.equal(classifyRemediation({ ...base, sourcePatientId: "" }).classification, "BLOCKED_MISSING_SOURCE");
  }

  // 4b. degenerate source where MRN == Patient ID -> BLOCKED (never fold)
  {
    const d = classifyRemediation({ ...base, sourceMrn: "SAME", sourcePatientId: "SAME", dbMrn: "SAME" });
    assert.equal(d.classification, "BLOCKED_UNEXPECTED_STATE");
    assert.equal(d.reason, "source_mrn_equals_patient_id");
  }

  // 5. db.mrn matches neither source value -> BLOCKED_UNEXPECTED_STATE (the outlier shape)
  {
    const d = classifyRemediation({ ...base, dbMrn: "SOMETHING-ELSE" });
    assert.equal(d.classification, "BLOCKED_UNEXPECTED_STATE");
    assert.equal(d.reason, "db_mrn_matches_neither_source_value");
  }

  // 6. MRN collision guard
  {
    const owned = new Map<string, number>([["1::A12345", 500]]);
    // same membership owns it -> not a collision
    assert.equal(wouldMrnCollide({ targetMrn: "a12345", clinicId: 1, ownedByClinicMrn: owned, selfMembershipId: 500 }), false);
    // different membership owns it -> collision
    assert.equal(wouldMrnCollide({ targetMrn: "A12345", clinicId: 1, ownedByClinicMrn: owned, selfMembershipId: 999 }), true);
    // unowned -> safe
    assert.equal(wouldMrnCollide({ targetMrn: "B99999", clinicId: 1, ownedByClinicMrn: owned, selfMembershipId: null }), false);
    // same value, different clinic -> not a collision (MRN is clinic-scoped)
    assert.equal(wouldMrnCollide({ targetMrn: "A12345", clinicId: 3, ownedByClinicMrn: owned, selfMembershipId: null }), false);
  }

  // 7. external ehr_patient_id collision guard
  {
    assert.equal(wouldExternalIdCollide({ ownerGlobalIds: [], selfGlobalId: null }), false);
    assert.equal(wouldExternalIdCollide({ ownerGlobalIds: [42], selfGlobalId: 42 }), false); // idempotent self
    assert.equal(wouldExternalIdCollide({ ownerGlobalIds: [7], selfGlobalId: 42 }), true);   // owned by another global
  }

  console.log("tfpIdentityRemediation.test.ts — all assertions passed");
}

main();

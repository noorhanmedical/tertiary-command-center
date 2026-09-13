// Unit tests for the RESUMABLE confirm decision logic (production hardening).
// Pure — no DB. Covers the partial-package-recovery matrix, retry-safe survivor
// classification, the clinic tenant gate, and derived operation completion.
//
// Run: npx tsx tests/unit/callListPartialRecovery.test.ts

import assert from "node:assert/strict";
import {
  classifyMappingEntry,
  reconcilePackages,
  deriveOperationStatus,
} from "../../shared/engagement/callListReconcile";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("callListPartialRecovery:");

// ── Partial package recovery matrix (expected members A=1, B=2, C=3) ────────
check("recovery: zero packages exist → all created", () => {
  const plan = reconcilePackages([1, 2, 3], []);
  assert.deepEqual(plan.toCreate, [1, 2, 3]);
  assert.deepEqual(plan.toReuse, []);
});

check("recovery: one of three exists → remaining two created", () => {
  const plan = reconcilePackages([1, 2, 3], [1]);
  assert.deepEqual(plan.toCreate, [2, 3]);
  assert.deepEqual(plan.toReuse, [1]);
});

check("recovery: two of three exist → remaining one created", () => {
  const plan = reconcilePackages([1, 2, 3], [1, 2]);
  assert.deepEqual(plan.toCreate, [3]);
  assert.deepEqual(plan.toReuse, [1, 2]);
});

check("recovery: all exist → idempotent (nothing created)", () => {
  const plan = reconcilePackages([1, 2, 3], [1, 2, 3]);
  assert.deepEqual(plan.toCreate, []);
  assert.deepEqual(plan.toReuse, [1, 2, 3]);
});

check("recovery: duplicate retry never re-creates + never double-counts", () => {
  const plan = reconcilePackages([1, 2, 3], [3, 2, 1]);
  // no member ever appears in both lists (no duplicate package membership)
  const overlap = plan.toCreate.filter((m) => plan.toReuse.includes(m));
  assert.deepEqual(overlap, []);
  // union covers exactly the expected set
  assert.deepEqual([...plan.toCreate, ...plan.toReuse].sort(), [1, 2, 3]);
});

// ── Operation completion state ──────────────────────────────────────────────
check("operationStatus: incomplete when a member still lacks a package", () => {
  assert.equal(deriveOperationStatus(3, 2), "assignment_complete_package_incomplete");
  assert.equal(deriveOperationStatus(3, 0), "assignment_complete_package_incomplete");
});

check("operationStatus: fully_complete when every expected member packaged", () => {
  assert.equal(deriveOperationStatus(3, 3), "fully_complete");
  assert.equal(deriveOperationStatus(0, 0), "fully_complete");
});

// ── Retry-safe survivor classification ──────────────────────────────────────
const adminClinics: number[] | null = null; // admin: no clinic narrowing
const mgrClinics = [1];

check("survivor: eligible + unassigned → survivor (first run)", () => {
  assert.equal(
    classifyMappingEntry({
      loadedExists: true,
      caseClinicId: 1,
      allowedClinicIds: mgrClinics,
      eligible: true,
      assignedTeamMemberId: null,
      intendedTeamMemberId: 10,
    }),
    "survivor",
  );
});

check("survivor: already assigned to intended member stays survivor even if ineligible now (RETRY)", () => {
  // The canonical assignment already stands; its package must be completable.
  assert.equal(
    classifyMappingEntry({
      loadedExists: true,
      caseClinicId: 1,
      allowedClinicIds: mgrClinics,
      eligible: false, // e.g. an external change would now fail the gate
      assignedTeamMemberId: 10,
      intendedTeamMemberId: 10,
    }),
    "survivor",
  );
});

check("conflict: never-assigned + ineligible → ineligible_conflict (never replaced)", () => {
  assert.equal(
    classifyMappingEntry({
      loadedExists: true,
      caseClinicId: 1,
      allowedClinicIds: mgrClinics,
      eligible: false,
      assignedTeamMemberId: null,
      intendedTeamMemberId: 10,
    }),
    "ineligible_conflict",
  );
});

check("conflict: missing case row → ineligible_conflict", () => {
  assert.equal(
    classifyMappingEntry({
      loadedExists: false,
      caseClinicId: null,
      allowedClinicIds: adminClinics,
      eligible: true,
      assignedTeamMemberId: null,
      intendedTeamMemberId: 10,
    }),
    "ineligible_conflict",
  );
});

// ── Clinic tenant gate ──────────────────────────────────────────────────────
check("clinic gate: manager, wrong clinic → clinic_conflict", () => {
  assert.equal(
    classifyMappingEntry({
      loadedExists: true,
      caseClinicId: 2, // not in mgrClinics [1]
      allowedClinicIds: mgrClinics,
      eligible: true,
      assignedTeamMemberId: null,
      intendedTeamMemberId: 10,
    }),
    "clinic_conflict",
  );
});

check("clinic gate: manager, null case clinic → clinic_conflict (fail-closed)", () => {
  assert.equal(
    classifyMappingEntry({
      loadedExists: true,
      caseClinicId: null,
      allowedClinicIds: mgrClinics,
      eligible: true,
      assignedTeamMemberId: 10,
      intendedTeamMemberId: 10,
    }),
    "clinic_conflict",
  );
});

check("clinic gate: admin (null allowedClinicIds) bypasses clinic narrowing", () => {
  assert.equal(
    classifyMappingEntry({
      loadedExists: true,
      caseClinicId: 999,
      allowedClinicIds: adminClinics,
      eligible: true,
      assignedTeamMemberId: null,
      intendedTeamMemberId: 10,
    }),
    "survivor",
  );
});

console.log(`\ncallListPartialRecovery: ${passed} checks passed\n`);

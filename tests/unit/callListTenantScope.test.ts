// Unit tests for the defense-in-depth CLINIC + facility tenant checks on the
// Engagement call-list package surface (production hardening). Pure given a
// ManagerScope + resolved clinic-id set. The DB-backed clinicIdsInScope is
// exercised in the acceptance/auth suite.
//
// Run: npx tsx tests/unit/callListTenantScope.test.ts

import assert from "node:assert/strict";
import {
  clinicInScope,
  packageInScope,
  packageFacilityInScope,
} from "../../server/services/engagement/callListAuthz";
import type { ManagerScope } from "../../server/services/teams/managerScope";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const admin: ManagerScope = { isAdmin: true, teamIds: [], userIds: new Set(), facilityIds: new Set() };
const mgrA: ManagerScope = { isAdmin: false, teamIds: [1], userIds: new Set(["u1"]), facilityIds: new Set(["Clinic A"]) };
const mgrNone: ManagerScope = { isAdmin: false, teamIds: [], userIds: new Set(), facilityIds: new Set() };

// mgrA is authorized for clinic id 1 only.
const mgrAClinics = new Set<number>([1]);
const adminClinics = null; // admin sentinel = all clinics

console.log("callListTenantScope:");

check("clinicInScope — admin sees all clinics", () => {
  assert.equal(clinicInScope(admin, adminClinics, 1), true);
  assert.equal(clinicInScope(admin, adminClinics, 999), true);
  assert.equal(clinicInScope(admin, adminClinics, null), true);
});

check("clinicInScope — manager only own clinics; null/unknown fail-closed", () => {
  assert.equal(clinicInScope(mgrA, mgrAClinics, 1), true);
  assert.equal(clinicInScope(mgrA, mgrAClinics, 2), false);
  assert.equal(clinicInScope(mgrA, mgrAClinics, null), false); // never assume facility uniqueness
});

check("packageInScope — correct clinic AND facility succeeds", () => {
  assert.equal(packageInScope(mgrA, mgrAClinics, { facilityId: "Clinic A", clinicId: 1 }), true);
});

check("packageInScope — wrong facility fails (even with right clinic)", () => {
  assert.equal(packageInScope(mgrA, mgrAClinics, { facilityId: "Clinic B", clinicId: 1 }), false);
});

check("packageInScope — CORRECT-LOOKING facility but WRONG clinic fails", () => {
  // The key defense-in-depth case: facility string matches scope but the
  // package belongs to a different clinic → denied.
  assert.equal(packageInScope(mgrA, mgrAClinics, { facilityId: "Clinic A", clinicId: 2 }), false);
});

check("packageInScope — null package clinic fails closed for a manager", () => {
  assert.equal(packageInScope(mgrA, mgrAClinics, { facilityId: "Clinic A", clinicId: null }), false);
});

check("packageInScope — manager with no scope is denied", () => {
  assert.equal(packageInScope(mgrNone, new Set<number>(), { facilityId: "Clinic A", clinicId: 1 }), false);
});

check("packageInScope — admin unchanged (cross-clinic allowed)", () => {
  assert.equal(packageInScope(admin, adminClinics, { facilityId: "Clinic Z", clinicId: 42 }), true);
  assert.equal(packageInScope(admin, adminClinics, { facilityId: "Clinic Z", clinicId: null }), true);
});

check("facility check still independently enforced", () => {
  assert.equal(packageFacilityInScope(mgrA, "Clinic A"), true);
  assert.equal(packageFacilityInScope(mgrA, "Clinic B"), false);
});

console.log(`\ncallListTenantScope: ${passed} checks passed\n`);

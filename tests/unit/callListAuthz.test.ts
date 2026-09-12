// Unit tests for scope-bound authorization helpers (Task 1 hardening).
// PURE given a ManagerScope — the DB-backed resolveManagerScope /
// schedulerIdsInScope are exercised in the acceptance/auth suite (Task 8).
//
// Run: DATABASE_URL='postgres://u:p@localhost:5432/x' npx tsx tests/unit/callListAuthz.test.ts

import assert from "node:assert/strict";
import {
  facilityInScope,
  packageFacilityInScope,
  allMembersInScope,
  resolveListFacilityScope,
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

console.log("callListAuthz:");

check("facilityInScope — admin sees all; manager only own facilities", () => {
  assert.equal(facilityInScope(admin, "Clinic A"), true);
  assert.equal(facilityInScope(admin, "Clinic B"), true);
  assert.equal(facilityInScope(mgrA, "Clinic A"), true);
  assert.equal(facilityInScope(mgrA, "Clinic B"), false);
  assert.equal(facilityInScope(mgrA, ""), false);
  assert.equal(facilityInScope(mgrA, null), false);
  assert.equal(facilityInScope(mgrNone, "Clinic A"), false);
});

check("packageFacilityInScope mirrors facility scope", () => {
  assert.equal(packageFacilityInScope(admin, "Clinic B"), true);
  assert.equal(packageFacilityInScope(mgrA, "Clinic A"), true);
  assert.equal(packageFacilityInScope(mgrA, "Clinic B"), false);
  assert.equal(packageFacilityInScope(mgrA, null), false);
});

check("allMembersInScope — admin any; manager only in-scope roster ids", () => {
  // admin (allowedSchedulerIds null) → always true
  assert.equal(allMembersInScope(admin, [1, 2, 3], null), true);
  // manager with roster ids [10,11]
  assert.equal(allMembersInScope(mgrA, [10, 11], [10, 11]), true);
  assert.equal(allMembersInScope(mgrA, [10, 12], [10, 11]), false);
  // manager with empty roster set → any non-empty mapping denied
  assert.equal(allMembersInScope(mgrA, [10], []), false);
  assert.equal(allMembersInScope(mgrA, [], []), true);
});

check("resolveListFacilityScope — admin", () => {
  assert.deepEqual(resolveListFacilityScope(admin, "Clinic B"), { facilityIds: ["Clinic B"] });
  assert.deepEqual(resolveListFacilityScope(admin, null), { facilityIds: null });
});

check("resolveListFacilityScope — manager", () => {
  // specific facility honored (route separately verifies it's in scope)
  assert.deepEqual(resolveListFacilityScope(mgrA, "Clinic A"), { facilityIds: ["Clinic A"] });
  // no facility → restricted to the manager's own facility set (fail-closed if empty)
  assert.deepEqual(resolveListFacilityScope(mgrA, null), { facilityIds: ["Clinic A"] });
  assert.deepEqual(resolveListFacilityScope(mgrNone, null), { facilityIds: [] });
});

console.log(`\ncallListAuthz: ${passed} checks passed\n`);

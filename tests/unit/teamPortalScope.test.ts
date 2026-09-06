// Focused tests for the multi-clinic Team Portal scope resolution.
//
// Runs standalone (no DB):
//   npx tsx tests/unit/teamPortalScope.test.ts

import assert from "node:assert/strict";
import {
  resolvePerClinicCapabilities,
  capabilityForClinic,
  hasAnyTeamCapability,
  resolveAuthorizedFacilities,
  resolveRosterIdsForFacilities,
  resolveRequestedFacilityScope,
  type TeamMembershipLite,
} from "../../server/services/teamPortalScope.pure";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n    ${(err as Error).message}`);
  }
}

const AUTH = ["Clinic A", "Clinic B", "Clinic C"];

// Callista: PCS@A, ACS@B, both@C (facility-scoped teams).
const callista: TeamMembershipLite[] = [
  { teamType: "PCS", facilityId: "Clinic A", active: true },
  { teamType: "ACS", facilityId: "Clinic B", active: true },
  { teamType: "PCS", facilityId: "Clinic C", active: true },
  { teamType: "ACS", facilityId: "Clinic C", active: true },
];

check("per-clinic capability maps each facility-scoped team correctly", () => {
  const caps = resolvePerClinicCapabilities(callista, AUTH);
  assert.deepEqual(caps["Clinic A"], { pcs: true, acs: false });
  assert.deepEqual(caps["Clinic B"], { pcs: false, acs: true });
  assert.deepEqual(caps["Clinic C"], { pcs: true, acs: true });
});

check("clinic with no PCS/ACS team seeds to both-false (still listed)", () => {
  const caps = resolvePerClinicCapabilities(
    [{ teamType: "PCS", facilityId: "Clinic A", active: true }],
    AUTH,
  );
  assert.deepEqual(caps["Clinic B"], { pcs: false, acs: false });
  assert.deepEqual(caps["Clinic C"], { pcs: false, acs: false });
});

check("org-wide team (null facilityId) applies to all authorized facilities", () => {
  const caps = resolvePerClinicCapabilities(
    [{ teamType: "PCS", facilityId: null, active: true }],
    AUTH,
  );
  for (const f of AUTH) assert.equal(caps[f].pcs, true, `${f} pcs`);
});

check("inactive membership is ignored", () => {
  const caps = resolvePerClinicCapabilities(
    [{ teamType: "ACS", facilityId: "Clinic A", active: false }],
    AUTH,
  );
  assert.deepEqual(caps["Clinic A"], { pcs: false, acs: false });
});

// CASE 9 — procedure completion is clinic-specific.
check("CASE 9: ACS@A can complete procedure at A, not at B", () => {
  const caps = resolvePerClinicCapabilities(callista, AUTH);
  const any = hasAnyTeamCapability(callista);
  const atB = capabilityForClinic(caps, "Clinic B", { hasAnyTeamCapability: any });
  const atC = capabilityForClinic(caps, "Clinic C", { hasAnyTeamCapability: any });
  assert.equal(atB.acs, true, "Callista is ACS at B → can complete at B");
  // A PCS-only clinic:
  const atA = capabilityForClinic(caps, "Clinic A", { hasAnyTeamCapability: any });
  assert.equal(atA.acs, false, "PCS-only at A → cannot complete procedure at A");
  assert.equal(atC.acs, true, "both at C → can complete at C");
});

check("no team for a clinic → no specialist capability when team model in use", () => {
  const caps = resolvePerClinicCapabilities(
    [{ teamType: "PCS", facilityId: "Clinic A", active: true }],
    AUTH,
  );
  const cap = capabilityForClinic(caps, "Clinic Z", { hasAnyTeamCapability: true });
  assert.deepEqual(cap, { pcs: false, acs: false });
});

check("legacy fallback: no teams at all → derive from global workspaceType", () => {
  const caps = resolvePerClinicCapabilities([], AUTH);
  const acs = capabilityForClinic(caps, "Clinic A", {
    hasAnyTeamCapability: false,
    globalWorkspaceType: "ancillaryCareSpecialist",
  });
  assert.deepEqual(acs, { pcs: false, acs: true });
  const pcs = capabilityForClinic(caps, "Clinic A", {
    hasAnyTeamCapability: false,
    globalWorkspaceType: "patientCareSpecialist",
  });
  assert.deepEqual(pcs, { pcs: true, acs: false });
});

check("authorized facilities = union of roster + coverage + team facilities", () => {
  const auth = resolveAuthorizedFacilities({
    rosterFacilities: ["Clinic A", "Clinic B"],
    coverageFacilities: ["Clinic B", "Clinic C"],
    teamFacilities: ["Clinic C", "Clinic D"],
  });
  assert.deepEqual(auth, ["Clinic A", "Clinic B", "Clinic C", "Clinic D"]);
});

const roster = [
  { id: 11, userId: "u1", facility: "Clinic A" },
  { id: 12, userId: "u1", facility: "Clinic B" },
  { id: 13, userId: "u2", facility: "Clinic A" },
  { id: 14, userId: "u1", facility: "Clinic C" },
];

check("roster ids resolve to the user's rows across included facilities", () => {
  assert.deepEqual(resolveRosterIdsForFacilities(roster, "u1", null), [11, 12, 14]);
  assert.deepEqual(resolveRosterIdsForFacilities(roster, "u1", ["Clinic B"]), [12]);
  assert.deepEqual(resolveRosterIdsForFacilities(roster, "u2", null), [13]);
});

// CASE 4 / CASE 5 — requested clinic filter vs All Clinics.
check("CASE 5: no requested clinic → all authorized facilities", () => {
  const r = resolveRequestedFacilityScope(AUTH, null);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.facilityIds, AUTH);
});

check("CASE 4: requested authorized clinic → only that clinic", () => {
  const r = resolveRequestedFacilityScope(AUTH, "Clinic B");
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.facilityIds, ["Clinic B"]);
});

check("requested UNauthorized clinic → not ok (403)", () => {
  const r = resolveRequestedFacilityScope(AUTH, "Clinic Z");
  assert.equal(r.ok, false);
});

if (failures > 0) {
  console.error(`\nteamPortalScope.test.ts: ${failures} test(s) FAILED`);
  process.exit(1);
}
console.log("teamPortalScope.test.ts: all tests passed");

// QA for ACS capability onboarding.
//
// Run with: `npm run qa:acs-capability-onboarding`. No DB
// required.
//
// Asserts:
//   - ancillaryCareSpecialist profile + capability defaults exist
//     in shared/teamMemberProfile.ts.
//   - All five canonical capability ids are declared.
//   - admin-users.tsx editor references every ACS capability key
//     and respects the isAncillary gate on procedure-side toggles.
//   - allowedServiceTypes + assignedFacilityIds are represented in
//     the editor.
//   - resolvePortalCapabilities() returns the safe defaults when a
//     missing-profile scenario is simulated.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  TEAM_MEMBER_CAPABILITY_IDS,
  defaultPatientCareSpecialistProfile,
  defaultAncillaryCareSpecialistProfile,
} from "../shared/teamMemberProfile";
import { defaultSafePortalCapabilities } from "../client/src/lib/portal/portalCapabilities";

let passes = 0;
let failures = 0;
function assert(cond: unknown, label: string) {
  if (cond) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

function readFile(path: string): string {
  try {
    return readFileSync(resolve(process.cwd(), path), "utf8");
  } catch {
    return "";
  }
}

function main() {
  console.log("\n--- canonical capability ids exist ---");
  for (const id of [
    "callAndSchedule",
    "completeProcedure",
    "primaryConsentScreening",
    "uploadProcedureReport",
    "viewAllFacilities",
  ]) {
    assert(
      (TEAM_MEMBER_CAPABILITY_IDS as readonly string[]).includes(id),
      `TEAM_MEMBER_CAPABILITY_IDS contains "${id}"`,
    );
  }

  console.log("\n--- ACS profile defaults ---");
  assert(
    defaultAncillaryCareSpecialistProfile.workspaceType === "ancillaryCareSpecialist",
    "ACS default profile has workspaceType ancillaryCareSpecialist",
  );
  assert(
    defaultAncillaryCareSpecialistProfile.capabilities.callAndSchedule === true,
    "ACS default callAndSchedule = true",
  );
  assert(
    defaultAncillaryCareSpecialistProfile.capabilities.completeProcedure === true,
    "ACS default completeProcedure = true",
  );
  assert(
    defaultAncillaryCareSpecialistProfile.capabilities.primaryConsentScreening === true,
    "ACS default primaryConsentScreening = true",
  );
  assert(
    defaultAncillaryCareSpecialistProfile.capabilities.uploadProcedureReport === true,
    "ACS default uploadProcedureReport = true",
  );
  assert(
    defaultAncillaryCareSpecialistProfile.assignedFacilityIds.length === 0,
    "ACS default assignedFacilityIds is empty (admin must opt-in per onboarding runbook)",
  );

  console.log("\n--- PCS profile defaults ---");
  assert(
    defaultPatientCareSpecialistProfile.workspaceType === "patientCareSpecialist",
    "PCS default profile has workspaceType patientCareSpecialist",
  );
  assert(
    defaultPatientCareSpecialistProfile.capabilities.completeProcedure === false,
    "PCS default completeProcedure = false (defense-in-depth)",
  );
  assert(
    defaultPatientCareSpecialistProfile.capabilities.primaryConsentScreening === false,
    "PCS default primaryConsentScreening = false",
  );
  assert(
    defaultPatientCareSpecialistProfile.capabilities.uploadProcedureReport === false,
    "PCS default uploadProcedureReport = false",
  );

  console.log("\n--- admin-users.tsx editor references every capability ---");
  const adminUsers = readFile("client/src/pages/admin-users.tsx");
  for (const id of [
    "callAndSchedule",
    "completeProcedure",
    "primaryConsentScreening",
    "uploadProcedureReport",
    "viewAllFacilities",
  ]) {
    assert(
      adminUsers.includes(`profile.capabilities.${id}`) ||
        adminUsers.includes(`"${id}"`),
      `admin-users.tsx references capability "${id}"`,
    );
  }

  console.log("\n--- editor respects isAncillary gate on procedure-side toggles ---");
  // The procedure-side checkboxes must be gated by isAncillary so
  // PCS profiles can't toggle them on.
  const isAncillaryGated = /disabled=\{!isAncillary\}/g;
  const matches = adminUsers.match(isAncillaryGated) ?? [];
  assert(
    matches.length >= 3,
    `editor disables at least three procedure-side toggles when !isAncillary (found ${matches.length})`,
  );
  assert(
    /isAncillary\s*=\s*profile\.workspaceType\s*===\s*"ancillaryCareSpecialist"/.test(adminUsers),
    "isAncillary derives from workspaceType === ancillaryCareSpecialist",
  );

  console.log("\n--- assignedFacilityIds + allowedServiceTypes in editor ---");
  assert(
    /assignedFacilityIds/.test(adminUsers),
    "editor manages assignedFacilityIds",
  );
  assert(
    /allowedServiceTypes/.test(adminUsers),
    "editor manages allowedServiceTypes",
  );

  console.log("\n--- safe defaults when profile is missing ---");
  const pcsSafe = defaultSafePortalCapabilities("patientCareSpecialist");
  assert(
    !pcsSafe.canMarkProcedureCompleted,
    "missing PCS profile → cannot mark procedure complete",
  );
  assert(
    pcsSafe.canUseCallList,
    "missing PCS profile → can still use call list",
  );
  const acsSafe = defaultSafePortalCapabilities("ancillaryCareSpecialist");
  assert(
    acsSafe.canMarkProcedureCompleted,
    "missing ACS profile → can mark procedure complete (default true on ACS)",
  );
  assert(
    acsSafe.canAddSameDayAncillary,
    "missing ACS profile → can add same-day ancillary",
  );

  console.log("\n--- onboarding audit doc exists ---");
  const auditDoc = readFile("docs/architecture/acs-capability-onboarding-audit.md");
  assert(auditDoc.length > 0, "acs-capability-onboarding-audit.md exists");
  assert(
    /assignedFacilityIds/.test(auditDoc),
    "audit doc names assignedFacilityIds risk",
  );

  console.log("\n=========================");
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log("=========================");
  process.exit(failures > 0 ? 1 : 0);
}

main();

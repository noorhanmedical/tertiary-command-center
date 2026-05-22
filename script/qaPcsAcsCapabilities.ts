// QA for the PCS/ACS portal capability resolver.
//
// Run with: `npm run qa:pcs-acs-capabilities`. No DB required.
// Pure-function tests against `resolvePortalCapabilities`.

import {
  resolvePortalCapabilities,
  defaultSafePortalCapabilities,
} from "../client/src/lib/portal/portalCapabilities";
import {
  defaultPatientCareSpecialistProfile,
  defaultAncillaryCareSpecialistProfile,
} from "../shared/teamMemberProfile";

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

function main() {
  // ─── PCS defaults ────────────────────────────────────────────────
  console.log("\n--- PCS with default profile ---");
  const pcs = resolvePortalCapabilities({
    workspaceType: "patientCareSpecialist",
    profile: defaultPatientCareSpecialistProfile,
  });
  assert(pcs.canUseCallList, "PCS can use call list");
  assert(pcs.canCreateCallback, "PCS can create callback");
  assert(pcs.canScheduleClinicVisit, "PCS can schedule clinic visit");
  assert(pcs.canScheduleAncillary, "PCS can schedule ancillary (server arbitrates)");
  assert(pcs.canForwardToScheduler, "PCS can forward to scheduler");
  assert(!pcs.canMarkProcedureCompleted, "PCS cannot mark procedure complete by default");
  assert(!pcs.canAddSameDayAncillary, "PCS cannot add same-day ancillary (ACS-only)");
  assert(!pcs.canPrimaryConsentScreening, "PCS cannot do primary consent/screening");
  assert(!pcs.canUploadProcedureReport, "PCS cannot upload procedure report");

  // ─── ACS defaults ────────────────────────────────────────────────
  console.log("\n--- ACS with default profile ---");
  const acs = resolvePortalCapabilities({
    workspaceType: "ancillaryCareSpecialist",
    profile: defaultAncillaryCareSpecialistProfile,
  });
  assert(acs.canScheduleAncillary, "ACS can schedule ancillary");
  assert(acs.canAddSameDayAncillary, "ACS can add same-day ancillary");
  assert(acs.canMarkProcedureCompleted, "ACS can mark procedure completed");
  assert(acs.canPrimaryConsentScreening, "ACS can do primary consent/screening");
  assert(acs.canUploadProcedureReport, "ACS can upload procedure report");
  assert(acs.canUseCallList, "ACS can use call list");
  assert(acs.canCreateCallback, "ACS can create callback");

  // ─── Missing profile → safe defaults ────────────────────────────
  console.log("\n--- missing profile (defaultSafePortalCapabilities) ---");
  const pcsSafe = defaultSafePortalCapabilities("patientCareSpecialist");
  assert(!pcsSafe.canMarkProcedureCompleted, "PCS safe-default cannot mark procedure complete");
  assert(pcsSafe.canUseCallList, "PCS safe-default can use call list");
  const acsSafe = defaultSafePortalCapabilities("ancillaryCareSpecialist");
  assert(acsSafe.canMarkProcedureCompleted, "ACS safe-default can mark procedure complete");
  assert(acsSafe.canAddSameDayAncillary, "ACS safe-default can add same-day ancillary");

  // ─── PCS profile cannot promote to procedure-side ────────────────
  console.log("\n--- defense-in-depth: PCS can't promote to procedure-side ---");
  const sneakyPcs = resolvePortalCapabilities({
    workspaceType: "patientCareSpecialist",
    profile: {
      ...defaultPatientCareSpecialistProfile,
      capabilities: {
        ...defaultPatientCareSpecialistProfile.capabilities,
        completeProcedure: true,
        primaryConsentScreening: true,
        uploadProcedureReport: true,
      },
    },
  });
  assert(
    !sneakyPcs.canMarkProcedureCompleted,
    "PCS workspace type ignores completeProcedure=true bit",
  );
  assert(
    !sneakyPcs.canPrimaryConsentScreening,
    "PCS workspace type ignores primaryConsentScreening=true bit",
  );
  assert(
    !sneakyPcs.canUploadProcedureReport,
    "PCS workspace type ignores uploadProcedureReport=true bit",
  );

  // ─── Explicit admin override wins over profile bit ──────────────
  console.log("\n--- admin override precedence ---");
  const acsOverride = resolvePortalCapabilities({
    workspaceType: "ancillaryCareSpecialist",
    profile: defaultAncillaryCareSpecialistProfile,
    adminOverride: { completeProcedure: false },
  });
  assert(
    !acsOverride.canMarkProcedureCompleted,
    "admin override completeProcedure=false revokes ACS capability",
  );
  const acsCallOff = resolvePortalCapabilities({
    workspaceType: "ancillaryCareSpecialist",
    profile: defaultAncillaryCareSpecialistProfile,
    adminOverride: { callAndSchedule: false },
  });
  assert(
    !acsCallOff.canUseCallList,
    "admin override callAndSchedule=false revokes call list",
  );
  assert(
    !acsCallOff.canCreateCallback,
    "admin override callAndSchedule=false revokes callback",
  );
  assert(
    !acsCallOff.canScheduleAncillary,
    "admin override callAndSchedule=false revokes ancillary scheduling",
  );
  // …but ACS keeps procedure-side capability since admin didn't
  // touch that bit and the default is true for ACS.
  assert(
    acsCallOff.canMarkProcedureCompleted,
    "admin override callAndSchedule=false does NOT revoke procedure capability",
  );

  // ─── PCS+missing profile defaults to safe ───────────────────────
  console.log("\n--- PCS with empty profile capabilities ---");
  const pcsEmpty = resolvePortalCapabilities({
    workspaceType: "patientCareSpecialist",
    profile: {
      ...defaultPatientCareSpecialistProfile,
      capabilities: {},
    },
  });
  assert(
    pcsEmpty.canUseCallList,
    "PCS empty capabilities still allow call list (callAndSchedule defaults true)",
  );
  assert(
    !pcsEmpty.canMarkProcedureCompleted,
    "PCS empty capabilities default to NO procedure complete",
  );

  console.log("\n=========================");
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log("=========================");
  process.exit(failures > 0 ? 1 : 0);
}

main();

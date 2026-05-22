// QA for the PCS/ACS left-rail PatientMiniCalendar.
//
// Run with: `npm run qa:pcs-acs-mini-calendar`. No DB required.
// Source-level contract checks — the mini calendar should render
// the canonical primitive and surface the facility access hint when
// the selected facility is outside the user's assigned scope.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  } catch (err: any) {
    console.error(`[qa-pcs-acs-mini-calendar] could not read ${path}: ${err.message}`);
    return "";
  }
}

function main() {
  const miniCalendar = readFile("client/src/components/portal/PatientMiniCalendar.tsx");
  const portalShell = readFile("client/src/components/portal/PortalShell.tsx");

  console.log("\n--- PatientMiniCalendar renders canonical primitive ---");
  assert(
    /import\s*\{\s*CanonicalCommandCalendar/.test(miniCalendar),
    "imports CanonicalCommandCalendar",
  );
  assert(
    /<CanonicalCommandCalendar\b/.test(miniCalendar),
    "renders <CanonicalCommandCalendar>",
  );
  assert(
    /mode="inline"/.test(miniCalendar),
    "uses inline mode",
  );

  console.log("\n--- mode → canonical profile mapping ---");
  assert(
    miniCalendar.includes(
      'mode === "ancillarySchedule" ? "ancillaryCareSpecialist" : "patientCareSpecialist"',
    ),
    "ancillarySchedule mode maps to ancillaryCareSpecialist; other modes map to patientCareSpecialist",
  );
  // callList mode + clinicSchedule mode both fall into the
  // patientCareSpecialist branch above, which is the spec'd intent
  // for PCS-typed surfaces.

  console.log("\n--- facility access hint ---");
  assert(
    /patient-mini-calendar-access-hint/.test(miniCalendar),
    "access hint has stable testid patient-mini-calendar-access-hint",
  );
  assert(
    /outside your assigned facilities/.test(miniCalendar),
    'access hint copy contains "outside your assigned facilities"',
  );
  assert(
    /assignedFacilityIds/.test(miniCalendar),
    "PatientMiniCalendar reads assignedFacilityIds prop",
  );
  assert(
    /viewAllFacilities/.test(miniCalendar),
    "PatientMiniCalendar reads viewAllFacilities prop",
  );

  console.log("\n--- PortalShell threads access props through ---");
  assert(
    /assignedFacilityIds=\{profileAssignedFacilities\}/.test(portalShell),
    "PortalShell passes profileAssignedFacilities to the mini calendar",
  );
  assert(
    /viewAllFacilities=\{profileViewAllFacilities\}/.test(portalShell),
    "PortalShell passes profileViewAllFacilities to the mini calendar",
  );

  console.log("\n--- Schedule CTA remains ---");
  assert(
    /button-patient-mini-calendar-schedule/.test(miniCalendar),
    "Schedule CTA testid is preserved",
  );

  console.log("\n=========================");
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log("=========================");
  process.exit(failures > 0 ? 1 : 0);
}

main();

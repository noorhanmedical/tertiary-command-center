// QA proving PCS / ACS / Plexus IQ / Dashboard all use the shared
// command calendar view model — same cells shape, same data feed,
// same ancillary dots + procedure-complete badge.
//
// Run with: `npm run qa:calendar-true-parity`. No DB required.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildCommandCalendarCells,
  buildCommandCalendarUnscheduledItems,
  defaultCommandCalendarEventWindow,
  ANCILLARY_DOT_CLASS,
} from "../client/src/lib/calendar/commandCalendarViewModel";

let passes = 0;
let failures = 0;
function assert(c: unknown, l: string) {
  if (c) { passes++; console.log(`  ✓ ${l}`); }
  else { failures++; console.log(`  ✗ ${l}`); }
}
function readFile(p: string): string {
  try { return readFileSync(resolve(process.cwd(), p), "utf8"); } catch { return ""; }
}

function main() {
  console.log("\n--- shared view model is the single source ---");
  assert(
    typeof buildCommandCalendarCells === "function",
    "buildCommandCalendarCells is exported",
  );
  assert(
    typeof buildCommandCalendarUnscheduledItems === "function",
    "buildCommandCalendarUnscheduledItems is exported",
  );
  assert(
    typeof defaultCommandCalendarEventWindow === "function",
    "defaultCommandCalendarEventWindow is exported",
  );
  for (const k of ["brainwave", "vitalwave", "ultrasound"]) {
    assert(
      ANCILLARY_DOT_CLASS[k] != null,
      `ANCILLARY_DOT_CLASS contains "${k}"`,
    );
  }

  console.log("\n--- cells builder is pure + correct ---");
  const cells = buildCommandCalendarCells({
    summary: [
      {
        id: 1,
        name: "TFP Visit",
        facility: "TFP",
        scheduleDate: "2026-05-22",
        patientCount: 4,
        categories: ["brainwave", "vitalwave"],
      },
      {
        id: 2,
        name: "NWPG Outreach",
        facility: "NWPG",
        scheduleDate: "2026-05-22",
        patientCount: 2,
        categories: ["ultrasound"],
      },
    ],
    facility: "TFP",
  });
  assert(
    cells["2026-05-22"]?.count === 4,
    "cells filter by facility on the input (TFP=4, not 4+2)",
  );
  assert(
    Array.isArray(cells["2026-05-22"]?.dots) &&
      cells["2026-05-22"]!.dots!.length === 2,
    "TFP cell carries two ancillary-category dots",
  );

  const cellsAll = buildCommandCalendarCells({
    summary: [
      {
        id: 1,
        name: "TFP",
        facility: "TFP",
        scheduleDate: "2026-05-22",
        patientCount: 4,
        categories: ["brainwave"],
      },
      {
        id: 2,
        name: "NWPG",
        facility: "NWPG",
        scheduleDate: "2026-05-22",
        patientCount: 2,
        categories: ["ultrasound"],
      },
    ],
  });
  assert(
    cellsAll["2026-05-22"]?.count === 6,
    "without facility filter the cell sums all facilities (4+2=6)",
  );

  console.log("\n--- Plexus IQ uses the shared view model ---");
  const plexusIq = readFile("client/src/pages/plexus-iq.tsx");
  assert(
    /import\s*\{[\s\S]*?buildCommandCalendarCells[\s\S]*?\}\s*from\s*"@\/lib\/calendar\/commandCalendarViewModel"/m.test(plexusIq),
    "plexus-iq imports buildCommandCalendarCells from the shared view model",
  );
  assert(
    /buildCommandCalendarCells\(/.test(plexusIq) &&
      /buildCommandCalendarUnscheduledItems\(/.test(plexusIq),
    "plexus-iq calls the shared cells + unscheduled builders",
  );
  assert(
    !/const\s+ANCILLARY_DOT_CLASS\s*:/.test(plexusIq),
    "plexus-iq no longer carries its own inline ANCILLARY_DOT_CLASS map",
  );

  console.log("\n--- PCS/ACS left calendar uses the shared view model ---");
  const miniCalendar = readFile("client/src/components/portal/PatientMiniCalendar.tsx");
  assert(
    /import\s*\{[\s\S]*?buildCommandCalendarCells[\s\S]*?\}\s*from\s*"@\/lib\/calendar\/commandCalendarViewModel"/m.test(miniCalendar),
    "PatientMiniCalendar imports buildCommandCalendarCells",
  );
  assert(
    /\/api\/screening-batches\/calendar-summary/.test(miniCalendar),
    "PatientMiniCalendar fetches the same calendar-summary feed Plexus IQ uses",
  );
  assert(
    /eventType=procedure_complete|"procedure_complete"/.test(miniCalendar),
    "PatientMiniCalendar fetches procedure-complete events for the badge",
  );
  assert(
    !/\/api\/portal\/month-summary/.test(miniCalendar),
    "PatientMiniCalendar no longer relies on the count-only /api/portal/month-summary feed",
  );
  assert(
    /buildCommandCalendarCells\(/.test(miniCalendar),
    "PatientMiniCalendar calls the shared cells builder",
  );

  console.log("\n--- Dashboard uses the shared view model ---");
  const homeDashboard = readFile("client/src/components/HomeDashboard.tsx");
  assert(
    /import\s*\{[\s\S]*?buildCommandCalendarCells[\s\S]*?\}\s*from\s*"@\/lib\/calendar\/commandCalendarViewModel"/m.test(homeDashboard),
    "HomeDashboard imports buildCommandCalendarCells",
  );
  assert(
    /\/api\/screening-batches\/calendar-summary/.test(homeDashboard),
    "HomeDashboard fetches the canonical calendar-summary feed",
  );
  assert(
    /buildCommandCalendarCells\(/.test(homeDashboard),
    "HomeDashboard calls the shared cells builder",
  );

  console.log("\n--- profile mapping unchanged ---");
  assert(
    /mode === "ancillarySchedule" \? "ancillaryCareSpecialist" : "patientCareSpecialist"/.test(miniCalendar),
    "PatientMiniCalendar still flips ACS vs PCS profile by mode",
  );

  console.log("\n--- UniversalCalendarDrawer remains internal-only ---");
  const pageLevelFiles = [
    "client/src/pages/plexus-iq.tsx",
    "client/src/pages/home.tsx",
    "client/src/components/HomeDashboard.tsx",
    "client/src/components/portal/PortalShell.tsx",
    "client/src/components/portal/PatientMiniCalendar.tsx",
  ];
  for (const path of pageLevelFiles) {
    const src = readFile(path);
    const usesJsx = /<UniversalCalendarDrawer\b/.test(src);
    assert(!usesJsx, `${path} does not render <UniversalCalendarDrawer> directly`);
  }

  console.log("\n=========================");
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log("=========================");
  process.exit(failures > 0 ? 1 : 0);
}

main();

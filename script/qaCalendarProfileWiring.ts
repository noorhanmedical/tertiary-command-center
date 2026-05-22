// QA for the shared canonical calendar profile wiring.
//
// Run with: `npm run qa:calendar-profile-wiring`. No DB required.
//
// Verifies (twofold):
//   1. Static module-level invariants on calendarProfiles —
//      every required profile id is registered, ACS carries the
//      expected defaults, and add-action coverage matches the
//      profile spec.
//   2. Source-file integration invariants — PortalShell routes
//      ACS to ancillaryCareSpecialist (not technician),
//      PatientMiniCalendar's ancillarySchedule mode maps to ACS,
//      Plexus IQ + HomeDashboard mount CanonicalCommandCalendar
//      with the right profile, and UniversalCalendarDrawer is no
//      longer used at any page-level callsite.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CALENDAR_PROFILE_IDS,
  CALENDAR_PROFILES,
  type CalendarFilterId,
  type CalendarAddActionId,
} from "../client/src/calendar/calendarProfiles";

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
    console.error(`[qa-calendar-profile-wiring] could not read ${path}: ${err.message}`);
    return "";
  }
}

function main() {
  // ─── 1. Static profile invariants ─────────────────────────────────
  console.log("\n--- CALENDAR_PROFILE_IDS coverage ---");
  const requiredIds = [
    "plexusIq",
    "patientCareSpecialist",
    "ancillaryCareSpecialist",
    "technician",
    "manager",
    "admin",
  ] as const;
  for (const id of requiredIds) {
    assert(
      (CALENDAR_PROFILE_IDS as readonly string[]).includes(id),
      `CALENDAR_PROFILE_IDS contains "${id}"`,
    );
  }

  console.log("\n--- CALENDAR_PROFILES.ancillaryCareSpecialist defaults ---");
  const acs = CALENDAR_PROFILES.ancillaryCareSpecialist;
  assert(!!acs, "ancillaryCareSpecialist profile entry exists");
  if (acs) {
    assert(acs.id === "ancillaryCareSpecialist", "profile id is ancillaryCareSpecialist");
    assert(acs.defaultView === "day", "defaultView is 'day'");

    const requiredDefaults: CalendarFilterId[] = [
      "clinicVisits",
      "qualifiedVisitPatients",
      "ancillaryScheduled",
      "myDailyCallList",
      "procedureCompleted",
    ];
    for (const f of requiredDefaults) {
      assert(
        acs.defaultFilters.includes(f),
        `ACS defaultFilters includes "${f}"`,
      );
    }

    const requiredActions: CalendarAddActionId[] = [
      "addCallListItem",
      "addCallback",
      "addAncillaryAppointment",
      "addSameDayAncillary",
      "markProcedureCompleted",
    ];
    for (const a of requiredActions) {
      assert(
        acs.addActions.includes(a),
        `ACS addActions includes "${a}"`,
      );
    }
  }

  // ─── 2. Source-file integration invariants ───────────────────────
  console.log("\n--- PortalShell routes ACS to ancillaryCareSpecialist ---");
  const portalShell = readFile("client/src/components/portal/PortalShell.tsx");
  assert(
    portalShell.includes(
      'workspaceIsAncillaryCareSpecialist ? "ancillaryCareSpecialist" : "patientCareSpecialist"',
    ),
    "PortalShell maps ACS workspace to ancillaryCareSpecialist (not technician)",
  );
  assert(
    !portalShell.match(/workspaceIsAncillaryCareSpecialist\s*\?\s*"technician"/),
    "PortalShell does not route ACS to technician fallback",
  );

  console.log("\n--- PatientMiniCalendar ancillarySchedule → ACS ---");
  const miniCalendar = readFile("client/src/components/portal/PatientMiniCalendar.tsx");
  assert(
    miniCalendar.includes(
      'mode === "ancillarySchedule" ? "ancillaryCareSpecialist" : "patientCareSpecialist"',
    ),
    "PatientMiniCalendar ancillarySchedule mode maps to ancillaryCareSpecialist",
  );
  assert(
    !miniCalendar.match(/mode === "ancillarySchedule" \? "technician"/),
    "PatientMiniCalendar no longer maps ancillarySchedule to technician",
  );

  console.log("\n--- Plexus IQ canonical calendar wiring ---");
  const plexusIq = readFile("client/src/pages/plexus-iq.tsx");
  assert(
    plexusIq.includes('import { CanonicalCommandCalendar }'),
    "plexus-iq imports CanonicalCommandCalendar",
  );
  assert(
    plexusIq.includes('<CanonicalCommandCalendar') &&
      plexusIq.includes('profileId="plexusIq"'),
    'plexus-iq renders <CanonicalCommandCalendar profileId="plexusIq" ...>',
  );

  console.log("\n--- Dashboard canonical calendar wiring ---");
  const homeDashboard = readFile("client/src/components/HomeDashboard.tsx");
  assert(
    homeDashboard.includes('import { CanonicalCommandCalendar }'),
    "HomeDashboard imports CanonicalCommandCalendar",
  );
  assert(
    homeDashboard.includes('<CanonicalCommandCalendar') &&
      homeDashboard.includes('profileId="admin"'),
    'HomeDashboard renders <CanonicalCommandCalendar profileId="admin" ...>',
  );

  // ─── 3. UniversalCalendarDrawer is internal-only ─────────────────
  console.log("\n--- UniversalCalendarDrawer is internal-only ---");
  const pageLevelFiles = [
    "client/src/pages/plexus-iq.tsx",
    "client/src/pages/home.tsx",
    "client/src/components/HomeDashboard.tsx",
    "client/src/components/portal/PortalShell.tsx",
    "client/src/components/portal/PatientMiniCalendar.tsx",
  ];
  for (const path of pageLevelFiles) {
    const src = readFile(path);
    // Only fail on JSX usage `<UniversalCalendarDrawer` (comment
    // references in JSDoc / inline notes are fine).
    const usesJsx = /<UniversalCalendarDrawer\b/.test(src);
    assert(!usesJsx, `${path} does not render <UniversalCalendarDrawer> directly`);
  }
  // Confirm primitive layer still owns it.
  const primitiveFile = readFile("client/src/calendar/UniversalCalendarDrawer.tsx");
  assert(
    primitiveFile.includes("export function UniversalCalendarDrawer"),
    "UniversalCalendarDrawer primitive remains exported from the calendar layer",
  );

  // ─── 4. CanonicalCommandCalendar exposes both modes ──────────────
  console.log("\n--- CanonicalCommandCalendar surface ---");
  const wrapper = readFile("client/src/components/calendar/CanonicalCommandCalendar.tsx");
  assert(
    /mode\??:\s*"inline"/.test(wrapper),
    "CanonicalCommandCalendar declares inline mode",
  );
  assert(
    /mode\??:\s*"drawer"/.test(wrapper),
    "CanonicalCommandCalendar declares drawer mode",
  );
  assert(
    wrapper.includes("initialMonth"),
    "CanonicalCommandCalendar threads initialMonth through",
  );

  console.log("\n=========================");
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log("=========================");
  process.exit(failures > 0 ? 1 : 0);
}

main();

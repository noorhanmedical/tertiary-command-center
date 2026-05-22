// QA for the calendar data-shape contract that PCS, ACS, Plexus IQ,
// and Dashboard each feed into the shared canonical calendar.
//
// Run with: `npm run qa:calendar-data-shape`. No DB required —
// every check operates over the page source files plus runtime
// validation of a representative CanonicalMonthCellSummary.
//
// We assert two things:
//   1. Each surface has a `useMemo<Record<string, CanonicalMonthCellSummary>>`
//      cell builder that the canonical calendar can consume.
//   2. Each surface threads `cells` + `onSelectDate` (and where
//      needed, `initialMonth`) into <CanonicalCommandCalendar>.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CanonicalMonthCellSummary } from "../client/src/calendar/views/CanonicalMonthCalendar";

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
    console.error(`[qa-calendar-data-shape] could not read ${path}: ${err.message}`);
    return "";
  }
}

type SurfaceContract = {
  surface: string;
  path: string;
  cellsBuilderRegex: RegExp;
  cellsPropRegex: RegExp;
  selectDateRegex: RegExp;
  expectInitialMonth?: boolean;
};

const SURFACES: SurfaceContract[] = [
  {
    surface: "Plexus IQ",
    path: "client/src/pages/plexus-iq.tsx",
    cellsBuilderRegex: /const\s+calendarCells\s*=\s*useMemo<Record<string,\s*CanonicalMonthCellSummary>>/,
    cellsPropRegex: /cells=\{calendarCells\}/,
    selectDateRegex: /onSelectDate=\{\(d\)\s*=>\s*\{[^}]*setOpenDate\(d\)/s,
  },
  {
    surface: "HomeDashboard (Dashboard)",
    path: "client/src/components/HomeDashboard.tsx",
    cellsBuilderRegex: /const\s+homeCalendarCells\s*=\s*useMemo<Record<string,\s*CanonicalMonthCellSummary>>/,
    cellsPropRegex: /cells=\{homeCalendarCells\}/,
    selectDateRegex: /onSelectDate=\{\(d\)\s*=>\s*\{[^}]*setHomeSelectedCalendarDate\(d\)/s,
  },
  {
    surface: "PortalShell drawer (PCS + ACS header)",
    path: "client/src/components/portal/PortalShell.tsx",
    cellsBuilderRegex: /const\s+teamPortalCalendarCells\s*=\s*useMemo<Record<string,\s*CanonicalMonthCellSummary>>/,
    cellsPropRegex: /cells=\{teamPortalCalendarCells\}/,
    selectDateRegex: /onSelectDate=\{\(d\)\s*=>\s*\{[^}]*setSelectedDate\(d\)/s,
  },
  {
    surface: "PatientMiniCalendar (PCS + ACS left rail)",
    path: "client/src/components/portal/PatientMiniCalendar.tsx",
    cellsBuilderRegex: /const\s+canonicalCells\s*=\s*useMemo<Record<string,\s*CanonicalMonthCellSummary>>/,
    cellsPropRegex: /cells=\{canonicalCells\}/,
    selectDateRegex: /onSelectDate=\{\(iso\)\s*=>\s*\{/s,
    expectInitialMonth: true,
  },
];

function main() {
  // ─── 1. Runtime sanity: CanonicalMonthCellSummary shape ──────────
  console.log("\n--- CanonicalMonthCellSummary runtime shape ---");
  const sample: CanonicalMonthCellSummary = {
    count: 3,
    dots: [{ className: "bg-indigo-500", title: "3 appointments" }],
    badge: { className: "bg-emerald-500", title: "Performed" },
  };
  assert(typeof sample.count === "number", "count is a number");
  assert(
    Array.isArray(sample.dots) && sample.dots.every((d) => typeof d.className === "string"),
    "dots[].className is required string",
  );
  assert(!!sample.badge && typeof sample.badge.className === "string", "badge.className present when badge set");

  // Empty cells are valid too — pages may render no markers on a date.
  const emptySample: CanonicalMonthCellSummary = {};
  assert(emptySample.count === undefined, "empty cell summary accepted");

  // ─── 2. Per-surface builder + prop wiring ────────────────────────
  for (const contract of SURFACES) {
    console.log(`\n--- ${contract.surface} ---`);
    const src = readFile(contract.path);
    assert(
      contract.cellsBuilderRegex.test(src),
      `${contract.surface} declares a cells builder typed Record<string, CanonicalMonthCellSummary>`,
    );
    assert(
      contract.cellsPropRegex.test(src),
      `${contract.surface} threads cells prop into the canonical calendar`,
    );
    assert(
      contract.selectDateRegex.test(src),
      `${contract.surface} wires onSelectDate to its page state`,
    );
    if (contract.expectInitialMonth) {
      assert(
        /initialMonth=\{/.test(src),
        `${contract.surface} threads initialMonth to seed the visible month`,
      );
    }
  }

  // ─── 3. Page-level UniversalCalendarDrawer is internal-only ──────
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
    const usesJsx = /<UniversalCalendarDrawer\b/.test(src);
    assert(!usesJsx, `${path} does not render <UniversalCalendarDrawer> directly`);
  }

  // ─── 4. Canonical primitives still export the expected shape ─────
  console.log("\n--- canonical primitive contract surface ---");
  const monthCalendarSrc = readFile(
    "client/src/calendar/views/CanonicalMonthCalendar.tsx",
  );
  assert(
    /export type CanonicalMonthCellSummary/.test(monthCalendarSrc),
    "CanonicalMonthCellSummary type is exported",
  );
  assert(
    /export type CanonicalCalendarUnscheduledItem/.test(monthCalendarSrc),
    "CanonicalCalendarUnscheduledItem type is exported",
  );

  const universalCalendarSrc = readFile("client/src/calendar/UniversalCalendar.tsx");
  assert(
    /initialMonth\?:\s*Date/.test(universalCalendarSrc),
    "UniversalCalendar accepts optional initialMonth",
  );
  assert(
    /<CanonicalMonthCalendar/.test(universalCalendarSrc),
    "UniversalCalendar renders CanonicalMonthCalendar (for every profile)",
  );

  console.log("\n=========================");
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log("=========================");
  process.exit(failures > 0 ? 1 : 0);
}

main();

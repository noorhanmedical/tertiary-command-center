// QA for the panel → popup → Playground pattern.
// Run with: `npm run qa:panel-popup-playground`. No DB required.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PANEL_PLAYGROUND_SOURCES,
  PANEL_PLAYGROUND_COMPONENT_TYPES,
  buildCalendarDatePlaygroundContext,
  buildPatientPlaygroundContext,
  buildAncillaryPlaygroundContext,
  buildCallListPlaygroundContext,
  isPanelPlaygroundContext,
} from "../client/src/lib/playground/panelPlaygroundContext";

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
  console.log("\n--- panel playground context primitives ---");
  for (const s of ["pcs", "acs", "plexusIq", "dashboard", "unknown"]) {
    assert(
      (PANEL_PLAYGROUND_SOURCES as readonly string[]).includes(s),
      `PANEL_PLAYGROUND_SOURCES contains "${s}"`,
    );
  }
  for (const t of [
    "calendarDate",
    "patient",
    "ancillary",
    "callList",
    "procedure",
    "document",
    "billing",
  ]) {
    assert(
      (PANEL_PLAYGROUND_COMPONENT_TYPES as readonly string[]).includes(t),
      `PANEL_PLAYGROUND_COMPONENT_TYPES contains "${t}"`,
    );
  }

  console.log("\n--- builders produce valid contexts ---");
  const calendarCtx = buildCalendarDatePlaygroundContext({
    sourceSurface: "pcs",
    selectedDate: "2026-05-22",
    facilityId: "TFP",
    count: 5,
    categories: ["brainwave"],
    procedureCompleted: true,
  });
  assert(calendarCtx.componentType === "calendarDate", "calendar builder sets componentType=calendarDate");
  assert(calendarCtx.title.includes("2026-05-22"), "calendar title includes selectedDate");
  assert(calendarCtx.facilityId === "TFP", "calendar context carries facilityId");
  assert(isPanelPlaygroundContext(calendarCtx), "calendar context passes isPanelPlaygroundContext");

  const patientCtx = buildPatientPlaygroundContext({
    sourceSurface: "pcs",
    patientUuid: "p-1",
    patientName: "Test Patient",
    facilityId: "TFP",
  });
  assert(patientCtx.componentType === "patient", "patient builder sets componentType=patient");
  assert(patientCtx.patientUuid === "p-1", "patient context carries patientUuid");

  const ancillaryCtx = buildAncillaryPlaygroundContext({
    sourceSurface: "acs",
    ancillaryType: "BrainWave EEG",
    patientName: "Test Patient",
  });
  assert(ancillaryCtx.componentType === "ancillary", "ancillary builder sets componentType=ancillary");
  assert(ancillaryCtx.ancillaryType === "BrainWave EEG", "ancillary context carries ancillaryType");

  const callCtx = buildCallListPlaygroundContext({
    sourceSurface: "pcs",
    patientName: "Test Patient",
    callType: "callback",
  });
  assert(callCtx.componentType === "callList", "callList builder sets componentType=callList");

  console.log("\n--- isPanelPlaygroundContext type guard ---");
  assert(!isPanelPlaygroundContext(null), "null is not a panel playground context");
  assert(!isPanelPlaygroundContext({}), "empty object is not a panel playground context");
  assert(
    !isPanelPlaygroundContext({ sourceSurface: "pcs", componentType: "bogus", title: "x" }),
    "unknown componentType is rejected",
  );

  console.log("\n--- PatientMiniCalendar wires popup + promote ---");
  const miniCalendar = readFile("client/src/components/portal/PatientMiniCalendar.tsx");
  assert(
    /patient-mini-calendar-date-popup/.test(miniCalendar),
    "PatientMiniCalendar declares the date-popup testid",
  );
  assert(
    /buildCalendarDatePlaygroundContext\(/.test(miniCalendar),
    "PatientMiniCalendar builds a CalendarDate playground context",
  );
  assert(
    /import\s*\{\s*PromoteToPlaygroundButton\s*\}/.test(miniCalendar),
    "PatientMiniCalendar imports PromoteToPlaygroundButton",
  );
  assert(
    /<PromoteToPlaygroundButton\b/.test(miniCalendar),
    "PatientMiniCalendar renders <PromoteToPlaygroundButton>",
  );
  assert(
    /onPromoteToPlayground/.test(miniCalendar),
    "PatientMiniCalendar exposes onPromoteToPlayground prop",
  );
  assert(
    /panelSourceSurface/.test(miniCalendar),
    "PatientMiniCalendar exposes panelSourceSurface prop",
  );

  console.log("\n--- PromoteToPlaygroundButton primitive exists ---");
  const promoteButton = readFile(
    "client/src/components/playground/PromoteToPlaygroundButton.tsx",
  );
  assert(
    /export function PromoteToPlaygroundButton/.test(promoteButton),
    "PromoteToPlaygroundButton is exported",
  );
  assert(
    /onPromote\(context\)/.test(promoteButton),
    "PromoteToPlaygroundButton calls onPromote(context)",
  );

  console.log("\n--- PortalShell provides the canonical promote handler ---");
  const portalShell = readFile("client/src/components/portal/PortalShell.tsx");
  assert(
    /panelSourceSurface=\{[\s\S]+?\}/.test(portalShell),
    "PortalShell passes panelSourceSurface to PatientMiniCalendar",
  );
  assert(
    /onPromoteToPlayground=\{[\s\S]+?setCenterMode\("playground"\)/m.test(portalShell),
    "PortalShell wires onPromoteToPlayground to setCenterMode('playground')",
  );

  console.log("\n--- canonical calendar parity is preserved ---");
  // Pattern lands without disturbing the shared command calendar
  // view model. The Plexus IQ + mini-calendar + dashboard builders
  // must still all flow through commandCalendarViewModel.
  const plexusIq = readFile("client/src/pages/plexus-iq.tsx");
  assert(
    /buildCommandCalendarCells\(/.test(plexusIq) &&
      /buildCommandCalendarCells\(/.test(miniCalendar) &&
      /buildCommandCalendarCells\(/.test(readFile("client/src/components/HomeDashboard.tsx")),
    "Plexus IQ + PatientMiniCalendar + HomeDashboard all still call buildCommandCalendarCells",
  );

  console.log("\n--- pattern doc exists ---");
  const doc = readFile("docs/architecture/panel-popup-playground-pattern.md");
  assert(doc.length > 0, "panel-popup-playground-pattern.md exists");
  assert(/sourceSurface/.test(doc), "doc names sourceSurface field");
  assert(/componentType/.test(doc), "doc names componentType field");

  console.log("\n=========================");
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log("=========================");
  process.exit(failures > 0 ? 1 : 0);
}

main();

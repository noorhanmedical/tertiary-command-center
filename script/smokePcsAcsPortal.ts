// Final no-DB smoke test for the PCS/ACS portal stack.
//
// Run with: `npm run smoke:pcs-acs-portal`. Source-level contract
// proof that the PCS/ACS portal wiring stays coherent across the
// canonical calendar work, the capability resolver, and the QA
// scaffolding.
//
// Every assertion reads the working tree directly — no DB, no
// server, no fetch. Exit 0 when all contracts hold, non-zero on
// any drift.

import { readFileSync, existsSync } from "node:fs";
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
  } catch {
    return "";
  }
}

function exists(path: string): boolean {
  return existsSync(resolve(process.cwd(), path));
}

function main() {
  // ─── 1. Canonical calendar wiring in PCS/ACS shell ───────────────
  console.log("\n--- canonical calendar wiring ---");
  const portalShell = readFile("client/src/components/portal/PortalShell.tsx");
  const miniCalendar = readFile("client/src/components/portal/PatientMiniCalendar.tsx");
  assert(
    portalShell.includes('import { CanonicalCommandCalendar }'),
    "PortalShell imports CanonicalCommandCalendar",
  );
  assert(
    /<CanonicalCommandCalendar\b/.test(portalShell),
    "PortalShell renders <CanonicalCommandCalendar>",
  );
  assert(
    /<CanonicalCommandCalendar\b/.test(miniCalendar),
    "PatientMiniCalendar renders <CanonicalCommandCalendar>",
  );

  // ─── 2. Role → profile mapping ───────────────────────────────────
  console.log("\n--- role → profile mapping ---");
  assert(
    portalShell.includes(
      'workspaceIsAncillaryCareSpecialist ? "ancillaryCareSpecialist" : "patientCareSpecialist"',
    ),
    "PortalShell maps ACS workspace to ancillaryCareSpecialist, PCS to patientCareSpecialist",
  );
  assert(
    !portalShell.includes('workspaceIsAncillaryCareSpecialist ? "technician"'),
    "PortalShell no longer falls back to technician for ACS",
  );
  assert(
    !portalShell.includes("workspaceRole === undefined"),
    "PortalShell no longer defaults undefined workspaceRole to ACS",
  );

  // ─── 3. ancillaryCareSpecialist profile exists in the registry ──
  console.log("\n--- ancillaryCareSpecialist profile is registered ---");
  const profiles = readFile("client/src/calendar/calendarProfiles.ts");
  assert(
    profiles.includes('"ancillaryCareSpecialist"'),
    "CALENDAR_PROFILE_IDS contains ancillaryCareSpecialist",
  );
  assert(
    profiles.includes("ancillaryCareSpecialist: {"),
    "CALENDAR_PROFILES.ancillaryCareSpecialist entry exists",
  );

  // ─── 4. Capability resolver in place + wired ─────────────────────
  console.log("\n--- portal capability resolver ---");
  assert(
    exists("client/src/lib/portal/portalCapabilities.ts"),
    "client/src/lib/portal/portalCapabilities.ts exists",
  );
  const caps = readFile("client/src/lib/portal/portalCapabilities.ts");
  assert(
    /export function resolvePortalCapabilities/.test(caps),
    "resolvePortalCapabilities is exported",
  );
  assert(
    portalShell.includes("import { resolvePortalCapabilities }"),
    "PortalShell imports resolvePortalCapabilities",
  );
  assert(
    /const portalCapabilities = resolvePortalCapabilities\(/.test(portalShell),
    "PortalShell calls resolvePortalCapabilities(...)",
  );

  // ─── 5. UniversalCalendarDrawer is internal-only ────────────────
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

  // ─── 6. QA scripts exist + are wired ─────────────────────────────
  console.log("\n--- required QA scripts exist ---");
  const requiredScripts = [
    "script/qaCalendarProfileWiring.ts",
    "script/qaCalendarDataShape.ts",
    "script/qaCalendarProfileOverrides.ts",
    "script/qaPcsAcsPortalActions.ts",
    "script/qaPcsAcsCapabilities.ts",
    "script/qaPcsAcsMiniCalendar.ts",
  ];
  for (const path of requiredScripts) {
    assert(exists(path), `${path} exists`);
  }
  const pkg = readFile("package.json");
  const requiredNpmScripts = [
    "qa:calendar-profile-wiring",
    "qa:calendar-data-shape",
    "qa:calendar-profile-overrides",
    "qa:pcs-acs-portal-actions",
    "qa:pcs-acs-capabilities",
    "qa:pcs-acs-mini-calendar",
    "smoke:pcs-acs-portal",
  ];
  for (const name of requiredNpmScripts) {
    assert(pkg.includes(`"${name}":`), `npm script "${name}" is registered`);
  }

  // ─── 7. Mini calendar surfaces the facility access hint ─────────
  console.log("\n--- mini calendar facility access hint ---");
  assert(
    /patient-mini-calendar-access-hint/.test(miniCalendar),
    "facility access hint testid present",
  );

  console.log("\n=========================");
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log("=========================");
  process.exit(failures > 0 ? 1 : 0);
}

main();

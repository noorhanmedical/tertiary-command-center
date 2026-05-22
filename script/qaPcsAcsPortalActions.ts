// QA for PCS / ACS portal action availability.
//
// Run with: `npm run qa:pcs-acs-portal-actions`. No DB required.
// Asserts that the canonical calendar profile each portal uses
// surfaces the add-actions that match the role's intent.
//
// Spec:
//   - PCS uses calendar profile `patientCareSpecialist`.
//   - ACS uses calendar profile `ancillaryCareSpecialist`.
//   - ACS profile must include:
//       addAncillaryAppointment · addSameDayAncillary ·
//       markProcedureCompleted (procedure-side capabilities ACS
//       owns).
//   - PCS profile must include call/callback/scheduling
//       (addCallListItem · addCallback · addAncillaryAppointment)
//       and must NOT default to markProcedureCompleted (ACS-only
//       capability).
//   - Shared PatientMiniCalendar still renders
//     CanonicalCommandCalendar inline at the left rail.
//   - PortalShell maps ACS workspace to ancillaryCareSpecialist.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CALENDAR_PROFILES } from "../client/src/calendar/calendarProfiles";

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
    console.error(`[qa-pcs-acs-portal-actions] could not read ${path}: ${err.message}`);
    return "";
  }
}

function main() {
  // ─── 1. PCS profile actions ──────────────────────────────────────
  console.log("\n--- PCS calendar profile actions ---");
  const pcs = CALENDAR_PROFILES.patientCareSpecialist;
  assert(!!pcs, "patientCareSpecialist profile exists");
  if (pcs) {
    for (const action of ["addCallListItem", "addCallback", "addAncillaryAppointment"] as const) {
      assert(
        pcs.addActions.includes(action),
        `PCS profile includes ${action}`,
      );
    }
    assert(
      !pcs.addActions.includes("markProcedureCompleted"),
      "PCS profile does NOT default to markProcedureCompleted (ACS-only capability)",
    );
    assert(
      !pcs.addActions.includes("addSameDayAncillary"),
      "PCS profile does NOT default to addSameDayAncillary (ACS-only capability)",
    );
  }

  // ─── 2. ACS profile actions ──────────────────────────────────────
  console.log("\n--- ACS calendar profile actions ---");
  const acs = CALENDAR_PROFILES.ancillaryCareSpecialist;
  assert(!!acs, "ancillaryCareSpecialist profile exists");
  if (acs) {
    for (const action of [
      "addAncillaryAppointment",
      "addSameDayAncillary",
      "markProcedureCompleted",
    ] as const) {
      assert(
        acs.addActions.includes(action),
        `ACS profile includes ${action}`,
      );
    }
    // ACS also owns the outreach-side call/callback actions so a
    // specialist can drive their own day end-to-end.
    for (const action of ["addCallListItem", "addCallback"] as const) {
      assert(
        acs.addActions.includes(action),
        `ACS profile includes ${action}`,
      );
    }
  }

  // ─── 3. PortalShell role → profile mapping ───────────────────────
  console.log("\n--- PortalShell role → profile mapping ---");
  const portalShell = readFile("client/src/components/portal/PortalShell.tsx");
  assert(
    portalShell.includes(
      'workspaceIsAncillaryCareSpecialist ? "ancillaryCareSpecialist" : "patientCareSpecialist"',
    ),
    "PortalShell maps ACS workspace to ancillaryCareSpecialist and PCS to patientCareSpecialist",
  );
  assert(
    !portalShell.includes('workspaceIsAncillaryCareSpecialist ? "technician"'),
    "PortalShell does NOT fall back to technician for ACS workspaces",
  );

  // ─── 4. PatientMiniCalendar still renders the canonical inline ───
  console.log("\n--- PatientMiniCalendar renders CanonicalCommandCalendar ---");
  const miniCalendar = readFile("client/src/components/portal/PatientMiniCalendar.tsx");
  assert(
    miniCalendar.includes(
      'import {\n  CanonicalCommandCalendar,',
    ) || miniCalendar.includes('import { CanonicalCommandCalendar'),
    "PatientMiniCalendar imports CanonicalCommandCalendar",
  );
  assert(
    /<CanonicalCommandCalendar/.test(miniCalendar) &&
      /mode="inline"/.test(miniCalendar),
    "PatientMiniCalendar mounts CanonicalCommandCalendar in inline mode",
  );
  assert(
    miniCalendar.includes(
      'mode === "ancillarySchedule" ? "ancillaryCareSpecialist" : "patientCareSpecialist"',
    ),
    "PatientMiniCalendar selects ACS vs PCS profile based on mode",
  );

  // ─── 5. ACS-typed capability flags exist on the shell ────────────
  console.log("\n--- ACS capability flags exist on PortalShell ---");
  assert(
    portalShell.includes("workspaceCanCompleteProcedure"),
    "PortalShell exposes workspaceCanCompleteProcedure capability flag",
  );
  assert(
    portalShell.includes("workspaceCanPrimaryConsentScreening"),
    "PortalShell exposes workspaceCanPrimaryConsentScreening capability flag",
  );
  assert(
    portalShell.includes("workspaceCanUploadProcedureReport"),
    "PortalShell exposes workspaceCanUploadProcedureReport capability flag",
  );
  // PCS-side capability that should also stay available.
  assert(
    portalShell.includes("workspaceCanCallAndSchedule"),
    "PortalShell exposes workspaceCanCallAndSchedule capability flag",
  );

  console.log("\n=========================");
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log("=========================");
  process.exit(failures > 0 ? 1 : 0);
}

main();

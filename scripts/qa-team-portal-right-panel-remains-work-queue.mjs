// QA — The right panel stays the assigned work queue / call list /
// schedule. None of the new left-rail tools (Document Library /
// Calendar / Email / Templates) may bleed into the right panel.
//
// We assert by extracting the right-rail region (everything inside
// data-testid="portal-right-rail") and checking that the new tool
// surfaces are NOT mounted there. The right rail must still drive its
// rendering off the workspace feed queries.
//
// Run: node scripts/qa-team-portal-right-panel-remains-work-queue.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const src = fs.readFileSync(
  path.join(root, "client/src/components/portal/TeamPortalShell.tsx"),
  "utf8",
);

const startMarker = 'data-testid="portal-right-rail"';
const startIdx = src.indexOf(startMarker);
if (startIdx < 0) {
  failures.push("Could not locate the portal-right-rail container");
} else {
  // Grab a generous slice (right rail closes at the corresponding
  // dock block — we just stop at the next dock-icon marker which we
  // know is after the right rail).
  const sliceEnd = src.indexOf('group/dock', startIdx);
  const region = sliceEnd > 0 ? src.slice(startIdx, sliceEnd) : src.slice(startIdx);
  const FORBIDDEN = [
    "PortalEmailComposerTab",
    "PortalDocumentLibraryTab",
    "PortalTemplatesResourcesTab",
    "PortalMarketingTab",
    "PortalPatientSearchTab",
    "PortalPlexusTasksTab",
    "LeftRailCompactCalendar",
    "left-rail-tool-",
  ];
  for (const f of FORBIDDEN) {
    if (region.includes(f)) {
      failures.push(`Right panel must not mount "${f}" — left-tools rail / center canvas only`);
    }
  }
  // Right panel still needs to render the workspace feeds; check the
  // workspace-call-list query result is referenced inside the region.
  if (!region.includes("workspaceCallList") && !region.includes("workspaceClinicSchedule") && !region.includes("workspaceAncillarySchedule")) {
    failures.push("Right panel must render at least one of the workspace feed query results (call list / clinic schedule / ancillary schedule)");
  }
}

if (failures.length > 0) {
  console.error("Right panel = work queue QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Right panel = work queue QA passed.");

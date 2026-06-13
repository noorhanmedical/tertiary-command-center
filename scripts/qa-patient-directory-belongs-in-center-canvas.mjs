// QA — Patient Directory details belong in the center canvas, NOT
// the left tools rail.
//
// The left rail is general tools only. Patient timeline, profile,
// call history, DNC/cooldown, prior ancillary detail, Admin Review
// history, duplicate warnings — all of those are patient-specific
// surfaces. They live in the center canvas (PatientCommandCanvas)
// after the operator clicks a patient row.
//
// Right rail = work queue. Center canvas = patient detail. Left rail
// = tools.
//
// Run: node scripts/qa-patient-directory-belongs-in-center-canvas.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const src = fs.readFileSync(
  path.join(root, "client/src/components/portal/TeamPortalShell.tsx"),
  "utf8",
);

// Extract the left-rail tools region.
const railStart = src.indexOf('data-testid="left-rail-tools-rail"');
const railEnd = railStart >= 0 ? src.indexOf("})()}", railStart) : -1;
const railRegion = railStart >= 0 ? src.slice(railStart, railEnd > 0 ? railEnd : railStart + 16384) : "";

if (!railRegion) {
  failures.push("Could not locate the left-rail tools region in TeamPortalShell.tsx");
} else {
  const FORBIDDEN_IN_LEFT_RAIL = [
    // Patient-specific Patient Directory surfaces.
    "PatientProfileDrawer",
    "PatientAuditTrailModal",
    "AdminReviewDialog",
    "AdminApprovalControl",
    "DuplicateWarningBadge",
    "PatientCallHistoryPanel",
    "AdminReviewDuplicateGuard",
    "EngagementHandoffDuplicateBar",
    // Patient timeline phrases the rail must not include.
    "Patient timeline",
    "Call history",
    "Admin Review history",
    "DNC detail",
    "Cooldown detail",
    "Prior ancillary detail",
  ];
  for (const needle of FORBIDDEN_IN_LEFT_RAIL) {
    if (railRegion.includes(needle)) {
      failures.push(`Left rail must not mount Patient Directory surface "${needle}"`);
    }
  }
}

// Conversely, the center-canvas PatientCommandCanvas SHOULD render
// the canonical patient detail surfaces.
const canvasSrc = fs.readFileSync(
  path.join(root, "client/src/components/portal/PatientCommandCanvas.tsx"),
  "utf8",
);
const CANVAS_REQUIRED = [
  "fetchPatientCommandCenter",
  "PatientCallHistoryPanel",
];
for (const needle of CANVAS_REQUIRED) {
  if (!canvasSrc.includes(needle)) {
    failures.push(`PatientCommandCanvas must render "${needle}" (Patient Directory facts live in the canvas, not the left rail)`);
  }
}

if (failures.length > 0) {
  console.error("Patient-Directory-in-center-canvas QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient-Directory-in-center-canvas QA passed.");

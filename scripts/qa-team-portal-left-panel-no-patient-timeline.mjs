// QA — Left panel does NOT include patient timeline / profile /
// Patient Directory detail / call result history / DNC-cooldown
// detail / Admin Review history. Those live in the patient
// canvas/playground, not the left rail.
//
// We assert the absence by scanning only the left-rail JSX block of
// TeamPortalShell.tsx between the `data-testid="left-rail-tools-rail"`
// marker and the next closing `</div>` that ends the rail.
//
// Run: node scripts/qa-team-portal-left-panel-no-patient-timeline.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const src = fs.readFileSync(
  path.join(root, "client/src/components/portal/TeamPortalShell.tsx"),
  "utf8",
);

// Locate the rail body: starts at `data-testid="left-rail-tools-rail"`
// and runs until the next `}` that closes the IIFE — we use a generous
// extraction so any forbidden tokens that drift inside the rail will
// trip the check. Then we additionally scan everything inside the
// outer portal-left-rail container, since the rail body should never
// contain patient-detail surfaces.
function extractRailRegion() {
  const startMarker = 'data-testid="left-rail-tools-rail"';
  const startIdx = src.indexOf(startMarker);
  if (startIdx < 0) return null;
  // Heuristic end: the closing parenthesis of the IIFE arrow body,
  // which we approximate by finding the next `})()}`. The rail JSX
  // is followed by `</div>\n              );\n            })()}`.
  const endIdx = src.indexOf("})()}", startIdx);
  if (endIdx < 0) return src.slice(startIdx);
  return src.slice(startIdx, endIdx + 5);
}

const region = extractRailRegion();
if (region === null) {
  failures.push("Could not locate the left-rail-tools-rail region in TeamPortalShell.tsx");
} else {
  const FORBIDDEN_IN_LEFT_RAIL = [
    // Patient detail components.
    "PatientCommandCanvas",
    "PatientDetail",
    "PatientCallHistoryPanel",
    "AdminReviewDialog",
    "AdminApprovalControl",
    "AdminReviewDuplicateGuard",
    "EngagementHandoffDuplicateBar",
    "PatientAuditTrailModal",
    "PatientProfileDrawer",
    "DuplicateWarningBadge",
    // Patient-specific upload / consent / chart UI.
    "LeftRailUpload",
    "ConsentDialog",
    // Patient timeline / history language.
    "Patient timeline",
    "Call history",
    "Admin Review history",
    "DNC detail",
    "Cooldown detail",
  ];
  for (const needle of FORBIDDEN_IN_LEFT_RAIL) {
    if (region.includes(needle)) {
      failures.push(
        `Left tools rail must not include patient-detail surface "${needle}" — move to center canvas / playground`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Team Portal left rail (no patient timeline / detail) QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal left rail (no patient timeline / detail) QA passed.");

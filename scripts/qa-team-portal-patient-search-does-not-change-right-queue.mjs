// QA — Patient Search must not change the right-rail work queue.
//
// Selecting a row in PortalPatientSearchTab opens the patient in the
// center canvas (via openPatientTabById in the shell). It must NOT:
//   - call setSelectedDate
//   - call setFacility
//   - call setActiveWorkspaceMode
//   - call setViewAsTeamMemberId
//
// We assert by scanning the Patient Search render block inside the
// shell.
//
// Run: node scripts/qa-team-portal-patient-search-does-not-change-right-queue.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const src = fs.readFileSync(
  path.join(root, "client/src/components/portal/TeamPortalShell.tsx"),
  "utf8",
);

const m = /activeTab\?\.kind === "patientSearch"[\s\S]*?<\/div>\s*\);\s*\}/.exec(src);
if (!m) {
  failures.push("Could not locate the patientSearch render branch in TeamPortalShell.tsx");
} else {
  const block = m[0];
  const forbidden = [
    "setSelectedDate(",
    "setFacility(",
    "setActiveWorkspaceMode(",
    "setViewAsTeamMemberId(",
  ];
  for (const f of forbidden) {
    if (block.includes(f)) {
      failures.push(
        `Patient Search render branch must not call ${f} (would change the right-rail queue)`,
      );
    }
  }
  // It MUST route to the patient via openPatientTabById, NOT mutate
  // queue state.
  if (!block.includes("openPatientTabById")) {
    failures.push("Patient Search render branch must call openPatientTabById on row select");
  }
}

if (failures.length > 0) {
  console.error("Patient Search right-queue safety QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Search right-queue safety QA passed.");

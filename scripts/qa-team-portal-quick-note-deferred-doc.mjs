// QA — Phase 2 PR 2.6 promoted Quick Note from deferred to live.
//
// History:
//   - Phase 1.7 audit deferred Quick Note because there was no
//     canonical patient_notes writer.
//   - Phase 2 PR 2.6 added the patient_notes table + the
//     canonical /api/patient-notes route + the QuickNoteTool.
//
// This QA used to assert "Quick Note is NOT in the shell". It now
// asserts the opposite: Quick Note IS wired AND the audit doc
// reflects that.
//
// Run: node scripts/qa-team-portal-quick-note-deferred-doc.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const shell = fs.readFileSync(
  path.join(root, "client/src/components/portal/TeamPortalShell.tsx"),
  "utf8",
);
if (!shell.includes("left-rail-tool-quick-note")) {
  failures.push("TeamPortalShell must mount the Quick Note left-rail button (PR 2.6)");
}
if (!shell.includes("QuickNoteTool")) {
  failures.push("TeamPortalShell must render <QuickNoteTool /> in the playground");
}

const newDoc = fs.existsSync(path.join(root, "docs/architecture/phase-2-patient-notes-runtime.md"))
  ? fs.readFileSync(path.join(root, "docs/architecture/phase-2-patient-notes-runtime.md"), "utf8")
  : "";
if (!newDoc) {
  failures.push("phase-2-patient-notes-runtime.md must exist (PR 2.6)");
} else {
  if (!newDoc.includes("/api/patient-notes")) {
    failures.push("phase-2-patient-notes-runtime.md must document the /api/patient-notes endpoint");
  }
  if (!newDoc.includes("QuickNoteTool")) {
    failures.push("phase-2-patient-notes-runtime.md must reference the QuickNoteTool surface");
  }
}

if (failures.length > 0) {
  console.error("Quick-Note (PR 2.6) live QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Quick-Note (PR 2.6) live QA passed.");

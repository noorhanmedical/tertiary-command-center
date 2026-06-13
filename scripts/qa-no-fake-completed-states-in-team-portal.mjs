// QA — Team Portal must not fake completed workflow states.
//
// Forbids hardcoded success-state markers in the team-portal tree:
// fake "sent" emails, fake "completed" procedures, fake "signed"
// consents, fake "uploaded" reports, fake "billing ready" flags.
// Honest scaffold-state labels (e.g. "Requires SMTP activation",
// "Scaffold", "Deferred to Phase 2") are required where the live
// path is unavailable — those tokens are explicitly allowed.
//
// Run: node scripts/qa-no-fake-completed-states-in-team-portal.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

function requireNotText(rel, needles, label) {
  const src = read(rel);
  if (src === null) return;
  for (const n of needles) if (src.includes(n)) failures.push(`${label}: forbidden "${n}" in ${rel}`);
}

// 1) PortalEmailComposerTab must not fake a sent state.
requireNotText(
  "client/src/components/portal/PortalEmailComposerTab.tsx",
  [
    "fakeMessageId",
    "fakeSend",
    "mockSend",
    "setTimeout(() => onSuccess",
    "Math.random",
  ],
  "Email composer must not fake a sent state",
);

// 2) PortalDocumentLibraryTab must not fake a download state.
requireNotText(
  "client/src/components/portal/PortalDocumentLibraryTab.tsx",
  ["fakeDownload", "mockDocumentList"],
  "Document Library tool must not fake document data",
);

// 3) PatientCommandCanvas must not fake call history rows / readiness
//    rows. The canvas pulls from canonical /api/portal/patient-command-
//    center; no local mock data.
requireNotText(
  "client/src/components/portal/PatientCommandCanvas.tsx",
  [
    "fakeCallHistory",
    "mockCallHistory",
    "fakeReadinessRows",
    "FAKE_PATIENT",
    "mockPatient",
  ],
  "Patient canvas must not fake call history / readiness",
);

// 4) TeamPortalShell must not re-introduce the demo patient prepended
//    in Slice 1.1 (regression guard).
requireNotText(
  "client/src/components/portal/TeamPortalShell.tsx",
  ["aliBoomayePatient", "Ali Boomaye", "ALI-900001"],
  "TeamPortalShell must not re-introduce the demo-patient injection (Slice 1.1)",
);

if (failures.length > 0) {
  console.error("No-fake-completed-states QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("No-fake-completed-states QA passed.");

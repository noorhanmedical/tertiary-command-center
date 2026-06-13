// QA — Patient Directory facts are wired into the center canvas
// (PatientCommandCanvas).
//
// PR A's qa-patient-directory-belongs-in-center-canvas.mjs proves
// patient-specific facts must not bleed into the left rail. This QA
// proves the converse: the center canvas actively surfaces Patient
// Directory facts (DNC / cooldown / prior tests / engagement
// history) by mounting PatientDirectoryFactsCard inside
// PatientCommandCanvas.
//
// Read-only — the card never adds new writes; the snapshot route is
// the canonical /api/patient-directory/:id.
//
// Run: node scripts/qa-patient-directory-facts-in-center-canvas.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const card = fs.readFileSync(
  path.join(root, "client/src/components/portal/PatientDirectoryFactsCard.tsx"),
  "utf8",
);
if (!card.includes("export function PatientDirectoryFactsCard")) {
  failures.push("PatientDirectoryFactsCard.tsx must export a named React component");
}
if (!card.includes("getPatientDirectorySnapshot")) {
  failures.push("PatientDirectoryFactsCard must fetch the canonical /api/patient-directory/:id snapshot via getPatientDirectorySnapshot");
}
const REQUIRED_FACTS = [
  "patient-directory-facts-dnc",
  "patient-directory-facts-cooldown",
  "patient-directory-facts-prior-tests",
  "patient-directory-facts-engagement",
];
for (const t of REQUIRED_FACTS) {
  if (!card.includes(t)) {
    failures.push(`PatientDirectoryFactsCard must render a region with data-testid="${t}"`);
  }
}

// Card must be read-only — disallow any direct write paths into the
// directory routes from this component.
const FORBIDDEN_WRITES = [
  'apiRequest("POST"',
  'apiRequest("PATCH"',
  'apiRequest("DELETE"',
  "method: \"POST\"",
  "method: \"PATCH\"",
  "method: \"DELETE\"",
];
for (const w of FORBIDDEN_WRITES) {
  if (card.includes(w)) {
    failures.push(`PatientDirectoryFactsCard must be read-only — found write call: ${w}`);
  }
}

const canvas = fs.readFileSync(
  path.join(root, "client/src/components/portal/PatientCommandCanvas.tsx"),
  "utf8",
);
if (!canvas.includes("PatientDirectoryFactsCard")) {
  failures.push("PatientCommandCanvas must mount PatientDirectoryFactsCard so patient-directory facts surface in the center canvas");
}
if (!canvas.includes("<PatientDirectoryFactsCard patientScreeningId={patientScreeningId}")) {
  failures.push("PatientCommandCanvas must pass patientScreeningId to PatientDirectoryFactsCard");
}

if (failures.length > 0) {
  console.error("Patient-Directory-facts-in-center-canvas QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient-Directory-facts-in-center-canvas QA passed.");

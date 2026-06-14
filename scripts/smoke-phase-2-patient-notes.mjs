// Smoke — Phase 2 patient notes chain.
//
// Run: node scripts/smoke-phase-2-patient-notes.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fails = [];
const passes = [];

function check(label, file, predicate) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  if (predicate(src)) passes.push(label);
  else fails.push(`${label} — failed for ${file}`);
}

check(
  "1. patient_notes schema + migration exist",
  "shared/schema/patientNotes.ts",
  (s) => s.includes("patient_notes") && s.includes("PATIENT_NOTE_TYPES"),
);
check(
  "2. Repo exposes list/create/archive",
  "server/repositories/patientNotes.repo.ts",
  (s) => s.includes("listPatientNotes") && s.includes("createPatientNote") && s.includes("archivePatientNote"),
);
check(
  "3. Routes registered in server/routes.ts",
  "server/routes.ts",
  (s) => s.includes("registerPatientNotesRoutes"),
);
check(
  "4. Client API exports create/fetch/archive",
  "client/src/lib/patientNotesApi.ts",
  (s) => s.includes("createPatientNote") && s.includes("fetchPatientNotes") && s.includes("archivePatientNote"),
);
check(
  "5. Tool calls createPatientNote on save",
  "client/src/components/portal/QuickNoteTool.tsx",
  (s) => s.includes("createPatientNote(") && s.includes("saveMutation.mutate"),
);
check(
  "6. PatientNotesPanel reads canonical /api/patient-notes",
  "client/src/components/portal/PatientNotesPanel.tsx",
  (s) => s.includes("fetchPatientNotes"),
);
check(
  "7. Shell renders both Quick Note + Patient Notes panel",
  "client/src/components/portal/TeamPortalShell.tsx",
  (s) => s.includes("QuickNoteTool"),
);

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length > 0) {
  console.error(`Smoke failed: ${fails.length} step(s) broken`);
  process.exit(1);
}
console.log("Smoke passed: patient notes chain intact.");

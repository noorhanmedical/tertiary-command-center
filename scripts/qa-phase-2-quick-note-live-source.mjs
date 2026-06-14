// QA — Phase 2 Quick Note is wired to a live canonical source.
//
// Run: node scripts/qa-phase-2-quick-note-live-source.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const REQUIRED = [
  "shared/schema/patientNotes.ts",
  "server/repositories/patientNotes.repo.ts",
  "server/routes/patientNotes.ts",
  "client/src/lib/patientNotesApi.ts",
  "client/src/components/portal/QuickNoteTool.tsx",
  "client/src/components/portal/PatientNotesPanel.tsx",
  "migrations/0030_add_patient_notes.sql",
];
for (const f of REQUIRED) {
  if (!fs.existsSync(path.join(root, f))) failures.push(`missing ${f}`);
}

const schema = fs.readFileSync(path.join(root, "shared/schema/patientNotes.ts"), "utf8");
if (!schema.includes('pgTable("patient_notes"')) {
  failures.push("schema must define pgTable('patient_notes')");
}
const REQUIRED_NOTE_TYPES = ["quick_note", "call_note", "acs_note", "admin_note", "system_note"];
for (const t of REQUIRED_NOTE_TYPES) {
  if (!schema.includes(`"${t}"`)) failures.push(`PATIENT_NOTE_TYPES missing "${t}"`);
}

const routes = fs.readFileSync(path.join(root, "server/routes/patientNotes.ts"), "utf8");
const REQUIRED_ROUTES = [
  'app.get("/api/patient-notes"',
  'app.post("/api/patient-notes"',
  'app.patch("/api/patient-notes/:id/archive"',
];
for (const r of REQUIRED_ROUTES) {
  if (!routes.includes(r)) failures.push(`patientNotes route missing ${r}`);
}
if (!routes.includes("requirePortalRole")) {
  failures.push("patientNotes routes must be gated by requirePortalRole");
}
if (!/actorUserId = req\.session\?\.userId/.test(routes)) {
  failures.push("author must come from session.userId, never from body");
}

const tool = fs.readFileSync(path.join(root, "client/src/components/portal/QuickNoteTool.tsx"), "utf8");
if (!tool.includes("createPatientNote(")) {
  failures.push("QuickNoteTool must POST via createPatientNote");
}
if (!tool.includes("portal-quick-note")) {
  failures.push("QuickNoteTool must expose data-testid=portal-quick-note");
}
// No fake save indicators.
const FORBIDDEN = ["fakeSave", "mockSave", "fakeSaved", "fakeNote"];
for (const phrase of FORBIDDEN) {
  if (tool.includes(phrase)) {
    failures.push(`QuickNoteTool must not contain fake-save pattern "${phrase}"`);
  }
}

// Wired into shell left rail.
const shell = fs.readFileSync(path.join(root, "client/src/components/portal/TeamPortalShell.tsx"), "utf8");
if (!shell.includes('"quickNote"')) {
  failures.push("TeamPortalShell must expose the quickNote tab kind");
}
if (!shell.includes("left-rail-tool-quick-note")) {
  failures.push("TeamPortalShell must have the Quick Note left-rail button");
}
if (!shell.includes("QuickNoteTool")) {
  failures.push("TeamPortalShell must import + render QuickNoteTool in the playground");
}

// Notes also visible in the center canvas.
const canvas = fs.readFileSync(path.join(root, "client/src/components/portal/PatientCommandCanvas.tsx"), "utf8");
if (!canvas.includes("PatientNotesPanel")) {
  failures.push("PatientCommandCanvas must mount PatientNotesPanel");
}

if (failures.length > 0) {
  console.error("Phase-2 quick-note-live-source QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-2 quick-note-live-source QA passed.");

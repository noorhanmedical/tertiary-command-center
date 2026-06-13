// QA — Quick Note left-rail tool decision.
//
// Phase 1.7 audit found no honest backend for a general patient
// "quick note" write: only `generated_notes` (qualification / batch /
// procedure-generated) exists. Adding a Quick Note tool would either
// repurpose an existing table for the wrong domain or fabricate a
// write surface.
//
// Decision: **Deferred** to Phase 2 once a `patient_notes` table or
// equivalent is canonical. The decision must be documented in
// docs/architecture/team-portal-left-tools-rail.md so a future
// engineer doesn't accidentally add a fake Quick Note button.
//
// This QA asserts:
//   1. No `left-rail-tool-quick-note` button exists in the shell.
//   2. The audit doc explicitly labels Quick Note as Deferred.
//
// Run: node scripts/qa-team-portal-quick-note-deferred-doc.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

function requireText(rel, needles) {
  const src = read(rel);
  if (src === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!src.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}

function requireNotText(rel, needles, label) {
  const src = read(rel);
  if (src === null) return;
  for (const n of needles) if (src.includes(n)) failures.push(`${label}: forbidden "${n}" in ${rel}`);
}

requireNotText(
  "client/src/components/portal/TeamPortalShell.tsx",
  [
    "left-rail-tool-quick-note",
    "QuickNoteTab",
    "PortalQuickNoteTab",
  ],
  "Quick Note must not appear in the shell until a canonical patient-note writer exists",
);

requireText("docs/architecture/team-portal-left-tools-rail.md", [
  "Quick Note",
  "Deferred",
]);

if (failures.length > 0) {
  console.error("Quick Note deferred-doc QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Quick Note deferred-doc QA passed.");

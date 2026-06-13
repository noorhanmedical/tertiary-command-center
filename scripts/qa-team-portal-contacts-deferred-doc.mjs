// QA — Internal Contacts / Clinic Directory left-rail tool decision.
//
// Phase 1.7 audit found no canonical contacts source: only
// `outreach_schedulers` (one row per scheduler with facility mapping)
// exists. That covers scheduler→facility routing but does NOT cover
// clinic phones, physician contacts, vendor / report contacts, or
// escalation contacts.
//
// Decision: **Deferred** to Phase 2 once a `contacts` table or
// equivalent canonical source exists. The decision must be documented
// in docs/architecture/team-portal-left-tools-rail.md.
//
// This QA asserts:
//   1. No `left-rail-tool-contacts` button exists in the shell.
//   2. The audit doc explicitly labels Internal Contacts as Deferred.
//
// Run: node scripts/qa-team-portal-contacts-deferred-doc.mjs

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
    "left-rail-tool-contacts",
    "ContactsTab",
    "PortalContactsTab",
    "ClinicDirectoryTab",
  ],
  "Internal Contacts must not appear in the shell until a canonical contacts source exists",
);

requireText("docs/architecture/team-portal-left-tools-rail.md", [
  "Internal Contacts",
  "Deferred",
]);

if (failures.length > 0) {
  console.error("Internal Contacts deferred-doc QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Internal Contacts deferred-doc QA passed.");

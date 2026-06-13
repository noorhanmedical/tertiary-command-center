// QA — Templates / Staff Resources insert-into-composer handoff.
//
// Asserts:
//   1. PortalTemplatesResourcesTab exposes onInsertIntoComposer.
//   2. Email-template kinds expose the "Insert into composer" button.
//   3. The shell wires the handoff via pendingEmailTemplate state and
//      switches the active tab to the Email Composer.
//   4. The Email Composer adopts prefilledTemplate.
//
// Run: node scripts/qa-team-portal-templates-insert-email-composer.mjs

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

const tab = "client/src/components/portal/PortalTemplatesResourcesTab.tsx";
const composer = "client/src/components/portal/PortalEmailComposerTab.tsx";
const shell = "client/src/components/portal/TeamPortalShell.tsx";

requireText(tab, [
  "onInsertIntoComposer",
  // Button is gated to email-template kinds.
  "portal-templates-resources-insert-",
  'r.kind === "email-template"',
]);

requireText(composer, [
  "prefilledTemplate",
  "onClearPrefilledTemplate",
  "setSubject(prefilledTemplate.subject)",
  "setBody(prefilledTemplate.body)",
]);

requireText(shell, [
  "pendingEmailTemplate",
  "setPendingEmailTemplate",
  "prefilledTemplate={pendingEmailTemplate}",
  // The handoff opens the email tab.
  'openPortalTab("email")',
]);

if (failures.length > 0) {
  console.error("Templates → Email Composer insert handoff QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Templates → Email Composer insert handoff QA passed.");

// QA — Marketing → Email Composer attachment handoff.
//
// Asserts:
//   1. PortalMarketingTab exposes the compose-email handoff button.
//   2. TeamPortalShell wires the handoff into the Email Composer tab
//      via pendingEmailAttachments state.
//   3. Email Composer adopts pre-attached material IDs.
//
// Run: node scripts/qa-team-portal-marketing-email-attachment-flow.mjs

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

const marketing = "client/src/components/portal/PortalMarketingTab.tsx";
const composer = "client/src/components/portal/PortalEmailComposerTab.tsx";
const shell = "client/src/components/portal/TeamPortalShell.tsx";

requireText(marketing, [
  "onComposeEmailWithMaterials",
  'data-testid="portal-marketing-compose-email"',
  // The handoff button passes the picked material(s).
  "onComposeEmailWithMaterials([selectedMaterialId])",
]);

requireText(composer, [
  "preAttachedMaterialIds",
  "onClearPreAttached",
  // The composer adopts the materials via an effect.
  "setAttachedIds(new Set(preAttachedMaterialIds))",
]);

requireText(shell, [
  "pendingEmailAttachments",
  "setPendingEmailAttachments",
  // The shell hands the picked materials into the composer.
  "preAttachedMaterialIds={pendingEmailAttachments}",
]);

if (failures.length > 0) {
  console.error("Marketing → Email attachment flow QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Marketing → Email attachment flow QA passed.");

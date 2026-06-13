// QA — Templates / Staff Resources left-rail tool exists, is wired
// into the center canvas, and is SEPARATE from the patient-facing
// Marketing Materials catalog.
//
// Run: node scripts/qa-team-portal-templates-resources-tool.mjs

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

const data = "client/src/lib/portal/staffResources.ts";
const tab = "client/src/components/portal/PortalTemplatesResourcesTab.tsx";
const shell = "client/src/components/portal/TeamPortalShell.tsx";

// 1) Staff-facing catalog exists and exposes every resource kind.
requireText(data, [
  "STAFF_RESOURCES",
  '"email-template"',
  '"call-script"',
  '"prep-language"',
  '"sop"',
  '"faq"',
]);

// 2) Patient-facing brochures are NOT duplicated here.
requireNotText(
  data,
  [
    "BrainWave Brochure",
    "VitalWave Info Sheet",
    "Ultrasound Prep",
  ],
  "STAFF_RESOURCES must not duplicate patient-facing MARKETING_MATERIALS — use the Marketing tool for those",
);

// 3) Tab component renders the catalog + the per-kind tabs.
requireText(tab, [
  "PortalTemplatesResourcesTab",
  "STAFF_RESOURCES",
  'data-testid="portal-templates-resources"',
  'data-testid="portal-templates-resources-tablist"',
  // Insert-into-composer support — the testid is templated with the
  // resource id, so we check the prefix string rather than the full
  // data-testid="..." form.
  "onInsertIntoComposer",
  "portal-templates-resources-insert-",
]);

// 4) Shell wires the left-rail tool + center-canvas tab.
requireText(shell, [
  "left-rail-tool-resources",
  '"resources"',
  "PortalTemplatesResourcesTab",
  '<PortalTemplatesResourcesTab',
  'data-testid="playground-templates-resources"',
]);

if (failures.length > 0) {
  console.error("Team Portal templates / resources tool QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal templates / resources tool QA passed.");

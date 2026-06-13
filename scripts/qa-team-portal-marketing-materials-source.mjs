// QA — Marketing Materials are pulled from the existing canonical
// source (Document Library / Drive marketing-materials backend) — NOT
// duplicated in a fake parallel catalog.
//
// Canonical source:
//   - server/services/marketingMaterials.ts → MARKETING_MATERIALS
//   - GET /api/outreach/materials (proxied through email.ts)
//   - fetchMarketingMaterials helper in
//     client/src/lib/portal/commandCenterApi.ts
//
// Run: node scripts/qa-team-portal-marketing-materials-source.mjs

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

requireText("server/services/marketingMaterials.ts", [
  "MARKETING_MATERIALS",
  "MarketingMaterial",
]);

requireText("server/routes/email.ts", [
  "MARKETING_MATERIALS",
  '"/api/outreach/materials"',
]);

requireText("client/src/lib/portal/commandCenterApi.ts", [
  "fetchMarketingMaterials",
  "/api/outreach/materials",
]);

// The marketing tab + email composer must both pull from the same
// fetcher — no parallel catalog.
requireText("client/src/components/portal/PortalMarketingTab.tsx", [
  "fetchMarketingMaterials",
]);
requireText("client/src/components/portal/PortalEmailComposerTab.tsx", [
  "fetchMarketingMaterials",
]);

// Forbid an alternative client-side hardcoded marketing-materials
// catalog.
requireNotText(
  "client/src/components/portal/PortalEmailComposerTab.tsx",
  [
    "MARKETING_MATERIALS",
    "BrainWave Brochure",
    "VitalWave Info Sheet",
  ],
  "Email composer must not hardcode marketing materials — pull from /api/outreach/materials",
);

if (failures.length > 0) {
  console.error("Team Portal marketing materials source QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal marketing materials source QA passed.");

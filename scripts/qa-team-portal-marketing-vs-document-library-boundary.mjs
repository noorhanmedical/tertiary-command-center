// QA — Marketing Materials and Document Library are SEPARATE surfaces.
//
//   - Marketing (patient-facing brochures)
//       backend:  /api/outreach/materials
//                 server/services/marketingMaterials.ts
//       helper:   fetchMarketingMaterials
//       UI:       PortalMarketingTab + PortalEmailComposerTab (attach)
//
//   - Document Library (internal / shared documents)
//       backend:  /api/documents-library
//                 client/src/hooks/api/documents-library.ts
//       UI:       PortalDocumentLibraryTab
//
// Each tab must use ONLY its own source. The Marketing tab must not
// hit /api/documents-library; the Document Library tab must not hit
// /api/outreach/materials.
//
// Run: node scripts/qa-team-portal-marketing-vs-document-library-boundary.mjs

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

const marketing = "client/src/components/portal/PortalMarketingTab.tsx";
const docLib = "client/src/components/portal/PortalDocumentLibraryTab.tsx";

requireText(marketing, [
  "fetchMarketingMaterials",
  "/api/outreach",
]);
requireNotText(
  marketing,
  ["/api/documents-library", "useDocumentLibrary"],
  "Marketing tab must not pull from the Document Library API",
);

requireText(docLib, [
  "useDocumentLibrary",
  "/api/documents-library",
]);
requireNotText(
  docLib,
  ["fetchMarketingMaterials", "/api/outreach/materials", "/api/outreach/send-material"],
  "Document Library tab must not pull from the Marketing materials API",
);

if (failures.length > 0) {
  console.error("Marketing ↔ Document Library boundary QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Marketing ↔ Document Library boundary QA passed.");

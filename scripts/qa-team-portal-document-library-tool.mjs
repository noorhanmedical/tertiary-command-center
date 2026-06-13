// QA — Document Library left-rail tool exists, opens in the center
// canvas, and reuses the canonical Document Library hook + API.
//
// Run: node scripts/qa-team-portal-document-library-tool.mjs

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

const tab = "client/src/components/portal/PortalDocumentLibraryTab.tsx";
const shell = "client/src/components/portal/TeamPortalShell.tsx";
const hook = "client/src/hooks/api/documents-library.ts";

requireText(tab, [
  "PortalDocumentLibraryTab",
  "useDocumentLibrary",
  "useDocumentLibraryMeta",
  'data-testid="portal-document-library"',
  'data-testid="portal-document-library-search"',
  'data-testid="portal-document-library-list"',
  // Open / download via the canonical downloadUrl.
  "d.downloadUrl",
]);

requireText(shell, [
  '"documentLibrary"',
  "PortalDocumentLibraryTab",
  '<PortalDocumentLibraryTab',
  'data-testid="playground-document-library"',
  // Left-rail button.
  'testId="left-rail-tool-document-library"',
]);

requireText(hook, [
  "useDocumentLibrary",
  "/api/documents-library",
]);

if (failures.length > 0) {
  console.error("Document Library tool QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Document Library tool QA passed.");

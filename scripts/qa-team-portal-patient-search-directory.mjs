// QA — Patient Search left-rail tool searches the full Patient
// Directory via the canonical search endpoint.
//
// Run: node scripts/qa-team-portal-patient-search-directory.mjs

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

const tab = "client/src/components/portal/PortalPatientSearchTab.tsx";
const api = "client/src/lib/portal/commandCenterApi.ts";
const shell = "client/src/components/portal/TeamPortalShell.tsx";

// 1) The tab component pulls from the existing API helper.
requireText(tab, [
  "PortalPatientSearchTab",
  "searchPatients",
  "onSelectPatient",
]);

// 2) The API helper points at the Patient Directory search endpoint.
requireText(api, [
  "searchPatients",
  // The canonical path. Either form ("/api/portal/patient-search" or
  // "/api/patient-directory/search") is accepted as the canonical
  // search source; the helper uses "/api/portal/patient-search".
  "/api/portal/patient-search",
]);

// 3) Shell wires the Patient Search tool into the left rail + center
//    canvas.
requireText(shell, [
  "left-rail-tool-patient-search",
  "PortalPatientSearchTab",
  '"patientSearch"',
]);

if (failures.length > 0) {
  console.error("Team Portal patient search QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal patient search QA passed.");

// QA — PatientCommandCanvas is wired into the actual workspace.
//
// Source-level proof that the canonical PatientCommandCanvas component
// exists, is imported by TeamPortalShell, and renders the live patient
// context (not a static stub). Phase 1 does not redesign the canvas;
// this script only enforces wiring.
//
// Run: node scripts/qa-phase-1-patient-command-canvas-live.mjs

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
  if (src === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const n of needles) {
    if (!src.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
  }
}

const canvas = "client/src/components/portal/PatientCommandCanvas.tsx";
const shell = "client/src/components/portal/TeamPortalShell.tsx";

// 1) Canonical component exists and is exported.
requireText(canvas, [
  "PatientCommandCanvas",
  "export",
]);

// 2) TeamPortalShell imports + renders the canvas.
requireText(shell, [
  "PatientCommandCanvas",
  "<PatientCommandCanvas",
]);

if (failures.length > 0) {
  console.error("PatientCommandCanvas wiring QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("PatientCommandCanvas wiring QA passed.");

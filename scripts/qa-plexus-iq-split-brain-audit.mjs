// QA: Plexus IQ split-brain audit (Batch 23).
//
// Asserts the audit doc exists with the load-bearing findings AND
// re-verifies (independently of the source scanner) that no Plexus
// IQ service writes operational workflow tables.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}
function requireFile(rel) {
  const c = read(rel);
  if (c === null) failures.push(`Missing file: ${rel}`);
  return c;
}
function requireText(rel, needles) {
  const c = read(rel);
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!c.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}

const DOC = "docs/architecture/plexus-iq-split-brain-audit.md";
requireFile(DOC);
requireText(DOC, [
  "What Plexus IQ reads",
  "What Plexus IQ writes",
  "Operational Queue",
  "Team Tasks",
  "Patient Directory",
  "Execution Case state",
  "billing readiness",
  "qualification decisions",
  "Admin Review",
  "intelligence layer",
  "read-model",
  "Identified split-brain risks",
  "Required future fix",
  "No Plexus IQ runtime change",
  "patient_screenings.reasoning",
]);

// Independent verification — Plexus IQ services have NO writes to
// the six canonical operational tables.
const FORBIDDEN_IDENTIFIERS = [
  "patientExecutionCases",
  "outreachCalls",
  "schedulerAssignments",
  "plexusTasks",
  "patientJourneyEvents",
  "schedulingTriageCases",
];

function walk(dir, files) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (["node_modules", "dist"].includes(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, files);
    else if (/\.(ts|mts|cts)$/.test(e.name)) files.push(abs);
  }
}

const plexusFiles = [];
walk(path.join(root, "server/services/plexusIq"), plexusFiles);

for (const abs of plexusFiles) {
  const rel = path.relative(root, abs);
  if (rel.includes("/__tests__/") || rel.endsWith(".test.ts")) continue;
  const src = fs.readFileSync(abs, "utf8");
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const id of FORBIDDEN_IDENTIFIERS) {
    const writeNear = new RegExp(
      `(?:insert|update|delete)\\(\\s*${id}\\b`,
    );
    if (writeNear.test(codeOnly)) {
      failures.push(
        `Plexus IQ split-brain HARD failure: ${rel} writes ${id} — Plexus IQ must remain read-model/intelligence`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Plexus IQ split-brain audit QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Plexus IQ split-brain audit QA passed.");

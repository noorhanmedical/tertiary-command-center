// QA: platform-wide split-brain audit (Batch 1 of split-brain run).
//
// Source-invariant check that the audit doc exists, references every
// major workflow, classifies risk, and includes the load-bearing
// anti-patterns and the Plexus IQ rule. No DB. No app boot. No PHI.

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
  if (c === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (!c.includes(needle)) failures.push(`Missing "${needle}" in ${rel}`);
  }
}

const DOC = "docs/architecture/platform-split-brain-audit.md";
requireFile(DOC);
requireText(DOC, [
  // Core architecture rule.
  "one canonical owner",
  "one canonical write path",
  "one canonical read model",
  "clear adapters for legacy routes",
  "no duplicate side-effect writers",
  "no hidden shadow systems",
  "no UI surface acting as its own backend brain",
  // Major workflows.
  "Engagement Center",
  "Outreach",
  "Team Portal",
  "Operational Queue",
  "Team Tasks",
  "Patient Directory",
  "Patient Execution Cases",
  "Journey Events",
  "Scheduler assignments",
  "Ancillary scheduling",
  "Ancillary documents",
  "PDF preview",
  "Billing readiness",
  "Billing / claims / remittance",
  "Admin Review",
  "Qualification engine",
  "Plexus IQ",
  "Background jobs",
  "EMR",
  "Clinical Evidence Store",
  "ICD suggestions",
  "Research workflows",
  // Risk levels surface.
  "Split-brain risk level",
  "critical",
  "high",
  "medium",
  "low",
  "none",
  // Plexus IQ rule.
  "intelligence",
  "read-model",
  "MUST NOT",
  // Anti-patterns and stop policy.
  "No BS patches",
  "No parallel brains",
  "No duplicated ownership",
  "No shadow systems",
  "No UI as backend brain",
  "No unsafe runtime fixes",
  "STOP",
]);

if (failures.length > 0) {
  console.error("Platform split-brain audit QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Platform split-brain audit QA passed.");

// QA: canonical workflow ownership registry (Batch 2 of split-brain run).
//
// Source-invariant pinning the registry doc + the load-bearing
// canonical owners. No DB. No app boot. No PHI.

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

const DOC = "docs/architecture/canonical-workflow-ownership-registry.md";
requireFile(DOC);
requireText(DOC, [
  // Per-area canonical statements.
  "Engagement Center",
  "the patient engagement workflow end-to-end",
  "Team Portal",
  "consumption of assigned work",
  "Patient Directory",
  "canonical patient identity",
  "Execution Case",
  "patient engagement lifecycle state",
  "Journey Events",
  "appendJourneyEvent",
  "Team Tasks",
  "actionable user work",
  "Operational Queue",
  "read-only operational projection",
  "Admin Review",
  "approval review flow",
  "Qualification Engine",
  "qualification logic",
  "Billing Readiness",
  "billing readiness state",
  "Billing",
  "all money math",
  "Plexus IQ",
  "intelligence",
  "read-model",
  "Clinical Evidence Store",
  "normalized clinical evidence",
  "EMR adapters",
  "EMR import / sync only",
  // Cross-cutting invariants.
  "One canonical writer per canonical table",
  "outreach_calls",
  "createOutreachCallAtomic",
  "patient_journey_events",
  "scheduler_assignments",
  "patient_execution_cases",
  "plexus_tasks",
  "scheduling_triage_cases",
  // No-BS rules.
  "No parallel brains",
  "No shadow systems",
  "No UI surface acts as its own backend brain",
  // Plexus IQ rule.
  "intelligence / read-model / aggregation",
  "STOPS",
]);

if (failures.length > 0) {
  console.error("Canonical workflow ownership registry QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Canonical workflow ownership registry QA passed.");

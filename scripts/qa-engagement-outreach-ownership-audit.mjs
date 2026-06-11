// QA: engagement/outreach ownership audit (Batch 4 of split-brain run).
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

const DOC = "docs/architecture/engagement-outreach-ownership-audit.md";
requireFile(DOC);
requireText(DOC, [
  "What is Engagement Center today",
  "What is Outreach today",
  "Outreach should be a sub-workflow",
  "/api/outreach/calls",
  "/api/engagement-center/call-result",
  "outreach_calls",
  "patient_execution_cases",
  "patient_journey_events",
  "scheduler_assignments",
  "scheduling_triage_cases",
  "plexus_tasks",
  "split-brain",
  "Target architecture",
  "Legacy adapter strategy",
  "safe now",
  "Ali approval",
  "Plexus IQ impact",
  "None expected",
  "recordCallResult",
  "byte-for-byte",
  "compatibility adapter",
]);

if (failures.length > 0) {
  console.error("Engagement/Outreach ownership audit QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement/Outreach ownership audit QA passed.");

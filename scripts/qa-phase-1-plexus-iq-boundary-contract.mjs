// QA: Phase 1 Plexus IQ boundary contract (Batch D1).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/phase-1-plexus-iq-boundary-contract.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else {
  for (const n of [
    "Plexus IQ scope in Phase 1",
    "Batch Flow",
    "Visit vs Outreach",
    "Qualification reasoning",
    "Admin Review support",
    "Plexus IQ is NOT Mission Control",
    "Mission Control comes LATER",
    "Assignment ownership",
    "Call-result ownership",
    "Operational workflow truth",
    "Billing dashboards",
    "Productivity metrics",
    "Financial metrics",
    "Plexus IQ UI behavior protection",
    "Plexus IQ runtime behavior protection",
    "Ali explicitly approves",
    "patient_execution_cases",
    "outreach_calls",
    "scheduler_assignments",
    "plexus_tasks",
    "patient_journey_events",
    "scheduling_triage_cases",
  ]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);
}

if (failures.length > 0) {
  console.error("Phase 1 Plexus IQ boundary contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 Plexus IQ boundary contract QA passed.");

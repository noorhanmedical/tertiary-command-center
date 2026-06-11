// QA: Phase 1 Batch Flow handoff contract (Batch D4).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/phase-1-batch-flow-handoff-contract.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "Batch Flow",
  "Visit vs Outreach",
  "Qualification / reasoning",
  "Admin Review",
  "Engagement candidate",
  "Batch Flow does NOT own operational call list",
  "Plexus IQ does NOT own assignment",
  "Admin Review does NOT own call results",
  "Engagement owns operational workflow",
  "Team Portal consumes assigned work",
  "No split-brain",
  "Plexus IQ posture",
  "Admin Review posture",
  "patient_screenings.reasoning",
  "patient_execution_cases",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

// Required upstream route file present.
const BATCHES = "server/routes/batches.ts";
if (read(BATCHES) === null) failures.push(`Batch Flow route missing: ${BATCHES}`);

if (failures.length > 0) {
  console.error("Phase 1 Batch Flow handoff contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 Batch Flow handoff contract QA passed.");

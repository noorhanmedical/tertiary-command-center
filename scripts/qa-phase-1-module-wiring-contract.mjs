// QA: Phase 1 module wiring contract (Batch C1).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/phase-1-module-wiring-contract.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else {
  const needles = [
    "Handoff 1", "Handoff 2", "Handoff 3", "Handoff 4", "Handoff 5",
    "Handoff 6", "Handoff 7", "Handoff 8", "Handoff 9", "Handoff 10",
    "Source owner", "Target consumer", "Canonical ID", "Status field",
    "Audit event", "Failure/blocker behavior", "No split-brain rule",
    "Plexus IQ is not Mission Control",
    "Team Portal CONSUMES",
    "Engagement Center owns operational workflow",
  ];
  for (const n of needles) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);
}

if (failures.length > 0) {
  console.error("Phase 1 module wiring contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 module wiring contract QA passed.");

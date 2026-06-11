// QA: Phase 1 outreach atomic write contract (Batch B1).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }
function requireFile(rel) { const c = read(rel); if (c === null) failures.push(`Missing file: ${rel}`); return c; }
function requireText(rel, needles) {
  const c = read(rel); if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!c.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}

const DOC = "docs/architecture/phase-1-outreach-atomic-write-contract.md";
requireFile(DOC);
requireText(DOC, [
  "POST /api/outreach/calls",
  "createOutreachCallAtomic",
  "outreach_calls",
  "appointmentStatus",
  "attemptNumber",
  "markSchedulerAssignmentCompleted",
  "ensureCanonicalSpineForScreening",
  "res.status(201).json(call)",
  "compatibility adapter",
  "Engagement Center remains the operational owner",
  "Plexus IQ",
  "Admin Review",
  "untouched",
  "USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE",
  "default OFF",
]);

if (failures.length > 0) {
  console.error("Phase 1 outreach atomic write contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 outreach atomic write contract QA passed.");

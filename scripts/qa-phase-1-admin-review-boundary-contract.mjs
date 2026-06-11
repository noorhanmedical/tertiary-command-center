// QA: Phase 1 Admin Review boundary contract (Batch D2).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/phase-1-admin-review-boundary-contract.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "Admin Review scope in Phase 1",
  "Reasoning review",
  "Evidence review",
  "Regeneration triggers",
  "Approval / commit",
  "upstream of Engagement",
  "Admin Review does NOT own",
  "Call list",
  "Team assignment",
  "Call results",
  "Invoicing",
  "Billing final state",
  "Team Portal work",
  "Admin Review UI protection",
  "Admin Review runtime protection",
  "Ali explicitly approves",
  "patient_screenings.reasoning",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

if (failures.length > 0) {
  console.error("Phase 1 Admin Review boundary contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 Admin Review boundary contract QA passed.");

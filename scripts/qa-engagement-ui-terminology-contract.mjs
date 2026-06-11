// QA: engagement UI terminology contract (Batch 22).
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

const DOC = "docs/architecture/engagement-ui-terminology-contract.md";
requireFile(DOC);
requireText(DOC, [
  "Engagement Center",
  "Call List",
  "Call Attempt",
  "Call Result",
  "Next Action",
  "Team Member",
  "Patient Care Specialist",
  "Ancillary Care Specialist",
  "Scheduler",
  "Outreach",
  "Plexus IQ",
  "intelligence layer",
  "read-model",
  "aggregation",
  "Legacy carve-out",
  "Hard-stops",
]);

if (failures.length > 0) {
  console.error("Engagement UI terminology contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement UI terminology contract QA passed.");

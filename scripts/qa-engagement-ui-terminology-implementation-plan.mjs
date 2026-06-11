// QA: engagement UI terminology implementation plan (Batch 18).
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

const DOC = "docs/architecture/engagement-ui-terminology-implementation-plan.md";
requireFile(DOC);
requireText(DOC, [
  "Team Member",
  "Patient Care Specialist",
  "Ancillary Care Specialist",
  "Call Attempt",
  "Call List",
  "Call Result",
  "Next Action",
  "Scheduler",
  "Outreach",
  "Legacy carve-out",
  "operator-visible",
  "Ali",
  "Hard-stops",
  "Plexus IQ",
]);

if (failures.length > 0) {
  console.error("Engagement UI terminology implementation plan QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement UI terminology implementation plan QA passed.");

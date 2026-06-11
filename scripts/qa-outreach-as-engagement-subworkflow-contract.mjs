// QA: outreach-as-engagement-subworkflow contract (Batch 13 of split-brain run).
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

const DOC = "docs/architecture/outreach-as-engagement-subworkflow-contract.md";
requireFile(DOC);
requireText(DOC, [
  "Outreach is NOT a standalone product owner",
  "SUB-WORKFLOW inside Engagement Center",
  "compatibility adapter",
  "/api/outreach/calls",
  "USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE",
  "Engagement Center call-result service",
  "Team Portal",
  "consumer",
  "Plexus IQ",
  "Untouched",
  "intelligence / read-model / aggregation",
  "Order of operations",
  "Batch 14",
  "Batch 19",
  "Hard-stops",
]);

if (failures.length > 0) {
  console.error("Outreach-as-subworkflow contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Outreach-as-subworkflow contract QA passed.");

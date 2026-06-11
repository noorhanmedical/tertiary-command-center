// QA: call-result delegation blockers resolution summary (Batch H).
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

const DOC = "docs/architecture/call-result-delegation-blockers-resolution-summary.md";
requireFile(DOC);
requireText(DOC, [
  "What this run delivered",
  "What adapter suppression resolved",
  "What remains unresolved",
  "Engagement-route delegation",
  "Outreach-route delegation",
  "Is engagement delegation now closer",
  "Is outreach delegation now closer",
  "What still needs Ali decision",
  "Exact next PR",
  "Plexus IQ",
  "Hard-stops respected",
  "ENGAGEMENT_SUPPRESSED_STEPS",
  "OUTREACH_SUPPRESSED_STEPS",
  "SUPPRESSED_STEP_REASON",
  // Pin batch list.
  "Batch A",
  "Batch B",
  "Batch C",
  "Batch D",
  "Batch E",
  "Batch F",
  "Batch G",
]);

if (failures.length > 0) {
  console.error("Blockers resolution summary QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Blockers resolution summary QA passed.");

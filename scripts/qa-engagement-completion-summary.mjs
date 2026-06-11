// QA: engagement completion summary (Batch 20).
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

const DOC = "docs/architecture/engagement-completion-summary.md";
requireFile(DOC);
requireText(DOC, [
  "PRs shipped in this run",
  "What is now delegated",
  "What is still flag-gated",
  "Does canonical plural endpoint exist",
  "Did UI switch",
  "Does call-list service exist",
  "What remains for Team Portal",
  "What remains for Outreach",
  "What remains for Journey Events",
  "What remains for Plexus IQ",
  "Exact next recommended run",
  "Hard-stops respected",
  "USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE",
  "USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_ENDPOINT",
  "USE_ENGAGEMENT_CANONICAL_CALL_LIST_READ",
  "VITE_USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_UI",
]);

if (failures.length > 0) {
  console.error("Engagement completion summary QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement completion summary QA passed.");

// QA: engagement blockers reduction summary (Batch 7 of arg-extensions run).
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

const DOC = "docs/architecture/call-result-engagement-blockers-reduction-summary.md";
requireFile(DOC);
requireText(DOC, [
  "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8",
  "engagementStatus semantics",
  "ownershipUpdated",
  "callbackHours",
  "triage payload",
  "task payload",
  "journey-event metadata",
  "ENGAGEMENT_STATUS_SEMANTICS",
  "Exact next PR",
  "USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE",
  "Plexus IQ",
  "Untouched",
]);

if (failures.length > 0) {
  console.error("Engagement blockers reduction summary QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement blockers reduction summary QA passed.");

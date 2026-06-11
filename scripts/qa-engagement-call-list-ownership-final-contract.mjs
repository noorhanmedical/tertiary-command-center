// QA: engagement call-list ownership final contract (Batch 13).
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

const DOC = "docs/architecture/engagement-call-list-ownership-final-contract.md";
requireFile(DOC);
requireText(DOC, [
  "Engagement Center owns call-list generation",
  "Team Portal CONSUMES assigned work",
  "Operational Queue is a read-only projection",
  "Team Tasks own actionable user work",
  "Outreach is a sub-workflow",
  "Plexus IQ",
  "read-model / intelligence",
  "No split-brain",
  "engagementCallListService",
  "USE_ENGAGEMENT_CANONICAL_CALL_LIST_READ",
]);

if (failures.length > 0) {
  console.error("Engagement call-list ownership final contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement call-list ownership final contract QA passed.");

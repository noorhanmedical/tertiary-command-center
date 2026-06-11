// QA: engagement UI canonical write switch plan (Batch 11).
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

const DOC = "docs/architecture/engagement-ui-canonical-write-switch-plan.md";
requireFile(DOC);
requireText(DOC, [
  "Current endpoint",
  "Target endpoint",
  "VITE_USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_UI",
  "Rollback",
  "Visual QA checklist",
  "Plexus IQ",
  "Untouched",
  "Hard-stops",
]);

if (failures.length > 0) {
  console.error("Engagement UI canonical write switch plan QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement UI canonical write switch plan QA passed.");

// QA: platform split-brain risk register (Batch 24).
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

const DOC = "docs/architecture/platform-split-brain-risk-register.md";
requireFile(DOC);
requireText(DOC, [
  "R-01",
  "R-02",
  "R-03",
  "R-04",
  "R-05",
  "R-06",
  "R-07",
  "R-08",
  "R-09",
  "R-10",
  "R-11",
  "R-12",
  "DispositionSheet",
  "patient_execution_cases",
  "patient_journey_events",
  "patient_screenings.reasoning",
  "Ali approval required",
  "Plexus IQ involved",
  "Plexus IQ summary",
  "critical",
  "Severity",
]);

if (failures.length > 0) {
  console.error("Platform split-brain risk register QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Platform split-brain risk register QA passed.");

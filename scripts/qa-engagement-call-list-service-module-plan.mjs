// QA: engagement call-list service module plan (Batch 14).
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

const DOC = "docs/architecture/engagement-call-list-service-module-plan.md";
requireFile(DOC);
requireText(DOC, [
  "Source tables",
  "patient_execution_cases",
  "scheduler_assignments",
  "patient_screenings",
  "Owner",
  "Engagement Center",
  "Read-model fields",
  "Route consumers",
  "Team Portal projection",
  "Operational Queue projection",
  "No writes from read model",
  "No Plexus IQ ownership",
  "engagementCallListService",
]);

if (failures.length > 0) {
  console.error("Engagement call-list service module plan QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement call-list service module plan QA passed.");

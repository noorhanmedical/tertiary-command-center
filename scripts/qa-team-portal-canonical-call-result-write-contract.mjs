// QA: Team Portal canonical call-result write contract (Batch 20).
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
function requireNotText(rel, needles, label) {
  const c = read(rel);
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (c.includes(n)) failures.push(`${label}: ${rel} contains "${n}"`);
}

const DOC = "docs/architecture/team-portal-canonical-call-result-write-contract.md";
requireFile(DOC);
requireText(DOC, [
  "Team Portal CONSUMES assigned work",
  "MUST NOT write `outreach_calls`",
  "MUST NOT write `scheduler_assignments`",
  "MUST NOT write `patient_execution_cases`",
  "MUST NOT append `patient_journey_events`",
  "Role / capability gate",
  "Patient Care Specialist",
  "Ancillary Care Specialist",
  "callbackAt rules",
  "Notes rules",
  "Journey Event audit expectations",
  "call_result_logged",
  "Plexus IQ",
  "Untouched",
  "Hard-stops",
]);

// Re-pin the existing scanner invariant: portal.ts has no direct
// writes to canonical workflow tables.
const PORTAL = "server/routes/portal.ts";
requireFile(PORTAL);
requireNotText(
  PORTAL,
  [
    "db.insert(patientExecutionCases",
    "db.update(patientExecutionCases",
    "db.insert(outreachCalls",
    "db.update(outreachCalls",
    "db.insert(schedulerAssignments",
    "db.update(schedulerAssignments",
    "db.insert(plexusTasks",
    "db.update(plexusTasks",
    "db.insert(patientJourneyEvents",
    "db.update(patientJourneyEvents",
    "db.insert(schedulingTriageCases",
    "db.update(schedulingTriageCases",
  ],
  "Team Portal contract: portal.ts MUST NOT write canonical workflow tables directly",
);

if (failures.length > 0) {
  console.error("Team Portal canonical call-result write contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal canonical call-result write contract QA passed.");

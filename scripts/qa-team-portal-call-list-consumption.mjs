// QA: Team Portal call-list consumption readiness (Batch F).
//
// Source-code invariant. Pins the contract doc + restates the
// "Team Portal does not own call-list generation / writes" rules
// at source-text level.
//
// No DB. No app boot. No network. No PHI.

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
  if (c === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (!c.includes(needle)) failures.push(`Missing "${needle}" in ${rel}`);
  }
}
function requireNotText(rel, needles, label) {
  const c = read(rel);
  if (c === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (c.includes(needle)) failures.push(`${label}: ${rel} contains "${needle}"`);
  }
}

const CONTRACT_REL =
  "docs/architecture/team-portal-call-list-consumption-readiness.md";
requireFile(CONTRACT_REL);

requireText(CONTRACT_REL, [
  // Product terminology.
  "Team Member",
  "Patient Care Specialist",
  "Ancillary Care Specialist",
  // Canonical service the future Team Portal write route delegates to.
  "recordCallResult",
  // Data sources Team Portal consumes.
  "outreach_calls",
  "Journey Event",
  "Team Tasks",
  "Operational Queue",
  // No direct writes statement.
  "no direct writes",
]);

// Portal route stays free of direct writes to canonical tables.
const PORTAL = "server/routes/portal.ts";
requireFile(PORTAL);
requireNotText(
  PORTAL,
  [
    "db.insert(schedulerAssignments",
    "db.update(schedulerAssignments",
    "db.delete(schedulerAssignments",
    "db.insert(patientExecutionCases",
    "db.update(patientExecutionCases",
    "db.delete(patientExecutionCases",
    "db.insert(outreachCalls",
    "db.update(outreachCalls",
    "db.insert(patientJourneyEvents",
    "db.update(patientJourneyEvents",
  ],
  "portal route must not directly write canonical call-list tables",
);

if (failures.length > 0) {
  console.error("Team Portal call-list consumption QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("Team Portal call-list consumption QA passed.");

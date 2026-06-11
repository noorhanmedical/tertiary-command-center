// QA: Team Portal outreach compatibility guard (Batch B11).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/phase-1-team-portal-outreach-compatibility-guard.md";
if (read(DOC) === null) failures.push(`Missing file: ${DOC}`);

// Required Team Portal panels still on disk.
for (const rel of [
  "client/src/components/portal/TeamPortalShell.tsx",
  "client/src/components/portal/PortalShell.tsx",
  "client/src/components/outreach/DispositionSheet.tsx",
  "client/src/components/outreach/CanonicalRowActions.tsx",
]) {
  if (read(rel) === null) failures.push(`Team Portal surface missing: ${rel}`);
}

// PatientCommandCanvas, SchedulePatientPlayground, CallListPanel — find any matching file.
function findFile(dir, pattern) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { if (findFile(abs, pattern)) return true; continue; }
    if (pattern.test(e.name)) return true;
  }
  return false;
}
for (const [label, re] of [
  ["PatientCommandCanvas", /PatientCommandCanvas\./],
  ["SchedulePatientPlayground", /SchedulePatientPlayground\./],
  ["CallListPanel", /CallListPanel\./],
]) {
  if (!findFile(path.join(root, "client/src"), re)) {
    failures.push(`Team Portal surface ${label} missing from client/src`);
  }
}

// No direct writes from portal.ts to canonical workflow tables.
const PORTAL = "server/routes/portal.ts";
if (read(PORTAL) !== null) {
  const src = read(PORTAL) ?? "";
  for (const v of [
    "db.insert(patientExecutionCases", "db.update(patientExecutionCases",
    "db.insert(patientJourneyEvents", "db.update(patientJourneyEvents",
    "db.insert(plexusTasks", "db.update(plexusTasks",
    "db.insert(schedulingTriageCases", "db.update(schedulingTriageCases",
  ]) {
    if (src.includes(v)) failures.push(`${PORTAL}: contains "${v}"`);
  }
}

if (failures.length > 0) {
  console.error("Team Portal outreach compatibility guard QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal outreach compatibility guard QA passed.");

// QA: Engagement + Team Portal duplicate warning bar (Batch B9).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const BAR = "client/src/components/patient-directory/EngagementHandoffDuplicateBar.tsx";
const c = read(BAR);
if (c === null) failures.push(`Missing file: ${BAR}`);
else for (const n of [
  "EngagementHandoffDuplicateBar",
  "flaggedCount",
  "blockedCount",
  "DuplicateWarningBadge",
  "Patient Directory warnings",
  "engagement-handoff-duplicate-bar",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${BAR}`);

// Engagement Center page still on disk.
for (const rel of [
  "client/src/pages/engagement-center.tsx",
  "client/src/components/portal/TeamPortalShell.tsx",
  "client/src/components/portal/PatientCommandCanvas.tsx",
  "client/src/components/outreach/CallListPanel.tsx",
]) if (read(rel) === null) failures.push(`Protected surface missing: ${rel}`);

if (failures.length > 0) {
  console.error("Engagement + Team Portal duplicate warning QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement + Team Portal duplicate warning QA passed.");

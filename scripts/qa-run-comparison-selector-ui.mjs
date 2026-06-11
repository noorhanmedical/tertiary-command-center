// QA: Run comparison selector UI (Batch B6).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const COMP = "client/src/components/plexus-iq/RunComparisonSelector.tsx";
const c = read(COMP);
if (c === null) failures.push(`Missing file: ${COMP}`);
else for (const n of [
  "RunComparisonSelector",
  "buildQualificationGroups",
  "selectAllRuns",
  "selectByDate",
  "selectByRuns",
  "selectNoRuns",
  "Newest first",
  "Oldest first",
  "Select all",
  "Clear",
  "run-comparison-selector",
  "run-comparison-select-all",
  "run-comparison-toggle-order",
  "run-comparison-clear",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${COMP}`);

// Component must NOT redesign Plexus IQ workspace — it's additive.
for (const rel of [
  "client/src/components/plexus-iq/PlexusIQWorkspace.tsx",
  "client/src/components/plexus-iq/PlexusIQBulkImportModal.tsx",
  "client/src/components/plexus-iq/PlexusIQAddPatientHub.tsx",
  "client/src/components/qualification/AdminReviewDialog.tsx",
]) if (read(rel) === null) failures.push(`Protected surface missing: ${rel}`);

if (failures.length > 0) {
  console.error("Run comparison selector QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Run comparison selector QA passed.");

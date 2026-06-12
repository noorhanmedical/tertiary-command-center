// QA: Patient Directory duplicate-warning live wiring (Batch F).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const HOOK = "client/src/lib/useLiveDuplicateWarnings.ts";
const c = read(HOOK);
if (c === null) failures.push(`Missing file: ${HOOK}`);
else for (const n of [
  "useLiveDuplicateWarnings",
  "fetchDuplicateWarningFacts",
  "computeDuplicateWarnings",
  "factsUnavailable",
  "currentPatients",
  "priorRunRoster",
  "selection",
  "DuplicateFactsTarget",
]) if (!c.includes(n)) failures.push(`${HOOK} missing "${n}"`);

// Hook does not introduce a new dependency.
if (c && /from "axios"|from "swr"/.test(c)) failures.push(`${HOOK} introduces unauthorized dependency`);

// Existing warning consumers still intact.
for (const rel of [
  "client/src/components/patient-directory/DuplicateWarningBadge.tsx",
  "client/src/components/patient-directory/AdminReviewDuplicateGuard.tsx",
  "client/src/components/patient-directory/EngagementHandoffDuplicateBar.tsx",
]) if (read(rel) === null) failures.push(`Required consumer surface missing: ${rel}`);

if (failures.length > 0) {
  console.error("Duplicate-warning live wiring QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Duplicate-warning live wiring QA passed.");

// QA: Plexus IQ hotfix — selected-run-only behavior is live.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const WK = read("client/src/components/plexus-iq/PlexusIQWorkspace.tsx") ?? "";

// §1 — Workspace tracks date vs run separately.
for (const n of [
  "selectedBatchByBucket",
  "allRunsModeByBucket",
  "resolveSelection",
  "siblingBucketsByGroupKey",
  "reduceToActive",
  // The "All runs for this date" mode is opt-in — never the default.
  "allRunsMode ?",
  "toggleBucketAllRuns",
  "setBucketRun",
]) if (!WK.includes(n)) failures.push(`PlexusIQWorkspace missing "${n}"`);

// §2 — Default selection points at the most recent sibling (latest in
//      the chronological ascending sort).
if (!/picked \?\? newest/.test(WK)) {
  failures.push("default selection must fall back to the most recent (newest) sibling batch");
}

// §3 — When allRunsMode is OFF, the source list filters to a single
//      batch — verify the WorklistGroupCard body uses `allRunsMode ?
//      allRunsPatients : ...` to pick the source.
if (!/allRunsMode\s*\?\s*allRunsPatients\s*:/.test(WK)) {
  failures.push("WorklistGroupCard must derive sourcePatients from allRunsMode / allRunsPatients");
}

// §4 — Compact run selector receives selectedBatchId.
if (!/<PlexusIQRunSelector[\s\S]+selectedBatchId=/.test(WK)) {
  failures.push("workspace must pass selectedBatchId into PlexusIQRunSelector");
}

if (failures.length > 0) {
  console.error("Selected-run-only behavior QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Selected-run-only behavior QA passed.");

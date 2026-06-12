// QA: Plexus IQ hotfix — compact run selector under the existing date card.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

// §1 — Compact selector module exists with all the pieces.
const SEL = "client/src/components/plexus-iq/PlexusIQRunSelector.tsx";
const sel = read(SEL);
if (sel === null) failures.push(`Missing file: ${SEL}`);
else for (const n of [
  "PlexusIQRunSelector",
  "PlexusIQRunSibling",
  "buildSiblingGroups",
  "plexus-iq-run-selector",
  "plexus-iq-run-row-",
  "plexus-iq-run-pick-",
  "plexus-iq-run-compare-",
  "plexus-iq-run-all",
  "plexus-iq-run-all-pick",
  "All runs for this date",
  "explicit only",
  "Active",
]) if (!sel.includes(n)) failures.push(`${SEL} missing "${n}"`);

// §2 — Workspace renders the compact selector inside WorklistGroupCard.
const WK = read("client/src/components/plexus-iq/PlexusIQWorkspace.tsx") ?? "";
for (const n of [
  '<PlexusIQRunSelector',
  "siblings",
  "selectedBatchId",
  "allRunsMode",
  "onSelectRun",
  "onSelectAllRuns",
]) if (!WK.includes(n)) failures.push(`PlexusIQWorkspace missing "${n}"`);

if (failures.length > 0) {
  console.error("Compact run selector under date QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Compact run selector under date QA passed.");

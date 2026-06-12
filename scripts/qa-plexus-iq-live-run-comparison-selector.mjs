// QA: Plexus IQ live compact run / compare selector (Part 4,
// hotfix-updated).
//
// After the hotfix the compact PlexusIQRunSelector lives under each
// date card with a per-row "Compare" chip. The old giant
// PlexusIQRunOrganizationPanel that previously embedded
// RunComparisonSelector is removed. The reusable RunComparisonSelector
// component is still exported for the standalone compare popover but
// is no longer required to render inside the workspace itself.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

// Compact selector + compare chip per run row.
const SEL = "client/src/components/plexus-iq/PlexusIQRunSelector.tsx";
const c = read(SEL);
if (c === null) failures.push(`Missing file: ${SEL}`);
else for (const n of [
  "PlexusIQRunSelector",
  "plexus-iq-run-selector",
  "plexus-iq-run-row-",
  "plexus-iq-run-pick-",
  "plexus-iq-run-compare-",
  "All runs for this date",
  "explicit only",
  "onCompareRun",
]) if (!c.includes(n)) failures.push(`${SEL} missing "${n}"`);

// Workspace consumes the selector with active state + sibling reduction.
const WK = read("client/src/components/plexus-iq/PlexusIQWorkspace.tsx") ?? "";
for (const n of [
  "selectedBatchByBucket",
  "allRunsModeByBucket",
  "reduceToActive",
  "<PlexusIQRunSelector",
]) if (!WK.includes(n)) failures.push(`PlexusIQWorkspace missing "${n}"`);

// The legacy RunComparisonSelector module is still on disk for the
// standalone compare popover surface.
const LEG = read("client/src/components/plexus-iq/RunComparisonSelector.tsx") ?? "";
if (!LEG.includes("RunComparisonSelector")) failures.push("RunComparisonSelector module missing");

// Removed giant panel must not return.
if (read("client/src/components/plexus-iq/PlexusIQRunOrganizationPanel.tsx") !== null) {
  failures.push("PlexusIQRunOrganizationPanel.tsx must be deleted by the hotfix");
}

const helper = read("client/src/lib/qualificationRunOrdering.ts") ?? "";
if (!helper.includes("makeRunLabel")) failures.push("makeRunLabel export missing");

if (failures.length > 0) {
  console.error("Plexus IQ live compact run / compare selector QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Plexus IQ live compact run / compare selector QA passed.");

// QA: Plexus IQ live RunComparisonSelector wiring (Part 4).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const PANEL = "client/src/components/plexus-iq/PlexusIQRunOrganizationPanel.tsx";
const c = read(PANEL);
if (c === null) failures.push(`Missing file: ${PANEL}`);
else {
  // Selector is imported + rendered + drives a RunSelection state.
  for (const n of [
    'from "@/components/plexus-iq/RunComparisonSelector"',
    "<RunComparisonSelector",
    "onChange={setSelection}",
    "selectAllRuns",
    "selectNoRuns",
    "selectByRuns",
    "Select all",
    "Clear",
    "Comparing",
    "RunSelection",
  ]) if (!c.includes(n)) failures.push(`${PANEL} missing "${n}"`);
  // Selection feeds the warning engine via useLiveDuplicateWarnings.
  if (!/useLiveDuplicateWarnings\([\s\S]+selection,?[\s\S]+\)/.test(c)) {
    failures.push(`${PANEL}: selection state must be passed into useLiveDuplicateWarnings`);
  }
}

// Run-label helper still exported.
const helper = read("client/src/lib/qualificationRunOrdering.ts") ?? "";
if (!helper.includes("makeRunLabel")) failures.push("makeRunLabel export missing");

if (failures.length > 0) {
  console.error("Plexus IQ live RunComparisonSelector wiring QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Plexus IQ live RunComparisonSelector wiring QA passed.");

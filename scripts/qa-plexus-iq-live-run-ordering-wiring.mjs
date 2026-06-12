// QA: Plexus IQ live run-ordering wiring (Parts 2 + 3, hotfix-updated).
//
// After the hotfix the giant PlexusIQRunOrganizationPanel is removed.
// Run ordering is wired inside PlexusIQWorkspace: each WorklistGroupCard
// runs orderPatientsWithinRun() before handing the patient list to
// QualificationPatientCardsPane.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const WK = "client/src/components/plexus-iq/PlexusIQWorkspace.tsx";
const wk = read(WK);
if (wk === null) failures.push(`Missing file: ${WK}`);
else {
  for (const n of [
    'from "@/components/plexus-iq/PlexusIQRunSelector"',
    'from "@/lib/qualificationRunOrdering"',
    "orderPatientsWithinRun(",
    "PlexusIQRunSelector",
  ]) if (!wk.includes(n)) failures.push(`${WK} missing "${n}"`);
  if (wk.includes("PlexusIQRunOrganizationPanel")) {
    failures.push(`${WK} must not re-import the removed giant panel`);
  }
}

// Compact selector module shape.
const SEL = "client/src/components/plexus-iq/PlexusIQRunSelector.tsx";
const sel = read(SEL);
if (sel === null) failures.push(`Missing file: ${SEL}`);
else for (const n of [
  "PlexusIQRunSelector",
  "PlexusIQRunSibling",
  "buildSiblingGroups",
  "All runs for this date",
  "Run ",
  "plexus-iq-run-selector",
  "plexus-iq-run-row-",
  "plexus-iq-run-pick-",
  "plexus-iq-run-all",
]) if (!sel.includes(n)) failures.push(`${SEL} missing "${n}"`);

// The removed giant panel file is gone.
if (read("client/src/components/plexus-iq/PlexusIQRunOrganizationPanel.tsx") !== null) {
  failures.push("PlexusIQRunOrganizationPanel.tsx must be deleted by the hotfix");
}

// Helper still exposes the ordering invariants.
const helper = read("client/src/lib/qualificationRunOrdering.ts") ?? "";
for (const n of [
  "orderPatientsWithinRun",
  "buildQualificationGroups",
  "selectAllRuns",
  "selectByRuns",
  "selectNoRuns",
  "makeRunLabel",
]) if (!helper.includes(n)) failures.push(`qualificationRunOrdering missing "${n}"`);

try {
  execSync(`npx tsx tests/unit/qualificationRunOrdering.test.ts`, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
} catch {
  failures.push("qualificationRunOrdering unit test FAILED");
}

if (failures.length > 0) {
  console.error("Plexus IQ live run-ordering wiring QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Plexus IQ live run-ordering wiring QA passed.");

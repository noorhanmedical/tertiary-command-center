// QA: Plexus IQ hotfix — no giant run panel.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

// §1 — The giant panel file is removed.
if (read("client/src/components/plexus-iq/PlexusIQRunOrganizationPanel.tsx") !== null) {
  failures.push("client/src/components/plexus-iq/PlexusIQRunOrganizationPanel.tsx must be deleted");
}

// §2 — The workspace must not import / render it.
const WK = read("client/src/components/plexus-iq/PlexusIQWorkspace.tsx") ?? "";
if (WK.includes("PlexusIQRunOrganizationPanel")) failures.push("workspace must not reference PlexusIQRunOrganizationPanel");
if (WK.includes("Qualification runs")) failures.push('workspace must not display "Qualification runs" header');
// The big "Compare against prior runs" header style must not return either.
if (/<RunComparisonSelector\s/.test(WK)) {
  failures.push("workspace must not embed the legacy RunComparisonSelector as a standalone full-width panel");
}

if (failures.length > 0) {
  console.error("Plexus IQ no-giant-run-panel QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Plexus IQ no-giant-run-panel QA passed.");

// QA: Plexus IQ hotfix — visible alphabetical / appointment-time
// ordering is enforced before the patient list renders.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

// §1 — Workspace orders the source patient list BEFORE handing it to
//      QualificationPatientCardsPane.
const WK = read("client/src/components/plexus-iq/PlexusIQWorkspace.tsx") ?? "";
if (!/patientsToRender\s*=\s*orderPatientsWithinRun\(/.test(WK)) {
  failures.push("PlexusIQWorkspace must build patientsToRender via orderPatientsWithinRun before rendering");
}

// §2 — Run the dedicated visible-ordering unit test.
try {
  execSync(`npx tsx tests/unit/visibleOrdering.test.ts`, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
} catch {
  failures.push("visibleOrdering test FAILED");
}

if (failures.length > 0) {
  console.error("Visible alphabetical order QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Visible alphabetical order QA passed.");

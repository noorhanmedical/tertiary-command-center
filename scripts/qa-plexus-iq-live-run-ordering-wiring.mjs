// QA: Plexus IQ live run-ordering wiring (Parts 2 + 3).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const WK = "client/src/components/plexus-iq/PlexusIQWorkspace.tsx";
const PANEL = "client/src/components/plexus-iq/PlexusIQRunOrganizationPanel.tsx";

const wk = read(WK);
if (wk === null) failures.push(`Missing file: ${WK}`);
else {
  // Workspace imports + renders the panel.
  for (const n of [
    'from "@/components/plexus-iq/PlexusIQRunOrganizationPanel"',
    "PlexusIQRunOrganizationPanel",
    "runOrgBatches",
  ]) if (!wk.includes(n)) failures.push(`${WK} missing "${n}"`);
  // Panel rendered in BOTH render branches: clinic-detail + legacy view.
  const panelRenderCount = (wk.match(/<PlexusIQRunOrganizationPanel/g) ?? []).length;
  if (panelRenderCount < 2) failures.push(`${WK}: panel should render in both clinic-detail + legacy views (found ${panelRenderCount})`);
}

const panel = read(PANEL);
if (panel === null) failures.push(`Missing file: ${PANEL}`);
else for (const n of [
  "orderPatientsWithinRun",
  "buildQualificationGroups",
  "RunComparisonSelector",
  "DuplicateWarningBadge",
  "PatientAuditTrailModal",
  "useLiveDuplicateWarnings",
  "plexus-iq-run-organization-panel",
  "plexus-iq-run-org-sort-toggle",
  "plexus-iq-run-org-select-all",
  "plexus-iq-run-org-clear",
  "Newest first",
  "Oldest first",
  "Comparing: all",
  "outreach",
  "appointmentTime",
]) if (!panel.includes(n)) failures.push(`${PANEL} missing "${n}"`);

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

// Unit test still passes (outreach alphabetical + visit appointment-time).
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

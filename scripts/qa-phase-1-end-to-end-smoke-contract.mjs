// QA: Phase 1 end-to-end smoke contract (Batch I1).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/phase-1-end-to-end-smoke-contract.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "end-to-end smoke contract",
  "End-to-end journey scope (Phase 1)",
  "Batch Flow",
  "Plexus IQ qualification + reasoning",
  "Admin Review",
  "Engagement Center handoff",
  "Team Portal cockpit",
  "RingCentral / call results",
  "Ancillary workflow",
  "Physician signing",
  "Billing readiness",
  "Invoicing",
  "AWS staging deploy",
  "What is NOT in the Phase 1 end-to-end",
  "Production cut-over",
  "Live claims submission",
  "ERA / remittance ingestion",
  "Denial routing",
  "Payment posting",
  "Mission Control",
  "Invariants the smoke MUST preserve",
  "default OFF in production",
  "Plexus IQ UI / runtime untouched",
  "Admin Review UI / runtime untouched",
  "engagementCallResultEndpoint",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

// Sanity: protected files still on disk (this is the smoke contract's hardest invariant).
for (const rel of [
  "client/src/components/portal/TeamPortalShell.tsx",
  "client/src/components/portal/PortalShell.tsx",
  "client/src/components/portal/PatientCommandCanvas.tsx",
  "client/src/components/portal/SchedulePatientPlayground.tsx",
  "client/src/components/outreach/CallListPanel.tsx",
  "client/src/components/outreach/DispositionSheet.tsx",
  "client/src/components/outreach/CanonicalRowActions.tsx",
  "client/src/components/plexus-iq/PlexusIQWorkspace.tsx",
  "client/src/components/qualification/AdminReviewDialog.tsx",
]) if (read(rel) === null) failures.push(`Protected file missing: ${rel}`);

// E9 rollback path string must still be in DispositionSheet.
{
  const dispo = read("client/src/components/outreach/DispositionSheet.tsx") ?? "";
  if (!dispo.includes('"/api/outreach/calls"')) {
    failures.push("DispositionSheet must still reference /api/outreach/calls (E9 rollback)");
  }
  if (!dispo.includes("engagementCallResultEndpoint")) {
    failures.push("DispositionSheet must still reference engagementCallResultEndpoint helper");
  }
}

if (failures.length > 0) {
  console.error("Phase 1 end-to-end smoke contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 end-to-end smoke contract QA passed.");

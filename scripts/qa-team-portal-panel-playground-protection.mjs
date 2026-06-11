// QA: Team Portal panel/playground protection (Batch E1).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }
function requireFile(rel) { const c = read(rel); if (c === null) failures.push(`Missing protected Team Portal file: ${rel}`); return c; }

// §1 — Protected surfaces present on disk.
const PROTECTED = [
  "client/src/components/portal/TeamPortalShell.tsx",
  "client/src/components/portal/PortalShell.tsx",
  "client/src/components/portal/PatientCommandCanvas.tsx",
  "client/src/components/portal/SchedulePatientPlayground.tsx",
  "client/src/components/outreach/CallListPanel.tsx",
  "client/src/components/outreach/DispositionSheet.tsx",
  "client/src/components/outreach/CanonicalRowActions.tsx",
];
for (const rel of PROTECTED) requireFile(rel);

// §2 — Plexus IQ UI surface preserved.
for (const rel of [
  "client/src/components/plexus-iq/PlexusIQWorkspace.tsx",
  "client/src/components/plexus-iq/PlexusIQBulkImportModal.tsx",
  "client/src/components/plexus-iq/PlexusIQAddPatientHub.tsx",
]) requireFile(rel);

// §3 — Admin Review UI preserved.
requireFile("client/src/components/qualification/AdminReviewDialog.tsx");

// §4 — Contract doc present.
requireFile("docs/architecture/team-portal-panel-playground-protection-contract.md");

// §5 — DispositionSheet still renders its core controls (sanity-check
//      for layout preservation — verify a few known JSX tokens).
{
  const dispo = read("client/src/components/outreach/DispositionSheet.tsx") ?? "";
  for (const n of ["Sheet", "SheetContent", "Button"]) {
    if (!dispo.includes(n)) failures.push(`DispositionSheet missing core control "${n}" — possible layout change`);
  }
}

if (failures.length > 0) {
  console.error("Team Portal panel/playground protection QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal panel/playground protection QA passed.");

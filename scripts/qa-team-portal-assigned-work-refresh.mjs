// QA: Team Portal assigned-work refresh after call result (Batch E10).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }
function requireFile(rel) { const c = read(rel); if (c === null) failures.push(`Missing file: ${rel}`); return c; }
function requireText(rel, needles) {
  const c = read(rel);
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!c.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}
function countOccurrences(src, needle) {
  return src.split(needle).length - 1;
}

const DISPO = "client/src/components/outreach/DispositionSheet.tsx";
const CANON = "client/src/components/outreach/CanonicalRowActions.tsx";

const dispoSrc = requireFile(DISPO);
const canonSrc = requireFile(CANON);

// §1 — DispositionSheet invalidates the Team Portal assigned-work keys.
requireText(DISPO, [
  '"/api/engagement-center/cases"',
  '"/api/portal/outreach-call-list"',
  '"/api/portal/my-tasks"',
  '"/api/portal/today-schedule"',
  '"portal-call-history"',
]);

// §2 — Both DispositionSheet mutation onSuccess handlers (legacy +
//      structured) include the new invalidations. Count occurrences
//      of one of the new keys — must be ≥2.
{
  const s = dispoSrc ?? "";
  const n = countOccurrences(s, '"/api/portal/outreach-call-list"');
  if (n < 2) failures.push(`${DISPO}: expected /api/portal/outreach-call-list invalidation in both mutations (found ${n})`);
}

// §3 — CanonicalRowActions invalidates the new keys after canonical
//      call result write.
requireText(CANON, [
  '"/api/engagement-center/cases"',
  '"/api/portal/outreach-call-list"',
  '"/api/portal/my-tasks"',
  '"/api/portal/today-schedule"',
]);
{
  const s = canonSrc ?? "";
  const n = countOccurrences(s, '"/api/portal/outreach-call-list"');
  if (n < 1) failures.push(`${CANON}: expected /api/portal/outreach-call-list invalidation (found ${n})`);
}

// §4 — Protected surfaces still on disk.
for (const rel of [
  "client/src/components/portal/TeamPortalShell.tsx",
  "client/src/components/portal/PortalShell.tsx",
  "client/src/components/portal/PatientCommandCanvas.tsx",
  "client/src/components/portal/SchedulePatientPlayground.tsx",
  "client/src/components/outreach/CallListPanel.tsx",
  "client/src/components/outreach/DispositionSheet.tsx",
  "client/src/components/outreach/CanonicalRowActions.tsx",
]) requireFile(rel);

// §5 — Plexus IQ + Admin Review UI preserved.
for (const rel of [
  "client/src/components/plexus-iq/PlexusIQWorkspace.tsx",
  "client/src/components/plexus-iq/PlexusIQBulkImportModal.tsx",
  "client/src/components/plexus-iq/PlexusIQAddPatientHub.tsx",
  "client/src/components/qualification/AdminReviewDialog.tsx",
]) requireFile(rel);

// §6 — TeamPortalShell still owns the assigned-work queries we're
//      now invalidating from the disposition flow.
requireText("client/src/components/portal/TeamPortalShell.tsx", [
  '"/api/portal/outreach-call-list"',
  '"/api/portal/my-tasks"',
  '"/api/portal/today-schedule"',
]);

if (failures.length > 0) {
  console.error("Team Portal assigned-work refresh QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal assigned-work refresh QA passed.");

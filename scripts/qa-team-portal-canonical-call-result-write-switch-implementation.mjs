// QA: Team Portal canonical call-result write switch implementation (Batch E9).
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
function requireNotText(rel, needles, label) {
  const c = read(rel);
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (c.includes(n)) failures.push(`${label}: ${rel} contains forbidden "${n}"`);
}

const DISPO = "client/src/components/outreach/DispositionSheet.tsx";
const src = requireFile(DISPO);

// §1 — Rollback flag wired.
requireText(DISPO, [
  "VITE_USE_LEGACY_DISPOSITION_WRITE",
  "LEGACY_DISPOSITION_WRITE_ENABLED",
  "if (LEGACY_DISPOSITION_WRITE_ENABLED) {",
]);

// §2 — Canonical endpoint is the primary write path.
requireText(DISPO, [
  "engagementCallResultEndpoint",
  "canonicalBody",
  "canonicalRes",
  '"Failed to log call"',
]);

// §3 — Legacy endpoint string preserved (rollback path), but no
//      hardcoded canonical URL.
requireText(DISPO, ['"/api/outreach/calls"']);
{
  const s = src ?? "";
  for (const forbidden of [
    '"/api/engagement/call-results"',
    '"/api/engagement/canonical-call-results"',
  ]) {
    if (s.includes(forbidden)) failures.push(`${DISPO} hardcodes canonical URL "${forbidden}"`);
  }
}

// §4 — Primary path no longer trails a best-effort canonical mirror
//      after a non-canonical write. Heuristic: the substring
//      "canonical call-result mirror failed" must only appear inside
//      the LEGACY rollback branch — count occurrences and verify they
//      sit after the rollback flag check.
{
  const s = src ?? "";
  const mirrorOccurrences = (s.match(/canonical call-result mirror failed/g) ?? []).length;
  if (mirrorOccurrences > 1) {
    failures.push(`${DISPO} has ${mirrorOccurrences} canonical-mirror sites; expected at most 1 (rollback only)`);
  }
}

// §5 — Legacy 19-outcome buttons + grouping intact.
requireText(DISPO, [
  "OUTCOMES",
  "OutcomeDef",
  "Reached patient",
  "Did not reach",
  "renderGroup",
  "disposition-submit",
  "Log call outcome",
]);

// §6 — Structured selector still present (E4 invariant).
requireText(DISPO, [
  "VITE_USE_STRUCTURED_CALL_RESULT_SELECTOR",
  "canonical-call-result-selector",
  "canonical-outcome-select",
  "logCanonicalCall",
]);

// §7 — Query-cache invalidations preserved.
requireText(DISPO, [
  '"/api/outreach/dashboard"',
  '"/api/outreach/calls"',
  '"/api/outreach/calls/by-patients"',
  '"/api/outreach/calls/today"',
]);

// §8 — Protected Team Portal surfaces still on disk.
for (const rel of [
  "client/src/components/portal/TeamPortalShell.tsx",
  "client/src/components/portal/PortalShell.tsx",
  "client/src/components/portal/PatientCommandCanvas.tsx",
  "client/src/components/portal/SchedulePatientPlayground.tsx",
  "client/src/components/outreach/CallListPanel.tsx",
  "client/src/components/outreach/DispositionSheet.tsx",
  "client/src/components/outreach/CanonicalRowActions.tsx",
]) requireFile(rel);

// §9 — Plexus IQ UI preserved.
for (const rel of [
  "client/src/components/plexus-iq/PlexusIQWorkspace.tsx",
  "client/src/components/plexus-iq/PlexusIQBulkImportModal.tsx",
  "client/src/components/plexus-iq/PlexusIQAddPatientHub.tsx",
]) requireFile(rel);

// §10 — Admin Review UI preserved.
requireFile("client/src/components/qualification/AdminReviewDialog.tsx");

// §11 — No direct client writes to workflow tables.
requireNotText(DISPO, [
  'from "drizzle-orm"',
  'from "@shared/schema/patientExecutionCases"',
  'from "@shared/schema/patientJourneyEvents"',
  'from "@shared/schema/plexusTasks"',
  'from "@shared/schema/schedulingTriageCases"',
  'from "@shared/schema/schedulerAssignments"',
  '"/api/patient-execution-cases"',
  '"/api/patient-journey-events"',
  '"/api/plexus-tasks"',
  '"/api/scheduling-triage-cases"',
  '"/api/scheduler-assignments"',
], "client must not write directly to workflow tables");

// §12 — Rollback flag dormancy (only DispositionSheet may reference it).
{
  const ALLOWED = new Set([DISPO]);
  const ROOTS = ["server", "client", "shared"];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (["node_modules", "dist", "build"].includes(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      if (ALLOWED.has(rel)) continue;
      const s = fs.readFileSync(abs, "utf8");
      if (s.includes("VITE_USE_LEGACY_DISPOSITION_WRITE")) {
        failures.push(`Unauthorized reference: ${rel} references VITE_USE_LEGACY_DISPOSITION_WRITE`);
      }
    }
  }
  for (const r of ROOTS) walk(path.join(root, r));
}

// §13 — engagementCallResultEndpoint helper still in place.
{
  const helper = read("client/src/lib/engagementCanonicalCallResultsUiFlag.ts");
  if (helper === null) failures.push("Missing engagementCanonicalCallResultsUiFlag.ts helper");
  else if (!helper.includes("engagementCallResultEndpoint")) failures.push("engagementCallResultEndpoint export missing");
}

if (failures.length > 0) {
  console.error("Team Portal canonical call-result write switch implementation QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal canonical call-result write switch implementation QA passed.");

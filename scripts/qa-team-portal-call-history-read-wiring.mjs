// QA: Team Portal call-history read wiring (Batch E7).
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

const PANEL = "client/src/components/portal/PatientCallHistoryPanel.tsx";
const CANVAS = "client/src/components/portal/PatientCommandCanvas.tsx";
requireFile(PANEL);
requireFile(CANVAS);

// §1 — Flag gate present.
requireText(PANEL, [
  "VITE_USE_PATIENT_CALL_HISTORY_READ",
  "CALL_HISTORY_READ_ENABLED",
  "if (!CALL_HISTORY_READ_ENABLED) return null",
]);

// §2 — Uses the existing approved endpoint, not a new one.
requireText(PANEL, [
  "/api/portal/calls?patientScreeningId=",
  "patient-call-history-panel",
]);
{
  const src = read(PANEL) ?? "";
  for (const forbidden of [
    "/api/portal/call-history",
    "/api/portal/calls/history",
    "/api/engagement/call-history",
  ]) {
    if (src.includes(forbidden)) {
      failures.push(`${PANEL} introduces unauthorized endpoint "${forbidden}"`);
    }
  }
}

// §3 — Display fields present.
requireText(PANEL, [
  "outcome",
  "notes",
  "callbackAt",
  "durationSeconds",
  "startedAt",
  "attemptNumber",
]);

// §4 — Read-only: no apiRequest("POST/PATCH/PUT/DELETE"), no useMutation.
requireNotText(PANEL, [
  'apiRequest("POST"',
  'apiRequest("PATCH"',
  'apiRequest("PUT"',
  'apiRequest("DELETE"',
  "useMutation",
  "method: \"POST\"",
  "method: 'POST'",
], "call-history panel must be read-only");

// §5 — No direct client writes to workflow tables.
requireNotText(PANEL, [
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

// §6 — Wired into PatientCommandCanvas.
requireText(CANVAS, [
  'from "@/components/portal/PatientCallHistoryPanel"',
  "<PatientCallHistoryPanel",
  "patientScreeningId={patientScreeningId}",
]);

// §7 — Protected Team Portal surfaces still on disk.
for (const rel of [
  "client/src/components/portal/TeamPortalShell.tsx",
  "client/src/components/portal/PortalShell.tsx",
  "client/src/components/portal/PatientCommandCanvas.tsx",
  "client/src/components/portal/SchedulePatientPlayground.tsx",
  "client/src/components/outreach/CallListPanel.tsx",
  "client/src/components/outreach/DispositionSheet.tsx",
  "client/src/components/outreach/CanonicalRowActions.tsx",
]) requireFile(rel);

// §8 — Plexus IQ UI preserved.
for (const rel of [
  "client/src/components/plexus-iq/PlexusIQWorkspace.tsx",
  "client/src/components/plexus-iq/PlexusIQBulkImportModal.tsx",
  "client/src/components/plexus-iq/PlexusIQAddPatientHub.tsx",
]) requireFile(rel);

// §9 — Admin Review UI preserved.
requireFile("client/src/components/qualification/AdminReviewDialog.tsx");

// §10 — Existing portal route still owns the endpoint.
requireText("server/routes/portal.ts", [
  '"/api/portal/calls"',
  "isPortalCallHistoryReadEnabled",
  "storage.listOutreachCallsForPatient",
]);

// §11 — Flag dormancy: only the panel may reference VITE_USE_PATIENT_CALL_HISTORY_READ.
{
  const ALLOWED = new Set([PANEL]);
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
      const src = fs.readFileSync(abs, "utf8");
      if (src.includes("VITE_USE_PATIENT_CALL_HISTORY_READ")) {
        failures.push(`Unauthorized reference: ${rel} references VITE_USE_PATIENT_CALL_HISTORY_READ`);
      }
    }
  }
  for (const r of ROOTS) walk(path.join(root, r));
}

if (failures.length > 0) {
  console.error("Team Portal call-history read wiring QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal call-history read wiring QA passed.");

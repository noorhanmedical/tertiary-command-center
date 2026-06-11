// QA: Team Portal call-result selector implementation (Batch E4).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }
function requireFile(rel) { const c = read(rel); if (c === null) failures.push(`Missing file: ${rel}`); return c; }
function requireText(rel, needles, label = rel) {
  const c = read(rel);
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!c.includes(n)) failures.push(`Missing "${n}" in ${label}`);
}
function requireNotText(rel, needles, label) {
  const c = read(rel);
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (c.includes(n)) failures.push(`${label}: ${rel} contains forbidden "${n}"`);
}

const DISPO = "client/src/components/outreach/DispositionSheet.tsx";
const dispoSrc = requireFile(DISPO);

// §1 — Flag gate present.
requireText(DISPO, [
  "VITE_USE_STRUCTURED_CALL_RESULT_SELECTOR",
  "STRUCTURED_SELECTOR_ENABLED",
  "STRUCTURED_SELECTOR_ENABLED && (",
]);

// §2 — All 15 canonical outcomes present in the selector.
const CANONICAL = [
  "scheduled", "callback", "no_answer", "voicemail", "wrong_number",
  "declined", "needs_records", "insurance_prior_auth_issue",
  "manager_review", "facility_specific_issue",
  "completed", "dnc", "do_not_contact", "deceased", "cancelled",
];
for (const v of CANONICAL) requireText(DISPO, [`"${v}"`], `${DISPO} canonical outcome ${v}`);

// §3 — Required outcome labels rendered (sanity-check the visible label set).
for (const label of [
  "Scheduled",
  "Callback later",
  "No answer",
  "Voicemail",
  "Wrong number",
  "Declined",
  "Needs records",
  "Insurance / prior auth issue",
  "Manager review",
  "Facility-specific issue",
  "Completed",
  "DNC",
  "Do not contact",
  "Deceased",
  "Cancelled",
]) requireText(DISPO, [label], `${DISPO} canonical label "${label}"`);

// §4 — Legacy outcome buttons + handler intact (not removed).
requireText(DISPO, [
  "OUTCOMES",
  "OutcomeDef",
  "Reached patient",
  "Did not reach",
  "renderGroup",
  "logCall",
  "/api/outreach/calls",
  "engagementCallResultEndpoint",
  "Log call outcome",
  "disposition-submit",
]);

// §5 — New canonical mutation present, using the existing endpoint helper.
requireText(DISPO, [
  "logCanonicalCall",
  "canonical-call-result-selector",
  "canonical-outcome-select",
  "canonical-submit",
  "callMetadata",
  "ringCentralCallId",
]);

// §6 — Canonical block uses the engagement endpoint helper, not a hardcoded URL.
{
  // Ensure no new hardcoded canonical-engagement URL string sneaks in.
  for (const forbidden of [
    "/api/engagement/canonical-call-results",
    "/api/engagement/call-results",
  ]) {
    if (dispoSrc && dispoSrc.includes(forbidden) && !dispoSrc.includes(`engagementCallResultEndpoint()`)) {
      failures.push(`${DISPO} hardcodes endpoint "${forbidden}" — must use engagementCallResultEndpoint()`);
    }
  }
}

// §7 — No direct client writes to protected workflow tables.
//      DispositionSheet is a client component; it must not import drizzle,
//      pull workflow-table schemas, or POST to workflow-table URLs.
//      (Documentation comments that mention table names are fine.)
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

// §9 — Plexus IQ UI files preserved.
for (const rel of [
  "client/src/components/plexus-iq/PlexusIQWorkspace.tsx",
  "client/src/components/plexus-iq/PlexusIQBulkImportModal.tsx",
  "client/src/components/plexus-iq/PlexusIQAddPatientHub.tsx",
]) requireFile(rel);

// §10 — Admin Review UI preserved.
requireFile("client/src/components/qualification/AdminReviewDialog.tsx");

// §11 — engagementCallResultEndpoint helper still the write endpoint helper.
{
  const helper = read("client/src/lib/engagementCanonicalCallResultsUiFlag.ts");
  if (helper === null) failures.push("Missing engagementCanonicalCallResultsUiFlag.ts helper");
  else if (!helper.includes("engagementCallResultEndpoint")) failures.push("engagementCallResultEndpoint export missing");
}

if (failures.length > 0) {
  console.error("Team Portal call-result selector implementation QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal call-result selector implementation QA passed.");

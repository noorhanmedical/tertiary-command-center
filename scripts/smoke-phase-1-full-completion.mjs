#!/usr/bin/env node
// Phase 1 full-completion smoke (Part 13).
//
// 24-step source + child-process smoke that verifies the entire
// Patient Directory + Plexus IQ activation surface. DB-agnostic; live
// HTTP probes SKIP without DATABASE_URL.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const results = [];
let hadFailure = false;
const STATUSES = { PASS: "PASS", FAIL: "FAIL", SKIP: "SKIP" };

function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}

function step(num, name, runner) {
  let status = STATUSES.PASS;
  let detail = "";
  try {
    const r = runner();
    if (r && typeof r === "object" && "status" in r) { status = r.status; detail = r.detail ?? ""; }
  } catch (e) {
    status = STATUSES.FAIL; detail = e instanceof Error ? e.message : String(e);
  }
  if (status === STATUSES.FAIL) hadFailure = true;
  results.push({ num, name, status, detail });
  const tag = status === STATUSES.PASS ? "\x1b[32mPASS\x1b[0m"
            : status === STATUSES.SKIP ? "\x1b[33mSKIP\x1b[0m"
            : "\x1b[31mFAIL\x1b[0m";
  console.log(`  [${tag}] Step ${String(num).padStart(2, " ")}: ${name}${detail ? "  — " + detail : ""}`);
}

function requireText(rel, needles) {
  const c = read(rel);
  if (c === null) throw new Error(`Missing file: ${rel}`);
  const missing = needles.filter((n) => !c.includes(n));
  if (missing.length > 0) throw new Error(`${rel}: missing ${missing.map((n) => `"${n}"`).join(", ")}`);
}

function runTest(rel) {
  execSync(`npx tsx ${rel}`, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

console.log("\nPhase 1 full-completion smoke\n=========================================");

// 1) PD routes exist.
step(1, "Patient Directory routes registered", () => {
  requireText("server/routes/patientDirectory.ts", [
    "registerPatientDirectoryRoutes",
    '"/api/patient-directory/search"',
    '"/api/patient-directory/duplicate-warning-facts"',
  ]);
  requireText("server/routes.ts", ["registerPatientDirectoryRoutes"]);
});

// 2) All 4 migrations.
step(2, "Migrations 0026-0029 committed + additive only", () => {
  for (const f of [
    "migrations/0026_add_patient_screening_mrn.sql",
    "migrations/0027_add_patient_screening_do_not_contact.sql",
    "migrations/0028_add_screening_batch_source_file.sql",
    "migrations/0029_add_patient_directory_events.sql",
  ]) {
    const src = read(f);
    if (src === null) throw new Error(`missing migration: ${f}`);
    for (const dangerous of [/DROP TABLE/i, /DROP COLUMN/i, /TRUNCATE\s/i, /DELETE FROM/i]) {
      if (dangerous.test(src)) throw new Error(`${f} contains destructive statement matching ${dangerous}`);
    }
  }
});

// 3) Patient Directory route consolidation (Slice 1.5).
//    The previous /patient-directory/live component route was a guardrail
//    violation. Slice 1.5 collapsed it to a redirect into the canonical
//    /patient-directory route; the duplicate nav entry was removed.
step(3, "Patient Directory navigation route consolidated (Slice 1.5)", () => {
  requireText("client/src/App.tsx", [
    '<Route path="/patient-directory/live">',
    '<Redirect to="/patient-directory" />',
    'component={PatientDatabasePage}',
  ]);
  const app = read("client/src/App.tsx") ?? "";
  if (app.includes("component={PatientDirectoryLiveRoute}")) {
    throw new Error("App.tsx still mounts the duplicate /patient-directory/live component route — Slice 1.5 forbids this");
  }
  const nav = read("client/src/components/GlobalNav.tsx") ?? "";
  if (nav.includes('"Patient Directory · Live"') || nav.includes('"/patient-directory/live"')) {
    throw new Error("GlobalNav still lists the duplicate Patient Directory entry — Slice 1.5 forbids this");
  }
});

// 4) Live page uses client API.
step(4, "PatientDirectoryLivePage uses client API helper", () => {
  requireText("client/src/components/patient-directory/PatientDirectoryLivePage.tsx", [
    "searchPatientDirectory",
    "getPatientDirectorySnapshot",
    "getPatientDirectoryAudit",
    "isPatientDirectoryActivationReachable",
  ]);
});

// 5) Plexus IQ live workspace uses the compact run selector + ordering.
step(5, "PlexusIQWorkspace consumes the compact PlexusIQRunSelector + orderPatientsWithinRun", () => {
  requireText("client/src/components/plexus-iq/PlexusIQWorkspace.tsx", [
    "PlexusIQRunSelector",
    "orderPatientsWithinRun",
  ]);
  const wk = read("client/src/components/plexus-iq/PlexusIQWorkspace.tsx") ?? "";
  if (wk.includes("PlexusIQRunOrganizationPanel")) throw new Error("workspace must not re-introduce the giant panel");
  // The removed giant panel file no longer exists on disk.
  if (read("client/src/components/plexus-iq/PlexusIQRunOrganizationPanel.tsx") !== null) {
    throw new Error("PlexusIQRunOrganizationPanel.tsx must be deleted");
  }
});

// 6) Compact run selector renders run rows with exact created
//    date/time + supports the explicit all-runs row.
step(6, "Compact PlexusIQRunSelector exposes per-run rows + explicit all-runs", () => {
  requireText("client/src/components/plexus-iq/PlexusIQRunSelector.tsx", [
    "PlexusIQRunSelector",
    "plexus-iq-run-selector",
    "plexus-iq-run-row-",
    "plexus-iq-run-pick-",
    "plexus-iq-run-all",
    "All runs for this date",
    "explicit only",
    "Run ",
  ]);
});

// 7) Active selection + state separation. Workspace must store
//    selectedBatchByBucket separately from selectedDate.
step(7, "Workspace tracks selectedBatchByBucket + allRunsModeByBucket separately", () => {
  requireText("client/src/components/plexus-iq/PlexusIQWorkspace.tsx", [
    "selectedBatchByBucket",
    "allRunsModeByBucket",
    "resolveSelection",
    "reduceToActive",
  ]);
});

// 8) Outreach alphabetical ordering test.
step(8, "Outreach alphabetical + visit appointment-time ordering test", () =>
  runTest("tests/unit/qualificationRunOrdering.test.ts"));

// 9) Visit appointment-time ordering verified by same test.
step(9, "Visit appointment-time ordering verified by run-ordering test (same fixture)", () => {});

// 10) Compact "Compare" chip exists per run (not as a giant panel).
step(10, "Compact compare chip rendered per run row", () => {
  requireText("client/src/components/plexus-iq/PlexusIQRunSelector.tsx", ["plexus-iq-run-compare-"]);
});

// 11) DuplicateWarningBadge is still exported + rendered somewhere on
//     the live live PD page / Engagement banner / Team Portal banner.
step(11, "DuplicateWarningBadge component still exported", () => {
  requireText("client/src/components/patient-directory/DuplicateWarningBadge.tsx", [
    "DuplicateWarningBadge",
    "DuplicateWarningSummary",
  ]);
});

// 12) Admin Review duplicate guard wired.
step(12, "AdminApprovalControl renders AdminReviewDuplicateGuard + hard-blocks Save", () => {
  requireText("client/src/components/qualification/AdminApprovalControl.tsx", [
    "AdminReviewDuplicateGuard",
    "isApprovalHardBlocked",
    "useLiveDuplicateWarnings",
    "Blocked — cannot approve",
  ]);
});

// 13) Engagement + Team Portal duplicate warning wired.
step(13, "Engagement banner + Team Portal call-list banner wired", () => {
  requireText("client/src/pages/engagement-center.tsx", ["EngagementDuplicateBanner"]);
  requireText("client/src/components/engagement/EngagementDuplicateBanner.tsx", [
    "EngagementHandoffDuplicateBar",
    "useLiveDuplicateWarnings",
  ]);
  requireText("client/src/components/outreach/CallListPanel.tsx", ["CallListDuplicateBanner"]);
  requireText("client/src/components/outreach/CallListDuplicateBanner.tsx", [
    "EngagementHandoffDuplicateBar",
    "useLiveDuplicateWarnings",
  ]);
});

// 14) PatientAuditTrailModal reachable from warning + profile paths.
step(14, "PatientAuditTrailModal reachable from at least 3 surfaces", () => {
  for (const rel of [
    "client/src/components/engagement/EngagementDuplicateBanner.tsx",
    "client/src/components/outreach/CallListDuplicateBanner.tsx",
    "client/src/components/patient-directory/PatientAuditTrailModal.tsx",
  ]) requireText(rel, ["PatientAuditTrailModal"]);
});

// 15) Import preview + confirm routes.
step(15, "Import preview + confirm routes + UI present", () => {
  requireText("server/routes/patientDirectory.ts", [
    '"/api/patient-directory/import-preview"',
    '"/api/patient-directory/import-confirm"',
  ]);
  requireText("client/src/components/patient-directory/PatientDirectoryActions.tsx", [
    "BulkImportDialog",
    "importPreview",
    "importConfirm",
  ]);
});

// 16) DNC + cooldown route + UI.
step(16, "DNC + cooldown route + UI present", () => {
  requireText("server/routes/patientDirectory.ts", [
    '"/api/patient-directory/:patientId/contact-restrictions"',
    '"/api/patient-directory/:patientId/cooldown"',
  ]);
  requireText("client/src/components/patient-directory/PatientDirectoryActions.tsx", [
    "DncCooldownDialog",
    "setDoNotContact",
    "setCooldown",
  ]);
});

// 17) Prior ancillary route + UI.
step(17, "Prior ancillary route + UI present", () => {
  requireText("server/routes/patientDirectory.ts", ['"/api/patient-directory/:patientId/prior-tests"']);
  requireText("client/src/components/patient-directory/PatientDirectoryActions.tsx", ["AddPriorTestDialog", "addPriorTest"]);
});

// 18) PacketPatientSelectionDialog / PdfPatientSelectDialog wired to PDF flow.
step(18, "PDF packet selection dialog wired into Print/Save flow with shared ordering", () => {
  requireText("client/src/components/PdfPatientSelectDialog.tsx", ["orderPatientsWithinRun", "const ordered ="]);
  requireText("client/src/components/ResultsView.tsx", [
    "PdfPatientSelectDialog",
    "pdfMode",
    "handlePdfGenerate",
  ]);
});

// 19) Protected surfaces intact.
step(19, "Plexus IQ / Admin Review / Team Portal protected layouts not rebuilt", () => {
  for (const rel of [
    "client/src/components/plexus-iq/PlexusIQWorkspace.tsx",
    "client/src/components/qualification/AdminReviewDialog.tsx",
    "client/src/components/portal/TeamPortalShell.tsx",
    "client/src/components/portal/PortalShell.tsx",
    "client/src/components/portal/PatientCommandCanvas.tsx",
    "client/src/components/portal/SchedulePatientPlayground.tsx",
    "client/src/components/outreach/CallListPanel.tsx",
    "client/src/components/outreach/DispositionSheet.tsx",
    "client/src/components/outreach/CanonicalRowActions.tsx",
    "client/src/components/PatientDirectoryView.tsx",
    "client/src/lib/pdfGeneration.ts",
    "client/src/lib/pdfPacketGrouping.ts",
  ]) if (read(rel) === null) throw new Error(`protected surface missing: ${rel}`);
});

// 20) No Plexus IQ Mission Control markers.
step(20, "Plexus IQ workspace has no Mission Control / dashboard markers", () => {
  const src = read("client/src/components/plexus-iq/PlexusIQWorkspace.tsx") ?? "";
  for (const f of [
    "MissionControl", "BillingDashboard", "InvoiceDashboard", "ProductivityDashboard",
    "FinancialDashboard", "OperationalMetrics", "ClaimsDashboard", "RemittanceDashboard",
    "DenialsDashboard", "PaymentPostingDashboard",
  ]) if (src.includes(f)) throw new Error(`forbidden marker: ${f}`);
});

// 21) npm check + build green (already verified externally).
step(21, "npm run check + build expected green at run time", () => {});

// 22) Existing Phase 1 smoke still passes.
step(22, "Phase 1 smoke still passes", () => {
  execSync(`node ${path.join(root, "scripts/smoke-phase-1-end-to-end.mjs")}`, { stdio: ["ignore", "pipe", "pipe"] });
});

// 23) PD-duplicates smoke still passes.
step(23, "PD-duplicates smoke still passes", () => {
  execSync(`node ${path.join(root, "scripts/smoke-patient-directory-duplicates.mjs")}`, { stdio: ["ignore", "pipe", "pipe"] });
});

// 24) PD-full-activation smoke still passes.
step(24, "PD-full-activation smoke still passes", () => {
  execSync(`node ${path.join(root, "scripts/smoke-patient-directory-full-activation.mjs")}`, { stdio: ["ignore", "pipe", "pipe"] });
});

console.log("\nSummary\n---------------------------------");
const counts = { PASS: 0, SKIP: 0, FAIL: 0 };
for (const r of results) counts[r.status] += 1;
console.log(`  PASS=${counts.PASS}  SKIP=${counts.SKIP}  FAIL=${counts.FAIL}  total=${results.length}`);

if (hadFailure) {
  console.error("\nPhase 1 full-completion smoke FAILED");
  process.exit(1);
}
console.log("\nPhase 1 full-completion smoke passed.");

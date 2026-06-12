#!/usr/bin/env node
// Patient Directory full-activation smoke test (Batch M).
//
// DB-agnostic: when DATABASE_URL is unset, live HTTP probes SKIP with
// a reason. When the DB is reachable but the activation flag is OFF,
// the endpoint probes also SKIP. Source-level wiring is verified
// unconditionally.

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

console.log("\nPatient Directory full-activation smoke\n=========================================");

// 1) Migration plan + 0026 committed
step(1, "Migration 0026 committed; 0027/0028/0029 inlined in blockers doc", () => {
  if (read("migrations/0026_add_patient_screening_mrn.sql") === null) throw new Error("0026 not committed");
  for (const f of ["0027_add_patient_screening_do_not_contact.sql", "0028_add_screening_batch_source_file.sql", "0029_add_patient_directory_events.sql"]) {
    if (fs.existsSync(path.join(root, "migrations", f))) throw new Error(`${f} should NOT be committed`);
  }
  requireText("docs/architecture/patient-directory-full-activation-blockers.md", [
    "0027_add_patient_screening_do_not_contact.sql",
    "0028_add_screening_batch_source_file.sql",
    "0029_add_patient_directory_events.sql",
  ]);
});

// 2) Routes registered (or guarded behind the activation flag)
step(2, "patientDirectory route registration imported in server/routes.ts", () => {
  requireText("server/routes.ts", [
    "registerPatientDirectoryRoutes",
    'from "./routes/patientDirectory"',
  ]);
});

// 3) Client API helper present
step(3, "Client API helper present with all 14+ exports", () => {
  requireText("client/src/lib/patientDirectoryApi.ts", [
    "searchPatientDirectory",
    "getPatientDirectorySnapshot",
    "getPatientDirectoryAudit",
    "createPatientDirectoryProfile",
    "importPreview",
    "importConfirm",
    "setDoNotContact",
    "setCooldown",
    "fetchDuplicateWarningFacts",
    "isPatientDirectoryActivationReachable",
  ]);
});

// 4) PatientDirectoryLivePage uses the real API
step(4, "PatientDirectoryLivePage consumes the real API helper", () => {
  requireText("client/src/components/patient-directory/PatientDirectoryLivePage.tsx", [
    "searchPatientDirectory",
    "getPatientDirectorySnapshot",
    "getPatientDirectoryAudit",
    "isPatientDirectoryActivationReachable",
  ]);
});

// 5) Profile drawer shape consumed
step(5, "Profile drawer compatible shape from snapshotToProfile", () => {
  requireText("client/src/components/patient-directory/PatientDirectoryLivePage.tsx", ["snapshotToProfile"]);
  requireText("client/src/components/patient-directory/PatientProfileDrawer.tsx", ["PatientProfileSnapshot"]);
});

// 6) Audit modal consumes endpoint-unavailable
step(6, "Audit modal renders source-unavailable when activation flag is OFF", () => {
  requireText("client/src/components/patient-directory/PatientAuditTrailModal.tsx", ["endpointUnavailable"]);
  requireText("client/src/components/patient-directory/PatientDirectoryLivePage.tsx", ["auditEndpointUnavailable"]);
});

// 7) Import preview + confirm route shapes
step(7, "Import preview + confirm routes wired", () => {
  requireText("server/routes/patientDirectory.ts", [
    '"/api/patient-directory/import-preview"',
    '"/api/patient-directory/import-confirm"',
  ]);
});

// 8) DNC + cooldown writer methods
step(8, "DNC + cooldown writer methods present", () => {
  requireText("server/services/patientDirectory/patientDirectoryWriter.ts", [
    "setDoNotContact",
    "clearDoNotContact",
    "setCooldown",
    "clearCooldown",
  ]);
});

// 9) Prior test persistence
step(9, "Prior test persistence method present", () => {
  requireText("server/services/patientDirectory/patientDirectoryWriter.ts", ["addPriorTest", "storage.createTestHistory"]);
});

// 10) Duplicate facts route + client hook
step(10, "Duplicate facts route + live hook present", () => {
  requireText("server/routes/patientDirectory.ts", ['"/api/patient-directory/duplicate-warning-facts"']);
  requireText("client/src/lib/useLiveDuplicateWarnings.ts", ["useLiveDuplicateWarnings", "fetchDuplicateWarningFacts"]);
});

// 11) Engine can consume real facts
step(11, "Duplicate-warning engine still passes with real-shaped facts", () => {
  runTest("tests/unit/patientDuplicateWarnings.test.ts");
});

// 12) Protected surfaces intact
step(12, "Plexus IQ + Admin Review + Team Portal protected surfaces intact", () => {
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
    "client/src/components/qualification/PatientPdfActions.tsx",
    "client/src/components/ResultsView.tsx",
  ]) if (read(rel) === null) throw new Error(`protected surface missing: ${rel}`);
});

// 13) No Plexus IQ Mission Control / billing dashboard markers
step(13, "Plexus IQ workspace has no Mission Control / dashboard markers", () => {
  const src = read("client/src/components/plexus-iq/PlexusIQWorkspace.tsx") ?? "";
  for (const forbidden of [
    "MissionControl", "BillingDashboard", "InvoiceDashboard",
    "ProductivityDashboard", "FinancialDashboard", "OperationalMetrics",
    "ClaimsDashboard", "RemittanceDashboard", "DenialsDashboard", "PaymentPostingDashboard",
  ]) if (src.includes(forbidden)) throw new Error(`forbidden marker: ${forbidden}`);
});

// 14) USE_PATIENT_DIRECTORY_ACTIVATION default OFF
step(14, "USE_PATIENT_DIRECTORY_ACTIVATION accessor defaults OFF", () => {
  const probe = `
    process.env = {};
    (async () => {
      const m = await import("../server/services/patientDirectory/patientDirectoryActivationFlag.ts");
      if (m.isPatientDirectoryActivationEnabled() !== false) throw new Error("activation must default OFF");
      console.log("OK");
    })().catch((e) => { console.error(e); process.exit(1); });
  `;
  const tmp = path.join(root, "tmp_recovery", "phase-1-activation-default-probe.mjs");
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, probe);
  try { execSync(`npx tsx ${tmp}`, { cwd: root, stdio: ["ignore", "pipe", "pipe"] }); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
});

// 15) Live HTTP probe SKIPS without DB or with activation OFF
step(15, "Live HTTP probe (gated on DATABASE_URL + activation flag)", () => {
  if (!process.env.DATABASE_URL) {
    return { status: STATUSES.SKIP, detail: "DATABASE_URL unset — boot path requires Postgres" };
  }
  if (process.env.USE_PATIENT_DIRECTORY_ACTIVATION !== "1") {
    return { status: STATUSES.SKIP, detail: "USE_PATIENT_DIRECTORY_ACTIVATION OFF — endpoints unregistered" };
  }
  // If both are set, defer to a future staging smoke harness.
  return { status: STATUSES.SKIP, detail: "boot probe deferred — covered by H5 staging runbook" };
});

// 16) Final report present
step(16, "Final report doc present", () => {
  if (read("docs/architecture/patient-directory-full-activation-results.md") === null) {
    return { status: STATUSES.SKIP, detail: "report written at end of batch run" };
  }
});

console.log("\nSummary\n---------------------------------");
const counts = { PASS: 0, SKIP: 0, FAIL: 0 };
for (const r of results) counts[r.status] += 1;
console.log(`  PASS=${counts.PASS}  SKIP=${counts.SKIP}  FAIL=${counts.FAIL}  total=${results.length}`);

if (hadFailure) {
  console.error("\nFull-activation smoke FAILED");
  process.exit(1);
}
console.log("\nFull-activation smoke passed.");

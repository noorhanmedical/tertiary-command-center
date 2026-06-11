#!/usr/bin/env node
// Patient Directory + duplicate-warning end-to-end smoke (Batch B16).
//
// Runs without a DB. Exercises the pure modules and source-level
// wiring across all 16 implementation batches. Mirrors the format of
// scripts/smoke-phase-1-end-to-end.mjs — every step prints PASS /
// SKIP / FAIL with a one-line detail.

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
    if (r && typeof r === "object" && "status" in r) {
      status = r.status; detail = r.detail ?? "";
    }
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

console.log("\nPatient Directory + duplicate-warning smoke test\n================================================");

// 1) Identity helper
step(1, "Identity helper tier-priority test", () => runTest("tests/unit/patientIdentity.test.ts"));

// 2) Qualification run ordering
step(2, "Qualification run ordering test (groups + run numbering)", () => runTest("tests/unit/qualificationRunOrdering.test.ts"));

// 3) Patient Directory audit doc + service scaffold
step(3, "Patient Directory audit doc + service scaffold present", () => {
  requireText("docs/architecture/patient-directory-runtime-implementation-audit.md", ["source-of-truth ownership is already established"]);
  requireText("server/services/patientDirectory/patientDirectoryService.ts", ["getPatientDirectorySnapshot", "isPatientDirectoryServiceEnabled"]);
});

// 4) Patient Directory service unit test
step(4, "Patient Directory service test", () =>
  runTest("server/services/patientDirectory/__tests__/patientDirectoryService.test.ts"));

// 5) Migration plan committed (no migrations added)
step(5, "Migration plan present; no 0026-0029 migrations committed", () => {
  requireText("docs/architecture/patient-directory-runtime-blockers.md", [
    "0026_add_patient_screening_mrn.sql",
    "0027_add_patient_screening_do_not_contact.sql",
    "0028_add_screening_batch_source_file.sql",
    "0029_add_patient_directory_events.sql",
  ]);
  const migrations = fs.readdirSync(path.join(root, "migrations")).filter((f) => /^00(2[6-9])/.test(f));
  if (migrations.length > 0) throw new Error(`unexpected migrations committed: ${migrations.join(", ")}`);
});

// 6) Duplicate-warning engine unit test (two runs same date, prior sent, DNC, cooldown, prior tests)
step(6, "Duplicate-warning engine test (priors / DNC / cooldown / prior tests)", () =>
  runTest("tests/unit/patientDuplicateWarnings.test.ts"));

// 7) Run comparison selector UI
step(7, "RunComparisonSelector present + uses qualification helper", () => {
  requireText("client/src/components/plexus-iq/RunComparisonSelector.tsx", [
    "RunComparisonSelector",
    "buildQualificationGroups",
    "selectAllRuns",
    "selectByDate",
    "selectByRuns",
  ]);
});

// 8) Plexus IQ duplicate warning badge (reusable)
step(8, "DuplicateWarningBadge reusable component present", () => {
  requireText("client/src/components/patient-directory/DuplicateWarningBadge.tsx", [
    "DuplicateWarningBadge",
    "DuplicateWarningSummary",
    "matched_prior_run",
    "do_not_contact",
  ]);
});

// 9) Admin Review guard + Engagement / Team Portal bar
step(9, "Admin Review duplicate guard + Engagement/Team Portal duplicate bar present", () => {
  requireText("client/src/components/patient-directory/AdminReviewDuplicateGuard.tsx", [
    "AdminReviewDuplicateGuard",
    "isApprovalHardBlocked",
  ]);
  requireText("client/src/components/patient-directory/EngagementHandoffDuplicateBar.tsx", [
    "EngagementHandoffDuplicateBar",
    "flaggedCount",
    "blockedCount",
  ]);
});

// 10) Patient Audit Trail modal
step(10, "Patient Audit Trail modal + event types present", () => {
  requireText("client/src/components/patient-directory/PatientAuditTrailModal.tsx", [
    "PatientAuditTrailModal",
    "endpointUnavailable",
  ]);
  requireText("client/src/lib/patientDirectoryAuditTypes.ts", ["PatientDirectoryEvent"]);
});

// 11) Patient Directory page + profile drawer scaffolds
step(11, "Patient Directory page + profile drawer scaffolds present", () => {
  requireText("client/src/components/patient-directory/PatientDirectoryPage.tsx", [
    "PatientDirectoryPage",
    "PatientProfileDrawer",
    "PatientAuditTrailModal",
  ]);
  requireText("client/src/components/patient-directory/PatientProfileDrawer.tsx", [
    "PatientProfileDrawer",
    "patient-profile-tab-demographics",
    "patient-profile-tab-prior-tests",
    "patient-profile-tab-contact-restrictions",
    "patient-profile-tab-cooldown",
    "patient-profile-tab-engagement-history",
    "patient-profile-tab-call-history",
    "patient-profile-tab-admin-review-history",
    "patient-profile-tab-imports",
    "patient-profile-tab-audit-trail",
  ]);
});

// 12) Import preview parsing + classification
step(12, "Import preview parsing + classification test (CSV + TXT)", () =>
  runTest("tests/unit/patientDirectoryImport.test.ts"));

// 13) Contact restrictions + cooldown helper test
step(13, "Contact restrictions + cooldown gate test", () =>
  runTest("tests/unit/contactRestrictions.test.ts"));

// 14) Prior ancillary history helper test
step(14, "Prior ancillary history helper test", () =>
  runTest("tests/unit/priorAncillaryHistory.test.ts"));

// 15) PDF packet selection dialog (source presence)
step(15, "PDF packet patient selection dialog present", () => {
  requireText("client/src/components/plexus-iq/PacketPatientSelectionDialog.tsx", [
    "PacketPatientSelectionDialog",
    "orderPatientsWithinRun",
    "Print selected",
    "Save selected",
  ]);
});

// 16) Protected surfaces intact
step(16, "Plexus IQ + Admin Review + Team Portal protected surfaces intact", () => {
  for (const rel of [
    "client/src/components/plexus-iq/PlexusIQWorkspace.tsx",
    "client/src/components/plexus-iq/PlexusIQBulkImportModal.tsx",
    "client/src/components/qualification/AdminReviewDialog.tsx",
    "client/src/components/portal/TeamPortalShell.tsx",
    "client/src/components/portal/PortalShell.tsx",
    "client/src/components/portal/PatientCommandCanvas.tsx",
    "client/src/components/portal/SchedulePatientPlayground.tsx",
    "client/src/components/outreach/CallListPanel.tsx",
    "client/src/components/outreach/DispositionSheet.tsx",
    "client/src/components/outreach/CanonicalRowActions.tsx",
    "client/src/components/PatientDirectoryView.tsx",
  ]) if (read(rel) === null) throw new Error(`protected surface missing: ${rel}`);
});

// 17) Run comparison + outreach alphabetical + visit appointment ordering
step(17, "Run comparison + outreach alphabetical + visit appointment sorting (via test fixture)", () =>
  runTest("tests/unit/qualificationRunOrdering.test.ts"));

// 18) PDF selection filters via shared ordering helper
step(18, "PDF selection dialog reuses orderPatientsWithinRun (no separate sort path)", () => {
  const src = read("client/src/components/plexus-iq/PacketPatientSelectionDialog.tsx") ?? "";
  if (!src.includes("orderPatientsWithinRun")) throw new Error("dialog must reuse orderPatientsWithinRun");
});

console.log("\nSummary\n---------------------------------");
const counts = { PASS: 0, SKIP: 0, FAIL: 0 };
for (const r of results) counts[r.status] += 1;
console.log(`  PASS=${counts.PASS}  SKIP=${counts.SKIP}  FAIL=${counts.FAIL}  total=${results.length}`);

if (hadFailure) {
  console.error("\nPatient Directory + duplicate-warning smoke FAILED");
  process.exit(1);
}
console.log("\nPatient Directory + duplicate-warning smoke passed.");

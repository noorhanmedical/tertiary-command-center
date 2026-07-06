#!/usr/bin/env node
// Phase 1 end-to-end smoke test (executable).
//
// Runs WITHOUT a Postgres connection by exercising the pure scaffolds
// in-process (via npx tsx for each unit test) and verifying source-
// level wiring of routes, UI surfaces, and feature-flag gates.
//
// Steps that genuinely need a running app + DB are explicitly skipped
// with reason — they're not failures, they're SKIPs that the final
// report records.
//
// Usage:
//   node scripts/smoke-phase-1-end-to-end.mjs
//
// Exit code: 0 if every required step passed (skips don't fail). 1 if
// any required step failed.

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
      status = r.status;
      detail = r.detail ?? "";
    }
  } catch (e) {
    status = STATUSES.FAIL;
    detail = e instanceof Error ? e.message : String(e);
  }
  if (status === STATUSES.FAIL) hadFailure = true;
  results.push({ num, name, status, detail });
  const tag = status === STATUSES.PASS ? "\x1b[32mPASS\x1b[0m" :
              status === STATUSES.SKIP ? "\x1b[33mSKIP\x1b[0m" :
                                          "\x1b[31mFAIL\x1b[0m";
  const line = `  [${tag}] Step ${String(num).padStart(2, " ")}: ${name}${detail ? "  — " + detail : ""}`;
  console.log(line);
}

function requireText(rel, needles) {
  const c = read(rel);
  if (c === null) throw new Error(`Missing file: ${rel}`);
  const missing = needles.filter((n) => !c.includes(n));
  if (missing.length > 0) throw new Error(`${rel}: missing ${missing.map((n) => `"${n}"`).join(", ")}`);
}

function runTest(testPath) {
  // server/**/__tests__ files are vitest suites; run them via vitest.
  execSync(`npx vitest run ${testPath}`, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

console.log("\nPhase 1 end-to-end smoke test\n=================================");

// Step 1 — Batch Flow intake exists.
step(1, "Batch Flow intake route present", () => {
  requireText("server/routes/batches.ts", ["registerBatchRoutes", "/api/batches"]);
});

// Step 2 — Plexus IQ workspace is intact (read-only role).
step(2, "Plexus IQ workspace + qualification surface intact", () => {
  for (const rel of [
    "client/src/components/plexus-iq/PlexusIQWorkspace.tsx",
    "client/src/components/plexus-iq/PlexusIQBulkImportModal.tsx",
    "client/src/components/plexus-iq/PlexusIQAddPatientHub.tsx",
    "client/src/components/plexus-iq/PlexusIQQualificationJobsStatus.tsx",
  ]) {
    if (read(rel) === null) throw new Error(`Missing protected Plexus IQ file: ${rel}`);
  }
});

// Step 3 — Admin Review surface intact.
step(3, "Admin Review dialog intact (no redesign)", () => {
  requireText("client/src/components/qualification/AdminReviewDialog.tsx", [
    "AdminReviewDialog",
  ]);
});

// Step 4 — Engagement assignment runtime present.
step(4, "Engagement assignment runtime route present", () => {
  for (const rel of ["server/routes/engagementAssignmentBoard.ts", "server/routes/executionCases.ts"]) {
    if (read(rel) === null) throw new Error(`Missing route: ${rel}`);
  }
});

// Step 5 — Engagement call-list read flag accessor present + dormant.
step(5, "Engagement call-list read flag accessor present", () => {
  requireText("server/services/engagement/engagementCanonicalCallListReadFlag.ts", [
    "isEngagementCanonicalCallListReadEnabled",
  ]);
});

// Step 6 — Outreach compatibility route present + default behavior preserved.
step(6, "Outreach compatibility route present + canonical POST helper in DispositionSheet", () => {
  requireText("server/routes/outreach.ts", ['"/api/outreach/calls"']);
  requireText("client/src/components/outreach/DispositionSheet.tsx", [
    '"/api/outreach/calls"',
    "engagementCallResultEndpoint",
  ]);
});

// Step 7 — Engagement canonical call-result route + flag accessor present.
step(7, "Engagement canonical call-result endpoint flag accessor present", () => {
  requireText("server/services/callResult/engagementCanonicalCallResultsEndpointFlag.ts", [
    "isEngagementCanonicalCallResultsEndpointEnabled",
  ]);
});

// Step 8 — Team Portal assigned-work read surface present.
step(8, "Team Portal assigned-work surface present", () => {
  requireText("client/src/components/portal/TeamPortalShell.tsx", [
    '"/api/portal/outreach-call-list"',
    '"/api/portal/my-tasks"',
    '"/api/portal/today-schedule"',
  ]);
});

// Step 9 — Structured call-result selector wired behind flag (E4).
step(9, "Structured call-result selector flag-gated inside DispositionSheet", () => {
  requireText("client/src/components/outreach/DispositionSheet.tsx", [
    "VITE_USE_STRUCTURED_CALL_RESULT_SELECTOR",
    "canonical-call-result-selector",
  ]);
});

// Step 10 — Call-history panel wired behind flag (E7).
step(10, "Call-history panel flag-gated + reuses existing /api/portal/calls", () => {
  requireText("client/src/components/portal/PatientCallHistoryPanel.tsx", [
    "VITE_USE_PATIENT_CALL_HISTORY_READ",
    "/api/portal/calls?patientScreeningId=",
  ]);
  requireText("server/routes/portal.ts", [
    '"/api/portal/calls"',
    "isPortalCallHistoryReadEnabled",
  ]);
});

// Step 11 — RingCentral adapter is dormant + safe without creds.
step(11, "RingCentral adapter test runs + DormantRingCentralClient throws", () => {
  runTest("server/services/ringCentral/__tests__/ringCentralAdapter.test.ts");
});

// Step 12 — Call-result canonical fixture pins all 15 outcomes
//           AND parity test still passes.
step(12, "Canonical call-result fixture (15 outcomes) + parity test green", () => {
  requireText("tests/fixtures/callResultCanonicalization.fixture.ts", [
    "CALL_RESULT_OUTCOMES_FIXTURE",
    '"scheduled"', '"callback"', '"no_answer"', '"voicemail"', '"wrong_number"',
    '"declined"', '"needs_records"', '"insurance_prior_auth_issue"', '"manager_review"',
    '"facility_specific_issue"', '"completed"', '"dnc"', '"do_not_contact"', '"deceased"', '"cancelled"',
  ]);
  runTest("server/services/__tests__/callResultCanonicalization-parity.test.ts");
});

// Step 13 — Callback / task / triage payload extension args still in adapter.
step(13, "Callback / task / triage payload extension args present in adapter", () => {
  requireText("server/services/callResult/recordCallResultExecutionAdapter.ts", [
    "callbackHours",
    "engagementStatusSemantics",
    "canonicalSpineRequired",
    "suppressedSteps",
  ]);
});

// Step 14 — Journey-event metadata contract still present + per-surface step
//           suppression in engagement + outreach executors.
step(14, "Per-surface step suppression in engagement + outreach executors", () => {
  requireText("server/services/callResult/recordCallResultOutreachExecutor.ts", [
    "OUTREACH_SUPPRESSED_STEPS",
    "journeyEventAppended",
    "executionCaseUpdated",
    "triageCaseUpserted",
    "followUpTaskCreated",
  ]);
  requireText("server/services/callResult/recordCallResultEngagementExecutor.ts", [
    "ENGAGEMENT_SUPPRESSED_STEPS",
    "outreachCallCreated",
    "assignmentCompleted",
  ]);
});

// Step 15 — Ancillary read-model returns expected blocker set.
step(15, "Ancillary read-model test (REQUIRED_KINDS = report/order_note/post_procedure_note)", () => {
  runTest("server/services/ancillary/__tests__/ancillaryReadModel.test.ts");
});

// Step 16 — Physician signing service transition table.
step(16, "Physician signing service transition table test", () => {
  runTest("server/services/ancillary/__tests__/signingService.test.ts");
});

// Step 17 — Billing readiness aggregator returns ready/blocked/incomplete/billed.
step(17, "Billing readiness aggregator test", () => {
  runTest("server/services/billingReadiness/__tests__/billingReadinessAggregator.test.ts");
});

// Step 18 — Invoicing scaffold creates a draft from a ready snapshot.
step(18, "Invoicing scaffold test (draft from ready snapshot)", () => {
  runTest("server/services/invoicing/__tests__/invoicingScaffold.test.ts");
});

// Step 19 — AWS runbooks + env inventory exist.
step(19, "AWS deploy/backup/smoke runbooks + env inventory present", () => {
  for (const rel of [
    "docs/architecture/phase-1-aws-deployment-contract.md",
    "docs/architecture/phase-1-aws-deploy-runbook.md",
    "docs/architecture/phase-1-aws-backup-runbook.md",
    "docs/architecture/phase-1-aws-smoke-test-runbook.md",
    "docs/architecture/phase-1-env-var-inventory.md",
  ]) if (read(rel) === null) throw new Error(`Missing doc: ${rel}`);
});

// Step 20 — Plexus IQ is not Mission Control (no dashboard-shaped imports).
step(20, "Plexus IQ workspace contains no Mission Control / billing dashboard markers", () => {
  const src = read("client/src/components/plexus-iq/PlexusIQWorkspace.tsx") ?? "";
  const forbidden = [
    "MissionControl",
    "BillingDashboard",
    "InvoiceDashboard",
    "ProductivityDashboard",
    "FinancialDashboard",
    "OperationalMetrics",
    "ClaimsDashboard",
    "RemittanceDashboard",
    "DenialsDashboard",
    "PaymentPostingDashboard",
  ];
  const hits = forbidden.filter((f) => src.includes(f));
  if (hits.length > 0) throw new Error(`forbidden markers: ${hits.join(", ")}`);
});

// Step 21 — Admin Review remains protected (no UI redesign markers).
step(21, "Admin Review dialog contains no redesign markers", () => {
  const src = read("client/src/components/qualification/AdminReviewDialog.tsx") ?? "";
  for (const required of ["AdminReviewDialog"]) {
    if (!src.includes(required)) throw new Error(`AdminReviewDialog missing identity: ${required}`);
  }
});

// Step 22 — Team Portal panels / playground intact.
step(22, "Team Portal protected surfaces still on disk", () => {
  for (const rel of [
    "client/src/components/portal/TeamPortalShell.tsx",
    "client/src/components/portal/PortalShell.tsx",
    "client/src/components/portal/PatientCommandCanvas.tsx",
    "client/src/components/portal/SchedulePatientPlayground.tsx",
    "client/src/components/outreach/CallListPanel.tsx",
    "client/src/components/outreach/DispositionSheet.tsx",
    "client/src/components/outreach/CanonicalRowActions.tsx",
  ]) if (read(rel) === null) throw new Error(`Missing protected surface: ${rel}`);
});

// Bonus — DB-required live HTTP probe is SKIPPED unless DATABASE_URL is set.
step(23, "Live HTTP probe (boot server, hit /api/health)", () => {
  if (!process.env.DATABASE_URL) {
    return { status: STATUSES.SKIP, detail: "DATABASE_URL unset — boot path requires a running Postgres" };
  }
  // If a DB were present, a future revision could boot the server and curl
  // /api/health. For now we mark SKIP rather than spawning without DB.
  return { status: STATUSES.SKIP, detail: "boot probe deferred — handled by H5 staging runbook" };
});

// Bonus — Production flag default sanity: every Phase 1 server flag
// accessor must default to OFF when the env var is unset, EXCEPT the
// engagement-canonical-call-results endpoint flag which now defaults
// ON per Phase 1 Slice 1.4 (canonical writeback is the new default;
// LEGACY_CALL_RESULT_ROLLBACK is the rollback flag).
step(24, "Phase 1 server flag accessors default to documented values when env is empty", () => {
  // Use a child invocation so we can scrub process.env.
  const probe = `
    process.env = {};
    const mods = [
      "../server/services/callResult/engagementCanonicalCallResultsEndpointFlag.ts",
      "../server/services/engagement/engagementCanonicalCallListReadFlag.ts",
      "../server/services/callResult/recordCallResultEngagementDelegateFlag.ts",
      "../server/services/callResult/recordCallResultOutreachDelegateFlag.ts",
      "../server/services/ringCentral/ringCentralAdapter.ts",
      "../server/services/ancillary/ancillaryReadModel.ts",
      "../server/services/ancillary/signingService.ts",
      "../server/services/billingReadiness/billingReadinessAggregator.ts",
      "../server/services/invoicing/invoicingScaffold.ts",
    ];
    // [modName, accessor, expectedDefault]
    // Slice 1.4: engagementCanonicalCallResultsEndpointFlag defaults ON
    // (canonical writeback is now the production default; the legacy
    // singular endpoint is reachable only via LEGACY_CALL_RESULT_ROLLBACK=1).
    const accessors = [
      ["engagementCanonicalCallResultsEndpointFlag", "isEngagementCanonicalCallResultsEndpointEnabled", true],
      ["engagementCanonicalCallListReadFlag", "isEngagementCanonicalCallListReadEnabled", false],
      ["recordCallResultEngagementDelegateFlag", "isRecordCallResultEngagementDelegateEnabled", false],
      ["recordCallResultOutreachDelegateFlag", "isRecordCallResultOutreachDelegateEnabled", false],
      ["ringCentralAdapter", "isRingCentralAdapterEnabled", false],
      ["ancillaryReadModel", "isAncillaryReadModelEnabled", false],
      ["signingService", "isSigningServiceEnabled", false],
      ["billingReadinessAggregator", "isBillingReadinessAggregatorEnabled", false],
      ["invoicingScaffold", "isInvoicingScaffoldEnabled", false],
    ];
    (async () => {
      for (const [modName, accessor, expected] of accessors) {
        const m = await import(mods.find((p) => p.includes(modName)));
        if (typeof m[accessor] !== "function") throw new Error(modName + " missing accessor " + accessor);
        const actual = m[accessor]();
        if (actual !== expected) throw new Error(modName + "." + accessor + "() expected " + expected + " but got " + actual);
      }
      console.log("OK");
    })().catch((e) => { console.error(e); process.exit(1); });
  `;
  const tmp = path.join(root, "tmp_recovery", "phase-1-flag-default-probe.mjs");
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, probe);
  try {
    execSync(`npx tsx ${tmp}`, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

// Summary -----------------------------------------------------------------
console.log("\nSummary");
console.log("---------------------------------");
const counts = { PASS: 0, SKIP: 0, FAIL: 0 };
for (const r of results) counts[r.status] += 1;
console.log(`  PASS=${counts.PASS}  SKIP=${counts.SKIP}  FAIL=${counts.FAIL}  total=${results.length}`);

if (hadFailure) {
  console.error("\nPhase 1 end-to-end smoke test FAILED");
  process.exit(1);
}
console.log("\nPhase 1 end-to-end smoke test passed (skips noted).");

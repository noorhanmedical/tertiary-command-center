// QA: architecture docs folder integrity.
//
// Source-code invariant check. No DB, no app boot, no network, no PHI.
// Asserts that every file the architecture program depends on is present
// IN THE CURRENT TREE.
//
// Important rollout note for the architecture program (Batches 0–21):
//   This script grows in scope as architecture PRs merge into main. The
//   list below intentionally records ONLY the files this script's batch
//   (Batch 21) knows are present on this branch. As Batches 0/1/3a/etc.
//   land on main, sub-batches of Batch 21 (specifically 21a) MUST extend
//   this list to add the newly-canonical docs.
//
//   See docs/architecture/qa-matrix.md §3.2 for the full canonical
//   expected set. The script SHOULD NOT diverge from that list once the
//   architecture PRs are merged.
//
// Pattern intentionally mirrors the existing scripts/qa-*.mjs scripts.
// This script does NOT lock the CONTENT of any doc — only its existence.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function requireFileExists(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`Missing architecture doc: ${rel}`);
  }
}

// ─── Files KNOWN to be on this branch (Batch 21) ─────────────────────
//
// As of Batch 21's branch (forked from origin/main), the only
// architecture doc on this tree is qa-matrix.md (added by this PR).
// Every other architecture doc lives on a separately-open PR that has
// not yet merged to main. The list below grows when those PRs merge.

requireFileExists("docs/architecture/qa-matrix.md");

// ─── Files this script's matrix EXPECTS to be canonical (post-merge) ─
//
// These checks are soft today (info log only, no failure). Once the
// originating PR merges, an updater PR converts the matching info() call
// to requireFileExists() so the script becomes a real tripwire.
//
// Pattern: this comment block + the info() calls below are the spec for
// future updaters. See qa-matrix.md §3.2 / §4 for the migration order.

function info(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    // Intentionally informational — these files are expected to be
    // canonical once their originating PRs merge.
    return;
  }
  // If we reach here the file IS present on this branch — promote the
  // check to a hard assertion so future re-deletions are caught.
  requireFileExists(rel);
}

info("docs/architecture/review-canonical-spine-2026-06-09.md");
info("docs/architecture/full-21-batch-orchestrator-review.md");
info("docs/architecture/README.md");
info("docs/architecture/canonical-spine.md");
info("docs/architecture/protected-flows.md");
info("docs/architecture/dependency-map.md");
info("docs/architecture/refactor-batches.md");
info("docs/architecture/do-not-touch.md");
info("docs/architecture/backend-route-parity-inventory.md");
info("docs/architecture/patient-directory-design.md");
info("docs/architecture/facility-string-inventory.md");
info("docs/architecture/facilities-design.md");
info("docs/architecture/patient-matching-design.md");
info("docs/architecture/pdf-protection-contract.md");
info("docs/architecture/team-task-spine-design.md");
info("docs/architecture/billing-cleanup-design.md");

// Batch 11a — Operational Queue source maps + design.
info("docs/architecture/call-list-source-map.md");
info("docs/architecture/scheduler-task-source-map.md");
info("docs/architecture/visit-schedule-source-map.md");
info("docs/architecture/global-calendar-source-map.md");
info("docs/architecture/operational-queue-design.md");

// Batches 10 + 12 — canonical-spine read-only foundations.
info("docs/architecture/execution-case-state-machine.md");
info("docs/architecture/journey-event-standardization-design.md");

// Batches 18 + 19 — infrastructure design (docs-only).
info("docs/architecture/background-jobs-design.md");
info("docs/architecture/aws-readiness-design.md");

// Batch 16 — documents storage abstraction (docs-only).
info("docs/architecture/documents-storage-design.md");

// Batch 11d.2 — operational-queue → SchedulerAssignment projection (docs-only).
info("docs/architecture/operational-queue-call-list-projection-design.md");

// Batch 19 — AWS readiness pre-cutover checklist (docs-only).
info("docs/architecture/aws-readiness-checklist.md");

// Bundle 11 — Team Portal + Playground wiring contract (docs-only).
info("docs/architecture/team-portal-playground-wiring-contract.md");

// Bundle 15 — Shadow-read parity-log analyzer (docs-only).
info("docs/architecture/shadow-read-parity-log-analyzer-design.md");

// Bundle 17 — Operational queue staging runbook (docs-only).
info("docs/architecture/operational-queue-staging-runbook.md");

// Bundle 18 — Portal cutover readiness checklist (docs-only).
info("docs/architecture/portal-cutover-readiness-checklist.md");

// Bundle 20 — Patient Directory shadow-read contract (docs-only).
info("docs/architecture/patient-directory-shadow-read-contract.md");

// Bundle 25 — Plexus IQ aggregate read-model contract (docs-only).
info("docs/architecture/plexus-iq-read-model-contract.md");

// Bundle 29 — Billing/invoice hard-stop map (docs-only).
info("docs/architecture/billing-invoice-hard-stop-map.md");

// Bundle 30 — Admin Review approval → commit inventory (docs-only).
info("docs/architecture/admin-review-approval-commit-inventory.md");

// Bundle 31 — Qualification structure cleanup design (docs-only).
info("docs/architecture/qualification-structure-cleanup-design.md");

// Bundle 32 — Playground design-system implementation plan (docs-only).
info("docs/architecture/playground-design-system-implementation-plan.md");

// Bundle 36 — QA index + regression coverage map (docs-only).
info("docs/architecture/qa-index-regression-map.md");

// Bundle 37 — EMR + Clinical Evidence + Ancillary Qualification (docs-only).
info("docs/architecture/emr-integration-clinical-evidence-qualification-contract.md");

// Bundle 38 — Clinical Evidence Store contract (docs-only).
info("docs/architecture/clinical-evidence-store-contract.md");

// Bundle 39 — EMR adapter interface design (docs-only).
info("docs/architecture/emr-adapter-interface-design.md");

// Bundle 40 — ICD suggestion safety contract (docs-only).
info("docs/architecture/icd-suggestion-safety-contract.md");

// Bundle 43 — Labs/imaging/notes extraction contract (docs-only).
info("docs/architecture/labs-imaging-notes-extraction-contract.md");

// Bundle 49 — Patient Directory read-only envelope readiness (docs-only).
info("docs/architecture/patient-directory-readonly-envelope-readiness.md");

// Bundle 54 — Team Portal runtime wiring readiness checklist (docs-only).
info("docs/architecture/team-portal-runtime-wiring-readiness-checklist.md");

// Bundle 55 — Frontend hooks extraction plan (docs-only).
info("docs/architecture/frontend-hooks-extraction-plan.md");

// Bundle 56 — PDF preview + download contract (docs-only).
info("docs/architecture/pdf-preview-download-contract.md");

// Batch A — Engagement call-list canonicalization contract (docs-only).
info("docs/architecture/engagement-call-list-canonicalization-contract.md");

// Batch D — Team-member assignment terminology contract (docs-only).
info("docs/architecture/team-member-assignment-terminology-contract.md");

// Batch E — Engagement → call-list bridge contract (docs-only).
info("docs/architecture/engagement-call-list-bridge-contract.md");

// Batch F — Team Portal call-list consumption readiness (docs-only).
info("docs/architecture/team-portal-call-list-consumption-readiness.md");

// Batch G — Call history read-only envelope contract (docs-only).
info("docs/architecture/call-history-readonly-envelope-contract.md");

// Batch H — Call-list runtime implementation plan (docs-only).
info("docs/architecture/call-list-runtime-implementation-plan.md");

// Batch K — Final call-list canonicalization summary (docs-only).
info("docs/architecture/call-list-canonicalization-summary.md");

// Batch H Step 4 — Call-result preview parity readiness (docs-only).
info("docs/architecture/call-result-preview-parity-readiness.md");

// Platform split-brain run Batch 1 — Platform-wide audit (docs-only).
info("docs/architecture/platform-split-brain-audit.md");

// Platform split-brain run Batch 2 — Canonical ownership registry.
info("docs/architecture/canonical-workflow-ownership-registry.md");

// Platform split-brain run Batch 3 — Source scanner baseline (docs-only).
info("docs/architecture/platform-split-brain-source-scanner-baseline.md");

// Platform split-brain run Batch 4 — Engagement/Outreach ownership audit.
info("docs/architecture/engagement-outreach-ownership-audit.md");

// Platform split-brain run Batch 5 — UI wiring audit.
info("docs/architecture/engagement-call-list-ui-wiring-audit.md");

// Platform split-brain run Batch 6 — Engagement canonical endpoint contract.
info("docs/architecture/engagement-canonical-call-result-endpoint-contract.md");

// Platform split-brain run Batch 10 — Engagement delegation contract.
info("docs/architecture/call-result-engagement-delegation-contract.md");

// Platform split-brain run Batch 12 — Engagement delegation BLOCKERS.
info("docs/architecture/call-result-engagement-delegation-blockers.md");

// Platform split-brain run Batch 13 — Outreach-as-Engagement-subworkflow contract.
info("docs/architecture/outreach-as-engagement-subworkflow-contract.md");

// Platform split-brain run Batch 17 — Outreach delegation contract.
info("docs/architecture/call-result-outreach-delegation-contract.md");

// Platform split-brain run Batch 19 — Outreach delegation BLOCKERS.
info("docs/architecture/call-result-outreach-delegation-blockers.md");

// Platform split-brain run Batch 20 — Team Portal canonical write contract.
info("docs/architecture/team-portal-canonical-call-result-write-contract.md");

// Platform split-brain run Batch 21 — Team Portal source wiring readiness.
info("docs/architecture/team-portal-call-result-source-wiring-readiness.md");

// Platform split-brain run Batch 22 — Engagement UI terminology contract.
info("docs/architecture/engagement-ui-terminology-contract.md");

// Platform split-brain run Batch 23 — Plexus IQ split-brain audit.
info("docs/architecture/plexus-iq-split-brain-audit.md");

// Platform split-brain run Batch 24 — Risk register.
info("docs/architecture/platform-split-brain-risk-register.md");

// Platform split-brain run Batch 25 — Final summary.
info("docs/architecture/no-split-brain-architecture-summary.md");

// Adapter blockers run Batch D — Journey-event metadata contract.
info("docs/architecture/call-result-journey-event-metadata-contract.md");

// Adapter blockers run Batch E — engagementStatus semantics decision doc.
info("docs/architecture/call-result-engagement-status-semantics.md");

// Adapter blockers run Batch F — outreach-only outcome extension design.
info("docs/architecture/call-result-outreach-only-outcome-extension.md");

// Adapter blockers run Batch H — Resolution summary.
info("docs/architecture/call-result-delegation-blockers-resolution-summary.md");

// Arg-extensions run Batch 7 — Engagement blockers reduction summary.
info("docs/architecture/call-result-engagement-blockers-reduction-summary.md");

// Arg-extensions run Batch 8 — Engagement-route delegation readiness re-check.
info("docs/architecture/call-result-engagement-route-delegation-readiness-recheck.md");

// Engagement completion run Batch 2 — FINAL readiness.
info("docs/architecture/call-result-engagement-route-delegation-final-readiness.md");

// Engagement completion run Batch 7 — Canonical plural endpoint contract.
info("docs/architecture/engagement-canonical-call-results-endpoint-implementation-contract.md");

// Engagement completion run Batch 10 — UI post-delegation source audit.
info("docs/architecture/engagement-ui-post-delegation-source-audit.md");

// Engagement completion run Batch 11 — UI canonical write switch plan.
info("docs/architecture/engagement-ui-canonical-write-switch-plan.md");

// Engagement completion run Batch 13 — Call-list ownership final contract.
info("docs/architecture/engagement-call-list-ownership-final-contract.md");

// Engagement completion run Batch 14 — Call-list service module plan.
info("docs/architecture/engagement-call-list-service-module-plan.md");

// Engagement completion run Batch 16 — Call-list route contract.
info("docs/architecture/engagement-call-list-route-contract.md");

// Engagement completion run Batch 18 — UI terminology implementation plan.
info("docs/architecture/engagement-ui-terminology-implementation-plan.md");

// Engagement completion run Batch 19 — UI terminology implementation BLOCKERS.
info("docs/architecture/engagement-ui-terminology-implementation-blockers.md");

// Engagement completion run Batch 20 — Final summary.
info("docs/architecture/engagement-completion-summary.md");

// Phase 1 run Segment B Batch 1 — outreach atomic write contract.
info("docs/architecture/phase-1-outreach-atomic-write-contract.md");

// Phase 1 run Segment B Batch 3 — outreach Journey Event ownership contract.
info("docs/architecture/phase-1-outreach-journey-event-ownership-contract.md");

// Phase 1 run Segment B Batch 6 — outreach route delegation final readiness.
info("docs/architecture/phase-1-outreach-route-delegation-final-readiness.md");

// Phase 1 run Segment B Batch 10 — Team Portal outreach write audit.
info("docs/architecture/phase-1-team-portal-outreach-write-audit.md");

// Phase 1 run Segment B Batch 12 — outreach completion summary.
info("docs/architecture/phase-1-outreach-completion-summary.md");

// Phase 1 run Segment C Batch 1 — module wiring contract.
info("docs/architecture/phase-1-module-wiring-contract.md");

// Phase 1 run Segment C Batch 2 — canonical ID registry.
info("docs/architecture/phase-1-canonical-id-registry.md");

// Phase 1 run Segment C Batch 3 — status ownership registry.
info("docs/architecture/phase-1-status-ownership-registry.md");

// Phase 1 run Segment C Batch 4 — wiring smoke-test contract.
info("docs/architecture/phase-1-wiring-smoke-test-contract.md");

// Phase 1 run Segment D Batch 1 — Plexus IQ boundary contract.
info("docs/architecture/phase-1-plexus-iq-boundary-contract.md");

// Phase 1 run Segment D Batch 2 — Admin Review boundary contract.
info("docs/architecture/phase-1-admin-review-boundary-contract.md");

// Phase 1 run Segment D Batch 4 — Batch Flow handoff contract.
info("docs/architecture/phase-1-batch-flow-handoff-contract.md");

// Phase 1 run Segment E Batch 1 — Team Portal panel/playground protection contract.
info("docs/architecture/team-portal-panel-playground-protection-contract.md");

// Phase 1 run Segment E Batch 2 — Team Portal Patient Directory wiring contract.
info("docs/architecture/team-portal-patient-directory-wiring-contract.md");

// Phase 1 run Segment E Batch 3 — Team Portal structured call-result selector contract.
info("docs/architecture/team-portal-structured-call-result-selector-contract.md");

// Phase 1 run Segment E Batch 5 — RingCentral adapter contract.
info("docs/architecture/ringcentral-adapter-contract.md");

// Phase 1 run Segment E Batch 8 — canonical call-result write switch plan.
info("docs/architecture/team-portal-canonical-call-result-write-switch-plan.md");

// Phase 1 run Segment F Batch 1 — ancillary boundary contract.
info("docs/architecture/phase-1-ancillary-boundary-contract.md");

// Phase 1 run Segment F Batch 3 — ancillary report upload contract.
info("docs/architecture/ancillary-report-upload-contract.md");

// Phase 1 run Segment F Batch 4 — ancillary order/note tracking contract.
info("docs/architecture/ancillary-order-note-tracking-contract.md");

// Phase 1 run Segment F Batch 5 — physician signing contract.
info("docs/architecture/physician-signing-contract.md");

// Phase 1 run Segment G Batch 1 — billing readiness boundary contract.
info("docs/architecture/phase-1-billing-readiness-boundary-contract.md");

// Phase 1 run Segment G Batch 3 — invoicing boundary contract.
info("docs/architecture/phase-1-invoicing-boundary-contract.md");

// Phase 1 run Segment H Batch 1 — AWS deployment contract.
info("docs/architecture/phase-1-aws-deployment-contract.md");

// Phase 1 run Segment H Batch 2 — env var inventory.
info("docs/architecture/phase-1-env-var-inventory.md");

// Phase 1 run Segment H Batch 3 — AWS deploy runbook.
info("docs/architecture/phase-1-aws-deploy-runbook.md");

// Phase 1 run Segment H Batch 4 — AWS backup runbook.
info("docs/architecture/phase-1-aws-backup-runbook.md");

// Phase 1 run Segment H Batch 5 — AWS smoke-test runbook.
info("docs/architecture/phase-1-aws-smoke-test-runbook.md");

// Phase 1 run Segment I Batch 1 — end-to-end smoke contract.
info("docs/architecture/phase-1-end-to-end-smoke-contract.md");

// Phase 1 run Segment I Batch 2 — scanner enforcement plan.
info("docs/architecture/phase-1-scanner-enforcement-plan.md");

if (failures.length > 0) {
  console.error("Architecture docs integrity QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
} else {
  console.log("Architecture docs integrity QA passed.");
}

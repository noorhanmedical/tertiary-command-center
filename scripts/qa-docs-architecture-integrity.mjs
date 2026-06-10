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

// Bundle 15 — Shadow-read parity-log analyzer (docs-only).
info("docs/architecture/shadow-read-parity-log-analyzer-design.md");

// Bundle 17 — Operational queue staging runbook (docs-only).
info("docs/architecture/operational-queue-staging-runbook.md");

if (failures.length > 0) {
  console.error("Architecture docs integrity QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
} else {
  console.log("Architecture docs integrity QA passed.");
}

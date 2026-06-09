# Architecture docs — index

This folder is the **living architecture map** for `tertiary-command-center`. It is the canonical reference for every safe-refactor PR going forward.

Batch 0 (the original architecture review) lives in **`review-canonical-spine-2026-06-09.md`** and is **frozen** as a historical record. New architectural changes go into the focused docs below — never back into the frozen review.

## Living docs

| File | Purpose |
| --- | --- |
| [`canonical-spine.md`](./canonical-spine.md) | Target patient/case spine vs. what exists today (gap analysis). |
| [`protected-flows.md`](./protected-flows.md) | Working flows that must remain working, paired with the QA script that exercises each. |
| [`dependency-map.md`](./dependency-map.md) | Fan-in / fan-out for the highest-coupling modules (PDF, AdminReviewDialog, EngagementAssignmentBoard, patientCommitService, screening, billing, invoices, storage). |
| [`refactor-batches.md`](./refactor-batches.md) | The 13-step safe-refactor plan from the original review (Batches 0–13). |
| [`do-not-touch.md`](./do-not-touch.md) | Exact file paths that must not be moved, renamed, or refactored without per-batch approval. |

## Orchestrator + originals

| File | Purpose |
| --- | --- |
| `review-canonical-spine-2026-06-09.md` | **Frozen.** Original Batch 0 review (720 lines). Cite by §-number. Do not edit. |
| `full-21-batch-orchestrator-review.md` | The 22-batch orchestrator (Batches 0–21) with copy/paste implementation prompts. The orchestrator is the source of truth for batch scope, allowed/forbidden files, validation, and approval phrases. |

## How to use this folder

- Before opening any refactor PR, find the protected flows it touches in `protected-flows.md`. If your PR would change behavior in any of them, the PR must be in a batch that explicitly allows it.
- Before moving or renaming any file, check `do-not-touch.md`. If the file is listed, the move/rename is **not** allowed in your batch unless the batch's prompt explicitly permits it.
- Before adding a new cross-cutting import, check `dependency-map.md`. High-fan-in modules (especially `client/src/lib/pdfGeneration.ts`) require extra care.
- When proposing a new batch, link the relevant rows in `canonical-spine.md` and `refactor-batches.md`.

## How to update this folder

- These docs describe **reality, not aspirations**. If a fact here is wrong, fix the fact — don't leave it.
- When a refactor ships that changes the do-not-touch surface (e.g., a sub-component is extracted from a large file), update `do-not-touch.md` and `dependency-map.md` in the same PR.
- Never edit `review-canonical-spine-2026-06-09.md`. If a finding there is stale, note the divergence in the living doc and link back.

## Cross-references

- Original review: [`review-canonical-spine-2026-06-09.md`](./review-canonical-spine-2026-06-09.md)
- Orchestrator: [`full-21-batch-orchestrator-review.md`](./full-21-batch-orchestrator-review.md)
- Repo-level guardrails: `CLAUDE.md` (repo root)
- Existing architecture notes: `docs/PLEXUS_IQ_RECOVERY_BASELINE.md`, `docs/clinic-workflow-spine.md`

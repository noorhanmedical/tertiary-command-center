# Safe-refactor batches (Batches 0–13)

Mirrors §9 of `review-canonical-spine-2026-06-09.md`. This doc holds the original 13-step plan for cross-reference; the full 22-batch program (Batches 0–21) with copy/paste implementation prompts lives in [`full-21-batch-orchestrator-review.md`](./full-21-batch-orchestrator-review.md).

> Every batch lists goal, files likely touched, risk, behavior that must remain identical, validation commands, manual regression notes, and rollback. **Do not implement any batch directly from this doc** — always use the matching orchestrator prompt.

---

## Batch 0 — Architecture review report **(SHIPPED — PR #50)**

- **Goal:** Architecture report only.
- **Files:** `docs/architecture/review-canonical-spine-2026-06-09.md`.
- **Risk:** None.
- **Validation:** `npm run check`, `npm run build`, all 8 `scripts/qa-*.mjs` — all PASS.
- **Rollback:** Delete file or revert PR.

---

## Batch 1 — Architecture docs + dependency map *(this PR)*

- **Goal:** Split Batch 0 into focused living docs.
- **Files:** `docs/architecture/{README, canonical-spine, protected-flows, dependency-map, refactor-batches, do-not-touch}.md`.
- **Risk:** None.
- **Behavior to preserve:** All — no code touched.
- **Validation:** `npm run check`, `npm run build`, 8 QA scripts.
- **Rollback:** Delete docs.

---

## Batch 2 — Shared contracts / types extraction only

- **Goal:** Pull stable contracts (reasoning blob shape, admin-review status union, engagement board row type, journey event kinds) into `shared/contracts/`.
- **Files:** `shared/contracts/*.ts` (new); ≤ 3 low-risk consumer files.
- **Risk:** LOW. Pure type moves.
- **Behavior to preserve:** Runtime identical (types only).
- **Validation:** `npm run check` must remain clean; `npm run build`; all QA scripts.
- **Manual regression:** None.
- **Rollback:** Revert imports + delete `shared/contracts/`.

---

## Batch 3 — Backend service wrappers around existing route logic

- **Goal:** Wrap the inline business logic in `routes/patients.ts` admin-review endpoints and `routes/billing.ts` auto-create scan in **services that call the same code**, without changing request/response shapes or DB writes.
- **Files:** `server/services/adminReviewService.ts` (new), `server/services/billingAutoCreateService.ts` (new), small edits to two route files to delegate.
- **Risk:** MEDIUM.
- **Behavior to preserve:** Identical responses for `evidence`, `regenerate`, `regenerate-all`, `regenerate-ancillary`, and `GET /api/billing-records`.
- **Validation:** `npm run check`, `npm run build`, all QA scripts, plus manual Admin Review + billing.
- **Rollback:** Inline the service back into the route.

---

## Batch 4 — Frontend hooks extraction

- **Goal:** Pull data fetches out of `AdminReviewDialog`, `EngagementAssignmentBoard`, and `PortalShell` into custom hooks under `hooks/api/`. **No JSX changes, no test-id changes, no UI behavior changes.**
- **Files:** New `hooks/api/admin-review.ts`, `hooks/api/engagement-board.ts`, `hooks/api/portal-shell.ts`; small import edits in the three components.
- **Risk:** MEDIUM.
- **Behavior to preserve:** Test-ids, markup, modal sequencing, sibling navigation, conflict-guard behavior, bulk-assignment behavior, PDF preview triggers.
- **Validation:** check / build / 8 QA scripts; click-through of Admin Review.
- **Rollback:** Revert hook imports.

---

## Batch 5 — Patient Directory preparation (read-side only)

- **Goal:** Add `server/modules/patient-directory/` with **read-only** helpers that compute a canonical view from `patient_screenings`. Add `getCanonicalPatientId(screeningId)` helper. **No new table.** **No data migration.**
- **Files:** `server/modules/patient-directory/{contracts,repo,service}.ts`.
- **Risk:** LOW.
- **Behavior to preserve:** All UI flows unchanged.
- **Validation:** check / build / 8 QA scripts.
- **Rollback:** Delete module.

---

## Batch 6 — Execution case / team task spine preparation

- **Goal:** Add `server/modules/execution-cases/stateMachine.ts` with named transitions covering today's enums. Wrap (don't replace) the existing direct status writes. Map current `plexus_tasks` types + `scheduler_assignments` rows to a unified `TeamTask` view (read-only).
- **Files:** new module files; no UI changes.
- **Risk:** LOW.
- **Behavior to preserve:** Existing status writes still work; new writer is opt-in.
- **Validation:** check / build / 8 QA scripts.
- **Rollback:** Remove new module.

---

## Batch 7 — Journey event standardization

- **Goal:** Add `server/platform/audit/journeyEventWriter.ts` with typed event kinds. Add missing journey events (`admin_review_regenerated`, `admin_review_approved`, `admin_review_rejected`, `regenerate_all`, `billing_record_status_changed`, `invoice_payment_recorded`). Existing events preserved; new events are additive only.
- **Files:** new writer + augmentations to 3–5 routes/services.
- **Risk:** LOW (additive).
- **Behavior to preserve:** Existing events identical.
- **Validation:** check / build / 8 QA scripts.
- **Manual regression:** Admin Review regenerate + approve; confirm new journey events appear.
- **Rollback:** Disable the writer with a feature gate.

---

## Batch 8 — Engagement Center read-model optimization

- **Goal:** Add a paginated/filtered `GET /api/engagement/assignment-board?page=...&facility=...` alongside today's endpoint. UI keeps the old endpoint.
- **Files:** new route + service; no UI changes.
- **Risk:** LOW (additive endpoint).
- **Validation:** check / build / 8 QA scripts.
- **Rollback:** Remove new endpoint.

---

## Batch 9 — Plexus IQ read-model optimization

- **Goal:** Replace per-batch all-row scans with aggregate endpoints. Keep existing endpoints alive.
- **Files:** server routes/services only.
- **Risk:** LOW (additive).
- **Validation:** check / build / 8 QA scripts.
- **Rollback:** Remove new endpoints.

---

## Batch 10 — Admin Review modularization

- **Goal:** Split `AdminReviewDialog.tsx` into `ApprovalPanel`, `EvidencePanel`, `ClinicalEditor`, `ReasoningEditor`, `SiblingNav`, `AuditLog`. **Preserve** all test-ids, the four regenerate endpoints, sibling Next/Prev, PDF preview, and the "Updates Made In Patient" change log.
- **Files:** `client/src/components/qualification/AdminReviewDialog.tsx` + new sub-files under `components/qualification/admin-review/`.
- **Risk:** HIGH. Ship only after Batches 2, 3, 4, 7 + a manual QA pass.
- **Validation:** check / build / 8 QA scripts + full manual regression of Plexus IQ, Admin Review, Clinician PDF, Plexus PDF, Engagement Center.
- **Rollback:** Keep the original `AdminReviewDialog.tsx` on a branch tag; revert if regression appears.

---

## Batch 11 — S3 / storage abstraction

- **Goal:** Make `STORAGE_PROVIDER=s3` the production default, document the cutover, add a one-shot script to migrate `uploaded_documents.driveFileId` → S3 keys with `sourceNotes` provenance. **Do not delete Drive data.**
- **Files:** small edits to `validateEnv.ts`, `integrations/fileStorage.ts`; new script under `script/`.
- **Risk:** LOW (abstraction); MEDIUM (cutover).
- **Validation:** check / build / 8 QA scripts; manual upload/download test.
- **Rollback:** Set `STORAGE_PROVIDER=google_drive`.

---

## Batch 12 — Worker / job architecture

- **Goal:** Add `platform/queue/` with an in-process worker that pulls from a typed queue (today: `outbox_items`; tomorrow: SQS). **No production job moves** until tests exist.
- **Files:** new module; no existing routes/services modified.
- **Risk:** LOW.
- **Validation:** check / build / 8 QA scripts.
- **Rollback:** Disable worker.

---

## Batch 13 — AWS deployment readiness

- **Goal:** Add Dockerfile, ECS Fargate task definition (or EC2 plan), RDS, S3, Secrets Manager, SQS, CloudWatch hooks. No application behavior changes.
- **Files:** `Dockerfile`, `.dockerignore`, `infra/` folder, `DEPLOY_AWS.md` updates.
- **Risk:** LOW for the app; MEDIUM for ops.
- **Validation:** check / build / 8 QA scripts.

---

## How this maps to the 22-batch orchestrator

The orchestrator (`full-21-batch-orchestrator-review.md`) re-numbers and expands these into Batches 0–21:

| This doc | Orchestrator | Notes |
| --- | --- | --- |
| Batch 0 | Batch 0 | Identical. Already shipped. |
| Batch 1 | Batch 1 | This PR. |
| Batch 2 | Batch 2 | Identical scope. |
| Batch 3 | Batch 3 | Identical scope. |
| Batch 4 | Batch 4 | Identical scope. |
| Batch 5 | Batch 5 | Patient Directory prep. |
| (—) | Batch 6 | New: Facility canonicalization design. |
| (—) | Batch 7 | New: Patient matching / dedupe design. |
| (—) | Batch 8 | New: Qualification structure cleanup. |
| (—) | Batch 9 | New: PDF / packet protection. |
| Batch 6 (Execution case + team task) | Batch 10 + Batch 11 | Split into two. |
| Batch 7 | Batch 12 | Journey events. |
| Batch 8 | Batch 13 | Engagement read model. |
| Batch 9 | Batch 14 | Plexus IQ read model. |
| Batch 10 | Batch 15 | Admin Review modularization (the highest risk). |
| Batch 11 | Batch 16 | S3 / storage abstraction. |
| (—) | Batch 17 | New: Billing/invoice architecture cleanup. |
| Batch 12 | Batch 18 | Background jobs / workers. |
| Batch 13 | Batch 19 | AWS deployment readiness. |
| (—) | Batch 20 | New: Observability + security. |
| (—) | Batch 21 | New: QA + regression hardening. |

When in doubt, **the orchestrator is the source of truth**.

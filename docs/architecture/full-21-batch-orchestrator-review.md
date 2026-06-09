# Full 21-Batch Architecture Orchestrator Review

**Branch:** `architecture/full-21-batch-orchestrator-review`
**Date:** 2026-06-09
**Repository:** `tertiary-command-center` (working tree `tertiary-command-center-replit-sync`)
**Author:** Architecture orchestrator review (Dr. Ali Imran, Noorhan Medical)
**Reference:** `docs/architecture/review-canonical-spine-2026-06-09.md` (Batch 0; on PR #50)
**Scope:** REVIEW + PLANNING + PROMPT-GENERATION only. No application source code modified by this document. Only file added by this branch is this orchestrator doc.

---

## How to use this document

This is the **single orchestrator** for the 22-batch refactor plan (Batch 0 through Batch 21). Each batch section is self-contained: purpose, risk, allowed/forbidden changes, validation, rollback, stop conditions, approval phrase, and a **standalone copy/paste Claude Code implementation prompt**.

The implementation prompts are written so you can paste them into a fresh Claude Code session — every prompt restates protected flows, allowed files, forbidden files, validation, commit message, and the final-report format. None of them rely on Claude remembering this orchestrator doc.

Approval is per-batch. No batch is implemented until you paste its **Required approval phrase** verbatim.

---

## Protected working flows (apply to every batch unless that batch's prompt explicitly allows changes)

These flows are **working today** and must remain working after every batch:

- **Plexus IQ** — calendar, workspace, sidebar, add-patient
- **Plexus IQ import** — bulk clinical import, AI parsing, batch resolution, MRN stamping
- **Clinical qualification** — `screenSinglePatientWithAI`, batch analysis runner, qualification modes
- **Admin Review** — `AdminReviewDialog`, supporting buttons, qualifying factors, per-ancillary regenerate, regenerate-all, admin approval, sibling Next/Prev, ICD chips, under-16 guardrails
- **Clinician packets / Clinician PDF / Plexus PDF** — `lib/pdfGeneration.ts`, `lib/pdfPacketGrouping.ts`, all entry points (`PatientPdfActions`, `PatientCard`, `ResultsView`, `EngagementAssignmentBoard`, `CanonicalRowActions`)
- **Selected patient PDF actions** — single-patient and multi-patient packet flows
- **Engagement Center** — assignment board, conflict guard, bulk assignment, journey events
- **Scheduler Portal** — `/scheduler-portal`, `/outreach/scheduler/:id`, scheduler assignment diff
- **Team Portals** — Patient Care Specialist, Ancillary Care Specialist, Team Portal Shell, Portal Shell
- **Patient assignment** — `assignedTeamMemberId`, scheduler assignments, conflict detection
- **Report upload / document flows** — document library, blob store, generated notes, Drive/S3 abstraction
- **Billing / invoice flows** — billing records, invoices, line items, payments, projected invoices, completed billing packages

Any change in any batch that risks these flows must be quarantined behind a feature flag or an additive endpoint, never a replacement.

---

## Global conventions (apply to all implementation prompts)

- **Never commit directly to `main`.** Each batch is a new branch off `main`.
- **Always show diffs and wait for approval before committing** — the user has CLAUDE.md guardrails that enforce this.
- **Never delete files without explicit confirmation.**
- **Never modify `.env`, `package.json`, `package-lock.json`, or files in `migrations/`** unless the batch is explicitly a migration batch and the user has approved the migration plan.
- **Files requiring explicit approval before editing:** `server/db.ts`, `server/storage.ts` (god-facade; edit repositories in `server/repositories/` directly), `shared/schema/index.ts`, any file in `migrations/`.
- **Preserve all `data-testid` attributes** referenced by `scripts/qa-*.mjs`.
- **No ICD codes in UI text** (the Clinician PDF intentionally omits ICD).
- **Clinical notes must use timeless language** — avoid "today", "current", "day X of".

Standard validation block used in every batch:

```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs
```

Standard final-report format used in every batch:

```
Branch: <branch>
Files changed: <list>
App source untouched: <yes/no — if no, list which files and why>
npm run check: <pass/fail>
npm run build: <pass/fail>
QA scripts: <8/8 pass | list failures>
Manual QA: <pass/fail per checklist item>
Blocked items: <none | list>
Behavior changes (UI/API): <none | list>
```

---

## Table of contents

- Batch 0 — Architecture review report **(COMPLETE — PR #50)**
- Batch 1 — Architecture docs and dependency map
- Batch 2 — Shared contracts / types extraction only
- Batch 3 — Backend service wrappers around current route logic
- Batch 4 — Frontend hooks extraction
- Batch 5 — Patient Directory preparation
- Batch 6 — Facility canonicalization
- Batch 7 — Patient matching / deduping design
- Batch 8 — Qualification structure cleanup
- Batch 9 — PDF / packet protection
- Batch 10 — Execution Case spine
- Batch 11 — Team Task spine
- Batch 12 — Journey event / audit standardization
- Batch 13 — Engagement Center read-model optimization
- Batch 14 — Plexus IQ read-model optimization
- Batch 15 — Admin Review modularization
- Batch 16 — Documents / reports storage abstraction
- Batch 17 — Billing / invoice architecture cleanup
- Batch 18 — Background jobs / workers
- Batch 19 — AWS deployment readiness
- Batch 20 — Observability / security
- Batch 21 — QA and regression hardening
- A — Recommended execution order
- B — Safe-to-approve early batches
- C — Batches requiring review-only sub-batches
- D — High-risk batches to delay
- E — Required approval protocol
- F — Claude autonomy rules
- G — Next recommended action

---

# Batch 0 — Architecture review report

## 1. Purpose
Produce a single read-only architecture review covering the entire repository, the canonical patient spine gap, backend/frontend findings, flow-wiring, do-not-touch list, and a safe-batch plan. No code changed.

## 2. Why this batch exists
The repo grew workflow-by-workflow rather than around a canonical patient spine. Before any refactor begins, an authoritative review must exist so contributors share a common map and a do-not-touch list. Without this, even small refactors risk breaking Plexus IQ, Admin Review, PDF, Engagement Center, or billing.

## 3. Current repo areas to inspect
- `server/` (routes, services, repositories, integrations, lib)
- `client/src/` (pages, components, lib, hooks, features)
- `shared/schema/` and `shared/` typings
- `migrations/` (0000…0025)
- `scripts/qa-*.mjs`
- `docs/` (existing `PLEXUS_IQ_RECOVERY_BASELINE.md`, `clinic-workflow-spine.md`)

## 4. Current risks
None — Batch 0 is docs-only. The only risk would be inaccurate findings; mitigated by referencing line numbers and file paths.

## 5. Protected flows at risk
None.

## 6. Batch type
**completed**

## 7. Risk level
**very low**

## 8. Safety conditions before implementation
N/A — already complete.

## 9. Allowed changes
- `docs/architecture/review-canonical-spine-2026-06-09.md` (the review report)

## 10. Forbidden changes
- All source code
- Any other file

## 11. Likely files touched
- `docs/architecture/review-canonical-spine-2026-06-09.md` (added)

## 12. Files/functions/routes that should not be touched
All source code.

## 13. Implementation approach
Read-only inspection. Document architecture map, spine gap, backend findings, frontend findings, flow-wiring, do-not-touch list, and 13-step safe-batch plan in a single markdown file.

## 14. Required compatibility rules
N/A — docs-only.

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs
```
All passed at PR-#50 creation time.

## 16. Manual QA checklist
None required.

## 17. Rollback plan
Delete the doc file or close PR #50.

## 18. Stop conditions
N/A — already complete.

## 19. Required approval phrase
**APPROVE BATCH 0 — N/A, already complete and shipped as PR #50.**

## 20. Exact Claude Code implementation prompt
**Status: COMPLETE. Do not re-run.**

PR #50 (open): `https://github.com/noorhanmedical/tertiary-command-center/pull/50`
- Title: "Architecture review: canonical patient spine + team portals (docs only)"
- Branch: `architecture/review-canonical-spine-team-portals`
- Files added: `docs/architecture/review-canonical-spine-2026-06-09.md` (+720 / −0)
- `npm run check`: PASS
- `npm run build`: PASS
- 8 QA scripts: PASS
- No app source files changed.

If a fresh review is ever required, the prompt would be: *"Produce a read-only architecture review of this repo. Add one file only: `docs/architecture/review-canonical-spine-<date>.md`. No source code changes. Run `npm run check`, `npm run build`, and all eight `scripts/qa-*.mjs` and report results. Do not push without approval."*

---

# Batch 1 — Architecture docs and dependency map

## 1. Purpose
Convert Batch 0 from a single report into a living `docs/architecture/` folder: an index, a canonical-spine doc, a protected-flows doc, a module dependency map, a refactor-batches doc, and a do-not-touch doc. Establishes the shared vocabulary for Batches 2–21.

## 2. Why this batch exists
A single 720-line report is hard to keep current. Splitting it into focused docs lets future PRs update one concern at a time and lets the do-not-touch list act as a guard rail referenced from PR descriptions. Zero runtime change — the cheapest possible follow-up to Batch 0.

## 3. Current repo areas to inspect
- `docs/architecture/review-canonical-spine-2026-06-09.md` (source of truth for this batch)
- `docs/PLEXUS_IQ_RECOVERY_BASELINE.md`, `docs/clinic-workflow-spine.md` (existing docs to cross-link)
- `CLAUDE.md` (guardrails; keep consistent)
- `scripts/qa-*.mjs` (referenced by protected-flows doc)
- `client/src/components/qualification/AdminReviewDialog.tsx` (only for line counts / cross-references)
- `client/src/lib/pdfGeneration.ts`, `client/src/lib/pdfPacketGrouping.ts` (cross-references)
- `server/services/patientCommitService.ts` (cross-reference)

## 4. Current risks
- Drift between the new split docs and the original review.
- A do-not-touch list that is too vague to be enforceable.
- A dependency map that becomes stale instantly.

## 5. Protected flows at risk
None — docs-only.

## 6. Batch type
**docs-only**

## 7. Risk level
**very low**

## 8. Safety conditions before implementation
- Batch 0 (PR #50) merged or referenced by SHA.
- No outstanding unmerged PRs that move the files cross-referenced from the docs.

## 9. Allowed changes
Only these files may be added:
- `docs/architecture/README.md` (index)
- `docs/architecture/canonical-spine.md` (target spine + gaps)
- `docs/architecture/protected-flows.md` (working flows + QA scripts)
- `docs/architecture/dependency-map.md` (manual module edge list)
- `docs/architecture/refactor-batches.md` (mirrors §9 of the review)
- `docs/architecture/do-not-touch.md` (mirrors §10 of the review)

## 10. Forbidden changes
- All source code (`server/`, `client/`, `shared/`, `migrations/`, `scripts/`, `script/`)
- `package.json`, `package-lock.json`, `.env*`
- `docs/architecture/review-canonical-spine-2026-06-09.md` (frozen as historical record; new content goes in the split docs)

## 11. Likely files touched
The six new files listed above.

## 12. Files/functions/routes that should not be touched
All source code.

## 13. Implementation approach
1. Create the six markdown files. Each cross-references §-numbers in the original review.
2. `do-not-touch.md` lists exact file paths from §10 of the review.
3. `protected-flows.md` lists each protected flow + the QA script that exercises it.
4. `dependency-map.md` lists fan-in / fan-out edges for: `pdfGeneration.ts`, `AdminReviewDialog.tsx`, `EngagementAssignmentBoard.tsx`, `patientCommitService.ts`, `screening.ts`, `billing.ts`, `invoices.ts`, `storage.ts`.
5. `README.md` indexes the other five with one-line summaries.

## 14. Required compatibility rules
- Preserve API response shapes (N/A — no API touched)
- Preserve test IDs (N/A — no UI touched)
- Preserve UI markup (N/A)
- Preserve PDF data source (N/A)
- Preserve canonical reasoning (N/A)
- Preserve existing routes (N/A)
- Add wrappers before replacing code (N/A)
- **New rule:** every claim in a new doc must cite a file path + line range from the review, or it must be removed.

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs
```

## 16. Manual QA checklist
- Open each new doc in a markdown viewer. Confirm links resolve.
- Confirm `protected-flows.md` lists all eight QA scripts.
- Confirm `do-not-touch.md` includes `AdminReviewDialog.tsx`, `pdfGeneration.ts`, `patientCommitService.ts`, `engagementAssignmentBoard.ts`, `billing.ts`, `screening.ts`, and the duplicate-numbered migrations.

## 17. Rollback plan
`git rm` the six new files. Branch is docs-only, no other state to unwind.

## 18. Stop conditions
- If any of the six files would require editing existing source to be "true" (e.g., a do-not-touch rule that contradicts what the code actually does), STOP and ask. Docs must describe reality, not aspirations.

## 19. Required approval phrase
**APPROVE BATCH 1**

## 20. Exact Claude Code implementation prompt

```
You are working in the repo `noorhanmedical/tertiary-command-center` on macOS.
Path: ~/Projects/tertiary-command-center-replit-sync

GOAL: Split the architecture review into a living docs folder. Docs-only batch.

BRANCH:
  Create branch from main:
    architecture/docs-and-dependency-map

ALLOWED FILES (add only — no edits to existing files):
  docs/architecture/README.md
  docs/architecture/canonical-spine.md
  docs/architecture/protected-flows.md
  docs/architecture/dependency-map.md
  docs/architecture/refactor-batches.md
  docs/architecture/do-not-touch.md

FORBIDDEN FILES (do not touch):
  Any file in server/, client/, shared/, migrations/, scripts/, script/
  package.json, package-lock.json, .env*
  docs/architecture/review-canonical-spine-2026-06-09.md (frozen)
  server/db.ts, server/storage.ts, shared/schema/index.ts

PROTECTED FLOWS (must remain identical — but you will not touch any code, so this is a tripwire):
  Plexus IQ; Plexus IQ import; clinical qualification; Admin Review (supporting
  buttons, qualifying factors, per-ancillary regenerate); Clinician PDF; Plexus
  PDF; Engagement Center; Scheduler Portal; Team Portals; patient assignment;
  document/report upload; billing/invoice flows.

EXACT IMPLEMENTATION REQUIREMENTS:
  1. Reference the existing review at docs/architecture/review-canonical-spine-2026-06-09.md
     by §-number for every factual claim.
  2. docs/architecture/README.md indexes the other five files with one-line summaries
     and a clear "Batch 0 lives in review-canonical-spine-2026-06-09.md (frozen)" note.
  3. docs/architecture/canonical-spine.md mirrors §3 (gap analysis) of the review.
  4. docs/architecture/protected-flows.md lists each protected flow with the QA
     script that exercises it (scripts/qa-*.mjs).
  5. docs/architecture/dependency-map.md lists fan-in/fan-out for:
       client/src/lib/pdfGeneration.ts
       client/src/components/qualification/AdminReviewDialog.tsx
       client/src/components/engagement/EngagementAssignmentBoard.tsx
       server/services/patientCommitService.ts
       server/services/screening.ts
       server/routes/billing.ts
       server/routes/invoices.ts
       server/storage.ts
  6. docs/architecture/refactor-batches.md mirrors §9 of the review.
  7. docs/architecture/do-not-touch.md mirrors §10 of the review, with exact paths.
  8. Do not edit any source code.
  9. Do not edit the frozen review file.

VALIDATION:
  npm run check
  npm run build
  node scripts/qa-navigation-dock-home-tiles.mjs
  node scripts/qa-command-center-architecture.mjs
  node scripts/qa-visit-outreach-tile-parity.mjs
  node scripts/qa-plexus-iq-interior.mjs
  node scripts/qa-plexus-iq-backend.mjs
  node scripts/qa-team-portals-restore.mjs
  node scripts/qa-team-portal-workspace-engine.mjs
  node scripts/qa-engagement-assignment-runtime.mjs

MANUAL QA CHECKLIST:
  - Open the six new markdown files; confirm rendering and cross-links.
  - Confirm protected-flows.md lists all eight QA scripts.
  - Confirm do-not-touch.md includes AdminReviewDialog.tsx, pdfGeneration.ts,
    patientCommitService.ts, engagementAssignmentBoard.ts, billing.ts,
    screening.ts, and the duplicate-numbered migrations.

COMMIT MESSAGE:
  Add architecture docs and dependency map (Batch 1)

FINAL REPORT FORMAT (paste back to user):
  Branch: <branch>
  Files changed: <list>
  App source untouched: yes
  npm run check: <pass/fail>
  npm run build: <pass/fail>
  QA scripts: <8/8 pass | list failures>
  Manual QA: <pass/fail per item>
  Blocked items: <none | list>
  Behavior changes (UI/API): none

STOP CONDITIONS:
  - If any factual claim cannot be sourced from the existing review or a file path,
    STOP and ask. Docs must describe reality.
  - If validation fails, STOP and report; do not push.

DO NOT push the branch unless the user explicitly says "push" or "open the PR".
```

---

# Batch 2 — Shared contracts / types extraction only

## 1. Purpose
Pull stable shared shapes (engagement-board row, journey-event kinds, admin-review status union, reasoning blob shape) into `shared/contracts/` as **type-only** modules. Runtime untouched.

## 2. Why this batch exists
Multiple files currently inline-define the same shapes (engagement board row in client + server; journey event kinds repeated across `patientCommitService`, `engagementAssignmentBoard`, `outreach`; admin-review status union in `AdminReviewDialog`, `AdminApprovalControl`, `adminReviewStatus.ts`). A single source of truth in `shared/contracts/` makes later batches safer because rename-by-import becomes possible.

## 3. Current repo areas to inspect
- `shared/schema/screening.ts`, `shared/schema/executionCase.ts`, `shared/schema/plexus.ts`
- `shared/clinicWorkflow.ts`, `shared/plexus.ts`, `shared/plexus-iq/*`
- `client/src/components/qualification/AdminReviewDialog.tsx` (only to identify inline types — do not edit yet)
- `client/src/components/engagement/EngagementAssignmentBoard.tsx`
- `client/src/lib/adminReviewStatus.ts`
- `server/services/patientCommitService.ts` (journey event kinds)
- `server/routes/engagementAssignmentBoard.ts`

## 4. Current risks
- Importing a `shared/contracts/` type into a file that already has an identically-named local type can cause silent type widening if the contract isn't byte-identical.
- A type rename mid-batch could change a `data-testid` (e.g., a `status` union value used as a DOM attribute).

## 5. Protected flows at risk
- Admin Review (if `AdminReviewStatus` shape diverges)
- Engagement Center (if board row shape diverges)
- Outreach (if journey event kinds diverge)

## 6. Batch type
**code-safe**

## 7. Risk level
**low**

## 8. Safety conditions before implementation
- Batch 1 docs merged so the do-not-touch list is referenceable.
- `npm run check` is clean on `main`.
- A two-pass plan exists: (a) add `shared/contracts/` files, no consumers updated; (b) optionally migrate ≤ 3 low-risk consumers and re-run `check`.

## 9. Allowed changes
- Add files under `shared/contracts/` only.
- Optionally, in a second sub-step within the same batch, update **≤ 3** low-risk consumer files to import from `shared/contracts/`. Low-risk = files that do not appear in §10 of the review's do-not-touch list. Example candidates: `client/src/hooks/api/keys.ts` consumers, `server/repositories/*` that already centralize type aliases.

## 10. Forbidden changes
- Any change inside `client/src/components/qualification/AdminReviewDialog.tsx` or the qualification folder.
- Any change to `client/src/lib/pdfGeneration.ts`, `pdfPacketGrouping.ts`.
- Any change to `server/storage.ts`, `server/db.ts`, `shared/schema/index.ts`.
- Any change to `shared/schema/*.ts` table definitions.
- Any change to `migrations/`.
- Any runtime / behavior change.

## 11. Likely files touched
- `shared/contracts/index.ts` (new barrel)
- `shared/contracts/engagementBoard.ts` (new)
- `shared/contracts/journeyEvents.ts` (new)
- `shared/contracts/adminReviewStatus.ts` (new)
- `shared/contracts/reasoning.ts` (new — read-only structural type for `patient_screenings.reasoning`)
- Optional: 1–3 consumer files for the second sub-step.

## 12. Files/functions/routes that should not be touched
- `AdminReviewDialog.tsx`
- `pdfGeneration.ts`
- `patientCommitService.ts`
- `engagementAssignmentBoard.ts` (route)
- `screening.ts` (service)
- `billing.ts`, `invoices.ts`
- `server/storage.ts`, `server/db.ts`
- `shared/schema/index.ts`, all `shared/schema/*.ts`

## 13. Implementation approach
1. Create `shared/contracts/` files containing **only** TypeScript types and `as const` enums. No values, no functions.
2. Each contract's shape must be **byte-identical** to the most authoritative inline definition in the codebase (capture the source path + line in a top-of-file comment).
3. Sub-step A: ship `shared/contracts/` with **zero** consumers updated. Confirm `npm run check` and `npm run build` still pass.
4. Sub-step B (optional, same batch): import the new contracts in ≤ 3 low-risk files. Re-run validation after each file.
5. If any consumer-update introduces a type error, revert that consumer's import and leave the contract in place for a later batch.

## 14. Required compatibility rules
- Preserve API response shapes (types are structural; no runtime change).
- Preserve test IDs (no UI touched).
- Preserve UI markup (no UI touched).
- Preserve PDF data source (no PDF touched).
- Preserve canonical reasoning (read-only structural type only — do not edit any reasoning write path).
- Preserve existing routes.
- Add wrappers before replacing code (`shared/contracts/` is the wrapper).

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs
```

## 16. Manual QA checklist
- Open Plexus IQ workspace — sidebar loads, calendar renders, no console error.
- Open Admin Review on a representative patient — supporting buttons render, regenerate per-ancillary works, regenerate-all works, approve flow opens.
- Open Engagement Center — board loads with all rows; assign / unassign one row.
- Open a Team Portal — patient list, schedule, tasks tabs all load.
- Generate Clinician PDF and Plexus PDF for one patient; diff against a saved baseline (no visual or content change).

## 17. Rollback plan
- Revert the consumer-update commit (if any).
- `git rm shared/contracts/`.
- Re-run validation; tree should be identical to pre-batch state.

## 18. Stop conditions
- If a contract cannot be made byte-identical to its inline source (e.g., the codebase has two divergent inline definitions), STOP and surface the divergence; do not pick one without approval.
- If any QA script fails after the contracts are added (no consumers updated), STOP — this implies a hidden import-graph effect that needs investigation.

## 19. Required approval phrase
**APPROVE BATCH 2**

## 20. Exact Claude Code implementation prompt

```
You are working in the repo `noorhanmedical/tertiary-command-center` on macOS.
Path: ~/Projects/tertiary-command-center-replit-sync

GOAL: Extract shared contracts/types into shared/contracts/. Type-only batch.
       No runtime behavior change.

BRANCH:
  Create branch from main:
    architecture/shared-contracts-extraction

ALLOWED FILES (add):
  shared/contracts/index.ts
  shared/contracts/engagementBoard.ts
  shared/contracts/journeyEvents.ts
  shared/contracts/adminReviewStatus.ts
  shared/contracts/reasoning.ts

ALLOWED FILES (optionally edit, ≤ 3, low-risk only — must NOT be in the forbidden
list below):
  Any file that already centralizes a type alias and is not in the forbidden
  list. Examples: a repository-level type re-export, a hook in client/src/hooks/api/
  that only declares its own input/output type.

FORBIDDEN FILES (do not edit under any circumstance in this batch):
  client/src/components/qualification/AdminReviewDialog.tsx
  client/src/components/qualification/PatientPdfActions.tsx
  client/src/components/qualification/AdminApprovalControl.tsx
  client/src/lib/pdfGeneration.ts
  client/src/lib/pdfPacketGrouping.ts
  client/src/components/engagement/EngagementAssignmentBoard.tsx
  client/src/components/portal/TeamPortalShell.tsx
  client/src/components/portal/PortalShell.tsx
  client/src/components/plexus-iq/PlexusIQWorkspace.tsx
  client/src/components/plexus-iq/PlexusIQBulkImportModal.tsx
  server/routes/patients.ts
  server/routes/billing.ts
  server/routes/invoices.ts
  server/routes/engagementAssignmentBoard.ts
  server/routes/plexusIqClinicalImport.ts
  server/services/patientCommitService.ts
  server/services/screening.ts
  server/services/batchAnalysisRunner.ts
  server/services/plexusIq/*
  server/storage.ts
  server/db.ts
  shared/schema/index.ts
  shared/schema/*.ts
  migrations/**
  package.json, package-lock.json, .env*

PROTECTED FLOWS (must remain identical):
  Plexus IQ; Plexus IQ import; clinical qualification; Admin Review (supporting
  buttons, qualifying factors, per-ancillary regenerate); Clinician PDF; Plexus
  PDF; Engagement Center; Scheduler Portal; Team Portals; patient assignment;
  document/report upload; billing/invoice flows.

EXACT IMPLEMENTATION REQUIREMENTS:
  1. Add only TypeScript types and `as const` enums in shared/contracts/. No values,
     no functions, no runtime imports.
  2. Each contract must be byte-identical to the most authoritative inline source
     in the codebase. Capture the source path + line range in a header comment.
  3. Sub-step A: add the five shared/contracts/ files; update NO consumers.
     Run validation. If any check fails, STOP and report.
  4. Sub-step B (optional, same batch): update ≤ 3 low-risk consumer files to
     import the new contracts. Re-run validation after each edit. If a type error
     appears, revert that consumer's import; the contract stays.
  5. Do not touch any file in the FORBIDDEN list.
  6. Do not change package.json or any migration.

VALIDATION:
  npm run check
  npm run build
  node scripts/qa-navigation-dock-home-tiles.mjs
  node scripts/qa-command-center-architecture.mjs
  node scripts/qa-visit-outreach-tile-parity.mjs
  node scripts/qa-plexus-iq-interior.mjs
  node scripts/qa-plexus-iq-backend.mjs
  node scripts/qa-team-portals-restore.mjs
  node scripts/qa-team-portal-workspace-engine.mjs
  node scripts/qa-engagement-assignment-runtime.mjs

MANUAL QA CHECKLIST:
  - Plexus IQ workspace: sidebar + calendar render; no console error.
  - Admin Review: supporting buttons render; per-ancillary regenerate runs;
    regenerate-all runs; admin approval opens.
  - Engagement Center: board loads; assign/unassign one row.
  - Team Portal: patient list, schedule, tasks tabs render.
  - Clinician PDF and Plexus PDF generate for one patient without visual change.

COMMIT MESSAGE:
  Extract shared contracts/types (Batch 2)

FINAL REPORT FORMAT:
  Branch: <branch>
  Files changed: <list>
  App source untouched: <yes/no — list any consumers updated>
  npm run check: <pass/fail>
  npm run build: <pass/fail>
  QA scripts: <8/8 pass | list failures>
  Manual QA: <pass/fail per item>
  Blocked items: <none | list>
  Behavior changes (UI/API): none

STOP CONDITIONS:
  - If two inline definitions of the same shape diverge, STOP; do not pick one.
  - If any QA script fails after only adding shared/contracts/, STOP.
  - If a consumer update introduces a type error, revert that update only.

DO NOT push unless the user explicitly says "push" or "open the PR".
```

---

# Batch 3 — Backend service wrappers around current route logic

## 1. Purpose
Wrap the inline business logic in `routes/patients.ts` admin-review endpoints and `routes/billing.ts` auto-create scan inside thin **service modules** that call the same code. Same request shape, same response shape, same DB writes. Parity is the goal.

## 2. Why this batch exists
- `routes/patients.ts` admin-review endpoints contain reasoning-merge logic inline.
- `routes/billing.ts` auto-creates missing `billing_records` inside `GET /api/billing-records` — O(batches × patients × tests).
- Both are hard to test, hard to instrument, and impossible to share across routes (e.g., a future scheduled regenerate worker would need the same logic).

A thin service wrapper preserves behavior exactly while making future safe edits possible.

## 3. Current repo areas to inspect
- `server/routes/patients.ts` — admin-review endpoints (`/evidence`, `/regenerate`, `/regenerate-all`, `/regenerate-ancillary`; lines around §4.1 of the review)
- `server/routes/billing.ts` — auto-create scan (lines 67–111)
- `server/services/plexusIq/*` — existing admin-review rule engine and AI regeneration helpers
- `server/repositories/*` — repos called by the routes
- `server/services/auditService.ts` — for parity audit calls

## 4. Current risks
- Wrapping changes the call site; if the wrapper accidentally re-orders writes, status transitions can race.
- `GET /api/billing-records` auto-create is read-as-write today; wrapping must keep that semantic explicit (or quarantine it behind a feature flag for Batch 17 later).
- Any subtle change in error-handling shape can break the client's central 401/error handling.

## 5. Protected flows at risk
- Admin Review (evidence, regenerate single, regenerate-all, regenerate-ancillary)
- Billing list page
- Clinician/Plexus PDF (only if reasoning shape were accidentally reshaped — must remain identical)

## 6. Batch type
**code-risky**

## 7. Risk level
**medium**

## 8. Safety conditions before implementation
- Batches 1 and 2 merged.
- A response-parity test fixture exists for each touched endpoint (capture before/after JSON for one patient + one billing facility).
- A short manual regression has been agreed (see §16).

## 9. Allowed changes
- Add `server/services/adminReviewService.ts` (new).
- Add `server/services/billingAutoCreateService.ts` (new).
- Edit `server/routes/patients.ts` admin-review handlers to call the new service. **No other change** to that file.
- Edit `server/routes/billing.ts` auto-create scan to call the new service. **No other change** to that file.
- Optionally add a `server/services/__tests__/` parity script (TypeScript, runnable with `npx tsx`).

## 10. Forbidden changes
- Any change to request/response shape.
- Any change to DB writes' columns or order.
- Any change to `server/storage.ts`, `server/db.ts`, `server/repositories/screening.repo.ts`, `server/repositories/billing.repo.ts` (consume them; do not edit them).
- Any change to `client/`.
- Any new migration.
- Any change to AI prompts, model IDs, or qualification rules.

## 11. Likely files touched
- `server/services/adminReviewService.ts` (new)
- `server/services/billingAutoCreateService.ts` (new)
- `server/routes/patients.ts` (delegate-only edit in admin-review handlers)
- `server/routes/billing.ts` (delegate-only edit in `GET /api/billing-records`)
- `server/services/__tests__/adminReviewParity.test.ts` (optional)
- `server/services/__tests__/billingAutoCreateParity.test.ts` (optional)

## 12. Files/functions/routes that should not be touched
- `server/services/screening.ts` (AI qualification)
- `server/services/patientCommitService.ts`
- `server/services/batchAnalysisRunner.ts`
- `server/services/plexusIq/*`
- `server/routes/engagementAssignmentBoard.ts`
- `server/routes/plexusIqClinicalImport.ts`
- `server/routes/invoices.ts`
- `server/storage.ts`, `server/db.ts`
- All client code
- All schema and migrations

## 13. Implementation approach
1. Create both service files with one function per existing inline block. Copy the logic verbatim; do not refactor.
2. In the routes, replace the inline blocks with a call to the new function. Imports and signatures stay equivalent.
3. Add response-shape parity assertions in the optional test scripts (compare keys + value types for a representative payload).
4. Run validation; if anything fails, revert the route edit only — keep the service file in place behind a TODO until next batch.

## 14. Required compatibility rules
- **Preserve API response shapes** (same JSON keys, same types, same status codes).
- Preserve test IDs (no UI touched).
- Preserve UI markup (no UI touched).
- **Preserve PDF data source** — the reasoning blob shape must not change.
- **Preserve canonical reasoning** — admin-review wrappers must not edit the reasoning merge order.
- Preserve existing routes (paths, methods).
- **Add wrappers before replacing code** — this batch is precisely that wrapper.

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs
# Optional, if added:
npx tsx server/services/__tests__/adminReviewParity.test.ts
npx tsx server/services/__tests__/billingAutoCreateParity.test.ts
```

## 16. Manual QA checklist
- Open Admin Review on one patient with supporting buttons set. Run **regenerate this ancillary**; confirm the reasoning blob keys are unchanged and the UI panel updates the same way.
- Run **regenerate all** on the same patient. Confirm ICD chips, qualifying factors, and admin-approval state are unchanged.
- Run **evidence** (rule engine) once; confirm output identical to pre-batch.
- Open the Billing page. Confirm the same number of `billing_records` rows appear; refresh; confirm no duplicates were created.
- Approve a patient; open Clinician PDF and Plexus PDF; confirm visual identity.

## 17. Rollback plan
- `git revert` the route-edit commit only; keep the new service files dormant if useful, or delete them.
- Re-run validation.

## 18. Stop conditions
- If any response key changes (even a serialization order in a way the client depends on), STOP.
- If any QA script regresses, STOP and revert the route edit.
- If the audit log entry order changes for admin-review approval, STOP.

## 19. Required approval phrase
**APPROVE BATCH 3**

## 20. Exact Claude Code implementation prompt

```
You are working in the repo `noorhanmedical/tertiary-command-center` on macOS.
Path: ~/Projects/tertiary-command-center-replit-sync

GOAL: Wrap inline business logic in routes/patients.ts admin-review endpoints
       and routes/billing.ts GET /api/billing-records auto-create scan into thin
       service modules. Preserve request shape, response shape, DB writes, and
       audit calls byte-identically.

BRANCH:
  Create branch from main:
    architecture/backend-service-wrappers

ALLOWED FILES:
  server/services/adminReviewService.ts             (new)
  server/services/billingAutoCreateService.ts       (new)
  server/routes/patients.ts                         (delegate-only edits in
                                                     admin-review handlers)
  server/routes/billing.ts                          (delegate-only edits in
                                                     GET /api/billing-records)
  server/services/__tests__/adminReviewParity.test.ts        (optional)
  server/services/__tests__/billingAutoCreateParity.test.ts  (optional)

FORBIDDEN FILES:
  server/services/screening.ts
  server/services/patientCommitService.ts
  server/services/batchAnalysisRunner.ts
  server/services/plexusIq/*
  server/routes/engagementAssignmentBoard.ts
  server/routes/plexusIqClinicalImport.ts
  server/routes/invoices.ts
  server/repositories/* (consume only)
  server/storage.ts, server/db.ts
  client/**
  shared/schema/**, shared/schema/index.ts
  migrations/**
  package.json, package-lock.json, .env*

PROTECTED FLOWS:
  Admin Review (supporting buttons, qualifying factors, per-ancillary
    regenerate, regenerate-all, admin approval)
  Clinician PDF, Plexus PDF, selected patient PDF actions
  Engagement Center, Scheduler Portal, Team Portals
  Billing list and invoice flows

EXACT IMPLEMENTATION REQUIREMENTS:
  1. Copy the inline logic from each admin-review endpoint into a function in
     server/services/adminReviewService.ts. Do not refactor — copy verbatim,
     re-export from index if helpful.
  2. Copy the auto-create scan from GET /api/billing-records into a function in
     server/services/billingAutoCreateService.ts. Same.
  3. In server/routes/patients.ts, replace ONLY the admin-review inline blocks
     with calls to the new service. Do not touch any other handler in the file.
  4. In server/routes/billing.ts, replace ONLY the auto-create scan with a call
     to the new service. Do not touch any other handler.
  5. Preserve response JSON byte-identically. Preserve audit-log calls exactly.
     Preserve order of DB writes.
  6. Do not change AI prompts, model IDs, or qualification rules.
  7. Do not change any column read/write or column name.
  8. Optional: add parity test scripts under server/services/__tests__/ that
     assert response shape equality for a single canned input. Runnable via npx tsx.

VALIDATION:
  npm run check
  npm run build
  node scripts/qa-navigation-dock-home-tiles.mjs
  node scripts/qa-command-center-architecture.mjs
  node scripts/qa-visit-outreach-tile-parity.mjs
  node scripts/qa-plexus-iq-interior.mjs
  node scripts/qa-plexus-iq-backend.mjs
  node scripts/qa-team-portals-restore.mjs
  node scripts/qa-team-portal-workspace-engine.mjs
  node scripts/qa-engagement-assignment-runtime.mjs

MANUAL QA CHECKLIST:
  - Admin Review on one patient: regenerate per-ancillary, regenerate-all,
    evidence (rule engine), admin approve. All identical to pre-batch.
  - Billing list: row count unchanged across two refreshes (no dupes).
  - Clinician PDF + Plexus PDF unchanged for one approved patient.

COMMIT MESSAGE:
  Add backend service wrappers for admin-review and billing auto-create (Batch 3)

FINAL REPORT FORMAT:
  Branch: <branch>
  Files changed: <list>
  App source untouched: no (routes/patients.ts, routes/billing.ts edited;
                            delegate-only; response shapes unchanged)
  npm run check: <pass/fail>
  npm run build: <pass/fail>
  QA scripts: <8/8 pass | list failures>
  Manual QA: <pass/fail per item>
  Blocked items: <none | list>
  Behavior changes (UI/API): none (response-shape parity verified)

STOP CONDITIONS:
  - Any response-shape diff → STOP and revert route edits.
  - Any QA-script regression → STOP and revert route edits.
  - Any change in audit-log emission order → STOP.

DO NOT push unless the user explicitly says "push" or "open the PR".
```

---

# Batch 4 — Frontend hooks extraction

## 1. Purpose
Pull data-fetch logic (React Query hooks) out of three large components into custom hook files. **No JSX changes, no test-id changes, no behavior changes.** Markup, props, sibling-nav, conflict-guard, bulk-assignment, PDF-preview triggers all stay identical.

## 2. Why this batch exists
- `AdminReviewDialog.tsx` (4,230 lines) embeds its own `useQuery`/`useMutation` calls inline. Same for `EngagementAssignmentBoard.tsx` (2,028 lines) and `PortalShell.tsx` (1,816 lines).
- Tests / future batches need to stub the data layer in isolation; today that's impossible without re-rendering the entire component.
- This is a precursor to Batch 15 (Admin Review modularization). Hooks first, JSX split later.

## 3. Current repo areas to inspect
- `client/src/components/qualification/AdminReviewDialog.tsx`
- `client/src/components/engagement/EngagementAssignmentBoard.tsx`
- `client/src/components/portal/PortalShell.tsx`
- `client/src/hooks/api/keys.ts` (`qk`)
- `client/src/lib/queryClient.ts`
- `client/src/hooks/api/*` (existing 11 hook files)

## 4. Current risks
- Reordering hook calls inside a React component changes the hook-call order React tracks. Even a "pure refactor" can break if a `useEffect` or `useMemo` dependency array shifts.
- Mutation `onSuccess` invalidations are easy to mis-target (wrong query key); a typo silently breaks reactivity.

## 5. Protected flows at risk
- Admin Review (highest)
- Engagement Center
- Team Portals (via PortalShell)
- Indirectly: anything that reads Admin Review state (e.g., the PatientPdfActions test-ids)

## 6. Batch type
**code-risky**

## 7. Risk level
**medium-high**

## 8. Safety conditions before implementation
- Batches 1, 2, 3 merged.
- A pre-batch screenshot/recording of Admin Review and Engagement Center exists for visual diff.
- All 8 QA scripts pass on `main` and on the new branch before edits begin.

## 9. Allowed changes
- Add files under `client/src/hooks/api/` for the three components.
- Edit the three components **only** to remove the inline `useQuery`/`useMutation` calls and replace them with calls to the new hooks. Preserve every JSX node, every `data-testid`, every event handler signature.

## 10. Forbidden changes
- Any JSX change.
- Any `data-testid` change.
- Any prop signature change on the components themselves.
- Any change to `queryClient.ts`, `qk` keys, or default `staleTime`.
- Any change to `lib/pdfGeneration.ts` or `pdfPacketGrouping.ts`.
- Any change to `client/src/components/qualification/PatientPdfActions.tsx`, `AdminApprovalControl.tsx`, `ChangeEngagementAssignmentDialog.tsx`.
- Any backend change.

## 11. Likely files touched
- `client/src/hooks/api/adminReview.ts` (new)
- `client/src/hooks/api/engagementBoard.ts` (new)
- `client/src/hooks/api/portalShell.ts` (new)
- `client/src/components/qualification/AdminReviewDialog.tsx` (hook-call swap only)
- `client/src/components/engagement/EngagementAssignmentBoard.tsx` (hook-call swap only)
- `client/src/components/portal/PortalShell.tsx` (hook-call swap only)

## 12. Files/functions/routes that should not be touched
- `PatientPdfActions.tsx`, `AdminApprovalControl.tsx`, `ChangeEngagementAssignmentDialog.tsx`
- `lib/pdfGeneration.ts`, `pdfPacketGrouping.ts`
- `TeamPortalShell.tsx` (left for Batch 11)
- All server code
- All schema and migrations

## 13. Implementation approach
1. For each target component, list every `useQuery` and `useMutation` call (top-to-bottom).
2. Create the matching hook file. The new hook exports one hook per call site. Hook-call order in the component must match the original.
3. Replace the inline call with a hook call. Keep the local variable name identical.
4. Keep all dependency arrays identical.
5. Re-run all QA scripts after each component, in this order: PortalShell first, EngagementAssignmentBoard second, AdminReviewDialog last.
6. If any test fails after a step, revert just that component's swap and report.

## 14. Required compatibility rules
- Preserve API response shapes (no API touched).
- **Preserve test IDs** — confirm via grep before/after that the set of `data-testid` values is identical in each touched file.
- **Preserve UI markup** — no JSX node added/removed/wrapped.
- Preserve PDF data source.
- Preserve canonical reasoning.
- Preserve existing routes.
- Add wrappers before replacing code (hook files are the wrapper).

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs

# Test-id parity check (recommended):
git diff --stat HEAD~1 -- 'client/src/components/qualification/AdminReviewDialog.tsx'
grep -c 'data-testid' client/src/components/qualification/AdminReviewDialog.tsx
grep -c 'data-testid' client/src/components/engagement/EngagementAssignmentBoard.tsx
grep -c 'data-testid' client/src/components/portal/PortalShell.tsx
```

## 16. Manual QA checklist
- Admin Review: open dialog; supporting buttons render; per-ancillary regenerate runs and updates panel; regenerate-all runs; admin approve opens; sibling Next/Prev moves; ICD chips unchanged; PDF preview launches.
- Engagement Center: board loads; conflict guard fires on a known dupe; bulk-assign one row; unassign; journey event appears.
- Team Portal: patient list, schedule, tasks, docs tabs all load; outreach call dialog opens.
- Clinician PDF + Plexus PDF for one approved patient: visual diff clean.

## 17. Rollback plan
- Revert the component-edit commit(s).
- Keep the new hook files dormant or `git rm` them.
- Re-run validation.

## 18. Stop conditions
- Any new console error/warning related to hook order, missing key, or invalidation.
- Any `data-testid` count change in a touched file.
- Any QA script regression.
- Any visible UI change.

## 19. Required approval phrase
**APPROVE BATCH 4**

## 20. Exact Claude Code implementation prompt

```
You are working in the repo `noorhanmedical/tertiary-command-center` on macOS.
Path: ~/Projects/tertiary-command-center-replit-sync

GOAL: Extract React Query data-fetch logic from three large components into
       custom hooks under client/src/hooks/api/. No JSX changes. No test-id
       changes. No prop-signature changes. No behavior changes.

BRANCH:
  Create branch from main:
    architecture/frontend-hooks-extraction

ALLOWED FILES (add):
  client/src/hooks/api/adminReview.ts
  client/src/hooks/api/engagementBoard.ts
  client/src/hooks/api/portalShell.ts

ALLOWED FILES (edit — hook-call swap only):
  client/src/components/qualification/AdminReviewDialog.tsx
  client/src/components/engagement/EngagementAssignmentBoard.tsx
  client/src/components/portal/PortalShell.tsx

FORBIDDEN CHANGES IN ALLOWED FILES:
  - No JSX node added, removed, or wrapped.
  - No data-testid change.
  - No prop signature or default-prop change.
  - No useEffect dependency array change.
  - No useMemo dependency array change.
  - No query key change in qk; if the existing call passes a literal, keep it literal.

FORBIDDEN FILES (do not touch):
  client/src/components/qualification/PatientPdfActions.tsx
  client/src/components/qualification/AdminApprovalControl.tsx
  client/src/components/qualification/ChangeEngagementAssignmentDialog.tsx
  client/src/lib/pdfGeneration.ts
  client/src/lib/pdfPacketGrouping.ts
  client/src/lib/queryClient.ts
  client/src/hooks/api/keys.ts (the `qk` factory — do not add keys)
  client/src/components/portal/TeamPortalShell.tsx
  client/src/components/plexus-iq/*
  All server/, shared/, migrations/.
  package.json, package-lock.json, .env*

PROTECTED FLOWS:
  Admin Review (supporting buttons, qualifying factors, per-ancillary
    regenerate, regenerate-all, sibling Next/Prev, admin approval, ICD chips,
    under-16 guardrails)
  Engagement Center (conflict guard, bulk assign)
  Team Portals (patient list, schedule, tasks, docs)
  Clinician PDF, Plexus PDF, selected patient PDF actions

EXACT IMPLEMENTATION REQUIREMENTS:
  1. For each target component, enumerate every useQuery and useMutation call
     and create a one-to-one named hook in the matching new hook file.
  2. Hook call order in the component must match the original, line-for-line.
  3. Local variable names (e.g., `const { data: patient } = ...`) must remain
     unchanged.
  4. Mutation onSuccess / onError handlers stay in the component, not in the hook.
     Move ONLY the queryFn / mutationFn / queryKey wiring.
  5. After each component swap, run validation. If any QA script regresses,
     revert that component's edit only.
  6. Order of operations: PortalShell first (lowest risk), then
     EngagementAssignmentBoard, then AdminReviewDialog.

VALIDATION:
  npm run check
  npm run build
  node scripts/qa-navigation-dock-home-tiles.mjs
  node scripts/qa-command-center-architecture.mjs
  node scripts/qa-visit-outreach-tile-parity.mjs
  node scripts/qa-plexus-iq-interior.mjs
  node scripts/qa-plexus-iq-backend.mjs
  node scripts/qa-team-portals-restore.mjs
  node scripts/qa-team-portal-workspace-engine.mjs
  node scripts/qa-engagement-assignment-runtime.mjs

  # Test-id parity (manual):
  grep -c 'data-testid' client/src/components/qualification/AdminReviewDialog.tsx
  grep -c 'data-testid' client/src/components/engagement/EngagementAssignmentBoard.tsx
  grep -c 'data-testid' client/src/components/portal/PortalShell.tsx
  # Compare counts against pre-batch.

MANUAL QA CHECKLIST:
  - Admin Review: regenerate per-ancillary, regenerate-all, sibling Next/Prev,
    admin approve, ICD chips visible, PDF preview opens.
  - Engagement Center: conflict guard fires on a known dupe; bulk assign one
    row; journey event appears.
  - Team Portal: patient list, schedule, tasks, docs tabs load; outreach call
    dialog opens.
  - Clinician PDF + Plexus PDF on one approved patient: identical to pre-batch.

COMMIT MESSAGE:
  Extract data-fetch hooks from AdminReview, EngagementBoard, PortalShell (Batch 4)

FINAL REPORT FORMAT:
  Branch: <branch>
  Files changed: <list>
  App source untouched: no (three components hook-swapped; markup unchanged)
  npm run check: <pass/fail>
  npm run build: <pass/fail>
  QA scripts: <8/8 pass | list failures>
  Manual QA: <pass/fail per item>
  test-id counts pre/post: <three numbers>
  Blocked items: <none | list>
  Behavior changes (UI/API): none

STOP CONDITIONS:
  - Any data-testid count differs from pre-batch → STOP and revert.
  - Any QA script regresses → STOP and revert.
  - Any new console warning about hooks order → STOP and revert.
  - Any visible UI change → STOP and revert.

DO NOT push unless the user explicitly says "push" or "open the PR".
```

---

# Batch 5 — Patient Directory preparation

## 1. Purpose
Design and add the `patient_directory` concept as **read-side helpers only**. No table created, no data migrated, no rename of `patient_screenings`. The output is a `server/modules/patient-directory/` skeleton that computes a canonical view by grouping screenings on `(lower(name), dob, facility)`.

## 2. Why this batch exists
Identity is duplicated across ~15 tables. A real `patient_directory` table is months of careful migration. Step one is to give callers a stable read function (`getCanonicalPatient(screeningId)`) backed by the existing data. Once consumers depend on the read function, switching its backing store from `patient_screenings` to a real table later is a one-line change.

## 3. Current repo areas to inspect
- `shared/schema/screening.ts` (lines 31–89)
- `server/routes/patientDatabase.ts` (existing GROUP BY (lower(name), dob) roster)
- `server/repositories/screening.repo.ts`
- `server/routes/plexusIqClinicalImport.ts` (identity creation site)
- `server/routes/batches.ts` (manual entry path)
- `server/services/patientCommitService.ts`
- `client/src/lib/plexusIqClinicalImportParser.ts` (client-side identity parsing)

## 4. Current risks
- A read helper that "drifts" from the existing roster aggregation would produce two different counts for the same data — confusing in dashboards.
- If consumers start calling the new helper before all upstream identity write paths agree on a normalization (lowercased name, DOB format), the helper would mask bugs rather than fix them.

## 5. Protected flows at risk
- Plexus IQ import (must not change identity creation in this batch)
- Engagement Center board (uses identity for conflict guard)
- Patient Database roster page

## 6. Batch type
**migration-design** (no migration ships; design + read helpers only)

## 7. Risk level
**low-medium**

## 8. Safety conditions before implementation
- Batches 1–4 merged.
- A documented identity-normalization rule exists in `docs/architecture/canonical-spine.md` (Batch 1 deliverable) — e.g., "name lowercased, DOB ISO-8601, facility verbatim string until Batch 6".
- No active migration PRs.

## 9. Allowed changes
- Add `server/modules/patient-directory/` with `contracts.ts`, `repo.ts`, `service.ts`.
- Add a single read helper export: `getCanonicalPatientByScreeningId(id)`.
- Add a single read helper export: `listCanonicalPatients({ facility, limit, offset })`.
- Add docs at `docs/architecture/patient-directory-design.md` describing the future table shape, migration risks, and the cutover plan.

## 10. Forbidden changes
- **No new DB tables** (no `CREATE TABLE`, no Drizzle table def).
- **No migration files.**
- **No rename of `patient_screenings`** or any of its columns.
- No edits to identity write paths (`plexusIqClinicalImport.ts`, `batches.ts`, `patients.ts`, `patientCommitService.ts`).
- No change to any UI.
- No change to any existing route.

## 11. Likely files touched
- `server/modules/patient-directory/contracts.ts` (new)
- `server/modules/patient-directory/repo.ts` (new — read-only)
- `server/modules/patient-directory/service.ts` (new — read-only)
- `server/modules/patient-directory/index.ts` (new — barrel)
- `docs/architecture/patient-directory-design.md` (new)

## 12. Files/functions/routes that should not be touched
- `shared/schema/screening.ts`
- `server/routes/patientDatabase.ts` (existing roster route — keep working)
- `server/routes/plexusIqClinicalImport.ts`
- `server/routes/patients.ts`
- `server/services/patientCommitService.ts`
- All `migrations/`

## 13. Implementation approach
1. Write `contracts.ts` with `CanonicalPatient` (id is a derived hash, e.g., `sha256(lower(name) + '|' + dob)`).
2. Write `repo.ts` with the GROUP BY query (mirrors the patientDatabase roster aggregation; reuse the SQL if possible).
3. Write `service.ts` with the two exported read helpers. Internal only. **Not wired to any route in this batch.**
4. Write the design doc with: future table DDL (commented, not committed as SQL), migration steps, rollback, blast radius per consumer.

## 14. Required compatibility rules
- Preserve API response shapes (no API touched).
- Preserve test IDs (no UI touched).
- Preserve UI markup.
- Preserve PDF data source.
- Preserve canonical reasoning.
- Preserve existing routes.
- Add wrappers before replacing code (the read helpers are the wrappers; routes are not switched yet).

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs
```

## 16. Manual QA checklist
- Open Patient Database page — unchanged.
- Open Plexus IQ workspace — sidebar, calendar, add-patient unchanged.
- Open Engagement Center — board unchanged.
- Confirm no route uses the new helper yet (search for `getCanonicalPatientByScreeningId`).

## 17. Rollback plan
- `git rm -r server/modules/patient-directory/` and the design doc.
- No other state change.

## 18. Stop conditions
- If the GROUP BY produces a different count than the existing `routes/patientDatabase.ts` roster for a sample facility/date, STOP and reconcile. Two diverging "canonical" counts is worse than zero canonical counts.
- If anyone proposes wiring the helper to a route in this batch, STOP.

## 19. Required approval phrase
**APPROVE BATCH 5**

## 20. Exact Claude Code implementation prompt

```
You are working in the repo `noorhanmedical/tertiary-command-center` on macOS.
Path: ~/Projects/tertiary-command-center-replit-sync

GOAL: Add patient-directory read-side helpers and a design doc. No new table,
       no migration, no rename of existing tables, no route wiring.

BRANCH:
  Create branch from main:
    architecture/patient-directory-prep

ALLOWED FILES (add):
  server/modules/patient-directory/contracts.ts
  server/modules/patient-directory/repo.ts
  server/modules/patient-directory/service.ts
  server/modules/patient-directory/index.ts
  docs/architecture/patient-directory-design.md

FORBIDDEN FILES (do not edit):
  shared/schema/screening.ts and all other shared/schema/*.ts
  shared/schema/index.ts
  server/routes/patientDatabase.ts
  server/routes/plexusIqClinicalImport.ts
  server/routes/patients.ts
  server/routes/batches.ts
  server/services/patientCommitService.ts
  server/storage.ts, server/db.ts
  client/**
  migrations/**
  package.json, package-lock.json, .env*

PROTECTED FLOWS:
  Plexus IQ; Plexus IQ import; Engagement Center; Patient Database roster.
  No identity write path may be modified in this batch.

EXACT IMPLEMENTATION REQUIREMENTS:
  1. contracts.ts defines `CanonicalPatient` (derived id = sha256(lower(name)|dob)).
  2. repo.ts implements ONLY a read query that groups patient_screenings by
     (lower(name), dob, facility), mirroring routes/patientDatabase.ts.
  3. service.ts exports two read helpers:
       getCanonicalPatientByScreeningId(id)
       listCanonicalPatients({ facility, limit, offset })
     Both are not wired to any route in this batch.
  4. docs/architecture/patient-directory-design.md describes:
       - future table DDL (in a code block, NOT a SQL file)
       - migration steps + rollback
       - blast radius per consumer
       - the cutover plan and feature flag name
  5. Run a manual count-parity check: for one sample facility, the helper's
     result count must match routes/patientDatabase.ts roster count. Document
     the result in the PR description.

VALIDATION:
  npm run check
  npm run build
  node scripts/qa-navigation-dock-home-tiles.mjs
  node scripts/qa-command-center-architecture.mjs
  node scripts/qa-visit-outreach-tile-parity.mjs
  node scripts/qa-plexus-iq-interior.mjs
  node scripts/qa-plexus-iq-backend.mjs
  node scripts/qa-team-portals-restore.mjs
  node scripts/qa-team-portal-workspace-engine.mjs
  node scripts/qa-engagement-assignment-runtime.mjs

MANUAL QA CHECKLIST:
  - Patient Database page: counts and rows unchanged.
  - Plexus IQ workspace: unchanged.
  - Engagement Center: unchanged.
  - grep `getCanonicalPatientByScreeningId` across the repo: only the new
    module file and the design doc should reference it. No route wires it.

COMMIT MESSAGE:
  Add patient-directory read helpers and design doc (Batch 5)

FINAL REPORT FORMAT:
  Branch: <branch>
  Files changed: <list>
  App source untouched: yes (new module only; no consumers wired)
  npm run check: <pass/fail>
  npm run build: <pass/fail>
  QA scripts: <8/8 pass | list failures>
  Manual QA: <pass/fail per item>
  Count parity vs routes/patientDatabase.ts: <equal | diff with N>
  Blocked items: <none | list>
  Behavior changes (UI/API): none

STOP CONDITIONS:
  - Count parity fails → STOP and reconcile.
  - Any route gets wired to the helper → STOP.
  - Any DDL is committed → STOP and remove.

DO NOT push unless the user explicitly says "push" or "open the PR".
```

---

# Batch 6 — Facility canonicalization

## 1. Purpose
Inventory every place facility identity is consumed as a string, design a `facilities` master table + `facility_id` column (additive), and ship **only** the inventory + design doc. No code or migration.

## 2. Why this batch exists
Facility is a text string (`"NWPG - Spring"`, etc.) duplicated across ~20 tables and validated against a hardcoded `VALID_FACILITIES` constant in `shared/plexus.ts` and `shared/platformSettings.ts`. Every filter route accepts facility as a string. A safe dual-write pattern (text + `facility_id`) must be planned before any column is added.

## 3. Current repo areas to inspect
- `shared/plexus.ts` (`VALID_FACILITIES`)
- `shared/platformSettings.ts`
- `shared/schema/screening.ts`, `executionCase.ts`, `billing.ts`, `documents.ts`, others — wherever `facility` columns exist
- `server/routes/patients.ts`, `billing.ts`, `engagementAssignmentBoard.ts`, `outreach.ts`, `documentLibrary.ts` — facility-filter accept points
- `client/src/lib/plexusIqClinicalImportParser.ts` and any client-side facility validation
- `migrations/` (history of facility-related changes)

## 4. Current risks
- Adding `facility_id` columns without a dual-write rule will produce divergence in days.
- Removing the `VALID_FACILITIES` allow-list before a master table is wired in would let bad strings into the DB.
- A facility rename (today: edit a constant; tomorrow: master-table update) must remain backward-compatible for historical data.

## 5. Protected flows at risk
- Every flow that filters by facility: Plexus IQ, Engagement Center, Scheduler Portal, Team Portals, Billing list, Patient Database.

## 6. Batch type
**migration-design**

## 7. Risk level
**low-medium** (this batch); the future implementation batch is **high**.

## 8. Safety conditions before implementation
- Batch 5 merged (patient directory design exists).
- The full list of tables with a `facility` column is captured (grep first).
- A documented dual-write rule exists in the canonical-spine doc.

## 9. Allowed changes
- Add `docs/architecture/facilities-design.md`.
- Add `docs/architecture/facility-string-inventory.md` — table-by-table list of every column and route that touches facility.

## 10. Forbidden changes
- No new DB columns.
- No new tables.
- No migration file.
- No edits to `VALID_FACILITIES` (the constant stays).
- No route or service edits.
- No UI edits.

## 11. Likely files touched
- `docs/architecture/facilities-design.md` (new)
- `docs/architecture/facility-string-inventory.md` (new)

## 12. Files/functions/routes that should not be touched
- `shared/plexus.ts`, `shared/platformSettings.ts`
- All `shared/schema/*.ts`
- All server routes and services that read/filter facility
- All client filter UI

## 13. Implementation approach
1. Grep every occurrence of `facility` (case-insensitive) across `server/`, `client/`, `shared/`. Group by file + column / variable name.
2. Produce the inventory doc — one row per (file, column or variable, type, write-or-read).
3. Produce the design doc — future `facilities` table DDL (commented), `facility_id` nullable column rollout per table, dual-write rule, cutover steps, rollback, blast radius.
4. The design doc names the feature flag (`FACILITY_DUAL_WRITE`) and the order of consumer migration.

## 14. Required compatibility rules
- Preserve API response shapes (no API touched).
- Preserve test IDs (no UI touched).
- Preserve UI markup.
- Preserve PDF data source.
- Preserve canonical reasoning.
- Preserve existing routes.
- Add wrappers before replacing code (this batch is design only).

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs
```

## 16. Manual QA checklist
- Every facility filter in the UI still works (Plexus IQ, Engagement Center, Scheduler Portal, Billing).
- `VALID_FACILITIES` constant is unchanged.

## 17. Rollback plan
- `git rm` the two new docs.

## 18. Stop conditions
- If the inventory reveals undocumented uses of facility strings (e.g., string concatenation into a Drive folder name), STOP and add a section on that risk before approving the implementation batch.
- If anyone proposes adding `facility_id` in this batch, STOP.

## 19. Required approval phrase
**APPROVE BATCH 6**

## 20. Exact Claude Code implementation prompt

```
You are working in the repo `noorhanmedical/tertiary-command-center` on macOS.
Path: ~/Projects/tertiary-command-center-replit-sync

GOAL: Produce a facility-string inventory and a facility canonicalization
       design doc. No code, no migration.

BRANCH:
  Create branch from main:
    architecture/facility-canonicalization-design

ALLOWED FILES (add):
  docs/architecture/facilities-design.md
  docs/architecture/facility-string-inventory.md

FORBIDDEN FILES (do not edit):
  shared/plexus.ts, shared/platformSettings.ts
  All shared/schema/*.ts and shared/schema/index.ts
  All server routes and services
  All client code
  migrations/**
  package.json, package-lock.json, .env*

PROTECTED FLOWS:
  Plexus IQ; Engagement Center; Scheduler Portal; Team Portals; Billing;
  Patient Database. All facility filters must continue working unchanged.

EXACT IMPLEMENTATION REQUIREMENTS:
  1. Grep every occurrence of "facility" (case-insensitive) across server/,
     client/, shared/, scripts/. Group by file + column or variable name.
     Capture: file, line range, column or variable, type, write-or-read,
     whether it appears in a route handler / service / repo / UI filter.
  2. docs/architecture/facility-string-inventory.md lists every row.
  3. docs/architecture/facilities-design.md describes:
       - the future `facilities` master table DDL (in a fenced code block,
         not a SQL file)
       - the `facility_id` nullable-column rollout per table (additive)
       - the dual-write rule (which side wins; how stale `facility_id`
         repairs run)
       - cutover order, with one consumer migrated per follow-up batch
       - rollback
       - feature flag name: FACILITY_DUAL_WRITE
  4. Do not change VALID_FACILITIES.
  5. Do not change any source file.

VALIDATION:
  npm run check
  npm run build
  node scripts/qa-navigation-dock-home-tiles.mjs
  node scripts/qa-command-center-architecture.mjs
  node scripts/qa-visit-outreach-tile-parity.mjs
  node scripts/qa-plexus-iq-interior.mjs
  node scripts/qa-plexus-iq-backend.mjs
  node scripts/qa-team-portals-restore.mjs
  node scripts/qa-team-portal-workspace-engine.mjs
  node scripts/qa-engagement-assignment-runtime.mjs

MANUAL QA CHECKLIST:
  - Facility filters in Plexus IQ, Engagement Center, Scheduler Portal,
    Billing, Patient Database all work unchanged.

COMMIT MESSAGE:
  Add facility canonicalization inventory and design doc (Batch 6)

FINAL REPORT FORMAT:
  Branch: <branch>
  Files changed: <list>
  App source untouched: yes
  npm run check: <pass/fail>
  npm run build: <pass/fail>
  QA scripts: <8/8 pass | list failures>
  Manual QA: <pass/fail per item>
  Inventory rows captured: <N>
  Blocked items: <none | list>
  Behavior changes (UI/API): none

STOP CONDITIONS:
  - Any new column or migration committed → STOP.
  - Any undocumented facility use (e.g., string concatenation into a Drive
    folder name) discovered → STOP and add a risk section before submitting.

DO NOT push unless the user explicitly says "push" or "open the PR".
```

---

# Batch 7 — Patient matching / deduping design

## 1. Purpose
Design a deterministic + probabilistic patient matcher (name + DOB + phone + MRN + facility) and a manual-review queue for uncertain matches. **Design only.** No code that silently merges patients.

## 2. Why this batch exists
The five identity-creation paths (manual entry, file import, text paste, Plexus IQ clinical import, seed scripts) have **no dedupe**. Phone has no unique index. MRN is in free-text notes. Two real patients with the same DOB + similar names would be silently treated as separate today — and a single patient imported twice would create two `patient_screenings` rows.

A correct fix is a matcher service + a UI-driven manual-merge queue. This batch designs both.

## 3. Current repo areas to inspect
- `server/routes/plexusIqClinicalImport.ts` (bulk import; MRN stamping in `buildClinicalImportNotes`)
- `server/routes/batches.ts` (manual entry, file import, text paste)
- `server/services/patientCommitService.ts`
- `shared/schema/screening.ts`
- `server/routes/patientDatabase.ts` (roster aggregation)
- `server/modules/patient-directory/` (from Batch 5)

## 4. Current risks
- Any automatic merge today would damage existing data: scheduler assignments, journey events, billing records all point to a specific `patient_screenings.id`. A merge that moves rows between IDs without a careful re-pointer would corrupt FKs.
- Probabilistic matching can produce false positives that combine two real people. PHI risk.
- A manual-review queue with weak audit logging would let a coder erase a merge after-the-fact.

## 5. Protected flows at risk
- Plexus IQ import
- Engagement Center conflict guard
- Scheduler assignments
- Billing records

## 6. Batch type
**migration-design**

## 7. Risk level
**medium**

## 8. Safety conditions before implementation
- Batches 5 and 6 merged.
- An identity-normalization rule documented (Batch 5).
- A facility canonicalization plan documented (Batch 6).

## 9. Allowed changes
- Add `docs/architecture/patient-matching-design.md` covering:
  - Deterministic match keys (MRN + facility; phone normalized E.164; insurance member + DOB)
  - Probabilistic match (Jaro-Winkler on name; DOB exact; facility exact; phone last-4)
  - Confidence thresholds: auto-accept (none — design-only forbids this), uncertain → manual queue, no-match → new row
  - Manual review queue table design (commented DDL)
  - Audit log requirements
  - Reverse-merge (un-merge) procedure
  - Feature flag: `PATIENT_MATCHER_ENABLED` (default off)

## 10. Forbidden changes
- No code that performs any match.
- No code that performs any merge.
- No new tables, columns, or migrations.
- No edits to identity write paths.

## 11. Likely files touched
- `docs/architecture/patient-matching-design.md` (new)

## 12. Files/functions/routes that should not be touched
- All identity write paths
- All schema
- `server/storage.ts`

## 13. Implementation approach
1. Audit the five identity-creation paths; document what data is available at each.
2. Define the matcher's input contract and output contract (`MatchResult { kind: 'auto'|'manual'|'new'; candidates: …; reason: … }`).
3. Define the manual-review queue table (DDL in fenced code block; not a SQL file).
4. Define audit requirements: every match decision logged with confidence, inputs, and the reviewer's user id.
5. Define rollback: how to un-merge if a coder mis-clicks.
6. Define what "auto-accept" means in practice — for this codebase, the design recommends "no auto-merge in v1; every match is reviewed."

## 14. Required compatibility rules
- Preserve API response shapes.
- Preserve test IDs.
- Preserve UI markup.
- Preserve PDF data source.
- Preserve canonical reasoning.
- Preserve existing routes.
- Add wrappers before replacing code (design only).

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs
```

## 16. Manual QA checklist
- Plexus IQ import a known-duplicate paste; confirm today's behavior is still two `patient_screenings` rows. (No silent merge.)
- Engagement Center conflict guard still fires for same-name + same-DOB + same-scheduleDate.

## 17. Rollback plan
- `git rm` the new doc.

## 18. Stop conditions
- If anyone proposes shipping the matcher's code in this batch, STOP.
- If the design proposes auto-merge without a reversible audit path, STOP.

## 19. Required approval phrase
**APPROVE BATCH 7**

## 20. Exact Claude Code implementation prompt

```
You are working in the repo `noorhanmedical/tertiary-command-center` on macOS.
Path: ~/Projects/tertiary-command-center-replit-sync

GOAL: Produce a patient-matching / dedupe design doc. Design only. No code.

BRANCH:
  Create branch from main:
    architecture/patient-matching-design

ALLOWED FILES (add):
  docs/architecture/patient-matching-design.md

FORBIDDEN FILES (do not edit):
  All server/, client/, shared/, migrations/, scripts/, script/ files.
  package.json, package-lock.json, .env*.

PROTECTED FLOWS:
  Plexus IQ import (must continue to create rows the same way today).
  Engagement Center conflict guard.
  Scheduler assignments.
  Billing records.

EXACT IMPLEMENTATION REQUIREMENTS:
  1. Audit the five identity-creation paths and document inputs available
     at each:
       - POST /api/batches/:id/patients (manual)
       - POST /api/batches/:id/import-file (Excel/CSV/PDF/image AI parsing)
       - POST /api/batches/:id/import-text
       - POST /api/plexus-iq/clinical-import
       - script/seed*.ts test fixtures
  2. Define MatchResult { kind: 'auto'|'manual'|'new'; candidates; reason }.
  3. Define deterministic keys (MRN+facility; phone E.164; insurance member+DOB).
  4. Define probabilistic match (Jaro-Winkler name; DOB exact; facility exact;
     phone last-4). Confidence thresholds. v1 recommendation: no auto-merge.
  5. Define manual-review queue table DDL in a fenced code block (not a SQL file).
  6. Define audit requirements per match decision.
  7. Define reverse-merge procedure.
  8. Define feature flag PATIENT_MATCHER_ENABLED (default off).
  9. Do not write any code.

VALIDATION:
  npm run check
  npm run build
  node scripts/qa-navigation-dock-home-tiles.mjs
  node scripts/qa-command-center-architecture.mjs
  node scripts/qa-visit-outreach-tile-parity.mjs
  node scripts/qa-plexus-iq-interior.mjs
  node scripts/qa-plexus-iq-backend.mjs
  node scripts/qa-team-portals-restore.mjs
  node scripts/qa-team-portal-workspace-engine.mjs
  node scripts/qa-engagement-assignment-runtime.mjs

MANUAL QA CHECKLIST:
  - Plexus IQ import a known-duplicate paste → two patient_screenings rows
    (today's behavior is preserved).
  - Engagement Center conflict guard fires on same-name + same-DOB +
    same-scheduleDate (today's behavior is preserved).

COMMIT MESSAGE:
  Add patient-matching / dedupe design doc (Batch 7)

FINAL REPORT FORMAT:
  Branch: <branch>
  Files changed: <list>
  App source untouched: yes
  npm run check: <pass/fail>
  npm run build: <pass/fail>
  QA scripts: <8/8 pass | list failures>
  Manual QA: <pass/fail per item>
  Blocked items: <none | list>
  Behavior changes (UI/API): none

STOP CONDITIONS:
  - Any code committed → STOP.
  - Any design that auto-merges without reversible audit path → STOP.

DO NOT push unless the user explicitly says "push" or "open the PR".
```

---

# Batch 8 — Qualification structure cleanup

## 1. Purpose
Move toward a typed `clinical_qualification_results` and a typed `qualification_factor_assignments` model **as design + non-invasive read helpers**. The existing jsonb reasoning blob stays the source of truth in this batch; helpers extract structured views without rewriting writes.

## 2. Why this batch exists
Per-service status lives in `procedure_events`. Verdicts live in `patient_screenings.qualifyingTests[]`. Supporting evidence (clicked buttons, ICD codes, qualifying factors) lives only in `patient_screenings.reasoning` jsonb. A strict contract would let Admin Review modularization (Batch 15) and PDF protection (Batch 9) proceed safely.

## 3. Current repo areas to inspect
- `shared/schema/screening.ts` (`reasoning` jsonb)
- `shared/schema/executionCase.ts` (`procedure_events`)
- `server/services/screening.ts` (AI qualification output shape)
- `server/services/plexusIq/*` (admin-review rule engine; per-ancillary regen)
- `server/routes/patients.ts` (admin-review endpoints)
- `client/src/components/qualification/AdminReviewDialog.tsx` (consumer)
- `client/src/lib/pdfGeneration.ts` (consumer)
- `shared/contracts/reasoning.ts` (from Batch 2)

## 4. Current risks
- Any change to the reasoning blob shape (key order, casing, missing keys) breaks Admin Review and both PDFs.
- The Clinician PDF intentionally omits ICD codes (`pdfGeneration.ts` line ~403–409) but expects them present in the blob — this contract must be locked down.
- A regenerate-all rerun must not lose admin-review overrides (`reasoning["adminReview:<ancillary>"]`).

## 5. Protected flows at risk
- Admin Review (supporting buttons, qualifying factors, per-ancillary regenerate, regenerate-all, ICD chips, under-16 guardrails)
- Clinician PDF, Plexus PDF
- Plexus IQ qualification jobs

## 6. Batch type
**code-safe** (helpers only; no writes touched)

## 7. Risk level
**low-medium**

## 8. Safety conditions before implementation
- Batches 1–4 merged.
- A canonical reasoning shape lives in `shared/contracts/reasoning.ts` (Batch 2 deliverable).
- A PDF baseline snapshot exists (Batch 9 design step recommended first; if Batch 9 ships before Batch 8, that's preferred).

## 9. Allowed changes
- Add `server/modules/qualification/` with `contracts.ts` (re-exports + structural narrowing), `repo.ts` (read-only helpers), `service.ts` (read-only `getStructuredQualification(screeningId)`).
- Add a typed read view `getQualificationFactorAssignments(screeningId, ancillary)` that flattens `reasoning[testName].qualifying_factors` + `icd10_codes` + `reasoning["adminReview:<ancillary>"]` into typed rows.
- Add `docs/architecture/qualification-design.md` describing the future tables and the cutover.

## 10. Forbidden changes
- No edits to `reasoning` write paths.
- No edits to AI prompts, models, or `screening.ts`.
- No edits to `AdminReviewDialog.tsx` or any qualification UI.
- No edits to PDF code.
- No new DB tables, columns, migrations.

## 11. Likely files touched
- `server/modules/qualification/contracts.ts` (new)
- `server/modules/qualification/repo.ts` (new — read only)
- `server/modules/qualification/service.ts` (new — read only)
- `server/modules/qualification/index.ts` (new)
- `docs/architecture/qualification-design.md` (new)

## 12. Files/functions/routes that should not be touched
- `server/services/screening.ts`
- `server/services/plexusIq/*`
- `server/routes/patients.ts`
- `client/src/components/qualification/*`
- `client/src/lib/pdfGeneration.ts`, `pdfPacketGrouping.ts`
- All schema and migrations

## 13. Implementation approach
1. Pin `shared/contracts/reasoning.ts` shape via tests in `server/modules/qualification/__tests__/`.
2. Write read helpers that return typed views without mutating anything.
3. Write the design doc with future DDL, cutover, and a strict invariant: "ICD codes always present in reasoning; UI/PDF decides whether to render."
4. Do not wire helpers to any route.

## 14. Required compatibility rules
- Preserve API response shapes.
- Preserve test IDs.
- Preserve UI markup.
- **Preserve PDF data source** — the reasoning blob is the canonical source; helpers read, do not write.
- **Preserve canonical reasoning** — including `qualifying_factors`, `icd10_codes`, `clinician_understanding`, `patient_talking_points`, `adminReview:<ancillary>` keys.
- Preserve existing routes.
- Add wrappers before replacing code.

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs
```

## 16. Manual QA checklist
- Admin Review supporting buttons render as before.
- Per-ancillary regenerate updates only the chosen ancillary; others unchanged.
- Regenerate-all preserves prior admin-review overrides.
- Clinician PDF: ICD not rendered, but qualifying factors and clinician understanding present.
- Plexus PDF: full content unchanged.

## 17. Rollback plan
- `git rm -r server/modules/qualification/` and the design doc.

## 18. Stop conditions
- If `shared/contracts/reasoning.ts` cannot describe the existing blob completely (i.e., the runtime data is more permissive), STOP and capture the gap in the design doc instead of narrowing the type.
- If anyone proposes editing reasoning writes in this batch, STOP.

## 19. Required approval phrase
**APPROVE BATCH 8**

## 20. Exact Claude Code implementation prompt

```
You are working in the repo `noorhanmedical/tertiary-command-center` on macOS.
Path: ~/Projects/tertiary-command-center-replit-sync

GOAL: Add qualification module with read-only typed helpers and a design doc.
       No reasoning writes touched. No AI prompts touched. No PDF code touched.

BRANCH:
  Create branch from main:
    architecture/qualification-structure-cleanup

ALLOWED FILES (add):
  server/modules/qualification/contracts.ts
  server/modules/qualification/repo.ts
  server/modules/qualification/service.ts
  server/modules/qualification/index.ts
  server/modules/qualification/__tests__/reasoningShape.test.ts (optional)
  docs/architecture/qualification-design.md

FORBIDDEN FILES (do not edit):
  server/services/screening.ts
  server/services/plexusIq/*
  server/routes/patients.ts (admin-review endpoints)
  client/src/components/qualification/*
  client/src/lib/pdfGeneration.ts
  client/src/lib/pdfPacketGrouping.ts
  shared/schema/screening.ts (and all other shared/schema/*.ts)
  shared/schema/index.ts
  shared/contracts/reasoning.ts (consume only)
  All migrations/
  package.json, package-lock.json, .env*

PROTECTED FLOWS:
  Admin Review (supporting buttons, qualifying factors, per-ancillary
    regenerate, regenerate-all, ICD chips, under-16 guardrails, OpenAI
    regeneration)
  Clinician PDF, Plexus PDF, selected patient PDF actions
  Plexus IQ qualification jobs

EXACT IMPLEMENTATION REQUIREMENTS:
  1. contracts.ts re-exports the canonical Reasoning shape from
     shared/contracts/reasoning.ts and adds narrowed views for:
       StructuredQualification, FactorAssignment, IcdAssignment.
  2. repo.ts implements read-only queries against patient_screenings.reasoning.
  3. service.ts exports:
       getStructuredQualification(screeningId)
       getQualificationFactorAssignments(screeningId, ancillary)
  4. Optional reasoningShape.test.ts asserts the shape contract holds on a
     captured fixture (use canned data, not a live query).
  5. design doc covers future tables (clinical_qualification_results,
     qualification_factor_assignments) with DDL in fenced code blocks,
     cutover, rollback, blast radius.
  6. Do not wire helpers to any route.

VALIDATION:
  npm run check
  npm run build
  node scripts/qa-navigation-dock-home-tiles.mjs
  node scripts/qa-command-center-architecture.mjs
  node scripts/qa-visit-outreach-tile-parity.mjs
  node scripts/qa-plexus-iq-interior.mjs
  node scripts/qa-plexus-iq-backend.mjs
  node scripts/qa-team-portals-restore.mjs
  node scripts/qa-team-portal-workspace-engine.mjs
  node scripts/qa-engagement-assignment-runtime.mjs

MANUAL QA CHECKLIST:
  - Admin Review supporting buttons render unchanged.
  - Per-ancillary regenerate updates only the chosen ancillary.
  - Regenerate-all preserves prior admin-review overrides.
  - Clinician PDF: ICD not rendered; qualifying factors + clinician
    understanding present.
  - Plexus PDF: unchanged.

COMMIT MESSAGE:
  Add qualification module read helpers and design doc (Batch 8)

FINAL REPORT FORMAT:
  Branch: <branch>
  Files changed: <list>
  App source untouched: yes (new module only; no consumers wired)
  npm run check: <pass/fail>
  npm run build: <pass/fail>
  QA scripts: <8/8 pass | list failures>
  Manual QA: <pass/fail per item>
  Blocked items: <none | list>
  Behavior changes (UI/API): none

STOP CONDITIONS:
  - Any reasoning write path edited → STOP.
  - Any PDF code edited → STOP.
  - Any contract narrowed below actual runtime data → STOP and capture the gap.

DO NOT push unless the user explicitly says "push" or "open the PR".
```

---

# Batch 9 — PDF / packet protection

## 1. Purpose
Deeply map the PDF / packet generation surface and write a protection contract: who calls `pdfGeneration.ts`, with what data, with what side effects, and what must remain invariant. Add a baseline snapshot test for one representative patient packet. No PDF code changes.

## 2. Why this batch exists
`client/src/lib/pdfGeneration.ts` (904 lines) is imported by 6+ unrelated features. Any change to its API ripples through Admin Review, Engagement Center, Outreach, and the patient cards. The Clinician PDF intentionally omits ICD codes; the Plexus PDF includes them. Two distinct print-preview helpers exist (`openPatientPacketPrintPreview`, `openSchedulerPacketPrintPreview`) to avoid html2canvas freezes. Without a contract, any "small cleanup" in `pdfGeneration.ts` will silently break one of the callers.

## 3. Current repo areas to inspect
- `client/src/lib/pdfGeneration.ts`
- `client/src/lib/pdfPacketGrouping.ts`
- `client/src/components/qualification/PatientPdfActions.tsx`
- `client/src/components/PatientCard.tsx`, `ResultsView.tsx`
- `client/src/components/qualification/AdminReviewDialog.tsx` (caller; do not modify)
- `client/src/components/engagement/EngagementAssignmentBoard.tsx` (caller)
- `client/src/components/outreach/CanonicalRowActions.tsx` (caller)
- `client/src/lib/pdf-baselines/` (new) — snapshot fixtures

## 4. Current risks
- A snapshot baseline that captures incidental rendering noise (timestamps, dynamic ids) would create false positives on every run.
- Reorganizing the PDF call graph without first locking down the data source can lose ICD codes from the Plexus PDF.
- The print-preview path (which opens a new window and triggers print) has subtle browser-permission quirks; any change must keep the existing call sites unchanged.

## 5. Protected flows at risk
- Clinician PDF (single and multi-patient packets)
- Plexus PDF
- Engagement Center bulk packet
- Outreach packet
- Selected patient PDF actions

## 6. Batch type
**docs-only** + optional **code-safe** baseline snapshot

## 7. Risk level
**low**

## 8. Safety conditions before implementation
- Batches 1–4 merged.
- Optional: Batch 8 helpers exist (so the snapshot can verify reasoning shape).
- A representative patient (with full reasoning blob) chosen for the snapshot.

## 9. Allowed changes
- Add `docs/architecture/pdf-protection-contract.md` covering: caller list, data source, side effects, invariants, do-not-touch list specific to PDF, print-preview rules, and the test plan.
- Optional: add `client/src/lib/pdf-baselines/clinicianPacketBaseline.fixture.ts` and a non-runtime baseline script under `scripts/` (does NOT execute on app boot).

## 10. Forbidden changes
- No edits to `pdfGeneration.ts`, `pdfPacketGrouping.ts`.
- No edits to any PDF caller.
- No edits to `AdminReviewDialog.tsx`, `PatientCard.tsx`, `ResultsView.tsx`, `PatientPdfActions.tsx`, `EngagementAssignmentBoard.tsx`, `CanonicalRowActions.tsx`.
- No new dependencies.

## 11. Likely files touched
- `docs/architecture/pdf-protection-contract.md` (new)
- `client/src/lib/pdf-baselines/clinicianPacketBaseline.fixture.ts` (new, optional)
- `scripts/qa-pdf-baseline-snapshot.mjs` (new, optional — manual run; not added to CI yet)

## 12. Files/functions/routes that should not be touched
All PDF code and all callers (see §11 above).

## 13. Implementation approach
1. Enumerate every import of `pdfGeneration.ts` and document the exported function used, the data shape passed, and the resulting PDF flavor.
2. Document invariants: ICD codes always present in reasoning; Clinician PDF omits ICD render; Plexus PDF renders ICD; print-preview vs. inline differences.
3. Optional baseline: build a JSON fixture for one patient that, when fed to `generateClinicianPDF`, produces a deterministic PDF blob hash. Lock the hash in the snapshot script. Do not wire to CI in this batch.

## 14. Required compatibility rules
- Preserve API response shapes.
- Preserve test IDs.
- Preserve UI markup.
- **Preserve PDF data source** — explicitly.
- **Preserve canonical reasoning** — the snapshot tests it.
- Preserve existing routes.
- Add wrappers before replacing code.

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs
# Optional, if added:
node scripts/qa-pdf-baseline-snapshot.mjs
```

## 16. Manual QA checklist
- From Admin Review, generate Clinician PDF and Plexus PDF for one approved patient. Visual diff against an externally saved PDF.
- From Engagement Center, run bulk PDF for 3 patients on the same date + facility. Confirm the print-preview window opens with the expected page count.
- From Outreach `CanonicalRowActions`, generate PDF for one patient. Visual diff.

## 17. Rollback plan
- `git rm` the new docs and (optional) fixture script. No runtime change.

## 18. Stop conditions
- If two callers pass divergent shapes (e.g., a different `reasoning` shape), STOP and document the divergence as a blocker for Batch 15.
- If the baseline hash is non-deterministic (different on every run on the same machine), STOP — the PDF library has non-determinism that must be quarantined first.

## 19. Required approval phrase
**APPROVE BATCH 9**

## 20. Exact Claude Code implementation prompt

```
You are working in the repo `noorhanmedical/tertiary-command-center` on macOS.
Path: ~/Projects/tertiary-command-center-replit-sync

GOAL: Document the PDF / packet generation contract and (optionally) add a
       baseline snapshot fixture for one representative patient. No PDF code
       changes. No caller changes.

BRANCH:
  Create branch from main:
    architecture/pdf-protection-contract

ALLOWED FILES (add):
  docs/architecture/pdf-protection-contract.md
  client/src/lib/pdf-baselines/clinicianPacketBaseline.fixture.ts (optional)
  scripts/qa-pdf-baseline-snapshot.mjs (optional; not wired to CI)

FORBIDDEN FILES (do not edit):
  client/src/lib/pdfGeneration.ts
  client/src/lib/pdfPacketGrouping.ts
  client/src/components/qualification/PatientPdfActions.tsx
  client/src/components/qualification/AdminReviewDialog.tsx
  client/src/components/PatientCard.tsx
  client/src/components/ResultsView.tsx
  client/src/components/engagement/EngagementAssignmentBoard.tsx
  client/src/components/outreach/CanonicalRowActions.tsx
  All server code, schema, migrations.
  package.json, package-lock.json, .env*

PROTECTED FLOWS:
  Clinician PDF, Plexus PDF, selected patient PDF actions, multi-patient
  packet print-preview, Engagement Center bulk PDF, Outreach PDF.

EXACT IMPLEMENTATION REQUIREMENTS:
  1. Document every import of pdfGeneration.ts:
       - file path
       - exported function used
       - input shape (TypeScript signature)
       - whether print-preview is used and which helper
  2. Document invariants:
       - Reasoning blob always contains qualifying_factors, icd10_codes,
         clinician_understanding, patient_talking_points
       - Clinician PDF intentionally does NOT render ICD codes
       - Plexus PDF renders ICD codes
       - Multi-patient packet flows use print-preview (openPatientPacketPrintPreview /
         openSchedulerPacketPrintPreview)
  3. Optional fixture: capture one patient's full data (no PHI in commits —
     use a fictional name + DOB) and a deterministic baseline hash.
  4. Optional script: scripts/qa-pdf-baseline-snapshot.mjs reads the fixture
     and confirms the hash. Manual run only. Do not wire to CI.

VALIDATION:
  npm run check
  npm run build
  node scripts/qa-navigation-dock-home-tiles.mjs
  node scripts/qa-command-center-architecture.mjs
  node scripts/qa-visit-outreach-tile-parity.mjs
  node scripts/qa-plexus-iq-interior.mjs
  node scripts/qa-plexus-iq-backend.mjs
  node scripts/qa-team-portals-restore.mjs
  node scripts/qa-team-portal-workspace-engine.mjs
  node scripts/qa-engagement-assignment-runtime.mjs
  # If fixture added: node scripts/qa-pdf-baseline-snapshot.mjs

MANUAL QA CHECKLIST:
  - Admin Review → Clinician PDF + Plexus PDF: visual identity.
  - Engagement Center bulk PDF for 3 patients on same date+facility:
    expected page count.
  - Outreach CanonicalRowActions PDF for one patient: visual identity.

COMMIT MESSAGE:
  Add PDF protection contract and optional baseline (Batch 9)

FINAL REPORT FORMAT:
  Branch: <branch>
  Files changed: <list>
  App source untouched: yes (no PDF or caller changes)
  npm run check: <pass/fail>
  npm run build: <pass/fail>
  QA scripts: <8/8 pass | list failures>
  Manual QA: <pass/fail per item>
  Fixture deterministic: <yes/no/not-added>
  Blocked items: <none | list>
  Behavior changes (UI/API): none

STOP CONDITIONS:
  - Caller divergence in input shape → STOP and document as Batch 15 blocker.
  - Non-deterministic baseline hash → STOP; quarantine first.

DO NOT push unless the user explicitly says "push" or "open the PR".
```

---

# Batch 10 — Execution Case spine

## 1. Purpose
Make the execution-case spine **transactional and typed** by wrapping today's fire-and-forget writes in a state-machine module. The state machine reads existing enums (`lifecycleStatus`, `engagementStatus`, `engagementBucket`, `qualificationStatus`) and exposes typed transitions. Existing direct writes continue to work; the wrapper is opt-in.

## 2. Why this batch exists
`patientCommitService.ts` orchestrates screening commit + execution case + global schedule + insurance eligibility + cooldown + journey events + scheduler auto-assign as **six fire-and-forget side effects**. If any fails, the screening lives but the spine does not. `assignedTeamMemberId` has no FK. Without a state machine, future status changes from new code paths will continue to silently drift.

## 3. Current repo areas to inspect
- `shared/schema/executionCase.ts` (lines 29–52, 70–87)
- `server/services/patientCommitService.ts`
- `server/repositories/executionCase.repo.ts`
- `server/routes/engagementAssignmentBoard.ts`
- `server/routes/outreach.ts` (`createOutreachCallAtomic`)
- `server/repositories/outreach.repo.ts`

## 4. Current risks
- Wrapping commit writes in a transaction without an idempotency check can deadlock or double-create rows on retry.
- An overly strict state machine that disallows currently-allowed transitions will break Engagement Center's bulk-assign.
- A new `assignedTeamMemberId` FK constraint added to existing data without backfill would fail in prod.

## 5. Protected flows at risk
- Patient commit (Plexus IQ → execution case)
- Engagement Center board + assignment
- Team Portal (reads execution cases)
- Scheduler Portal

## 6. Batch type
**code-risky** (introduces wrapper + state machine; does not yet switch writers)

## 7. Risk level
**medium-high**

## 8. Safety conditions before implementation
- Batches 1–4 merged.
- Batch 8 helpers and Batch 9 contract documented.
- A documented matrix of every status enum, current transitions, and which callers perform each transition exists (deliverable of this batch's design step).

## 9. Allowed changes
- Add `server/modules/execution-cases/` with `contracts.ts`, `repo.ts`, `service.ts`, `stateMachine.ts`.
- Add `transitionExecutionCaseStatus(...)` typed wrapper that calls existing repo writes.
- Edit `server/services/patientCommitService.ts` **only** to add a feature-flagged transaction wrapper (`EXECUTION_CASE_TX` env, default off) around the six side-effect writes — when on, the wrapper makes them transactional; when off, behavior is identical to today.
- Add `docs/architecture/execution-case-state-machine.md`.

## 10. Forbidden changes
- No edits to `shared/schema/executionCase.ts`.
- No new migration.
- No FK addition to `assignedTeamMemberId`.
- No edits to `engagementAssignmentBoard.ts` route logic (conflict guard stays).
- No client edits.

## 11. Likely files touched
- `server/modules/execution-cases/contracts.ts`, `repo.ts`, `service.ts`, `stateMachine.ts`, `index.ts` (all new)
- `server/services/patientCommitService.ts` (only the feature-flagged tx wrapper)
- `docs/architecture/execution-case-state-machine.md` (new)

## 12. Files/functions/routes that should not be touched
- `shared/schema/executionCase.ts`
- `server/routes/engagementAssignmentBoard.ts`
- `server/routes/outreach.ts`
- `client/src/components/portal/*`
- `client/src/components/engagement/*`
- `server/storage.ts`, `server/db.ts`
- All migrations

## 13. Implementation approach
1. Write the state machine: every legal `(from, to)` transition mapped to a callable that delegates to today's repo.
2. The transaction wrapper is **opt-in via env**. Default off. With the flag on, the six side-effect writes run inside a `db.transaction`. With the flag off, behavior is byte-identical to today.
3. Document the transition matrix.
4. Do not point any production-default code path at the wrapper yet.

## 14. Required compatibility rules
- Preserve API response shapes.
- Preserve test IDs.
- Preserve UI markup.
- Preserve PDF data source.
- Preserve canonical reasoning.
- Preserve existing routes.
- Add wrappers before replacing code (this batch is the wrapper; switching writers is the next batch).

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs

# With flag off (default):
EXECUTION_CASE_TX=0 npm run dev
# With flag on (smoke):
EXECUTION_CASE_TX=1 npm run dev
```

## 16. Manual QA checklist
- Flag off: Plexus IQ import + commit a patient; execution case created; engagement board shows the patient.
- Flag on: same flow; same result; on a forced repo error injected mid-flow, transaction rolls back and no orphan execution case exists.
- Engagement Center conflict guard unchanged.
- Team Portal reads unchanged.

## 17. Rollback plan
- Set `EXECUTION_CASE_TX=0` everywhere and redeploy.
- Revert the patientCommitService.ts wrapper commit.
- Keep the state machine module in place (read-only; harmless).

## 18. Stop conditions
- If the transaction wrapper deadlocks under a single-user smoke test, STOP and revert.
- If the state machine forbids a transition that's currently allowed in prod, STOP and widen the matrix.

## 19. Required approval phrase
**APPROVE BATCH 10**

## 20. Exact Claude Code implementation prompt

```
You are working in the repo `noorhanmedical/tertiary-command-center` on macOS.
Path: ~/Projects/tertiary-command-center-replit-sync

GOAL: Add an execution-case state-machine module and a feature-flagged
       transaction wrapper around the six side-effect writes in
       patientCommitService. Default flag value preserves today's behavior.

BRANCH:
  Create branch from main:
    architecture/execution-case-spine

ALLOWED FILES (add):
  server/modules/execution-cases/contracts.ts
  server/modules/execution-cases/repo.ts
  server/modules/execution-cases/service.ts
  server/modules/execution-cases/stateMachine.ts
  server/modules/execution-cases/index.ts
  docs/architecture/execution-case-state-machine.md

ALLOWED FILES (edit — minimal, feature-flagged):
  server/services/patientCommitService.ts (wrap six writes in db.transaction
                                           only when EXECUTION_CASE_TX=1)

FORBIDDEN FILES (do not edit):
  shared/schema/executionCase.ts (and all other shared/schema/*.ts)
  shared/schema/index.ts
  server/routes/engagementAssignmentBoard.ts
  server/routes/outreach.ts
  client/**
  server/storage.ts, server/db.ts
  migrations/**
  package.json, package-lock.json, .env*

PROTECTED FLOWS:
  Plexus IQ commit → execution case creation
  Engagement Center board + bulk assignment (conflict guard preserved)
  Team Portals (read execution cases)
  Scheduler Portal
  Outreach call atomic write

EXACT IMPLEMENTATION REQUIREMENTS:
  1. stateMachine.ts enumerates every legal (from, to) transition for
     lifecycleStatus, engagementStatus, engagementBucket, qualificationStatus.
     Each transition is a function that delegates to executionCase.repo.ts.
  2. The state machine MUST permit every transition the existing code already
     performs. Verify by reading patientCommitService.ts and
     engagementAssignmentBoard.ts.
  3. In patientCommitService.ts, add an EXECUTION_CASE_TX env check.
       - Flag value '1' → wrap the six writes in db.transaction.
       - Anything else → unchanged behavior (fire-and-forget).
     Default flag value (when unset): unchanged behavior.
  4. design doc captures the transition matrix and the rollback steps.
  5. Do not add any FK constraint or migration.
  6. Do not change conflict-guard logic.

VALIDATION:
  npm run check
  npm run build
  node scripts/qa-navigation-dock-home-tiles.mjs
  node scripts/qa-command-center-architecture.mjs
  node scripts/qa-visit-outreach-tile-parity.mjs
  node scripts/qa-plexus-iq-interior.mjs
  node scripts/qa-plexus-iq-backend.mjs
  node scripts/qa-team-portals-restore.mjs
  node scripts/qa-team-portal-workspace-engine.mjs
  node scripts/qa-engagement-assignment-runtime.mjs

MANUAL QA CHECKLIST:
  - Flag off (default): import + commit one patient via Plexus IQ. Execution
    case exists. Engagement board lists the patient.
  - Flag on: same scenario. Same result. Force a repo error mid-flow (e.g.,
    a temporary throw in a non-critical repo call) and confirm the
    transaction rolls back with no orphan execution case.
  - Engagement Center conflict guard still fires on the same dupe.
  - Team Portal reads the patient through the existing path.

COMMIT MESSAGE:
  Add execution-case state machine and feature-flagged tx wrapper (Batch 10)

FINAL REPORT FORMAT:
  Branch: <branch>
  Files changed: <list>
  App source untouched: no (patientCommitService.ts edited; tx flag default off)
  npm run check: <pass/fail>
  npm run build: <pass/fail>
  QA scripts: <8/8 pass | list failures>
  Manual QA (flag off): <pass/fail per item>
  Manual QA (flag on): <pass/fail per item>
  Blocked items: <none | list>
  Behavior changes (UI/API): none (default flag preserves today's behavior)

STOP CONDITIONS:
  - Any tx deadlock under single-user smoke → STOP and revert.
  - Any forbidden transition that production currently performs → STOP and
    widen the matrix.

DO NOT push unless the user explicitly says "push" or "open the PR".
```

---

# Batch 11 — Team Task spine

## 1. Purpose
Unify today's parallel "task" models (`plexus_tasks`, `scheduler_assignments`) behind a **read-only** `TeamTask` view. Portals continue to use their existing data sources; the new view is opt-in for new code.

## 2. Why this batch exists
Engagement Center, Scheduler Portal, and Team Portals each compute their own task lists. The data is the same; the shapes are not. A single typed `TeamTask` read view (no writes, no DB changes) makes future portal consolidation safe.

## 3. Current repo areas to inspect
- `shared/schema/plexus.ts` (`plexus_tasks`, `plexus_task_collaborators`, `plexus_task_messages`, `plexus_task_events`, `plexus_task_reads`)
- `shared/schema/outreach.ts` (`scheduler_assignments`, lines 75–115)
- `server/routes/plexusTasks.ts` (if present) and `server/services/*` task-related
- `server/services/callListEngine.ts`, `callListPriority.ts`
- `client/src/components/portal/PortalShell.tsx`, `TeamPortalShell.tsx`
- `client/src/lib/workflow/teamMemberWorkspaceApi.ts`
- `client/src/lib/portal/commandCenterApi.ts`

## 4. Current risks
- A union view that loses fields existing portals rely on (e.g., scheduler-assignment-specific status names) will silently break Scheduler Portal reads.
- Adding a write helper in this batch (forbidden) could double-write into both models.
- Changing the absence-watcher's task creation pattern is out of scope and would break the auto-redistribute timer.

## 5. Protected flows at risk
- Team Portal patient list, schedule, tasks
- Scheduler Portal
- Engagement Center
- Absence alerts / auto-redistribute

## 6. Batch type
**code-safe**

## 7. Risk level
**low-medium**

## 8. Safety conditions before implementation
- Batch 10 merged.
- A mapping table between `plexus_tasks.type` values and `scheduler_assignments` rows is documented.
- No portal route is migrated to the new view in this batch.

## 9. Allowed changes
- Add `server/modules/team-tasks/` with `contracts.ts`, `repo.ts`, `service.ts`.
- Add `getTeamTaskView(userId, { facility, scope })` read helper.
- Add `docs/architecture/team-task-spine-design.md`.

## 10. Forbidden changes
- No edits to `shared/schema/plexus.ts` or `shared/schema/outreach.ts`.
- No new task tables.
- No new migration.
- No edits to absence-watcher, `morningRebuildScheduler`, `callListEngine`, `callListPriority`.
- No client edits.

## 11. Likely files touched
- `server/modules/team-tasks/contracts.ts`, `repo.ts`, `service.ts`, `index.ts` (new)
- `docs/architecture/team-task-spine-design.md` (new)

## 12. Files/functions/routes that should not be touched
- `shared/schema/plexus.ts`, `shared/schema/outreach.ts`
- `server/services/absenceWatcher.ts`, `morningRebuildScheduler.ts`
- `server/services/callListEngine.ts`, `callListPriority.ts`
- `client/src/components/portal/*`
- All migrations

## 13. Implementation approach
1. Read both schemas. Build a union `TeamTask` type covering: id, ownerType (`'plexus_task' | 'scheduler_assignment'`), assigneeId, facility, dueAt, status, source.
2. Implement the read helper as two queries unioned in code (no SQL union).
3. Document the mapping table per task type.
4. Do not wire any portal to the new view.

## 14. Required compatibility rules
- Preserve API response shapes (no API touched).
- Preserve test IDs (no UI touched).
- Preserve UI markup.
- Preserve PDF data source.
- Preserve canonical reasoning.
- Preserve existing routes.
- Add wrappers before replacing code.

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs
```

## 16. Manual QA checklist
- Team Portals load patient list, schedule, tasks tabs.
- Scheduler Portal lists assignments.
- Absence alerts continue to fire on a synthetic absence event.
- `morningRebuildScheduler` runs without error.

## 17. Rollback plan
- `git rm -r server/modules/team-tasks/` and the design doc.

## 18. Stop conditions
- If the union loses fields used by Scheduler Portal, STOP and widen the contract.
- If anyone wires a portal to the new view in this batch, STOP.

## 19. Required approval phrase
**APPROVE BATCH 11**

## 20. Exact Claude Code implementation prompt

```
You are working in the repo `noorhanmedical/tertiary-command-center` on macOS.
Path: ~/Projects/tertiary-command-center-replit-sync

GOAL: Add a read-only TeamTask union view across plexus_tasks and
       scheduler_assignments. No schema changes. No portal wiring.

BRANCH:
  Create branch from main:
    architecture/team-task-spine

ALLOWED FILES (add):
  server/modules/team-tasks/contracts.ts
  server/modules/team-tasks/repo.ts
  server/modules/team-tasks/service.ts
  server/modules/team-tasks/index.ts
  docs/architecture/team-task-spine-design.md

FORBIDDEN FILES (do not edit):
  shared/schema/plexus.ts, shared/schema/outreach.ts
  All other shared/schema/*.ts and shared/schema/index.ts
  server/services/absenceWatcher.ts, morningRebuildScheduler.ts,
    callListEngine.ts, callListPriority.ts
  client/**
  All migrations/**
  package.json, package-lock.json, .env*

PROTECTED FLOWS:
  Team Portals (patient list, schedule, tasks)
  Scheduler Portal
  Engagement Center
  Absence alerts / auto-redistribute

EXACT IMPLEMENTATION REQUIREMENTS:
  1. contracts.ts defines TeamTask { id, ownerType, assigneeId, facility,
     dueAt, status, source } covering both plexus_tasks and scheduler_assignments.
  2. repo.ts implements two queries (one per source) and returns the union
     mapped to TeamTask in code (no SQL UNION).
  3. service.ts exports getTeamTaskView(userId, { facility, scope }).
  4. design doc lists the mapping table per plexus_tasks.type value and per
     scheduler_assignments row.
  5. Do not wire any portal to the new view.

VALIDATION:
  npm run check
  npm run build
  node scripts/qa-navigation-dock-home-tiles.mjs
  node scripts/qa-command-center-architecture.mjs
  node scripts/qa-visit-outreach-tile-parity.mjs
  node scripts/qa-plexus-iq-interior.mjs
  node scripts/qa-plexus-iq-backend.mjs
  node scripts/qa-team-portals-restore.mjs
  node scripts/qa-team-portal-workspace-engine.mjs
  node scripts/qa-engagement-assignment-runtime.mjs

MANUAL QA CHECKLIST:
  - Team Portals load patient list, schedule, tasks tabs.
  - Scheduler Portal lists assignments.
  - Absence alerts fire on a synthetic event.
  - morningRebuildScheduler runs without error.

COMMIT MESSAGE:
  Add team-task union read view and design doc (Batch 11)

FINAL REPORT FORMAT:
  Branch: <branch>
  Files changed: <list>
  App source untouched: yes (new module only; no portals wired)
  npm run check: <pass/fail>
  npm run build: <pass/fail>
  QA scripts: <8/8 pass | list failures>
  Manual QA: <pass/fail per item>
  Blocked items: <none | list>
  Behavior changes (UI/API): none

STOP CONDITIONS:
  - Union loses fields used by Scheduler Portal → STOP and widen.
  - Any portal wired to the new view → STOP.

DO NOT push unless the user explicitly says "push" or "open the PR".
```

---

# Batch 12 — Journey event / audit standardization

## 1. Purpose
Centralize journey-event and audit-log writes behind a single typed writer. **Add missing events only after the writer is in place; do not change existing events' shape.** Default is to log additively.

## 2. Why this batch exists
`patient_journey_events` is written explicitly in `patientCommitService.ts`, `engagementAssignmentBoard.ts`, and `outreach.ts`. Coverage is uneven: admin-review approval, regenerate-all, ICD edits, billing status changes, invoice payments do not append journey events. `audit_log` is best-effort and called inconsistently. No central event bus, no replay.

## 3. Current repo areas to inspect
- `shared/schema/executionCase.ts` (`patient_journey_events`)
- `shared/schema/auditLog.ts` (if separate) or wherever `audit_log` is defined
- `server/services/auditService.ts`
- `server/services/patientCommitService.ts`
- `server/routes/engagementAssignmentBoard.ts`
- `server/routes/outreach.ts`
- `server/routes/patients.ts` (admin-review handlers — missing events)
- `server/routes/billing.ts`, `invoices.ts` (missing events)

## 4. Current risks
- A central writer that changes the columns / order of existing events will break dashboards or downstream consumers.
- An overly eager rollout that adds events to a hot loop (e.g., `GET /api/billing-records` auto-create) would explode the table.
- Async fire-and-forget writes are easy to lose silently if the writer's error handler is wrong.

## 5. Protected flows at risk
- All flows that already journal (Plexus IQ commit, engagement assignment, outreach calls)
- Admin Review (after new events are added)
- Billing / invoices (after new events are added)

## 6. Batch type
**code-safe** (additive writer) → **code-risky** when wiring missing events

## 7. Risk level
**low-medium**

## 8. Safety conditions before implementation
- Batches 1–4 merged.
- A list of every existing journey-event-kind used by today's code (grep `appendPatientJourneyEvent` and `journey_events`).
- A documented list of "missing" events to add (admin_review_regenerated, admin_review_approved, admin_review_rejected, regenerate_all, billing_record_status_changed, invoice_payment_recorded).

## 9. Allowed changes
- Add `server/platform/audit/journeyEventWriter.ts` (typed writer; one function: `writeJourneyEvent(kind, payload, options?)`).
- Add `server/platform/audit/auditLogWriter.ts` (thin typed wrapper around existing `auditService`).
- Edit existing call sites that already write journey events to call the new writer — same kinds, same payload shape. **Parity only.**
- After parity is verified, add the missing-event writes in 3–5 specific routes / services. Each new event is **additive**.

## 10. Forbidden changes
- No new tables, columns, or migrations.
- No edits to existing event kinds, payload shape, or column order.
- No removal of any existing audit-log call.
- No edits to PDF code, schema, or `server/storage.ts`.

## 11. Likely files touched
- `server/platform/audit/journeyEventWriter.ts` (new)
- `server/platform/audit/auditLogWriter.ts` (new)
- `server/services/patientCommitService.ts` (call-site swap only)
- `server/routes/engagementAssignmentBoard.ts` (call-site swap only)
- `server/routes/outreach.ts` (call-site swap only)
- `server/routes/patients.ts` admin-review handlers (additive new events)
- `server/routes/billing.ts`, `invoices.ts` (additive new events)

## 12. Files/functions/routes that should not be touched
- `shared/schema/executionCase.ts`
- `server/services/screening.ts`, `batchAnalysisRunner.ts`
- All client code
- All migrations

## 13. Implementation approach
1. Build the typed writer. Internally it still calls the same DB write.
2. Swap call sites for parity — confirm DB rows are byte-identical.
3. Add missing events one route at a time. After each, run all QA + manually verify.
4. If event volume grows unexpectedly, add a per-event sampling option.

## 14. Required compatibility rules
- Preserve API response shapes.
- Preserve test IDs.
- Preserve UI markup.
- Preserve PDF data source.
- Preserve canonical reasoning.
- Preserve existing routes.
- **Add wrappers before replacing code** — explicit here.

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs
```

## 16. Manual QA checklist
- After Batch 12 ships, perform: a Plexus IQ commit, an engagement assignment, an outreach call. Confirm the journey events written are identical in shape to pre-batch (column-by-column).
- Admin Review regenerate + approve a patient. Confirm new events appear.
- Record a payment on an invoice. Confirm `invoice_payment_recorded` appears.

## 17. Rollback plan
- Per added event: revert that route's commit.
- Per writer swap: revert that call-site's commit. The writer stays harmless.

## 18. Stop conditions
- Any column or value diff in existing events → STOP and revert the parity swap.
- A 10× spike in event volume in any environment → STOP and quarantine the new event behind a flag.

## 19. Required approval phrase
**APPROVE BATCH 12**

## 20. Exact Claude Code implementation prompt

```
You are working in the repo `noorhanmedical/tertiary-command-center` on macOS.
Path: ~/Projects/tertiary-command-center-replit-sync

GOAL: Centralize journey-event and audit-log writes behind a typed writer.
       Swap existing call sites for parity (no event-shape change). Then add
       a small set of missing events additively.

BRANCH:
  Create branch from main:
    architecture/journey-event-standardization

ALLOWED FILES (add):
  server/platform/audit/journeyEventWriter.ts
  server/platform/audit/auditLogWriter.ts

ALLOWED FILES (edit — call-site swap only, then additive new events):
  server/services/patientCommitService.ts
  server/routes/engagementAssignmentBoard.ts
  server/routes/outreach.ts
  server/routes/patients.ts (admin-review handlers — additive)
  server/routes/billing.ts (additive)
  server/routes/invoices.ts (additive)

FORBIDDEN FILES (do not edit):
  shared/schema/executionCase.ts and all other shared/schema/*.ts
  shared/schema/index.ts
  server/services/screening.ts, batchAnalysisRunner.ts, plexusIq/*
  server/storage.ts, server/db.ts
  client/**
  All migrations/**
  package.json, package-lock.json, .env*

PROTECTED FLOWS:
  Plexus IQ commit, engagement assignment, outreach calls (existing journey
  events). Admin Review and billing/invoices (new additive events must not
  affect UI/API behavior).

EXACT IMPLEMENTATION REQUIREMENTS:
  1. journeyEventWriter.ts exposes writeJourneyEvent(kind, payload, options).
     Internally writes to the existing patient_journey_events table.
  2. auditLogWriter.ts wraps auditService.logAudit() with a typed kind union.
  3. Parity swap: in the three existing journal sites, replace direct writes
     with the typed writer. Confirm DB rows byte-identical (capture before
     and after rows for one Plexus IQ commit and one engagement assignment).
  4. Additive new events (each in a separate commit so any one can be reverted):
       - admin_review_regenerated (server/routes/patients.ts)
       - admin_review_approved (server/routes/patients.ts)
       - admin_review_rejected (server/routes/patients.ts)
       - regenerate_all (server/routes/patients.ts)
       - billing_record_status_changed (server/routes/billing.ts)
       - invoice_payment_recorded (server/routes/invoices.ts)
  5. Do not change any column order, kind name, or payload shape for existing
     events.
  6. Do not write events inside a hot loop (e.g., do NOT write events from
     the billing auto-create scan).

VALIDATION:
  npm run check
  npm run build
  node scripts/qa-navigation-dock-home-tiles.mjs
  node scripts/qa-command-center-architecture.mjs
  node scripts/qa-visit-outreach-tile-parity.mjs
  node scripts/qa-plexus-iq-interior.mjs
  node scripts/qa-plexus-iq-backend.mjs
  node scripts/qa-team-portals-restore.mjs
  node scripts/qa-team-portal-workspace-engine.mjs
  node scripts/qa-engagement-assignment-runtime.mjs

MANUAL QA CHECKLIST:
  - Plexus IQ commit + engagement assignment + outreach call: journey events
    byte-identical to pre-batch.
  - Admin Review regenerate + approve: new events appear with correct kind +
    payload.
  - Invoice payment: invoice_payment_recorded appears.

COMMIT MESSAGE:
  Centralize journey-event/audit writer and add missing events (Batch 12)

FINAL REPORT FORMAT:
  Branch: <branch>
  Files changed: <list>
  App source untouched: no (call-site swaps and additive new events)
  npm run check: <pass/fail>
  npm run build: <pass/fail>
  QA scripts: <8/8 pass | list failures>
  Manual QA: <pass/fail per item>
  Existing event byte-identical: <yes/no — diff if no>
  New events landed: <list>
  Blocked items: <none | list>
  Behavior changes (UI/API): none

STOP CONDITIONS:
  - Any existing event diff → STOP and revert parity swap.
  - Any 10× event-volume spike → STOP and quarantine.

DO NOT push unless the user explicitly says "push" or "open the PR".
```

---

# Batch 13 — Engagement Center read-model optimization

## 1. Purpose
Add **new** paginated / filtered Engagement Center endpoints **alongside** today's. The UI keeps the old endpoint until the new one has parity tests. Old endpoint stays untouched.

## 2. Why this batch exists
`GET /api/engagement/assignment-board` returns all active cases without pagination. As patient count grows this will become the slowest page in the app. Today's UI doesn't expect pagination — so we must not break it while we add the new shape.

## 3. Current repo areas to inspect
- `server/routes/engagementAssignmentBoard.ts` (lines 165–227 read; 388–540 assign)
- `server/services/*` (assignment-related)
- `client/src/components/engagement/EngagementAssignmentBoard.tsx`
- `client/src/hooks/api/engagementBoard.ts` (from Batch 4)
- `shared/contracts/engagementBoard.ts` (from Batch 2)

## 4. Current risks
- Two endpoints serving the same data can drift quickly. Discipline: one is the canonical reader; the other is the legacy snapshot.
- Pagination + filters can mask conflict-guard semantics if the bulk-assign hits a hidden page boundary.

## 5. Protected flows at risk
- Engagement Center (read + bulk assign + conflict guard)

## 6. Batch type
**code-safe** (additive endpoint)

## 7. Risk level
**low**

## 8. Safety conditions before implementation
- Batch 12 merged.
- A parity test compares the new endpoint's first-page result against the legacy endpoint's filtered slice.

## 9. Allowed changes
- Add a new route `GET /api/engagement/assignment-board/v2` (or `?page=` form) with pagination + filters (facility, date range, scheduler, assigned-only).
- Add a new service module under `server/modules/engagement/` consuming `server/modules/execution-cases/` (from Batch 10).
- Add a parity test.

## 10. Forbidden changes
- No edits to the old endpoint.
- No edits to `EngagementAssignmentBoard.tsx` UI yet.
- No conflict-guard changes.
- No migration.

## 11. Likely files touched
- `server/routes/engagementAssignmentBoardV2.ts` (new) **or** a v2 handler co-located inline (preferred, but in a new function)
- `server/modules/engagement/contracts.ts`, `repo.ts`, `service.ts`, `index.ts` (new)
- `server/modules/engagement/__tests__/parity.test.ts` (new)

## 12. Files/functions/routes that should not be touched
- `server/routes/engagementAssignmentBoard.ts` (legacy)
- `client/src/components/engagement/EngagementAssignmentBoard.tsx`
- All schema

## 13. Implementation approach
1. New endpoint: request-shape includes `page`, `pageSize`, `facility`, `dateFrom`, `dateTo`, `scheduler`, `assignedOnly`. Response shape: `{ items: …, page, pageSize, total }`.
2. Reuse the legacy reader's joins. Wrap in `server/modules/engagement/`.
3. Parity test: for a chosen facility + date, the union of all pages on v2 equals the legacy endpoint's filtered slice.
4. Do not point the UI at the new endpoint yet.

## 14. Required compatibility rules
- Preserve API response shapes — explicitly, the legacy endpoint is unchanged.
- Preserve test IDs.
- Preserve UI markup.
- Preserve PDF data source.
- Preserve canonical reasoning.
- **Preserve existing routes** — additive only.
- Add wrappers before replacing code.

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs
npx tsx server/modules/engagement/__tests__/parity.test.ts
```

## 16. Manual QA checklist
- Engagement Center board (legacy endpoint) loads, assigns, unassigns, conflict-guard fires.
- Hit `/api/engagement/assignment-board/v2?facility=X&page=1` via curl; expected page returns with `total`.
- Page through all results; row count equals legacy filtered count.

## 17. Rollback plan
- Remove the new route; remove the new module; remove the parity test.

## 18. Stop conditions
- Parity test diff → STOP; root-cause before merging.
- Any change in legacy endpoint's behavior → STOP and revert.

## 19. Required approval phrase
**APPROVE BATCH 13**

## 20. Exact Claude Code implementation prompt

```
You are working in the repo `noorhanmedical/tertiary-command-center` on macOS.
Path: ~/Projects/tertiary-command-center-replit-sync

GOAL: Add a new paginated/filtered Engagement Center endpoint alongside the
       existing one. UI not switched. Legacy endpoint untouched.

BRANCH:
  Create branch from main:
    architecture/engagement-center-read-model

ALLOWED FILES (add):
  server/routes/engagementAssignmentBoardV2.ts
  server/modules/engagement/contracts.ts
  server/modules/engagement/repo.ts
  server/modules/engagement/service.ts
  server/modules/engagement/index.ts
  server/modules/engagement/__tests__/parity.test.ts

ALLOWED FILES (edit — registration only):
  server/routes.ts or server/index.ts (only to register the new route)

FORBIDDEN FILES (do not edit):
  server/routes/engagementAssignmentBoard.ts (legacy)
  client/src/components/engagement/EngagementAssignmentBoard.tsx
  client/src/hooks/api/engagementBoard.ts
  All shared/schema/*.ts and shared/schema/index.ts
  server/storage.ts, server/db.ts
  All migrations/**
  package.json, package-lock.json, .env*

PROTECTED FLOWS:
  Engagement Center read + bulk assign + conflict guard.

EXACT IMPLEMENTATION REQUIREMENTS:
  1. New endpoint accepts: page, pageSize, facility, dateFrom, dateTo,
     scheduler, assignedOnly. Returns { items, page, pageSize, total }.
  2. Reuse the legacy reader's joins by extracting a query function in
     server/modules/engagement/repo.ts. Do not change the legacy reader.
  3. Parity test: for one canned (facility, date) pair, all pages of v2
     union-equal the legacy slice.
  4. Do not point the UI at the new endpoint.

VALIDATION:
  npm run check
  npm run build
  node scripts/qa-navigation-dock-home-tiles.mjs
  node scripts/qa-command-center-architecture.mjs
  node scripts/qa-visit-outreach-tile-parity.mjs
  node scripts/qa-plexus-iq-interior.mjs
  node scripts/qa-plexus-iq-backend.mjs
  node scripts/qa-team-portals-restore.mjs
  node scripts/qa-team-portal-workspace-engine.mjs
  node scripts/qa-engagement-assignment-runtime.mjs
  npx tsx server/modules/engagement/__tests__/parity.test.ts

MANUAL QA CHECKLIST:
  - Engagement Center UI unchanged (loads, assigns, unassigns, guard fires).
  - curl /api/engagement/assignment-board/v2?facility=X&page=1 → expected
    shape with `total`.
  - Page through all results; count equals legacy filtered count.

COMMIT MESSAGE:
  Add paginated v2 Engagement Center read endpoint (Batch 13)

FINAL REPORT FORMAT:
  Branch: <branch>
  Files changed: <list>
  App source untouched: no (added new module + new route; legacy untouched)
  npm run check: <pass/fail>
  npm run build: <pass/fail>
  QA scripts: <8/8 pass | list failures>
  Parity test: <pass/fail>
  Manual QA: <pass/fail per item>
  Blocked items: <none | list>
  Behavior changes (UI/API): none (additive endpoint only)

STOP CONDITIONS:
  - Parity test diff → STOP.
  - Legacy behavior change → STOP and revert.

DO NOT push unless the user explicitly says "push" or "open the PR".
```

---

# Batch 14 — Plexus IQ read-model optimization

## 1. Purpose
Replace per-batch all-row scans with paginated / aggregated **additive** endpoints. Existing endpoints unchanged. Calendar, workspace, sidebar, bulk-import behavior preserved.

## 2. Why this batch exists
Plexus IQ dashboard recomputes per request. As batches grow, this becomes slow. Adding an aggregate read endpoint (`GET /api/plexus-iq/dashboard-summary/v2`) lets the UI move incrementally later; today's UI stays on the legacy reader.

## 3. Current repo areas to inspect
- `server/routes/plexus.ts` (or whatever holds Plexus IQ reads — confirm via grep)
- `server/services/screening.ts`, `batchAnalysisRunner.ts`
- `server/routes/plexusIqClinicalImport.ts` (write path — do not touch)
- `client/src/components/plexus-iq/PlexusIQWorkspace.tsx`
- `client/src/components/plexus-iq/PlexusIQBulkImportModal.tsx`
- `client/src/lib/plexusIqClinicalImportApi.ts`

## 4. Current risks
- A summary endpoint that drifts from the real per-row count will mislead users about batch status.
- Touching the import path is out of scope and could break MRN stamping.

## 5. Protected flows at risk
- Plexus IQ calendar / workspace
- Plexus IQ bulk import
- Qualification jobs status

## 6. Batch type
**code-safe** (additive)

## 7. Risk level
**low**

## 8. Safety conditions before implementation
- Batches 1–4 merged.
- An inventory of current dashboard queries documented.

## 9. Allowed changes
- Add new aggregate routes (e.g., `GET /api/plexus-iq/dashboard-summary/v2`, `GET /api/plexus-iq/qualification-jobs/v2`) with paging + filters.
- Add `server/modules/plexus-iq/` with contracts/repo/service.

## 10. Forbidden changes
- No edits to existing endpoints.
- No edits to `plexusIqClinicalImport.ts`, `batchAnalysisRunner.ts`, `screening.ts`.
- No client edits.
- No schema or migration.

## 11. Likely files touched
- `server/routes/plexusIqV2.ts` (new) or co-located new handlers
- `server/modules/plexus-iq/contracts.ts`, `repo.ts`, `service.ts`, `index.ts` (new)
- `server/modules/plexus-iq/__tests__/parity.test.ts` (new)

## 12. Files/functions/routes that should not be touched
- `plexusIqClinicalImport.ts`
- `batchAnalysisRunner.ts`
- `screening.ts`
- `PlexusIQWorkspace.tsx`, `PlexusIQBulkImportModal.tsx`, `PlexusIQQualificationJobsStatus.tsx`
- All schema and migrations

## 13. Implementation approach
1. Add the new endpoints; reuse existing repos and services as readers.
2. Parity test against the existing reader for one batch.
3. UI does not switch.

## 14. Required compatibility rules
- Preserve API response shapes.
- Preserve test IDs.
- Preserve UI markup.
- Preserve PDF data source.
- Preserve canonical reasoning.
- Preserve existing routes (additive only).
- Add wrappers before replacing code.

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs
npx tsx server/modules/plexus-iq/__tests__/parity.test.ts
```

## 16. Manual QA checklist
- Plexus IQ calendar, workspace, sidebar render unchanged.
- Bulk import flow unchanged.
- Qualification jobs status unchanged.
- New endpoints return expected aggregates via curl.

## 17. Rollback plan
- Remove new endpoints and module.

## 18. Stop conditions
- Any legacy behavior change → STOP.
- Parity test diff → STOP.

## 19. Required approval phrase
**APPROVE BATCH 14**

## 20. Exact Claude Code implementation prompt

```
You are working in the repo `noorhanmedical/tertiary-command-center` on macOS.
Path: ~/Projects/tertiary-command-center-replit-sync

GOAL: Add additive aggregated/paginated read endpoints for Plexus IQ. UI not
       switched. Existing endpoints untouched.

BRANCH:
  Create branch from main:
    architecture/plexus-iq-read-model

ALLOWED FILES (add):
  server/routes/plexusIqV2.ts
  server/modules/plexus-iq/contracts.ts
  server/modules/plexus-iq/repo.ts
  server/modules/plexus-iq/service.ts
  server/modules/plexus-iq/index.ts
  server/modules/plexus-iq/__tests__/parity.test.ts

ALLOWED FILES (edit — registration only):
  server/routes.ts or server/index.ts (only to register the new route)

FORBIDDEN FILES (do not edit):
  server/routes/plexusIqClinicalImport.ts
  server/services/batchAnalysisRunner.ts
  server/services/screening.ts
  client/src/components/plexus-iq/*
  client/src/lib/plexusIqClinicalImportParser.ts
  client/src/lib/plexusIqClinicalImportApi.ts
  All shared/schema/*.ts and shared/schema/index.ts
  server/storage.ts, server/db.ts
  All migrations/**
  package.json, package-lock.json, .env*

PROTECTED FLOWS:
  Plexus IQ calendar/workspace/sidebar
  Plexus IQ bulk import
  Qualification jobs status

EXACT IMPLEMENTATION REQUIREMENTS:
  1. Add new aggregate endpoints alongside existing ones (e.g.,
     /api/plexus-iq/dashboard-summary/v2, /api/plexus-iq/qualification-jobs/v2).
  2. Reuse existing repos; do not change them. Wrap in
     server/modules/plexus-iq/.
  3. Parity test: for one batch, the new endpoint's totals equal the legacy
     count.
  4. Do not switch the UI.

VALIDATION:
  npm run check
  npm run build
  node scripts/qa-navigation-dock-home-tiles.mjs
  node scripts/qa-command-center-architecture.mjs
  node scripts/qa-visit-outreach-tile-parity.mjs
  node scripts/qa-plexus-iq-interior.mjs
  node scripts/qa-plexus-iq-backend.mjs
  node scripts/qa-team-portals-restore.mjs
  node scripts/qa-team-portal-workspace-engine.mjs
  node scripts/qa-engagement-assignment-runtime.mjs
  npx tsx server/modules/plexus-iq/__tests__/parity.test.ts

MANUAL QA CHECKLIST:
  - Plexus IQ calendar, workspace, sidebar unchanged.
  - Bulk import unchanged.
  - Qualification jobs status unchanged.
  - New endpoints return expected aggregates via curl.

COMMIT MESSAGE:
  Add additive paginated Plexus IQ read endpoints (Batch 14)

FINAL REPORT FORMAT:
  Branch: <branch>
  Files changed: <list>
  App source untouched: no (additive routes + module)
  npm run check: <pass/fail>
  npm run build: <pass/fail>
  QA scripts: <8/8 pass | list failures>
  Parity test: <pass/fail>
  Manual QA: <pass/fail per item>
  Blocked items: <none | list>
  Behavior changes (UI/API): none (additive only)

STOP CONDITIONS:
  - Any legacy behavior change → STOP.
  - Parity diff → STOP.

DO NOT push unless the user explicitly says "push" or "open the PR".
```

---

# Batch 15 — Admin Review modularization

## 1. Purpose
Split `AdminReviewDialog.tsx` (4,230 lines) into focused sub-components: `ApprovalPanel`, `EvidencePanel`, `ClinicalEditor`, `ReasoningEditor`, `SiblingNav`, `AuditLog`. Preserve every `data-testid`, every regenerate endpoint, sibling Next/Prev, PDF preview, "Updates Made In Patient" log, ICD chips, under-16 guardrails, OpenAI regeneration.

## 2. Why this batch exists
`AdminReviewDialog.tsx` is the riskiest file in the front-end. Its sibling navigation auto-advances, its regenerate endpoints update specific reasoning keys, and its PDF preview reuses the same shared `lib/pdfGeneration.ts`. Without modularization, every subsequent batch that touches qualification UI is dangerous.

## 3. Current repo areas to inspect
- `client/src/components/qualification/AdminReviewDialog.tsx`
- `client/src/components/qualification/AdminApprovalControl.tsx`
- `client/src/components/qualification/PatientPdfActions.tsx`
- `client/src/components/qualification/ChangeEngagementAssignmentDialog.tsx`
- `client/src/lib/adminReviewStatus.ts`
- `client/src/hooks/api/adminReview.ts` (from Batch 4)
- `shared/contracts/adminReviewStatus.ts`, `reasoning.ts` (from Batch 2)
- `server/routes/patients.ts` admin-review handlers

## 4. Current risks
- This is the highest-risk UI refactor in the plan. Any test-id rename, JSX wrap change, or hook reorder can break QA scripts or break the regenerate flow.
- The "Updates Made In Patient" change log is a UI-only feature with its own subtle invariants.
- PDF preview reuse means a small handler change in this file can affect Clinician PDF and Plexus PDF.

## 5. Protected flows at risk
- Admin Review (every sub-flow)
- Clinician PDF
- Plexus PDF
- Selected patient PDF actions
- Engagement Center (uses Admin Review state)

## 6. Batch type
**code-risky** (split into review-only sub-batches)

## 7. Risk level
**high**

## 8. Safety conditions before implementation
- Batches 1, 2, 3, 4, 7 (PDF protection), 8 (qualification cleanup), 12 (audit) all merged.
- A PDF baseline snapshot exists (Batch 9 deliverable).
- A full manual-QA recording of Admin Review captured pre-batch.
- A sub-batch plan exists (one component-extract per PR):
  - 15a: extract `SiblingNav` (lowest risk)
  - 15b: extract `AuditLog` ("Updates Made In Patient")
  - 15c: extract `ApprovalPanel`
  - 15d: extract `EvidencePanel`
  - 15e: extract `ReasoningEditor`
  - 15f: extract `ClinicalEditor`
- Each sub-batch is its own PR with its own approval.

## 9. Allowed changes
- Per sub-batch: add the new sub-component file under `client/src/components/qualification/admin-review/`, and edit `AdminReviewDialog.tsx` to render it in place of the inline block. Preserve every `data-testid`, prop, and dependency array.

## 10. Forbidden changes
- No edits to `pdfGeneration.ts`, `pdfPacketGrouping.ts`.
- No edits to `PatientPdfActions.tsx`, `AdminApprovalControl.tsx`, `ChangeEngagementAssignmentDialog.tsx`.
- No backend changes (admin-review endpoints stay byte-identical).
- No `qk` key changes.
- No QA-script `data-testid` value changes.

## 11. Likely files touched
- `client/src/components/qualification/admin-review/SiblingNav.tsx` (new, 15a)
- `client/src/components/qualification/admin-review/AuditLog.tsx` (new, 15b)
- `client/src/components/qualification/admin-review/ApprovalPanel.tsx` (new, 15c)
- `client/src/components/qualification/admin-review/EvidencePanel.tsx` (new, 15d)
- `client/src/components/qualification/admin-review/ReasoningEditor.tsx` (new, 15e)
- `client/src/components/qualification/admin-review/ClinicalEditor.tsx` (new, 15f)
- `client/src/components/qualification/AdminReviewDialog.tsx` (incremental per-sub-batch shrink)

## 12. Files/functions/routes that should not be touched
- All files listed in §10 above
- All server code
- All schema and migrations

## 13. Implementation approach
1. **Sub-batch 0 (review-only):** Identify every `data-testid` in `AdminReviewDialog.tsx`. Document a "block map" — which inline JSX block becomes which sub-component, with surrounding event handlers and dependencies. Ship this as `docs/architecture/admin-review-block-map.md`. **No code change.**
2. **Sub-batch 15a (SiblingNav):** Move sibling Next/Prev logic. Keep the auto-advance behavior. Run all QA + manual flow.
3. Repeat for 15b–15f. After each, the parent file shrinks; the protected behaviors stay.

## 14. Required compatibility rules
- **Preserve test IDs** (every QA-script-referenced id).
- **Preserve UI markup** (no extra wrappers).
- Preserve API response shapes.
- **Preserve PDF data source.**
- **Preserve canonical reasoning** (every regenerate path).
- Preserve existing routes.
- Add wrappers before replacing code.

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs

# Test-id parity:
grep -c 'data-testid' client/src/components/qualification/AdminReviewDialog.tsx
grep -rc 'data-testid' client/src/components/qualification/admin-review/
```

## 16. Manual QA checklist
- Open Admin Review on one patient. Click every supporting button. Confirm UI matches pre-batch screenshot.
- Per-ancillary regenerate runs and updates only that ancillary's panel.
- Regenerate-all preserves admin-review overrides.
- Sibling Next/Prev auto-advances after approve (the existing behavior).
- ICD chips render unchanged.
- Under-16 guardrails fire on a fictional 14-year-old.
- OpenAI regeneration completes (one full request).
- Clinician PDF + Plexus PDF visual identity vs. pre-batch.
- "Updates Made In Patient" change log entries appear in identical order.

## 17. Rollback plan
- Per sub-batch revert. The orchestrator branch tag captures the previous parent file state.

## 18. Stop conditions
- Any `data-testid` count or value diff in the touched files → STOP and revert that sub-batch.
- Any QA script regresses → STOP and revert.
- Any visible UI change → STOP and revert.
- Any change in regenerate-all behavior re: existing overrides → STOP and revert.
- Any PDF visual diff → STOP and revert.

## 19. Required approval phrase
**APPROVE BATCH 15** (and a separate **APPROVE BATCH 15a**, **15b**, etc. per sub-batch)

## 20. Exact Claude Code implementation prompt

```
You are working in the repo `noorhanmedical/tertiary-command-center` on macOS.
Path: ~/Projects/tertiary-command-center-replit-sync

GOAL: Modularize AdminReviewDialog.tsx into focused sub-components, one
       sub-batch at a time. Preserve every data-testid, JSX node, prop
       signature, and behavior, including: supporting buttons; qualifying
       factors; per-ancillary regenerate; regenerate-all; canonical reasoning;
       Clinician PDF; Plexus PDF; selected patient PDF actions; under-16
       guardrails; ICD-needed behavior; OpenAI regeneration.

       This prompt covers one sub-batch at a time. Pick the sub-batch from:
       15a SiblingNav | 15b AuditLog | 15c ApprovalPanel | 15d EvidencePanel |
       15e ReasoningEditor | 15f ClinicalEditor.

       The user must approve each sub-batch separately.

BRANCH:
  Create branch from main:
    architecture/admin-review-modularization-<sub-letter>
  Example: architecture/admin-review-modularization-15a

ALLOWED FILES (add — one per sub-batch):
  client/src/components/qualification/admin-review/<ComponentName>.tsx

ALLOWED FILES (edit — minimal swap only):
  client/src/components/qualification/AdminReviewDialog.tsx (replace one
    inline JSX block + its handlers with the new sub-component import +
    usage; nothing else changes)

FORBIDDEN CHANGES IN ALLOWED FILES:
  - No data-testid added, removed, or changed.
  - No JSX node added beyond the sub-component wrapper.
  - No prop signature or default-prop change on AdminReviewDialog itself.
  - No useEffect / useMemo dependency array change.
  - No `qk` key added.
  - No hook reorder.

FORBIDDEN FILES (do not touch):
  client/src/components/qualification/PatientPdfActions.tsx
  client/src/components/qualification/AdminApprovalControl.tsx
  client/src/components/qualification/ChangeEngagementAssignmentDialog.tsx
  client/src/lib/pdfGeneration.ts
  client/src/lib/pdfPacketGrouping.ts
  client/src/lib/adminReviewStatus.ts (read only)
  client/src/hooks/api/adminReview.ts (read only)
  All server/, shared/, migrations/.
  package.json, package-lock.json, .env*

PROTECTED FLOWS:
  Admin Review: supporting buttons, qualifying factors, per-ancillary
    regenerate, regenerate-all, sibling Next/Prev, admin approval, ICD chips,
    under-16 guardrails, OpenAI regeneration.
  Clinician PDF, Plexus PDF, selected patient PDF actions.
  Engagement Center (uses Admin Review state).

EXACT IMPLEMENTATION REQUIREMENTS (per sub-batch):
  1. Capture pre-batch test-id count in AdminReviewDialog.tsx via
       grep -c 'data-testid' client/src/components/qualification/AdminReviewDialog.tsx
  2. Implement the new sub-component containing the moved JSX and handlers.
     Props are explicit — pass every state/setter/handler the original block
     used. Do not introduce a context.
  3. In AdminReviewDialog.tsx, replace ONLY the original inline block with
     <ComponentName ...props />. Do not touch any other block.
  4. Capture post-batch test-id count in BOTH files (parent + new sub-component).
     The sum must equal the pre-batch count.
  5. Run all QA + manual checklist. If anything regresses, revert this
     sub-batch and STOP.

VALIDATION:
  npm run check
  npm run build
  node scripts/qa-navigation-dock-home-tiles.mjs
  node scripts/qa-command-center-architecture.mjs
  node scripts/qa-visit-outreach-tile-parity.mjs
  node scripts/qa-plexus-iq-interior.mjs
  node scripts/qa-plexus-iq-backend.mjs
  node scripts/qa-team-portals-restore.mjs
  node scripts/qa-team-portal-workspace-engine.mjs
  node scripts/qa-engagement-assignment-runtime.mjs

  # Test-id parity:
  grep -c 'data-testid' client/src/components/qualification/AdminReviewDialog.tsx
  grep -rc 'data-testid' client/src/components/qualification/admin-review/

MANUAL QA CHECKLIST:
  - Open Admin Review on one patient.
  - Click every supporting button; identical UI vs. pre-batch screenshot.
  - Per-ancillary regenerate: updates only the chosen ancillary's panel.
  - Regenerate-all: preserves prior admin-review overrides.
  - Sibling Next/Prev auto-advances after approve.
  - ICD chips render unchanged.
  - Under-16 guardrails fire on a fictional 14-year-old.
  - OpenAI regeneration completes (one full request).
  - Clinician PDF + Plexus PDF visual identity vs. pre-batch.
  - "Updates Made In Patient" log entries appear in identical order.

COMMIT MESSAGE:
  Modularize AdminReviewDialog: extract <ComponentName> (Batch 15<letter>)

FINAL REPORT FORMAT:
  Branch: <branch>
  Files changed: <list>
  App source untouched: no (one component extracted; parent shrunk)
  npm run check: <pass/fail>
  npm run build: <pass/fail>
  QA scripts: <8/8 pass | list failures>
  test-id parity (sum pre vs sum post): <equal | diff with N>
  Manual QA: <pass/fail per item>
  PDF visual diff: <none | description>
  Blocked items: <none | list>
  Behavior changes (UI/API): none

STOP CONDITIONS:
  - test-id parity diff → STOP and revert this sub-batch.
  - Any QA script regression → STOP and revert.
  - Any visible UI change → STOP and revert.
  - Any change in regenerate-all override-preservation → STOP and revert.
  - Any PDF visual diff → STOP and revert.

DO NOT push unless the user explicitly says "push" or "open the PR".
```

---

# Batch 16 — Documents / reports storage abstraction

## 1. Purpose
Confirm and consolidate the storage abstraction (`server/integrations/fileStorage.ts`) so production runs on S3 by default. Add a one-shot migration script (Drive → S3) with provenance markers. Do not delete Drive data.

## 2. Why this batch exists
`fileStorage.ts` already picks `google_drive` (default) or `s3` via `STORAGE_PROVIDER`. The S3 path uses `@aws-sdk/client-s3` + presigned URLs. `validateEnv.ts` enforces S3 in production unless explicitly allowed. The actual prod cutover hasn't happened — no migration script, no `documents.sourceNotes` provenance for moved blobs.

## 3. Current repo areas to inspect
- `server/integrations/fileStorage.ts`
- `server/integrations/s3FileStorage.ts`
- `server/integrations/googleDrive.ts` (or equivalent)
- `server/lib/validateEnv.ts`
- `server/routes/documentLibrary.ts` (migration-on-read)
- `shared/schema/documents.ts`
- `script/` for any existing migration scripts

## 4. Current risks
- A migration script that overwrites Drive blobs would delete patient documents.
- Failing to mark migrated rows with provenance creates an audit gap.
- Forcing `STORAGE_PROVIDER=s3` in dev would break local dev where S3 creds are absent.

## 5. Protected flows at risk
- Document library upload / download
- Patient document upload
- Generated notes Drive link
- Report upload

## 6. Batch type
**code-safe** (abstraction confirmation) + **migration-implementation** (one-shot Drive→S3 script with provenance)

## 7. Risk level
**low-medium**

## 8. Safety conditions before implementation
- An S3 bucket exists for prod with the correct lifecycle policy.
- `validateEnv.ts` enforces S3 only in `NODE_ENV=production`.
- A backup of the Drive folder structure is in place.

## 9. Allowed changes
- Small edits to `server/lib/validateEnv.ts` to clarify error messages (no behavior change).
- Small edits to `server/integrations/fileStorage.ts` to add explicit logging of the chosen provider at boot (no behavior change).
- Add `script/migrate-drive-to-s3.ts` (manual run; not a route; not auto-run).
- Add `docs/architecture/storage-cutover.md`.

## 10. Forbidden changes
- No edits to `googleDrive.ts` or `s3FileStorage.ts` runtime paths.
- No edits to `documentLibrary.ts` migration-on-read.
- No schema or migration changes.
- No deletion of any Drive blob in code.

## 11. Likely files touched
- `server/lib/validateEnv.ts` (clarify error messages)
- `server/integrations/fileStorage.ts` (boot log only)
- `script/migrate-drive-to-s3.ts` (new)
- `docs/architecture/storage-cutover.md` (new)

## 12. Files/functions/routes that should not be touched
- `server/integrations/s3FileStorage.ts`, `googleDrive.ts`
- `server/routes/documentLibrary.ts`
- `shared/schema/documents.ts`

## 13. Implementation approach
1. Add boot-log + clarify error messages. Confirm `STORAGE_PROVIDER=s3` still works on a staging env.
2. Write a one-shot migration script that lists Drive blobs in scope, downloads each, uploads to S3 with the same key pattern, and updates `documents.sourceNotes` with `migrated_from=drive:<fileId> at=<ISO>`.
3. The script is idempotent: a re-run skips already-migrated documents.
4. The script does NOT delete from Drive.
5. Document the cutover plan with rollback (set `STORAGE_PROVIDER=google_drive`).

## 14. Required compatibility rules
- Preserve API response shapes.
- Preserve test IDs.
- Preserve UI markup.
- Preserve PDF data source.
- Preserve canonical reasoning.
- Preserve existing routes.
- **Add wrappers before replacing code** — keep both providers operational.

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs

# Migration smoke (staging only):
STORAGE_PROVIDER=s3 npx tsx script/migrate-drive-to-s3.ts --dry-run
```

## 16. Manual QA checklist
- Document upload on staging: confirm blob lands in S3.
- Document download for a migrated document: confirm presigned URL works.
- Document upload on local dev (`STORAGE_PROVIDER=google_drive`): unchanged.
- Provenance: pick one migrated document; confirm `documents.sourceNotes` has `migrated_from=drive:...`.

## 17. Rollback plan
- Set `STORAGE_PROVIDER=google_drive` and redeploy. Existing S3 blobs remain accessible via presigned URL.

## 18. Stop conditions
- If the script can delete from Drive in any code path, STOP and remove.
- If migration is not idempotent, STOP and add `documents.sourceNotes` check.
- If presigned URLs expire before 24h in prod, STOP and re-check config.

## 19. Required approval phrase
**APPROVE BATCH 16**

## 20. Exact Claude Code implementation prompt

```
You are working in the repo `noorhanmedical/tertiary-command-center` on macOS.
Path: ~/Projects/tertiary-command-center-replit-sync

GOAL: Add a one-shot Drive → S3 migration script with provenance. Confirm
       storage abstraction. No production-default behavior change. Do not
       delete any Drive blob in code.

BRANCH:
  Create branch from main:
    architecture/storage-cutover

ALLOWED FILES (add):
  script/migrate-drive-to-s3.ts
  docs/architecture/storage-cutover.md

ALLOWED FILES (edit — minimal):
  server/lib/validateEnv.ts (clarify error messages only)
  server/integrations/fileStorage.ts (boot-time provider log only)

FORBIDDEN FILES (do not edit):
  server/integrations/s3FileStorage.ts
  server/integrations/googleDrive.ts (or equivalent)
  server/routes/documentLibrary.ts
  shared/schema/documents.ts and all other shared/schema/*.ts
  shared/schema/index.ts
  client/**
  All migrations/**
  package.json, package-lock.json, .env*

PROTECTED FLOWS:
  Document library upload/download, patient document upload, generated notes,
  report upload.

EXACT IMPLEMENTATION REQUIREMENTS:
  1. script/migrate-drive-to-s3.ts:
       - --dry-run flag prints actions without writing.
       - For each in-scope Drive blob: download → S3 upload (same key pattern
         used by s3FileStorage.ts) → update documents.sourceNotes with
         migrated_from=drive:<fileId> at=<ISO>.
       - Idempotent: skip rows whose sourceNotes already contain migrated_from.
       - Never delete from Drive.
  2. validateEnv.ts: improve the error message when STORAGE_PROVIDER is missing
     in production. Do not change which environments require S3.
  3. fileStorage.ts: log "[storage] provider=s3" or "[storage] provider=google_drive"
     once at boot.
  4. docs/architecture/storage-cutover.md describes:
       - cutover plan (env flip)
       - rollback (env flip back)
       - bucket / lifecycle requirements
       - PHI considerations

VALIDATION:
  npm run check
  npm run build
  node scripts/qa-navigation-dock-home-tiles.mjs
  node scripts/qa-command-center-architecture.mjs
  node scripts/qa-visit-outreach-tile-parity.mjs
  node scripts/qa-plexus-iq-interior.mjs
  node scripts/qa-plexus-iq-backend.mjs
  node scripts/qa-team-portals-restore.mjs
  node scripts/qa-team-portal-workspace-engine.mjs
  node scripts/qa-engagement-assignment-runtime.mjs

  # Staging only:
  STORAGE_PROVIDER=s3 npx tsx script/migrate-drive-to-s3.ts --dry-run

MANUAL QA CHECKLIST:
  - Staging upload → blob in S3.
  - Migrated-document download → presigned URL works.
  - Local dev (google_drive) unchanged.
  - Provenance: sourceNotes contains migrated_from=drive:...

COMMIT MESSAGE:
  Add Drive→S3 migration script and storage cutover doc (Batch 16)

FINAL REPORT FORMAT:
  Branch: <branch>
  Files changed: <list>
  App source untouched: no (validateEnv.ts message + fileStorage.ts boot log)
  npm run check: <pass/fail>
  npm run build: <pass/fail>
  QA scripts: <8/8 pass | list failures>
  Migration script dry-run on staging: <pass/fail>
  Manual QA: <pass/fail per item>
  Blocked items: <none | list>
  Behavior changes (UI/API): none

STOP CONDITIONS:
  - Any code path that deletes from Drive → STOP and remove.
  - Migration not idempotent → STOP and add provenance check.
  - Presigned URL TTL regression → STOP and re-check config.

DO NOT push unless the user explicitly says "push" or "open the PR".
```

---

# Batch 17 — Billing / invoice architecture cleanup

## 1. Purpose
**Review-first.** Document the parallel state machines (`completed_billing_packages.packageStatus` ↔ `invoices.status`) and the `billing_records` auto-create scan. Design the cleanup (claims, remittances, denials, billing-readiness gate). No code change in this batch beyond optional read-only helpers.

## 2. Why this batch exists
Today: two parallel state machines with no DB-level alignment; the `billing_records` auto-create scan runs on every read of `GET /api/billing-records`. The billing flows work but are fragile. A code cleanup before the design is ready would damage live revenue flows.

## 3. Current repo areas to inspect
- `shared/schema/billing.ts`, `invoices.ts`
- `server/routes/billing.ts`, `invoices.ts`
- `server/repositories/billing.repo.ts`, `invoices.repo.ts`
- `server/services/billingAutoCreateService.ts` (from Batch 3, if shipped)
- `client/src/pages/billing.tsx`, `invoices.tsx`
- `server/services/auditService.ts` (audit calls in billing)

## 4. Current risks
- Aligning the two state machines without a feature flag could leave a package showing `invoiced` while its invoice is `Draft`.
- The auto-create scan is read-as-write; making it write-only requires a migration of legacy data first.
- Any cleanup that changes invoice email semantics could double-send.

## 5. Protected flows at risk
- Billing list page
- Invoice creation
- Invoice payment
- Invoice email
- Projected invoices

## 6. Batch type
**review-only**

## 7. Risk level
**low** (this batch); the future implementation batch is **high**.

## 8. Safety conditions before implementation
- Batch 3 shipped (billing auto-create wrapper exists).
- Batch 12 shipped (audit writer exists).

## 9. Allowed changes
- Add `docs/architecture/billing-cleanup-design.md` (state-machine alignment plan, claims/remittances/denials tables, billing-readiness gate, cutover).
- Optionally add read-only helpers under `server/modules/billing/` (no writes; not wired to any route).

## 10. Forbidden changes
- No edits to `billing.ts`, `invoices.ts` routes.
- No edits to repositories.
- No schema or migration changes.
- No UI changes.

## 11. Likely files touched
- `docs/architecture/billing-cleanup-design.md` (new)
- Optional: `server/modules/billing/contracts.ts`, `repo.ts` (read-only)

## 12. Files/functions/routes that should not be touched
- `server/routes/billing.ts`, `invoices.ts`
- `server/repositories/billing.repo.ts`, `invoices.repo.ts`
- `client/src/pages/billing.tsx`, `invoices.tsx`
- All schema and migrations

## 13. Implementation approach
1. Document the two state machines, the auto-create scan, and the billing-readiness gate.
2. Propose the future tables: `claims`, `remittances`, `denials` (DDL in fenced blocks).
3. Propose the state-machine alignment plan: a DB constraint or a typed transition writer that prevents the divergence.
4. Define the rollout: feature flag `BILLING_STATE_ALIGNMENT` (default off); per-step cutover.

## 14. Required compatibility rules
- Preserve API response shapes.
- Preserve test IDs.
- Preserve UI markup.
- Preserve PDF data source.
- Preserve canonical reasoning.
- Preserve existing routes.
- Add wrappers before replacing code.

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs
```

## 16. Manual QA checklist
- Billing list page unchanged.
- Create one invoice + record one payment; behavior unchanged.
- Send an invoice email; behavior unchanged.

## 17. Rollback plan
- `git rm` the design doc and optional helpers.

## 18. Stop conditions
- If anyone proposes shipping the state-machine alignment in this batch, STOP.
- If the design touches the auto-create scan without a migration plan, STOP.

## 19. Required approval phrase
**APPROVE BATCH 17**

## 20. Exact Claude Code implementation prompt

```
You are working in the repo `noorhanmedical/tertiary-command-center` on macOS.
Path: ~/Projects/tertiary-command-center-replit-sync

GOAL: Document the billing/invoice cleanup plan. Review-only. No runtime change.

BRANCH:
  Create branch from main:
    architecture/billing-cleanup-design

ALLOWED FILES (add):
  docs/architecture/billing-cleanup-design.md
  server/modules/billing/contracts.ts (optional, read-only)
  server/modules/billing/repo.ts (optional, read-only)
  server/modules/billing/index.ts (optional)

FORBIDDEN FILES (do not edit):
  server/routes/billing.ts, invoices.ts
  server/repositories/billing.repo.ts, invoices.repo.ts
  client/src/pages/billing.tsx, invoices.tsx
  All shared/schema/*.ts and shared/schema/index.ts
  All migrations/**
  package.json, package-lock.json, .env*

PROTECTED FLOWS:
  Billing list; invoice creation; invoice payment; invoice email; projected
  invoices.

EXACT IMPLEMENTATION REQUIREMENTS:
  1. design doc covers:
       - the two state machines (completed_billing_packages.packageStatus,
         invoices.status) and how they currently drift.
       - the billing_records auto-create scan; the cost; the future plan to
         make it write-only.
       - future tables: claims, remittances, denials (DDL fenced).
       - state-machine alignment proposal: typed transition writer OR DB
         constraint.
       - rollout under BILLING_STATE_ALIGNMENT flag (default off).
       - rollback for each step.
  2. Optional read-only helpers under server/modules/billing/, not wired to
     any route.
  3. Do not edit any route, repo, or schema.

VALIDATION:
  npm run check
  npm run build
  node scripts/qa-navigation-dock-home-tiles.mjs
  node scripts/qa-command-center-architecture.mjs
  node scripts/qa-visit-outreach-tile-parity.mjs
  node scripts/qa-plexus-iq-interior.mjs
  node scripts/qa-plexus-iq-backend.mjs
  node scripts/qa-team-portals-restore.mjs
  node scripts/qa-team-portal-workspace-engine.mjs
  node scripts/qa-engagement-assignment-runtime.mjs

MANUAL QA CHECKLIST:
  - Billing list page unchanged.
  - Create one invoice + record one payment; behavior unchanged.
  - Send an invoice email; behavior unchanged.

COMMIT MESSAGE:
  Add billing/invoice cleanup design doc (Batch 17)

FINAL REPORT FORMAT:
  Branch: <branch>
  Files changed: <list>
  App source untouched: yes (or optional read-only helpers, no consumers)
  npm run check: <pass/fail>
  npm run build: <pass/fail>
  QA scripts: <8/8 pass | list failures>
  Manual QA: <pass/fail per item>
  Blocked items: <none | list>
  Behavior changes (UI/API): none

STOP CONDITIONS:
  - Any state-machine alignment code committed → STOP.
  - Any auto-create scan edit without migration plan → STOP.

DO NOT push unless the user explicitly says "push" or "open the PR".
```

---

# Batch 18 — Background jobs / workers

## 1. Purpose
Design-first. Document the in-process background-job inventory (`morningRebuildScheduler`, `absenceWatcher`, `invoiceReminderWatcher`, `syncService`, `batchAnalysisRunner`) and a plan to move them to typed workers behind an outbox / SQS pattern. Add the `server/platform/queue/` skeleton — interface only. Do not move any production job.

## 2. Why this batch exists
All background work runs in-process. Advisory locks protect two jobs from double-runs but there's no retry/DLQ/observability. Before any move to workers, the job set and recovery semantics must be documented.

## 3. Current repo areas to inspect
- `server/services/morningRebuildScheduler.ts`
- `server/services/absenceWatcher.ts`
- `server/services/invoiceReminderService.ts`
- `server/services/syncService.ts`
- `server/services/batchAnalysisRunner.ts`
- `shared/schema/outboxItems.ts` (`outbox_items`)
- `server/lib/advisoryLock.ts`

## 4. Current risks
- Moving the AI batch runner to a worker without recovery semantics could lose Plexus IQ qualification jobs in-flight.
- Moving the invoice reminder watcher could double-send emails.
- Adding a queue without observability creates a silent failure mode.

## 5. Protected flows at risk
- Plexus IQ qualification jobs
- Morning scheduler rebuild
- Absence alerts / auto-redistribute
- Invoice reminders
- Drive / Sheets sync

## 6. Batch type
**infrastructure-design** + **code-safe** (queue interface skeleton; no production job moves)

## 7. Risk level
**low** (this batch); the future implementation batches are **medium-high**.

## 8. Safety conditions before implementation
- Batches 12 and 16 merged (centralized event/audit writer + storage abstraction).
- Outbox table is healthy (no stale rows older than a week without cause).

## 9. Allowed changes
- Add `server/platform/queue/` interface (`Queue.publish`, `Queue.consume`, `Job` type).
- Add an in-process implementation that wraps `outbox_items` (read-only consume; no new writers).
- Add `docs/architecture/background-jobs-design.md`.

## 10. Forbidden changes
- No production job moved.
- No changes to `morningRebuildScheduler`, `absenceWatcher`, `invoiceReminderService`, `syncService`, `batchAnalysisRunner`.
- No SQS integration code in this batch.

## 11. Likely files touched
- `server/platform/queue/contracts.ts`, `inProcess.ts`, `index.ts` (new)
- `docs/architecture/background-jobs-design.md` (new)

## 12. Files/functions/routes that should not be touched
- All listed services in §3.
- `shared/schema/outboxItems.ts`.

## 13. Implementation approach
1. Document each job: trigger, frequency, lock, recovery, observability.
2. Define the queue interface.
3. The in-process implementation reads `outbox_items` but is not registered yet.
4. Document the SQS rollout plan with rollback (in-process default if SQS env is missing).

## 14. Required compatibility rules
- Preserve API response shapes.
- Preserve test IDs.
- Preserve UI markup.
- Preserve PDF data source.
- Preserve canonical reasoning.
- Preserve existing routes.
- Add wrappers before replacing code.

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs
```

## 16. Manual QA checklist
- Morning rebuild runs at the scheduled time without error.
- Absence watcher fires on a synthetic absence event.
- Invoice reminder watcher unchanged.
- Plexus IQ qualification jobs unchanged.

## 17. Rollback plan
- `git rm -r server/platform/queue/` and the design doc.

## 18. Stop conditions
- If anyone moves a production job in this batch, STOP.
- If the queue interface introduces a runtime dependency that fails to boot, STOP.

## 19. Required approval phrase
**APPROVE BATCH 18**

## 20. Exact Claude Code implementation prompt

```
You are working in the repo `noorhanmedical/tertiary-command-center` on macOS.
Path: ~/Projects/tertiary-command-center-replit-sync

GOAL: Document background-job inventory and add a typed Queue interface
       skeleton + in-process implementation reading outbox_items. No production
       job is moved.

BRANCH:
  Create branch from main:
    architecture/background-jobs-design

ALLOWED FILES (add):
  server/platform/queue/contracts.ts
  server/platform/queue/inProcess.ts
  server/platform/queue/index.ts
  docs/architecture/background-jobs-design.md

FORBIDDEN FILES (do not edit):
  server/services/morningRebuildScheduler.ts
  server/services/absenceWatcher.ts
  server/services/invoiceReminderService.ts
  server/services/syncService.ts
  server/services/batchAnalysisRunner.ts
  shared/schema/outboxItems.ts (and all other shared/schema/*.ts)
  shared/schema/index.ts
  client/**
  All migrations/**
  package.json, package-lock.json, .env*

PROTECTED FLOWS:
  Plexus IQ qualification jobs (in-process batch runner).
  Morning scheduler rebuild (advisory-locked).
  Absence alerts / auto-redistribute.
  Invoice reminders.
  Drive / Sheets sync.

EXACT IMPLEMENTATION REQUIREMENTS:
  1. design doc lists each job with: trigger, frequency, lock, recovery,
     observability gap.
  2. contracts.ts defines Queue { publish, consume } and Job type.
  3. inProcess.ts implements consume() by polling outbox_items. It is NOT
     registered anywhere yet.
  4. SQS rollout plan documented; rollback (env absent → in-process default).
  5. Do not move any production job.

VALIDATION:
  npm run check
  npm run build
  node scripts/qa-navigation-dock-home-tiles.mjs
  node scripts/qa-command-center-architecture.mjs
  node scripts/qa-visit-outreach-tile-parity.mjs
  node scripts/qa-plexus-iq-interior.mjs
  node scripts/qa-plexus-iq-backend.mjs
  node scripts/qa-team-portals-restore.mjs
  node scripts/qa-team-portal-workspace-engine.mjs
  node scripts/qa-engagement-assignment-runtime.mjs

MANUAL QA CHECKLIST:
  - Morning rebuild runs.
  - Absence watcher fires on synthetic event.
  - Invoice reminder watcher unchanged.
  - Plexus IQ qualification jobs unchanged.

COMMIT MESSAGE:
  Add background-job queue interface and design doc (Batch 18)

FINAL REPORT FORMAT:
  Branch: <branch>
  Files changed: <list>
  App source untouched: yes (skeleton not registered)
  npm run check: <pass/fail>
  npm run build: <pass/fail>
  QA scripts: <8/8 pass | list failures>
  Manual QA: <pass/fail per item>
  Blocked items: <none | list>
  Behavior changes (UI/API): none

STOP CONDITIONS:
  - Any production job moved → STOP.
  - Boot-time failure from the new skeleton → STOP.

DO NOT push unless the user explicitly says "push" or "open the PR".
```

---

# Batch 19 — AWS deployment readiness

## 1. Purpose
Infrastructure-design + scaffolding only. Add Dockerfile, ECS Fargate task definition (or EC2 plan), RDS, S3, Secrets Manager, SQS, CloudWatch wiring as **infrastructure files**. No runtime app behavior change.

## 2. Why this batch exists
No Dockerfile, no ECS task definitions, no Secrets Manager wiring, no SQS, no CloudWatch hooks today. `DEPLOY_AWS.md` documents the target. Before any deploy, the scaffolding must exist and be reviewable.

## 3. Current repo areas to inspect
- `DEPLOY_AWS.md`
- `server/index.ts` (boot, sessions, validateEnv, lifecycle)
- `server/lib/validateEnv.ts`
- `server/integrations/s3FileStorage.ts`, `fileStorage.ts`
- `.replit` (existing config)
- `package.json` scripts (`start`, `build`)

## 4. Current risks
- A Dockerfile that runs as root or doesn't pin the Node version creates ops risk.
- An ECS task definition that exposes secrets via plain env vars (not Secrets Manager) violates basic hygiene.
- CloudWatch wiring that ships PHI to logs would be a HIPAA incident.

## 5. Protected flows at risk
- All flows (this batch is the deployment substrate).

## 6. Batch type
**infrastructure-design** + **infrastructure-implementation** (files only; no deploy)

## 7. Risk level
**medium**

## 8. Safety conditions before implementation
- Batches 16 (storage) and 18 (queue design) merged.
- A documented secret list (DATABASE_URL, SESSION_SECRET, AI_INTEGRATIONS_OPENAI_API_KEY, AWS creds, S3 bucket) and the chosen Secrets Manager layout.

## 9. Allowed changes
- Add `Dockerfile`, `.dockerignore`.
- Add `infra/` folder with: `ecs-task-definition.json` (or Terraform/CDK), `rds.md`, `s3.md`, `sqs.md`, `secrets-manager.md`, `cloudwatch.md`.
- Update `DEPLOY_AWS.md` with the new files referenced.
- Add `scripts/healthcheck.mjs` (calls `/readyz` for ECS health check; not used at runtime).

## 10. Forbidden changes
- No edits to `server/index.ts` boot.
- No changes to `validateEnv.ts` beyond docs.
- No new app dependencies.
- No actual deploy / push to AWS in this batch.

## 11. Likely files touched
- `Dockerfile`, `.dockerignore`
- `infra/ecs-task-definition.json`
- `infra/rds.md`, `infra/s3.md`, `infra/sqs.md`, `infra/secrets-manager.md`, `infra/cloudwatch.md`
- `DEPLOY_AWS.md`
- `scripts/healthcheck.mjs`

## 12. Files/functions/routes that should not be touched
- `server/index.ts`
- `server/lib/validateEnv.ts` (runtime)
- `client/`

## 13. Implementation approach
1. Multi-stage Dockerfile pinned to Node 20.x; non-root user; `dist/index.cjs` + `dist/public/`.
2. ECS Fargate task definition with secrets via Secrets Manager refs; CloudWatch log group with PHI-aware exclusions (no body of patient_screenings.notes, no reasoning blob).
3. RDS sizing notes; S3 bucket policy with TLS-only; SQS DLQ.
4. Healthcheck script calls `/readyz`.

## 14. Required compatibility rules
- Preserve API response shapes.
- Preserve test IDs.
- Preserve UI markup.
- Preserve PDF data source.
- Preserve canonical reasoning.
- Preserve existing routes.
- Add wrappers before replacing code.

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs

# Optional local docker smoke:
docker build -t tertiary-cc:local . && docker run --rm -p 5000:5000 tertiary-cc:local
```

## 16. Manual QA checklist
- Local docker run boots successfully (`/healthz` returns 200).
- `/readyz` returns 200 once DB is reachable.
- No PHI lines appear in container stdout.

## 17. Rollback plan
- `git rm` infra files; remove Dockerfile.

## 18. Stop conditions
- If the Dockerfile would run as root → STOP and fix.
- If secrets are read from plain env in task definition → STOP and switch to Secrets Manager.
- If CloudWatch wiring would log reasoning blob contents → STOP.

## 19. Required approval phrase
**APPROVE BATCH 19**

## 20. Exact Claude Code implementation prompt

```
You are working in the repo `noorhanmedical/tertiary-command-center` on macOS.
Path: ~/Projects/tertiary-command-center-replit-sync

GOAL: Add Dockerfile, ECS Fargate task definition, and infra docs (RDS, S3,
       SQS, Secrets Manager, CloudWatch). Infrastructure-only; no app runtime
       change; no deploy.

BRANCH:
  Create branch from main:
    architecture/aws-deployment-readiness

ALLOWED FILES (add):
  Dockerfile
  .dockerignore
  infra/ecs-task-definition.json
  infra/rds.md
  infra/s3.md
  infra/sqs.md
  infra/secrets-manager.md
  infra/cloudwatch.md
  scripts/healthcheck.mjs

ALLOWED FILES (edit — minimal):
  DEPLOY_AWS.md (reference the new infra files)

FORBIDDEN FILES (do not edit):
  server/index.ts
  server/lib/validateEnv.ts (runtime behavior)
  client/**
  All shared/schema/*.ts and shared/schema/index.ts
  All migrations/**
  package.json, package-lock.json (no new app deps)
  .env*

PROTECTED FLOWS:
  All flows. The new files do not alter app runtime.

EXACT IMPLEMENTATION REQUIREMENTS:
  1. Dockerfile: multi-stage; Node 20.x; non-root user; copies dist/.
     CMD runs the production server.
  2. .dockerignore excludes node_modules, .git, *.tar.gz, storage/documents/.
  3. ecs-task-definition.json: secrets via Secrets Manager refs; CloudWatch
     log group; PHI-aware log filters described in cloudwatch.md.
  4. Infra docs each describe purpose, config, rollback.
  5. healthcheck.mjs is a standalone script that calls /readyz; exit 0/1.
  6. DEPLOY_AWS.md updates only to reference the new files.

VALIDATION:
  npm run check
  npm run build
  node scripts/qa-navigation-dock-home-tiles.mjs
  node scripts/qa-command-center-architecture.mjs
  node scripts/qa-visit-outreach-tile-parity.mjs
  node scripts/qa-plexus-iq-interior.mjs
  node scripts/qa-plexus-iq-backend.mjs
  node scripts/qa-team-portals-restore.mjs
  node scripts/qa-team-portal-workspace-engine.mjs
  node scripts/qa-engagement-assignment-runtime.mjs

  # Optional local docker smoke:
  docker build -t tertiary-cc:local . && \
    docker run --rm -p 5000:5000 tertiary-cc:local

MANUAL QA CHECKLIST:
  - Local docker run: /healthz returns 200; /readyz returns 200 once DB is
    reachable.
  - No PHI in container stdout.

COMMIT MESSAGE:
  Add Dockerfile, ECS task definition, and infra docs (Batch 19)

FINAL REPORT FORMAT:
  Branch: <branch>
  Files changed: <list>
  App source untouched: yes (no app runtime change)
  npm run check: <pass/fail>
  npm run build: <pass/fail>
  QA scripts: <8/8 pass | list failures>
  Docker local smoke: <pass/fail>
  Manual QA: <pass/fail per item>
  Blocked items: <none | list>
  Behavior changes (UI/API): none

STOP CONDITIONS:
  - Dockerfile runs as root → STOP and fix.
  - Plain-env secrets in task def → STOP; switch to Secrets Manager.
  - PHI-logging risk in CloudWatch wiring → STOP.

DO NOT push unless the user explicitly says "push" or "open the PR".
```

---

# Batch 20 — Observability / security

## 1. Purpose
Add structured logging, request IDs, basic metrics, and a session/security-header audit. Review PHI logging exposure. Confirm RBAC coverage across routes. **Add observability without changing auth.**

## 2. Why this batch exists
Today's logging is console-only. No request IDs, no metrics. Some routes lack explicit role guards. Without observability, the upcoming batches (worker moves, performance) are unsafe — failures won't be detectable.

## 3. Current repo areas to inspect
- `server/middleware/errorHandler.ts`, `rateLimiter.ts`
- `server/index.ts` (session config)
- `server/routes.ts` (auth, audit-log, user CRUD inline)
- All `server/routes/*` (RBAC guards)
- `server/services/auditService.ts`

## 4. Current risks
- A logger that includes request body for `/api/patient-packet` would log PHI.
- A new `requireRole` rollout that's too aggressive would block legitimate users.
- Adding a request-ID middleware in the wrong order (after errorHandler) can lose the ID on error responses.

## 5. Protected flows at risk
- Auth / session
- All routes (RBAC)
- Audit log

## 6. Batch type
**code-safe** (additive)

## 7. Risk level
**low-medium**

## 8. Safety conditions before implementation
- Batches 12 (audit writer), 16 (storage), 18 (queue design) merged.
- A documented role matrix (`admin`, `clinician`, `scheduler`, `biller` × every route).

## 9. Allowed changes
- Add structured logger (pino or built-in JSON formatter) with PHI redactors.
- Add request-ID middleware (`X-Request-Id`).
- Add basic metrics endpoint (`/metrics` — Prometheus text format; gated behind a role).
- Audit RBAC across routes; add missing guards as additive edits.
- Add security headers (helmet-equivalent) without breaking existing fetches.

## 10. Forbidden changes
- No removal of any existing audit-log call.
- No change to session config that affects login flow.
- No change to `apiRequest` semantics on the client (401 redirect must still work).

## 11. Likely files touched
- `server/platform/logger/index.ts` (new)
- `server/middleware/requestId.ts` (new)
- `server/middleware/securityHeaders.ts` (new)
- `server/routes/metrics.ts` (new)
- Selected `server/routes/*.ts` files for additive `requireRole` (clearly documented per file)

## 12. Files/functions/routes that should not be touched
- Auth handler (`POST /api/login`, `POST /api/logout`)
- Session secret rotation behavior
- Client `apiRequest`

## 13. Implementation approach
1. Add the logger with PHI redactors (drop `reasoning`, `notes`, full request body for patient endpoints).
2. Add request-ID middleware before the error handler.
3. Add the metrics endpoint behind `requireAdmin`.
4. Audit RBAC; add `requireRole` to missing routes one PR at a time.

## 14. Required compatibility rules
- Preserve API response shapes.
- Preserve test IDs.
- Preserve UI markup.
- Preserve PDF data source.
- Preserve canonical reasoning.
- Preserve existing routes.
- Add wrappers before replacing code.

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs

# Smoke:
curl -i http://localhost:5000/healthz   # should include X-Request-Id
curl -i http://localhost:5000/metrics   # should require admin role
```

## 16. Manual QA checklist
- Log lines are JSON; no `reasoning` or `notes` content visible.
- `X-Request-Id` appears on responses.
- `/metrics` requires admin role.
- All login + logout flows unchanged.
- All eight QA scripts still pass.

## 17. Rollback plan
- Disable the logger via env (`LOGGER=plain`) and remove the middleware order changes.

## 18. Stop conditions
- Any login regression → STOP and revert.
- Any PHI leak in logs → STOP and add redactor.
- Any role guard breaking a known-good flow → STOP and remove that guard.

## 19. Required approval phrase
**APPROVE BATCH 20**

## 20. Exact Claude Code implementation prompt

```
You are working in the repo `noorhanmedical/tertiary-command-center` on macOS.
Path: ~/Projects/tertiary-command-center-replit-sync

GOAL: Add structured logging with PHI redactors, request IDs, security headers,
       a metrics endpoint, and additive RBAC guards. Auth flow unchanged.

BRANCH:
  Create branch from main:
    architecture/observability-and-security

ALLOWED FILES (add):
  server/platform/logger/index.ts
  server/middleware/requestId.ts
  server/middleware/securityHeaders.ts
  server/routes/metrics.ts

ALLOWED FILES (edit — additive RBAC only, one route per commit):
  server/routes/<selected>.ts (add requireRole/requireAdmin where missing;
                                 must NOT remove any existing guard)

FORBIDDEN FILES (do not edit):
  Auth handler (POST /api/login, POST /api/logout) in server/routes.ts or
    wherever it lives — leave session config alone
  client/src/lib/queryClient.ts and apiRequest semantics
  All shared/schema/*.ts and shared/schema/index.ts
  All migrations/**
  package.json (no new app deps unless approved; structured logger may use
    the existing console or a minimal in-repo JSON formatter)
  .env*

PROTECTED FLOWS:
  Auth / session; all routes; audit log.

EXACT IMPLEMENTATION REQUIREMENTS:
  1. Logger redacts: reasoning, notes, full request body for /api/patient-packet,
     /api/patient-screenings/:id/admin-review/*.
  2. requestId.ts adds X-Request-Id header; mounted BEFORE errorHandler.
  3. securityHeaders.ts adds standard headers (X-Content-Type-Options,
     Referrer-Policy, etc.) without breaking the SPA.
  4. /metrics returns Prometheus text format; gated by requireAdmin.
  5. RBAC additive audit: add requireRole/requireAdmin only where missing;
     never remove an existing guard. One route per commit.

VALIDATION:
  npm run check
  npm run build
  node scripts/qa-navigation-dock-home-tiles.mjs
  node scripts/qa-command-center-architecture.mjs
  node scripts/qa-visit-outreach-tile-parity.mjs
  node scripts/qa-plexus-iq-interior.mjs
  node scripts/qa-plexus-iq-backend.mjs
  node scripts/qa-team-portals-restore.mjs
  node scripts/qa-team-portal-workspace-engine.mjs
  node scripts/qa-engagement-assignment-runtime.mjs

  # Smoke:
  curl -i http://localhost:5000/healthz
  curl -i http://localhost:5000/metrics

MANUAL QA CHECKLIST:
  - Log lines JSON; no reasoning/notes content visible.
  - X-Request-Id appears on responses.
  - /metrics requires admin.
  - Login/logout flow unchanged.
  - QA scripts unchanged.

COMMIT MESSAGE:
  Add observability + additive RBAC audit (Batch 20)

FINAL REPORT FORMAT:
  Branch: <branch>
  Files changed: <list>
  App source untouched: no (additive middleware + selected route guards)
  npm run check: <pass/fail>
  npm run build: <pass/fail>
  QA scripts: <8/8 pass | list failures>
  Manual QA: <pass/fail per item>
  PHI redactor verified: <yes/no>
  Blocked items: <none | list>
  Behavior changes (UI/API): none (additive only)

STOP CONDITIONS:
  - Any login regression → STOP and revert.
  - PHI leak in logs → STOP and add redactor.
  - Existing flow blocked by new guard → STOP and remove that guard.

DO NOT push unless the user explicitly says "push" or "open the PR".
```

---

# Batch 21 — QA and regression hardening

## 1. Purpose
Expand QA coverage **before** the riskier refactors (Batch 15, the worker moves). Build a QA matrix that maps protected flow → existing QA script → manual checklist → automated regression candidate.

## 2. Why this batch exists
Eight QA scripts exist (`scripts/qa-*.mjs`); ~30 `script/test*.ts` runners; no Jest/Vitest. Batches 10, 12, 15, 17, 18 all want stronger automated coverage. Establishing the matrix now is the lowest-cost way to keep later batches honest.

## 3. Current repo areas to inspect
- `scripts/qa-*.mjs` (8 files)
- `script/test*.ts` (~30 runners)
- `client/src/lib/pdf-baselines/` (from Batch 9, if shipped)
- `docs/architecture/protected-flows.md` (from Batch 1)

## 4. Current risks
- A new QA harness that is too noisy (flaky) will be ignored.
- Coverage targets pushed without owner / time budget will stagnate.

## 5. Protected flows at risk
- None directly — this batch hardens coverage.

## 6. Batch type
**code-safe** (additive tests + docs)

## 7. Risk level
**very low**

## 8. Safety conditions before implementation
- Batches 1 and 9 merged.

## 9. Allowed changes
- Add `scripts/qa-*.mjs` for newly-covered flows (Admin Review smoke; PDF baseline; engagement v2 parity if Batch 13 shipped; documents Drive→S3 health if Batch 16 shipped).
- Add `docs/architecture/qa-matrix.md`.
- Add `tests/` runners only if they don't add a runtime dependency.

## 10. Forbidden changes
- No app source code edits.
- No removal of existing QA scripts.
- No CI/CD changes (handled by Batch 19).

## 11. Likely files touched
- New `scripts/qa-*.mjs` files
- `docs/architecture/qa-matrix.md` (new)
- Optional `tests/` files

## 12. Files/functions/routes that should not be touched
- All app source.

## 13. Implementation approach
1. Audit each protected flow vs. the existing QA scripts.
2. Identify gaps; write new `scripts/qa-*.mjs` to fill them. Each new script is standalone (no shared harness) so it can be approved per-PR.
3. Build the matrix doc.

## 14. Required compatibility rules
- Preserve API response shapes.
- Preserve test IDs.
- Preserve UI markup.
- Preserve PDF data source.
- Preserve canonical reasoning.
- Preserve existing routes.
- Add wrappers before replacing code.

## 15. Validation commands
```bash
npm run check
npm run build
node scripts/qa-navigation-dock-home-tiles.mjs
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
node scripts/qa-team-portals-restore.mjs
node scripts/qa-team-portal-workspace-engine.mjs
node scripts/qa-engagement-assignment-runtime.mjs
# Any new scripts:
for f in scripts/qa-*.mjs; do node "$f"; done
```

## 16. Manual QA checklist
- Each new script runs locally and exits 0.
- The matrix doc enumerates every protected flow with at least one automated check OR an explicit "manual-only" note.

## 17. Rollback plan
- `git rm` new scripts and the matrix doc.

## 18. Stop conditions
- A new script is flaky on a second back-to-back run → STOP and fix or remove.
- A new script reaches into PHI in fixtures → STOP and re-design with fictional data.

## 19. Required approval phrase
**APPROVE BATCH 21**

## 20. Exact Claude Code implementation prompt

```
You are working in the repo `noorhanmedical/tertiary-command-center` on macOS.
Path: ~/Projects/tertiary-command-center-replit-sync

GOAL: Expand QA coverage and produce the QA matrix doc. No app source changes.

BRANCH:
  Create branch from main:
    architecture/qa-regression-hardening

ALLOWED FILES (add):
  scripts/qa-<new-flow>.mjs (one or more, additive)
  docs/architecture/qa-matrix.md
  tests/<runner>.ts (optional; no new runtime dep)

FORBIDDEN FILES (do not edit):
  All server/, client/, shared/, migrations/.
  package.json, package-lock.json, .env*.
  Existing scripts/qa-*.mjs (additive only; do not modify).

PROTECTED FLOWS:
  All. New QA scripts must use fictional data only.

EXACT IMPLEMENTATION REQUIREMENTS:
  1. qa-matrix.md lists every protected flow with the QA script(s) that
     exercise it. Note gaps explicitly.
  2. Add one new QA script per gap, where automation is cheap and stable.
     Each script:
       - is standalone (no shared harness)
       - uses fictional names/DOB
       - is idempotent
       - exits 0/1 cleanly
  3. Run each new script twice locally; both runs must pass.

VALIDATION:
  npm run check
  npm run build
  node scripts/qa-navigation-dock-home-tiles.mjs
  node scripts/qa-command-center-architecture.mjs
  node scripts/qa-visit-outreach-tile-parity.mjs
  node scripts/qa-plexus-iq-interior.mjs
  node scripts/qa-plexus-iq-backend.mjs
  node scripts/qa-team-portals-restore.mjs
  node scripts/qa-team-portal-workspace-engine.mjs
  node scripts/qa-engagement-assignment-runtime.mjs
  # Any new scripts:
  for f in scripts/qa-*.mjs; do node "$f"; done

MANUAL QA CHECKLIST:
  - Each new script passes twice in a row.
  - Matrix lists every protected flow with at least one check or a
    documented manual-only note.

COMMIT MESSAGE:
  Expand QA coverage and add QA matrix (Batch 21)

FINAL REPORT FORMAT:
  Branch: <branch>
  Files changed: <list>
  App source untouched: yes
  npm run check: <pass/fail>
  npm run build: <pass/fail>
  QA scripts: <N/N pass | list failures>
  New scripts added: <list>
  Blocked items: <none | list>
  Behavior changes (UI/API): none

STOP CONDITIONS:
  - Flaky new script → STOP and fix or remove.
  - PHI in fixtures → STOP and re-design.

DO NOT push unless the user explicitly says "push" or "open the PR".
```

---

# A. Recommended execution order

The order is chosen to maximize "safety per merge" — each batch lowers risk for everything that follows. The plan front-loads documentation and contracts, then ships read-side helpers and wrappers, then opens the door to the riskiest UI and migration work.

1. **Batch 1** — Architecture docs and dependency map.
   Establishes the shared vocabulary and the do-not-touch surface. Zero runtime change.
2. **Batch 2** — Shared contracts / types extraction.
   Unblocks every consumer rename in later batches without runtime change.
3. **Batch 3** — Backend service wrappers around current route logic.
   Lets later batches edit business logic in services instead of inside routes. Strict response-parity required.
4. **Batch 4** — Frontend hooks extraction.
   Mandatory precursor to Batch 15 (Admin Review modularization). Markup unchanged.
5. **Batch 5** — Patient Directory preparation.
   Adds the canonical-read helper without touching writes.
6. **Batch 6** — Facility canonicalization.
   Design-only inventory; future facility table planning.
7. **Batch 7** — Patient matching / deduping design.
   Design-only; no merge code.
8. **Batch 8** — Qualification structure cleanup.
   Read-only typed views over the reasoning blob.
9. **Batch 9** — PDF / packet protection.
   Locks down the PDF contract before any caller refactor.
10. **Batch 10** — Execution Case spine.
    Adds state machine + feature-flagged transaction wrapper.
11. **Batch 11** — Team Task spine.
    Read-only union view across plexus_tasks and scheduler_assignments.
12. **Batch 12** — Journey event / audit standardization.
    Centralized writer + additive missing events.
13. **Batch 13** — Engagement Center read-model optimization.
    Additive paginated endpoint; UI unchanged.
14. **Batch 14** — Plexus IQ read-model optimization.
    Additive aggregated endpoints; UI unchanged.
15. **Batch 16** — Documents / reports storage abstraction.
    Drive → S3 cutover script + provenance.
16. **Batch 17** — Billing / invoice architecture cleanup.
    Review-only first; implementation deferred.
17. **Batch 18** — Background jobs / workers design.
    Skeleton + design; no production job moved.
18. **Batch 19** — AWS deployment readiness.
    Dockerfile + ECS scaffolding.
19. **Batch 20** — Observability / security.
    Structured logging, request IDs, additive RBAC.
20. **Batch 21** — QA and regression hardening.
    Cover gaps before the riskiest UI refactor.
21. **Batch 15** — Admin Review modularization.
    Split into sub-batches 15a–15f. Highest risk; ships last.

Note: Batch 15 is intentionally placed at the end. It is technically the most aggressive UI refactor and benefits from every preceding batch (contracts, hooks, audit writer, PDF contract, QA hardening).

---

# B. Safe-to-approve early batches

These batches are low-risk and can be approved first, in roughly any order:

- **Batch 1** — docs only
- **Batch 2** — type-only extraction
- **Batch 5** — design + read helpers
- **Batch 6** — design inventory
- **Batch 7** — design only
- **Batch 8** — read-only helpers
- **Batch 9** — docs + optional baseline (read-only)
- **Batch 11** — read-only union view
- **Batch 17** — review-only design doc
- **Batch 18** — interface skeleton + design
- **Batch 21** — additive QA scripts

If approved together as a "documentation + read-helpers wave", they materially de-risk every later batch. None of them changes app behavior.

---

# C. Batches requiring review-only sub-batches

These should not go straight to implementation — they need a review-only sub-batch first:

- **Batch 10** (Execution Case spine):
  - 10a (review-only): document every transition the existing code performs; map to a state-machine matrix; ship the doc.
  - 10b (implementation): add the state machine + feature-flagged transaction wrapper (default off).

- **Batch 12** (Journey event / audit standardization):
  - 12a (review-only): map every existing journey-event call site and the missing events; ship the inventory.
  - 12b (parity swap): swap existing call sites for parity; verify DB rows byte-identical.
  - 12c (additive events): add missing events one route per commit.

- **Batch 15** (Admin Review modularization):
  - 15-block-map (review-only): inventory every JSX block + handler + test-id; ship the block-map doc.
  - 15a–15f: each sub-component extraction is its own approval-gated sub-batch.

- **Batch 17** (Billing / invoice cleanup):
  - 17a (review-only): design doc; ship.
  - 17b–17z (implementation): future approvals; not in scope of this orchestrator.

- **Batch 18** (Background jobs / workers):
  - 18a (design only): doc + interface skeleton.
  - 18b+ (per-job moves): out of this orchestrator's scope; each move is its own PR.

- **Batch 19** (AWS deployment):
  - 19a (Dockerfile + .dockerignore): ship.
  - 19b (ECS task definition + infra docs): ship.
  - 19c (CloudWatch wiring): ship only after PHI-redactor verified.

- **Batch 20** (Observability / security):
  - 20a (logger + request IDs + security headers): ship.
  - 20b (metrics endpoint): ship.
  - 20c (RBAC additive guards): one route per commit; per-PR approval.

---

# D. High-risk batches to delay

These should NOT be implemented before their prerequisites have shipped and a manual regression has been run:

- **Batch 15 (Admin Review modularization)** — depends on Batches 1, 2, 3, 4, 8, 9, 12, 21. Highest risk in the plan. Touches the largest, most coupled UI component. Even a "pure refactor" can ship a regression that breaks Plexus IQ qualification, Clinician PDF, Plexus PDF, sibling navigation, or ICD chips.
- **Batch 10 (Execution Case spine)** — non-trivial. The transaction wrapper, even when feature-flagged, can deadlock under load if a repo call is unexpectedly synchronous-blocking. Run only after Batches 1–4 and ideally Batch 12.
- **Batch 13 (Engagement Center read-model)** — additive, but if the parity test is weak the UI cutover (a later batch) will be unsafe. Defer the UI cutover until after Batch 21.
- **Batch 17 (Billing cleanup, implementation phase)** — touches live revenue flows. Implementation should not begin until the state-machine alignment plan and feature flag are documented and reviewed by a second engineer.
- **Worker moves under Batch 18** — moving `batchAnalysisRunner` to a true worker is a separate, gated piece of work. Lose-in-flight semantics must be designed first.
- **Patient-matcher implementation under Batch 7** — silent merges of patient identity are catastrophic. The implementation must require manual review and full audit; that is design-only in this orchestrator.

---

# E. Required approval protocol

For every batch (including each sub-batch):

1. The user pastes the exact `APPROVE BATCH N` phrase (or `APPROVE BATCH 15a` for sub-batches) into the chat. No batch starts without that phrase.
2. Claude creates the branch from `main` using the name in the batch's prompt.
3. Claude implements the batch exactly as written in §20 of that batch. Claude does not invent additional changes.
4. Claude runs the validation block. If anything fails, Claude STOPS, reports, and waits for direction.
5. Claude shows the diff and the final-report fields. Claude does NOT push.
6. The user reviews the diff and the final report.
7. The user either (a) pastes `push` / `open the PR` to publish, or (b) provides corrections, or (c) instructs Claude to revert.
8. After the PR is opened, the user merges it through GitHub. Claude does not merge.

If at any point Claude encounters an instruction that contradicts the protected-flows list or the batch's Forbidden list, Claude STOPS and asks rather than proceeding.

---

# F. Claude autonomy rules

These rules apply to every batch in this orchestrator and to any future architecture work in this repo:

- **Claude may review all batches now** — read existing code, grep, and produce additional inventory artifacts if asked.
- **Claude may create docs-only planning artifacts if explicitly approved** — e.g., the block map for Batch 15.
- **Claude must NOT implement code without approval.** No exceptions. Even "tiny cleanups" require approval.
- **Claude must NOT touch protected runtime flows without approval** — Plexus IQ, Plexus IQ import, clinical qualification, Admin Review, Clinician PDF, Plexus PDF, selected patient PDF actions, Engagement Center, Scheduler Portal, Team Portals, patient assignment, report upload, billing/invoice.
- **Claude must STOP before risky areas.** When the next step would touch the do-not-touch list, Claude asks before proceeding.
- **Claude must create smaller review-only sub-batches when needed.** See §C above.
- **Claude must preserve API response shapes** unless a compatibility layer is approved.
- **Claude must preserve UI behavior and test IDs** unless a specific approved batch allows changes.
- **Claude must ask before migrations.** No `migrations/` file is created without explicit approval.
- **Claude must ask before Admin Review, PDF, Plexus IQ import, Engagement Center runtime, Scheduler Portal runtime, Team Portal runtime, or billing runtime changes.**
- **Claude must run validation after each approved implementation batch.** The standard block is npm run check + npm run build + the eight QA scripts.
- **Claude must report files changed and risk after each batch** using the final-report format in §"Global conventions" above.
- **Claude must NOT push unless explicitly asked.** Branches stay local until the user says `push` or `open the PR`.
- **Claude must NOT modify `.env`, `package.json`, `package-lock.json`, `server/db.ts`, `server/storage.ts`, `shared/schema/index.ts`, or any `migrations/` file** without explicit approval per batch.

---

# G. Next recommended action

The next thing to approve is the **first wave of safe batches** — specifically:

> **APPROVE BATCH 1** — Architecture docs and dependency map.

This single approval ships six docs (`README.md`, `canonical-spine.md`, `protected-flows.md`, `dependency-map.md`, `refactor-batches.md`, `do-not-touch.md`) that every later batch references. Zero runtime change. Lowest possible risk. Sets the vocabulary for the rest of the work.

After Batch 1 ships, the recommended next approvals (in any order) are Batches 5, 6, 7, 8, 9, 11, 17, 18, and 21 — all design / read-only / additive. Batches 2, 3, 4 are the first code-touching batches and should be approved one at a time.

Batch 15 (Admin Review modularization) should be left for last and approved as sub-batches 15-block-map → 15a → 15b → 15c → 15d → 15e → 15f.

End of orchestrator review.

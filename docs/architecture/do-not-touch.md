# Do-not-touch list

Mirrors §10 of `review-canonical-spine-2026-06-09.md`. These files / functions / migrations are **off-limits** to any refactor batch unless the batch's orchestrator entry (`full-21-batch-orchestrator-review.md`) explicitly permits the edit.

> Anything that handles patient identity, qualification reasoning, PDF rendering, admin approval, or engagement assignment is off-limits to non-explicit batches.

The default rule for any PR: **if a file appears below, leave it alone**. If the work genuinely needs to touch it, the PR description must cite the batch number + the orchestrator's §20 prompt that permits the edit.

---

## Frontend — off-limits

- `client/src/components/qualification/AdminReviewDialog.tsx` *(4,230 lines; sibling nav and PDF preview are subtle)*
- `client/src/components/qualification/PatientPdfActions.tsx`
- `client/src/components/qualification/AdminApprovalControl.tsx`
- `client/src/components/qualification/ChangeEngagementAssignmentDialog.tsx`
- `client/src/lib/pdfGeneration.ts`
- `client/src/lib/pdfPacketGrouping.ts`
- `client/src/components/engagement/EngagementAssignmentBoard.tsx`
- `client/src/components/portal/TeamPortalShell.tsx`
- `client/src/components/portal/PortalShell.tsx`
- `client/src/components/plexus-iq/PlexusIQWorkspace.tsx`
- `client/src/components/plexus-iq/PlexusIQBulkImportModal.tsx`
- `client/src/components/plexus-iq/PlexusIQQualificationJobsStatus.tsx`
- `client/src/components/outreach/CanonicalRowActions.tsx` *(PDF entry from outreach)*
- `client/src/components/PatientCard.tsx`
- `client/src/components/ResultsView.tsx`
- `client/src/components/EditableScreeningFormModal.tsx`
- All `data-testid` attributes referenced by `scripts/qa-*.mjs` *(a rename is a regression)*

---

## Backend — off-limits

- `server/routes/plexusIqClinicalImport.ts` *(bulk import pipeline)*
- `server/routes/patients.ts` admin-review endpoints (`/evidence`, `/regenerate`, `/regenerate-all`, `/regenerate-ancillary`)
- `server/services/screening.ts` *(AI qualification)*
- `server/services/patientCommitService.ts` *(commit + spine creation; fragile, do not move)*
- `server/services/batchAnalysisRunner.ts`
- `server/services/plexusIq/*` *(admin-review rule engine, AI regeneration, ICD search)*
- `server/routes/engagementAssignmentBoard.ts` *(conflict-guard logic)*
- `server/services/callListEngine.ts`, `server/services/callListPriority.ts`
- `server/services/morningRebuildScheduler.ts`, `server/services/absenceWatcher.ts` *(advisory-locked daily flow)*
- `server/routes/billing.ts` auto-creation on GET *(known O(n³) fragility — quarantine via a new route in Batch 14; do not edit the original until then)*
- `server/routes/invoices.ts` payment flow
- `server/routes/patientPacket.ts` *(powers all team-portal patient views and PDF source)*
- `server/storage.ts` *(god-facade — do not shrink before consumers are migrated)*

---

## Shared schema / types — additive only

- `shared/schema/screening.ts`
- `shared/schema/executionCase.ts`
- `shared/schema/procedureEvents.ts`
- `shared/schema/globalSchedule.ts`
- `shared/schema/billing.ts`
- `shared/schema/invoices.ts`
- `shared/schema/documents.ts`

**Rule:** Column **additions** may be OK under approved Batches 5+. **Renames** and **drops** are not allowed without a multi-phase migration plan.

- `shared/clinicWorkflow.ts`, `shared/plexus.ts`, `shared/plexus-iq/*` *(hardcoded clinical config; changes here ripple into reasoning and PDFs)*

---

## DB migrations — off-limits without explicit approval

- `migrations/0000..0025` — duplicate-numbered files exist (`0010_central_document_library.sql` vs `0010_patient_lookup_indexes.sql`; same for `0018_*` and `0021_*`). **Do not renumber.** New migrations should start at `0026_*`.

---

## CLAUDE.md "explicit approval" list (repeated here)

These files require explicit per-PR approval **before** editing, per the repo's `CLAUDE.md`:

- `server/db.ts`
- `server/storage.ts` *(facade only; edit repositories in `server/repositories/` directly)*
- `shared/schema/index.ts`
- Any file in `migrations/`

---

## How to use this list

1. Before opening a PR, search this file for every path in your diff.
2. If a path is listed, find the batch in `full-21-batch-orchestrator-review.md` that explicitly permits the edit.
3. Cite the batch + §20 prompt in your PR description.
4. If no batch permits the edit, the PR is not safe to ship — split off the off-limits change into a proper batch.

This list is updated whenever a refactor batch lands that materially changes the off-limits surface (e.g., when sub-components are extracted from `AdminReviewDialog.tsx`).

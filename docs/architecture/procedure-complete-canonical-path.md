# Procedure Complete — Canonical Path

> **Scope:** Single canonical write path for "Procedure Performed"
> and its side-effect chain. Read-only audit.

## Canonical write path

`server/repositories/procedureEvents.repo.ts` →
`markProcedureComplete(input)`.

Input: `{ executionCaseId?, patientScreeningId?, globalScheduleEventId?,
patientName?, patientDob?, facilityId?, serviceType,
completedByUserId?, note?, completedAt? }`.

The handler:

1. Upserts a `procedure_events` row dedup'd by
   `(patientScreeningId, serviceType)` with
   `procedureStatus = "complete"`, `completedAt`, and the optional
   `completedByUserId` + `note`.
2. Calls `upsertCaseDocumentReadinessForProcedureComplete(...)` —
   creates / updates the standard `case_document_readiness` rows
   for the procedure (consent / screening_form / report /
   order_note / post_procedure_note).
3. Fires `createPendingProcedureNotes(...)` (fire-and-forget) —
   queues `procedure_notes` rows for order_note +
   post_procedure_note generation.
4. Fires `evaluateBillingReadinessForProcedure(...)`
   (fire-and-forget) — upserts a `billing_readiness_checks` row
   reflecting the new readiness state; the helper itself opens a
   pending `billing_document_request` when readiness flips to
   `ready_to_generate`.
5. Opens / reconciles open `plexus_tasks` for the standard
   missing-document set via `ensureMissingDocumentTask(...)` (per
   `server/repositories/missingDocumentTasks.repo.ts`).

So one call writes:

- `procedure_events`
- `case_document_readiness` (six rows)
- `procedure_notes` (two pending notes)
- `billing_readiness_checks`
- `billing_document_requests` (when readiness allows)
- `plexus_tasks` (one per missing doc type)

Plus the patient-journey side-effects from each downstream
helper.

## User-facing surfaces

The "Procedure Performed" action is exposed by:

- `client/src/components/patient/ProcedureCompleteButton.tsx` —
  the canonical button (renamed from "Procedure Complete" in an
  earlier batch). Used by PortalShell on ancillary cards
  (line 527 + line 2466).
- `client/src/components/portal/PortalShell.tsx` — wires the
  button when `workspaceCanCompleteProcedure` (resolved by
  `resolvePortalCapabilities`) is true.

Loading / error / success state already exists on the button via
TanStack `useMutation`:

- `mutation.isPending` toggles `disabled` + the spinner glyph.
- `onError` shows a destructive toast with the server error.
- `onSuccess` shows a success toast and invalidates the
  canonical-spine queries.

## API endpoint

`POST /api/procedure-events/mark-procedure-complete` in
`server/routes/procedureEvents.ts`. Body matches
`MarkProcedureCompleteInput`; the handler calls
`markProcedureComplete(...)` and returns the new
`procedure_event` + the upserted readiness rows.

## Readiness re-evaluation hooks (D3 territory)

Beyond the procedure-complete trigger, three other write paths
already re-evaluate the readiness chain:

1. `POST /api/case-document-readiness/complete` — when a single
   document is marked complete, the route calls
   `evaluateBillingReadinessForProcedure(...)` and
   `resolveMissingDocumentTask(...)` (closes the open Plexus task
   when readiness flips to satisfied).
2. `POST /api/case-document-readiness/report-uploaded` — the
   report-upload wrapper hits the same evaluator.
3. `POST /api/billing-readiness-checks/recompute` — explicit
   manual recompute action.

`technician_uploads` mutations also fire readiness re-evaluation
when the upload row's `status` becomes `confirmed_at`.

## Audit + journey coverage

- Every write site appends `patient_journey_events` via
  `appendPatientJourneyEvent(...)` (per
  `docs/architecture/audit-log-coverage.md`).
- `mark-procedure-complete` does NOT currently call `logAudit`
  (system-wide actor + action log) — same gap pattern as the
  engagement-center call-result handler. Worth closing in a
  future small batch.

## Cross-references

- `server/repositories/procedureEvents.repo.ts` —
  `markProcedureComplete()` + side-effect chain.
- `server/routes/procedureEvents.ts` — POST handler.
- `client/src/components/patient/ProcedureCompleteButton.tsx` —
  UI.
- `docs/architecture/audit-log-coverage.md` — audit log gap #3
  pattern.
- `docs/architecture/tertiary-command-center-canonical-spine.md`
- `docs/architecture/billing-package-source-of-truth.md` *(next
  batch in this stream)*.

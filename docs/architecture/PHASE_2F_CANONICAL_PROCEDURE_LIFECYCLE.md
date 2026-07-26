# Phase 2F — Canonical Procedure Lifecycle & Procedure Note Foundation

Status: **Phase 2F-A checkpoint** — foundation only. Both feature flags default
**OFF**. Migration `0054` is **additive and UNAPPLIED**. No new UI. No billing
transition. No Procedure Note body generation. No auto-sign.

This document is the source of truth for the canonical procedure lifecycle and
the canonical Procedure Note (`post_procedure_note`) that builds on it.

---

## 1. Current-state audit (before Phase 2F-A)

**`procedure_events`** (`shared/schema/procedureEvents.ts`) is the existing
canonical procedure execution/completion row:

- Columns: `id`, `clinicId?`, `executionCaseId?`, `patientScreeningId?`,
  `globalScheduleEventId?`, `serviceType`, `procedureStatus`
  (`not_started | in_progress | complete | cancelled | no_show |
  reschedule_needed`, default `not_started`), `completedByUserId?`,
  `completedAt?`, `note?`, `metadata`, `createdAt`, `updatedAt`.
- Canonical completion = `procedure_status='complete'` + a real `completed_at`.
  The immutable `id` + `completed_at` are the completion evidence.
- **Primary write hook:** `markProcedureComplete()`
  (`server/repositories/procedureEvents.repo.ts`) — dedup upsert by
  `(patientScreeningId, serviceType)`; fires (fire-and-forget)
  `upsertProcedureCompleteEvent` (mirrors a `procedure_complete`
  `global_schedule_events` badge), `upsertCaseDocumentReadinessForProcedureComplete`,
  `createPendingProcedureNotes` (legacy note writer), and
  `evaluateBillingReadinessForProcedure`. Route: `POST /api/procedure-events/complete`.
- `updateProcedureEvent()` also transitions status; moving *away from* complete
  clears the mirrored badge.
- **Missing before 0054:** `ancillary_case_id`, `global_plexus_patient_id`,
  `patient_clinic_membership_id`.

**`procedure_notes`** (`shared/schema/generatedNotes.ts`) already carries the
full Phase 2E case-scoped identity/evidence/supersession set
(`ancillaryCaseId`, `globalPlexusPatientId`, `patientClinicMembershipId`,
`procedureEventId`, `qualifyingGlobalScheduleEventId`, `adminReviewEventId`,
`effectiveClinicalDate`, `supersedesNoteId`, `supersededAt`, signature columns).
`note_type ∈ {order_note, post_procedure_note}`. Migration 0053 set the
post-procedure-note uniqueness to `uq_pn_post_procedure_note (screening,
service, note_type)`. **Missing before 0054:** `report_document_reference_id`.

**Reports** become current via `POST /api/case-document-readiness/complete`
→ `ensureAncillaryDocumentReference` (`documentReferenceWriter.ts`), which
deterministically resolves the owning ancillary case and indexes a
`documentKind='report'` row in `ancillary_document_references` (Phase 2E).

**Signature** flows through `signProcedureNoteRow` / `returnProcedureNoteRow`
(`generatedNotes.repo.ts`) via `physicianPortal/signatureWorkflow.ts`.
`computeSignatureItem` already treats a `post_procedure_note` as
report-required. Phase 2F does **not** change the signing state machine.

---

## 2. Chosen canonical procedure source

`procedure_events` **remains** the canonical procedure execution/completion
row. Phase 2F extends it **additively** (three nullable identity columns) — it
does **not** create a competing procedure-completion table. The immutable
`procedure_events.id` and `completed_at` are the Procedure Note completion
evidence.

A **completed procedure event must belong to exactly one ancillary case**. The
linkage is written by the completion hook (§10) using deterministic resolution
only: never patient-name, never first/newest, never cross-clinic.

## 3. Procedure state model

Reused unchanged from `procedure_events.procedure_status`:
`not_started`, `in_progress`, `complete`, `cancelled`, `no_show`,
`reschedule_needed`. No new states are invented. Only `complete` (with a real
`completed_at`) counts as completion. `cancelled` / `no_show` are never a
completion. `doctor_visit` and mere scheduling never create a
`procedure_events` row, so they never count.

## 4. Exact two-condition Procedure Note eligibility

A Procedure Note is eligible **iff BOTH** hold (`procedureNoteEligibility.ts`):

1. **Procedure complete** — a `procedure_events` row for THIS exact ancillary
   case (same clinic) with `procedure_status='complete'` and a real
   `completed_at`.
2. **Report associated** — a CURRENT `ancillary_document_references` row,
   `documentKind='report'`, same clinic, THIS exact ancillary case, exact
   `serviceType`, not superseded, acceptable status
   (`uploaded | completed | approved`).

Neither alone is sufficient. Reason codes: `procedure_not_complete`,
`procedure_event_missing`, `report_missing`, `report_not_current`,
`report_case_mismatch`, `report_service_mismatch`, `cross_clinic_denied`,
`migration_missing`. Mandatory consent may block execution upstream but is
**not** a third eligibility condition once a valid completion + report exist.
Ordinary missing documents remain warnings. Evidence is never fabricated, never
backdated. **Feature OFF ⇒ zero Phase 2F reads.**

## 5. Case-scoped Procedure Note identity

Canonical current identity (migration 0054):

```
(ancillary_case_id, note_type='post_procedure_note')  WHERE superseded_at IS NULL
```

`uq_pn_post_procedure_note_active_case`. Separate ancillary episodes each own
their own Procedure Note. Legacy unlinked notes keep the original
screening+service identity via `uq_pn_post_procedure_note_legacy`
(`ancillary_case_id IS NULL`) so `createPendingProcedureNotes` stays deployable
while flags are OFF. Foundation service: `procedureNoteService.ts`
(`createOrReuseProcedureNote`) — reuse current case-scoped note, else adopt a
DETERMINISTIC single legacy note (link-only; never touches body/signature),
else insert. `generationStatus='pending'`, `signatureStatus='needs_signature'`.
Signed notes are returned unchanged. Ambiguous legacy → durable retry, never
first/newest.

## 6. Report evidence model

The report is indexed (never copied) in `ancillary_document_references`
(`documentKind='report'`, `sourceTable='case_document_readiness'`). Eligibility
retains the immutable reference id + source id. `procedure_notes.report_document_reference_id`
records the qualifying reference id as permanent evidence.

## 7. Migration 0054 (`migrations/0054_add_canonical_procedure_lifecycle.sql`)

Additive-only, unapplied, does not amend 0049–0053:

1. `procedure_events` += `ancillary_case_id`, `global_plexus_patient_id`,
   `patient_clinic_membership_id` (nullable, FK, `ON DELETE SET NULL`) +
   `idx_pe_ancillary_case`.
2. `procedure_notes` += `report_document_reference_id` (FK →
   `ancillary_document_references`, `ON DELETE SET NULL`) + index.
3. Replace `uq_pn_post_procedure_note` with two disjoint partial-unique
   indexes (`_active_case` + `_legacy`) — same shape as the 0053 order-note fix.
4. Widen `chk_adr_document_kind` to include `procedure_note` (strict superset).
5. Widen `chk_adrf_requested_action` to include `link_procedure_note`,
   `link_procedure_note_evidence` (strict superset).

No data deletion, no truncation, no clinic mutation, no mandatory CHECK/NOT
NULL that breaks legacy inserts, no billing_document, no body generation.

## 8. Legacy compatibility

All added columns are nullable; both CHECK replacements only widen. Legacy
`procedure_events` and `createPendingProcedureNotes` post-procedure-note writers
remain valid while both Phase 2F flags are OFF. No case-required constraint is
imposed — canonical rows get their `ancillary_case_id` from the service layer.

## 9. Retry architecture

Reuses the existing PHI-free `ancillary_document_reconciliation_failures`
ledger with source-specific dedupe (two partial unique indexes from 0053) and
exact failure-id resolution. New actions: `link_procedure_note` (re-create/reuse
the note + reference) and `link_procedure_note_evidence` (link procedure/report
evidence once resolvable). Feature OFF ⇒ zero retry reads/writes. Cross-clinic
denied. Evidence linkage never touches a signed note body/signature. No
clinic-facing repair route, no uncontrolled `setInterval`, no apply execution
in this checkpoint.

## 10. Live hook boundaries

- **Hook A — procedure completed** (`onProcedureCompleted`, wired in
  `markProcedureComplete` and the `updateProcedureEvent` → complete transition,
  gated by `FEATURE_CANONICAL_PROCEDURE_LIFECYCLE`): deterministically resolves
  the one owning ancillary case, writes the additive canonical linkage onto the
  `procedure_events` row (sets `clinic_id` when absent so eligibility resolves),
  then delegates to Hook B's ensure. Ambiguous/absent case → durable retry,
  never guess. Cross-clinic → denied + retry.
- **Hook B — report associated / case known**
  (`ensureCanonicalProcedureNoteForAncillaryCase`, wired in
  `documentReferenceWriter` on a successful `documentKind='report'` reference,
  gated by `FEATURE_CANONICAL_PROCEDURE_NOTE`): delegates the two-condition
  eligibility to `createOrReuseProcedureNote`.

Both hooks fire AFTER their parent state change committed, are idempotent, and
**never throw** — a hook failure never reverses the committed procedure/report
action; it records truthful durable reconciliation work. Raw upload routes that
cannot deterministically resolve an ancillary case are NOT wired.

## 11. Feature flags

Server (`server/lib/featureFlags.ts`, default OFF):
`FEATURE_CANONICAL_PROCEDURE_LIFECYCLE`, `FEATURE_CANONICAL_PROCEDURE_NOTE`.
Client (`client/src/lib/procedureLifecycleFlag.ts`, default OFF, unused in
2F-A): `VITE_FEATURE_CANONICAL_PROCEDURE_NOTE`.

## 12. Enablement prerequisites (exact order — nothing below was run)

1. Merge stacked PRs in order (2A → 2B → 2C → 2D → 2E → 2F) — never modify #321.
2. Apply migrations `0049`–`0054` via the approved process — never
   `drizzle-kit push --force`, never `db:push`. If any tool proposes truncating
   `clinics`, answer **“No, add the constraint without truncating.”**
3. Keep all flags OFF through backfill.
4. Author + dry-run the Phase 2F backfill (link existing completed
   `procedure_events` to their one deterministic ancillary case), review
   ambiguity/retry counts, then gated apply.
5. Enable `FEATURE_CANONICAL_PROCEDURE_LIFECYCLE` (completion hook begins
   writing linkage), validate.
6. Enable `FEATURE_CANONICAL_PROCEDURE_NOTE`, validate the two-condition flow.
7. Monitor `ancillary_document_reconciliation_failures`.

## 13. Unresolved questions (for Phase 2F-B and beyond)

- Backfill authoring for existing completed procedures → single owning case;
  handling of historically ambiguous completions.
- Whether the physician-portal signature surface should read the canonical
  Procedure Note reference (UI is out of scope here).
- Billing readiness transition on a signed Procedure Note (deferred; no billing
  behavior in 2F-A).
- Report supersession → Procedure Note supersession policy (correction/version
  UI is not activated).
- Reconciliation *apply* worker scheduling (no apply execution in 2F-A).

## 14. Explicit Phase 2F-A exclusions

No new UI. No billing_document schema or billing transition. No Procedure Note
body generation. No auto-sign. No backfill/reconciliation apply run. No
migration executed. No flag enabled. No production data changed. No clinics
truncated. No Twilio/SMS/patient messaging. No MRN/PDF cleanup. Migration 0055
is **not** created in this checkpoint.

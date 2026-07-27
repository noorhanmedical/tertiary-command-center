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

## 6a. Phase 2F-A2 hardening (identity, tenancy, retries)

- **Canonical completion** goes through `completeCanonicalProcedure`
  (`canonicalProcedureCompletion.ts`) when the lifecycle flag is ON: it resolves
  the EXACT ancillary case (direct id → schedule event → deterministic legacy
  fallback), dedupes/reselects by `ancillary_case_id` (never screening+service),
  and inserts a fresh event per episode. The completion is committed first; the
  awaited, non-throwing Procedure Note ensure never reverses it. The route
  returns a canonical outcome (`completed_and_linked`, `completed_note_created`,
  `completed_note_reused`, `completed_waiting_for_report`,
  `deferred_ambiguous_case`, `reconciliation_not_recorded`, `migration_missing`).
- **Server-owned ownership commands** — `linkProcedureEventToAncillaryCase`
  (exact-ownership scoped, `.returning()` affected-row check, never re-homes) and
  `completeExistingProcedureEvent` / `insertCanonicalProcedureEvent`. The general
  `insertProcedureEventSchema` omits `clinicId` + the case identity, so no
  `Partial<InsertProcedureEvent>` path can seed/re-home ownership.
- **Tenancy** — all procedure-event routes derive clinic ONLY from
  `req.clinicId` (fail closed), use clinic-scoped repository reads, and return a
  DTO that omits `globalPlexusPatientId` / `patientClinicMembershipId`.
- **Legacy-note suppression** — when `FEATURE_CANONICAL_PROCEDURE_NOTE` is ON,
  `markProcedureComplete` no longer calls `createPendingProcedureNotes`; the
  two-condition canonical service is the only post-procedure-note creator.
- **Hooks are awaited** (no async DB task escapes the caller) and record
  SOURCE-CORRECT reconciliation: completion/case-link failures key on
  `sourceTable=procedure_events`, `sourceId=procedureEventId`,
  `requestedAction=link_procedure_note` — never under `procedure_notes`.
- **Retry execution** — the bounded worker handles `link_procedure_note`
  (procedure_events source → completion hook; procedure_notes/source-less →
  case ensure) and `link_procedure_note_evidence` (LINK-ONLY, signed-note-safe),
  resolving ONLY the exact failure id.
- **Evidence** — eligibility surfaces `procedure_event_ambiguous` for >1
  completed case-linked event (never latest-picking); `effectiveClinicalDate`
  defaults to the qualifying procedure's actual `completedAt`.

## 6b. Phase 2F-A3 hardening (commit truth, exact retries, evidence consistency)

- **Commit truth** — `completeCanonicalProcedure` returns
  `completionCommitted` + `completionStage`. A pre-commit rejection
  (identity/migration/conflict) is `completionCommitted=false` → the route uses
  503/404/409/202 and NEVER mirrors the schedule event or claims a
  `procedureEventId`; a committed completion whose Procedure Note reconciliation
  deferred is `completionCommitted=true` → 201 with truthful warnings.
  Pre-commit `migration_missing` (503) is distinct from post-commit
  `completed_reconciliation_migration_missing` (201).
- **Full identity agreement** — every supplied identifier must agree; a
  co-supplied `globalScheduleEventId` is independently validated
  (`ancillary_appointment`/`same_day_add`, not cancelled/no_show, exact case +
  service + execution + screening). Only the VALIDATED `qualifyingScheduleEventId`
  is returned, and the route mirrors ONLY that (awaited, non-throwing, warns on
  failure) — never a raw client-supplied id.
- **Immutable completedAt** — the first transition owns it; idempotent repeats
  preserve it; a concurrent reselect preserves the winner's; an explicit
  different time on an already-complete event is `timestamp_conflict`.
- **Existing-event completion** — fully scoped (`.returning()` affected-row
  check on id + clinic + case + service) and compatibility-validated before
  reuse.
- **Same-case link sync** — a clinicless/underfilled same-case event is
  synchronized (clinic + canonical identity filled when NULL); a conflicting
  non-null identity is `identity_conflict`, never overwritten.
- **Expected-clinic hooks** — `onProcedureCompleted({procedureEventId,
  expectedClinicId, expectedAncillaryCaseId})`; another clinic's event is
  `cross_clinic_denied`; no retry persistence ever manufactures `clinicId=0`
  (`unscoped_event`).
- **One runtime gate** — `procedureNoteRuntimeEnabled()` (all three flags) gates
  eligibility, create/reuse, evidence sync, retry execution, the report hook,
  and legacy-writer suppression. Partial enablement preserves the legacy path.
- **Exact retries** — event-source `link_procedure_note` re-drives the
  completion hook (resolving only on full success; `linked_waiting_for_note_runtime`
  when the note runtime is OFF); note-source `link_procedure_note` reconciles
  ONLY that named note's exact reference; `link_procedure_note_evidence` updates
  note + reference ATOMICALLY (rollback on partial; `reference_missing` when
  none), signed-note-safe.
- **Evidence consistency** — a reused unsigned note's stale evidence is
  synchronized exactly (body/signature untouched); a signed note is never
  rewritten and its reference metadata reflects the SIGNED note's stored
  evidence (an exact `link_procedure_note_evidence` reconciliation is recorded).
  Reference metadata is always derived from the final note row, never directly
  from eligibility. Retry persistence returns `retryRecorded` and is never
  swallowed.

## 6c. Phase 2F-B — state machine, generator, lineage, void, signature sync

- **Procedure state machine** (`procedureStateMachine.ts`, routes
  `/api/procedure-events/{start,:id/pause,:id/resume,:id/cancel,:id/no-show,:id/unable-to-complete}`):
  clinic-scoped, server-owned transitions (`not_started→in_progress→paused⇄`,
  `→cancelled|no_show|unable_to_complete`). Each derives clinic from context,
  validates the exact case, stamps server time (`lastTransitionAt`) + actor,
  appends a PHI-free journey event, and applies an affected-row-checked
  exact-state WHERE. `start` INSERTS an `in_progress` row directly in a single
  write (never a completed row, `completed_at` NULL, no completion side effects;
  concurrent starts converge on the exact case winner). Terminal rows never
  reopen. Completion is allowed only from `in_progress`/`paused` (a
  `not_started` row never jumps to complete). `cancel`/`unable-to-complete`
  require a non-empty reason (400 otherwise); `no_show` reason is optional.
- **Configurable prerequisites** (`ancillary_service_prerequisite_config`,
  `evaluateProcedurePrerequisites`): consent/insurance/authorization/coding are
  NOT universal blockers — each requirement's effect (hard / soft / documentation
  / billing / claim) is per-clinic-or-default configured per stage. Always-hard:
  tenancy, active case, valid canonical appointment, and unresolved canonical
  identity (when Plexus writes are engaged); readiness reads are clinic-scoped in
  SQL. Overrides require an EXPLICIT request (`{reason, requirementCodes}`) — role
  eligibility ALONE never overrides; only named requirements, for an allowed
  role, with a non-empty reason, are cleared, and each applied override is
  audited transactionally with the start (audit failure defers the start).
- **Generator** (`procedureNoteGenerator.ts`, `FEATURE_PROCEDURE_NOTE_GENERATOR`
  + full runtime) — produces an **evidence-only procedure-completion
  CERTIFICATION** (option B): a non-findings document that certifies the exact
  procedure completed and a current canonical report is associated, and points
  the signer to that report. It is NOT rendered from report content and makes NO
  clinical-findings claims. Claims exactly one pending note (`.returning()`),
  requires the exact current report reference + resolvable readiness source
  (`report_content_unavailable` otherwise), `pending→generating→generated` (or
  `failed` with a PHI-free code + a durable `generate_procedure_note` retry).
  Never auto-signs; no document body in logs/ledger.
- **Lineage** (`procedureNoteLineage.ts`) — ATOMIC: report replacement /
  signed-note change supersedes the prior note + reference and inserts a new
  pending note in ONE transaction (shared handle for note/reference/audit,
  affected-row checked, full reference ownership predicates); a reference
  conflict or required-audit failure rolls the whole operation back (never
  `amended`/`voided` on partial success). The new note's exact reference is
  created or a durable exact `link_procedure_note` retry is recorded. Never two
  current notes; prior signed body/signer/signedAt immutable.
- **Void** (§7): cancel/no_show/unable_to_complete void the current unsigned
  note + reference atomically (generated body retained for audit); a signed note
  is superseded (body/signer/signedAt immutable); reference-zero-row rolls back.
- **Signature sync** (§8): after a canonical `post_procedure_note` sign/return,
  `syncProcedureNoteReferenceSignature` mirrors documentStatus + signedAt onto
  the exact reference (never throws; missing reference → exact retry). Order Note
  sync unchanged.
- **Reconciliation** (§9): new bounded-worker actions `generate_procedure_note`,
  `reconcile_procedure_note_lineage`, `void_procedure_note`,
  `sync_procedure_note_signature` — flag-gated, exact-source, exact-failure-id
  resolution, PHI-free.
- **Backfill** (`script/backfillCanonicalProcedureLifecycle.ts`): dry-run
  default (zero writes); apply gated by
  `BACKFILL_CANONICAL_PROCEDURE_LIFECYCLE_APPLY=YES` + all three flags; links
  only deterministic identities via the canonical hook (preserves
  completedAt/signed bodies, never generates), idempotent.

## 7. Migration 0054 (`migrations/0054_add_canonical_procedure_lifecycle.sql`)

Additive-only, unapplied, does not amend 0049–0053:

1. `procedure_events` += `ancillary_case_id`, `global_plexus_patient_id`,
   `patient_clinic_membership_id` (nullable, FK, `ON DELETE SET NULL`) +
   `idx_pe_ancillary_case`, plus `uq_pe_canonical_ancillary_case` (partial
   unique on `ancillary_case_id WHERE ancillary_case_id IS NOT NULL` — one
   canonical procedure event per case; additive since legacy rows are NULL).
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

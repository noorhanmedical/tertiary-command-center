# Phase 2K — Hardening Backlog

Deferred MINOR / HARDENING items surfaced during Phase 2F acceptance reviews.
None block Phase 2F (see the frozen acceptance severity gate in the Phase 2F
final-acceptance runbook): none is a tenant/security boundary failure, a
destructive/corruption risk, a core-workflow blocker, an unrecoverable exact
retry, a false clinical success, a wrong-case/clinic/service/episode attachment,
a signed-document rewrite, a type/build/test failure, or a migration
incompatibility. They are recorded here for a later hardening pass and must NOT
reopen or redesign Phase 2F.

## Reconciliation / generator truth

- **Reference *creation* on a generated note with no reference yet.**
  `syncProcedureNoteReferenceSignature` only *updates* an existing reference; when
  a generated note has no reference at all, the generator records a distinct
  `sync_procedure_note_signature` retry that will keep returning
  `no_reference`/`reference_missing` until a separate `link_procedure_note`
  failure creates the reference. This is strictly truthful (never a false
  `generated`) but relies on the link failure existing. Consider a dedicated
  "ensure-or-create reference" step for the generator's projection in Phase 2K.

- **Lineage retry service-type re-validation.** The retry worker binds a
  source-bearing `reconcile_procedure_note_lineage` to the exact named note by
  clinic/case/type and relies on the downstream case-scoped ensure to enforce
  service consistency (one lineage per case). An explicit `note.serviceType`
  comparison in the worker would be defense-in-depth (the schema's per-case
  identity already prevents cross-service mixing).

## Backfill

- **Report-acceptance status set drift (classifier vs. eligibility).** The
  backfill classifier's `ACCEPTABLE_REPORT` set
  (`uploaded/generated/approved/completed/signed`) is broader than the
  eligibility service's `ACCEPTABLE_REPORT_STATUSES`
  (`uploaded/completed/approved`). A report in status `generated`/`signed` can be
  classified `exact_report_evidence_available` + `note_generation_candidate`, yet
  `ensureCanonicalProcedureNoteForAncillaryCase` then returns `not_yet_eligible`
  at apply time. Result is a benign `apply_deferred` with `ensure_note`
  unresolved (no note created, no generation queued, no false success) — but the
  classifier's DRY-RUN plan overstates applicability. Align the two status sets
  (or have the classifier reuse the eligibility service) in Phase 2K for
  truthful DRY-RUN telemetry. Not a correctness/boundary risk.

- **Deterministic-link apply outcome granularity.** When a deterministic link
  completes but report evidence is missing, the case is reported
  `apply_deferred` with `actions.link="completed"` + `actions.report="unresolved"`.
  A future pass could add finer per-action telemetry (e.g. counts of link-only
  vs. fully-applied cases) for operator dashboards.

## Generator / ensure durability edge

- **Generator `not_yet_eligible` after a `created`/`reused` ensure records no
  generate retry.** When the ensure creates/reuses a note (eligibility passed in
  `createOrReuseProcedureNote`) and immediately drives the generator, a rare
  TOCTOU can have the generator's own eligibility re-read return
  `not_yet_eligible` — for which `classifyGeneratorOutcome` yields
  `generationRetryRecorded === undefined` (treated as durable), so the driving
  link/lineage failure is resolved and NO `generate_procedure_note` retry exists.
  The note still exists as `pending` and any later re-drive of the ensure (report
  hook, subsequent completion) re-attempts generation, so nothing clinical is
  lost and the evidence-only certification body is not on the signature critical
  path. Consider recording an explicit generate retry on generator
  `not_yet_eligible` in Phase 2K for self-healing without an external re-drive.

## Notes

- All feature flags remain default OFF; migration 0054 remains additive and
  unapplied; no migration 0055 exists. These items are safe to defer.

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

## Phase 2G — canonical billing readiness + Billing Document (deferred)

None block Phase 2G under the frozen gate: no tenant/cross-case exposure, no
wrong-episode attachment, no destructive migration (0055 is additive/widening
only), no Billing Document generated without exact evidence, no invented
clinical/billing/payer data, no signed-document mutation, no unrecoverable
retry, no false generated/ready success without durable reconciliation, no
flags-OFF legacy regression, and check/tests are green.

- **Backfill apply skips stale-but-existing readiness (completeness).**
  `script/backfillCanonicalBillingReadiness.ts` `main()` runs `queueApplyWork`
  only when the classifier emits `readiness_candidate` (no current readiness
  yet) or `billing_document_candidate` (no current doc yet). A case whose
  readiness/doc already exists but whose evidence has since changed is reported
  `existing_current_readiness` / `existing_current_billing_document` and is NOT
  re-evaluated by the backfill. This is a one-time seeding gap only — the live
  orchestration hook and the explicit evaluate API supersede on evidence change,
  so nothing goes stale silently in production; the backfill just under-reports
  re-apply candidates. Consider having apply always re-evaluate (evaluator is
  idempotent + supersedes) in Phase 2K. Not a correctness/boundary risk.

- **Reference supersession in `supersedeStaleBillingDocument` is best-effort.**
  `server/services/billingLifecycle/billingLifecycleOrchestration.ts` stamps the
  Billing Document row `superseded` with an affected-row check (truthful), but
  the follow-on `ancillary_document_references` supersede UPDATE is fire-and-
  forget (no affected-row check, no `supersede_billing_document` retry queued on
  miss). The packet ROW is correctly superseded (no false current/generated
  state), and the next `evaluate` re-drives the supersede, so the reference
  self-heals on the next canonical evaluation — but a dedicated durable
  reference-supersede retry would close the window deterministically. The
  `supersede_billing_document` retry action exists in the enum + handler
  (`retrySupersede`) but is currently never queued by any writer (dead path).
  Wire the writer to record it, or drop the unused action, in Phase 2K.

- **`retrySupersede` resolves on a 0-row supersede.** The handler resolves its
  exact failure even when `supersedeStaleBillingDocument` returns false due to a
  0-row document UPDATE (another worker already superseded). The post-condition
  (no stale current doc) holds either way, so this is truthful; noted for
  symmetry with the stricter affected-row semantics elsewhere.

## Notes

- All feature flags remain default OFF; migrations 0054–0055 remain additive and
  unapplied. Migration 0055 partial-unique current-row indexes key ONLY on
  `ancillary_case_id IS NOT NULL` canonical rows (no screening+service merge of
  separate episodes). These items are safe to defer.

## Phase 2G billing readiness / Billing Document (closeout review)

Verified during the independent Phase 2G BLOCKER/MAJOR closeout review. None
meets the frozen acceptance gate (no false ready/generated, no tenant/evidence
acceptance, no unrecoverable retry, no destructive migration). Deferred:

- **Report source-row validation now implemented (durability closeout).**
  `loadExactReportEvidence` re-loads the underlying `case_document_readiness`
  row at `ref.sourceId` and independently re-asserts clinic/service/documentType
  ownership plus deterministic execution-case/screening linkage and an acceptable
  source status (distinct `report_source_*` blocker codes). No further work
  required; noted here only to supersede the prior deferral.

- **`ensureBillingReferenceDurability` does not filter superseded references.**
  The §2 durability lookup keys on `(sourceTable, sourceId=billingDocumentId,
  documentKind=billing_document)` and returns `reference_present` for any owned
  row, including a `supersededAt != null` one. For a still-generated/approved doc
  a superseded reference is anomalous and, even if resolved, the sync/link paths
  reconcile via separate failures — so no false durable success arises. Consider
  adding `isNull(supersededAt)` (and preferring a current row) for defence in
  depth in a later pass.

- **Report `documentType` rejection is untested.** The `src.documentType !==
  "report"` guard is present and correct but not exercised by a dedicated test.
  Add a case in the report source-validation suite.

- **`retrySupersede` resolves after a non-committed re-evaluation.** The
  `supersede_billing_document` retry handler re-evaluates, then supersedes any
  current document whose fingerprint differs (passing `null` when the
  re-evaluation returned a transient status such as
  `requirements_unavailable_retry_recorded`) and resolves unconditionally.
  Superseding is the fail-closed direction (never a false ready/generated), AND
  no code path currently enqueues `supersede_billing_document`, so this handler
  is unreachable in practice. Consider (a) deferring resolution unless the
  re-evaluation status is a committed `ready_to_generate`/`missing_requirements`,
  and (b) removing or exercising the handler once an enqueue site exists.

## Phase 2H — Clinician Portal canonical overview (read model)

- **Finance `evaluated` count assumes one current readiness row per case.**
  `buildFinance` increments `evaluated` once per non-superseded
  `billing_readiness_checks` row rather than deduping by `ancillaryCaseId`. This
  is correct given the Phase 2G evaluator's supersede-on-write invariant (at most
  one current snapshot per case), but if two current rows for one case ever
  coexist (evaluator race/bug), finance would double-count. Consider deduping to
  the newest `evaluatedAt` per `ancillaryCaseId` as defense-in-depth so the read
  model is robust to an upstream invariant violation. `readyToGenerate`,
  `missingRequirements`, and the row list share the same assumption.

- **`counts_truncated` warning basis is the post-filter list.** In `buildFinance`
  the warning uses `current.length >= SCAN_LIMIT` (after the in-memory
  clinic/superseded filter), and orders/notes uses `refs.length` (pre-filter).
  If the raw fetch returns exactly `SCAN_LIMIT` rows and a few are dropped by the
  in-memory filter, finance could under-report truncation. Base every section's
  truncation warning on the raw fetched length (`readiness.length`,
  `refs.length`, `notes.length`, `casesRaw.length`) for consistency. Cosmetic
  only — 2000 current rows per clinic/section is far beyond realistic volume and
  there is no correctness or tenancy impact.

- **Admin users cannot use the canonical overview endpoint.** `clinicContext`
  sets `req.clinicId = null` for `admin`, and `requireClinicScope` returns 403
  when clinicId is null, so admins (who are otherwise authorized by
  `requireClinicianOrAdmin`) always get 403. This is fail-closed and matches the
  existing `physicianPortal` pattern, so it is safe — but if admins should see a
  clinic-scoped overview, a clinic selector / explicit clinic param would be
  needed (never body-supplied). The intended contract is now pinned by a test
  (admin + `clinicId: null` → 403) and documented in `clinicianPortalGuard.ts`;
  broadening to an all-clinics portal read remains deferred to Phase 2K.

- **Report reference case-linkage is best-effort (schema-limited).**
  `case_document_readiness` has no `ancillary_case_id` column, so
  `validateReportRef` binds a report reference to a case only via
  `executionCaseId`, and only when the reference carries a non-null
  `executionCaseId`. A report reference with a null `executionCaseId` is
  validated by clinic + service + `documentType=report` + current status, but not
  by a per-case identity — the strongest linkage the current schema allows. The
  `missingEvidence` heuristic (procedure_note present, no report for the same
  case) therefore relies on the reference's own `ancillaryCaseId`, which is
  exact. Consider adding an `ancillary_case_id` to `case_document_readiness` (or a
  deterministic join) in a later pass for a fully exact report↔case binding.

- **Client migration-vs-generic error uses message inspection.** The SERVER
  contract is typed (`MigrationMissingError` → 503 `code`), but
  `useCanonicalOverview.isMigrationMissingError` distinguishes the migration
  banner from the generic-error banner by inspecting the React Query error
  message (`getQueryFn` throws `"<status>: <body>"`). Both branches are truthful
  non-zero error states (never a zero-count render), so this is cosmetic; a
  structured error surfaced by a custom `queryFn` would be cleaner.

## Phase 2I — PCS/ACS canonical views (closeout review)

None block Phase 2I under the frozen gate (no cross-clinic disclosure, no identity
collision/demographic fallback, no episode merging, no false current stage, no
superseded-as-current, no mock in canonical mode, no claims/invoice/payment, no
unauthorized access, no unbounded/N+1, migration-missing → 503, no failed-section-
as-zero, no unrelated redesign; check/tests/build/manifest green).

- **Admin roles are allow-listed but scope-denied in production.** `/api/pcs`
  and `/api/acs/canonical-view` include `admin` in their role sets, but
  `clinicContext` sets `req.clinicId = null` for admins, so `requireClinicScope`
  returns 403. This is the deliberate 2H fail-closed pattern (prevents any
  cross-clinic admin read); a clinic-selector / explicit server-context clinic
  for admins would be needed to actually serve admins. Pinned by the intended
  contract (missing clinic scope → 403). Not a boundary risk.

- **PCS identity-display reads are not migration-wrapped.** In
  `pcsCanonicalView.ts`, the `global_plexus_patients` / `patient_clinic_memberships`
  display-name reads run outside `loadOrNull`; a missing 0049 table still yields a
  truthful 503 (the raw pg `42P01` propagates and the route's migration set catches
  it), but an ordinary read failure there fails the whole request rather than
  degrading to "display unavailable". Consider wrapping them so display-only
  failures degrade gracefully. Not a correctness/boundary risk (identity is never
  inferred from demographics; only the authorized display name is affected).

- **`iso()` double-wraps already-Date values** (`caseStageVector.ts`) — harmless
  `new Date(existingDate)`; noted for symmetry only.

## Phase 2I truth closeout (independent review)

Zero blockers, zero majors. Deferred MINOR/HARDENING:

- **Billing Document fingerprint null-null equality edge.**
  `server/services/canonicalStage/caseStageVector.ts` binds the current Billing
  Document to the current readiness by `billingReadinessCheckId` (authoritative) AND
  `evidenceFingerprint`. When BOTH fingerprints are null the `!==` check passes
  vacuously — not a staleness bypass today (the id binding guarantees the doc points
  at the current readiness row), but if Phase 2G ever writes a null fingerprint the
  fingerprint check degrades to a no-op. Hardening: treat a null fingerprint on
  either side as unverifiable → `billing_document_stale_fingerprint` + status null.
- **Stage-vector identity `available` default is loose.** In `buildOne`,
  `identity.available` defaults to `globalPlexusPatientId != null && membershipId
  != null` without a verified membership. Safe today (display fields are hard-null
  there so no PHI leaks, PCS overwrites the whole identity block via
  `verifyCaseIdentity`, ACS never renders display), but defaulting `available:false`
  would be symmetric so the flag can never read "available" without proof.

## Phase 2I final acceptance (independent review)

Zero blockers, zero majors — ACCEPT. Deferred MINOR/HARDENING:

- **`isTerminalHalt` lists only `procedure`.** A cancelled/no_show *appointment*
  halts progression correctly because `isComplete("appointment")` excludes those
  statuses (deriveCurrentStage stops there), but the halt is implicit for
  appointments rather than explicit in `isTerminalHalt`. Cosmetic — behavior is
  correct and tested.
- **Appointment `blocked`/`pending_sync` coverage.** The current-leaf status is
  preserved status-agnostically (never coerced to "missing"); `cancelled`/`no_show`
  are asserted and `blocked`/`pending_sync` are now covered by the terminal-status
  loop. Noted for completeness.

# Phase 2K — Execution Matrix

Converts every item in `PHASE_2K_HARDENING_BACKLOG.md` into an explicit, classified
execution row. Phase 2K is **behavior-preserving reliability/hardening** — it makes
existing canonical truth more reliable, it does not invent business semantics.

Classifications: `MANDATORY_HARDENING` · `PRODUCT_DECISION_REQUIRED` ·
`UI_REDESIGN_DEFERRED` · `ALREADY_FIXED` · `NO_LONGER_APPLICABLE`.

Source Phase 2J HEAD: `8276cb9bb68d46555df291ddda206551be18edab`. Branch:
`phase/2k-enterprise-hardening` (stacked on `phase/2j-canonical-claims-invoices-payments`).

| ID | Orig phase | Backlog item (short) | File · symbol | Current behavior | Desired hardened behavior | Risk if unchanged | Classification | Impl? | Migration? | Behavioral test | Verdict |
|----|-----------|----------------------|--------------|------------------|---------------------------|-------------------|----------------|-------|-----------|-----------------|---------|
| K1 | 2F | Reference creation on a generated note with no reference | `procedureLifecycle` · `syncProcedureNoteReferenceSignature` / ensure | sync only UPDATEs an existing ref; creation depends on a separate `link_procedure_note` failure | deterministic ensure-or-create: a generated note that should have a canonical ref eventually has exactly one current ref without depending on another failure | recovery depends on an unrelated failure existing | MANDATORY_HARDENING | yes | no | ensure create/reuse/converge/wrong-scope/dup/signed-immutable | pending |
| K2 | 2F | Lineage retry service-type re-validation | retry worker · `reconcile_procedure_note_lineage` | worker binds by clinic/case/type; relies on downstream case-scoped ensure for service | explicit `note.serviceType == failure.serviceType` before repair; wrong service → zero mutation | defense-in-depth gap (schema per-case identity already prevents cross-service) | MANDATORY_HARDENING | yes | no | wrong-service → zero mutation | pending |
| K3 | 2F | Report-acceptance status set drift (classifier vs eligibility) | backfill classifier · `ACCEPTABLE_REPORT` vs `ACCEPTABLE_REPORT_STATUSES` | classifier set broader than eligibility set → DRY-RUN overstates applicability | classifier + live eligibility share ONE source/helper; DRY-RUN reports exactly what apply considers eligible | misleading operator telemetry (no correctness risk) | MANDATORY_HARDENING | yes (classifier only) | no | table-driven per report status | pending |
| K4 | 2F | Deterministic-link apply outcome granularity | backfill · per-action telemetry | coarse `apply_deferred` outcome | finer per-action counts | operator-dashboard telemetry only | PRODUCT_DECISION_REQUIRED | no | no | — | deferred |
| K5 | 2F | Generator `not_yet_eligible` records no generate retry | `procedureNoteGenerator` · `classifyGeneratorOutcome` | TOCTOU: generator re-read `not_yet_eligible` → no durable `generate_procedure_note` retry | record one exact durable generation retry when retryable; converge; later eligible generates + resolves | recovery may need external re-drive | MANDATORY_HARDENING | yes | no | created/reused+not_yet_eligible→retry; no dup; later eligible resolves | pending |
| K6 | 2G | Backfill apply skips stale-but-existing readiness | `backfillCanonicalBillingReadiness` | apply only for no-current-row candidates | (whether apply always re-evaluates) | one-time seeding under-report; live hook supersedes | PRODUCT_DECISION_REQUIRED | no | no | — | deferred |
| K7 | 2G | Reference supersession best-effort | `billingLifecycleOrchestration` · `supersedeStaleBillingDocument` | doc row superseded (checked); ref supersede fire-and-forget; `supersede_billing_document` retry never queued (dead) | deterministic durable ref supersession; on miss record exact retry targeting the exact BD/ref lineage; wire or remove the dead action | window where ref not superseded | MANDATORY_HARDENING | yes | no | ref succeeds / ref misses→retry durable / dup fail-closed | pending |
| K8 | 2G | `retrySupersede` resolves on 0-row / non-committed re-eval | `billingLifecycleOrchestration` · `retrySupersede` | resolves even on 0-row or transient re-eval | resolve only when the required post-condition is proven | retry resolves without proving post-condition | MANDATORY_HARDENING | yes | no | transient re-eval → retry unresolved | pending |
| K9 | 2G | Report source-row validation | `loadExactReportEvidence` | re-loads `case_document_readiness`, re-asserts clinic/service/documentType + linkage + status | (met) | — | ALREADY_FIXED | no | no | (exists) | already-fixed |
| K10 | 2G | `ensureBillingReferenceDurability` doesn't filter superseded refs | `billingLifecycleSupport` · `ensureBillingReferenceDurability` | returns `reference_present` for any owned row incl. superseded | require `supersededAt IS NULL` for a current ref; only-superseded → repair; dup current → conflict | superseded ref counted as durable | MANDATORY_HARDENING | yes | no | current/only-superseded/wrong-src/dup | pending |
| K11 | 2G | Report `documentType` rejection untested | report source-validation | guard present, untested | dedicated `documentType !== "report"` test + wrong clinic/service/exec/screening/superseded/status | coverage gap | MANDATORY_HARDENING | no | no | documentType + fail-closed matrix | pending |
| K12 | 2H | Finance `evaluated` count assumes one readiness row per case | `clinicianPortal` · `buildFinance` | increments per non-superseded row (double-counts on dup) | dedupe/ conflict on duplicate current readiness per case; no silent newest-wins | double-count on upstream invariant violation | MANDATORY_HARDENING | yes | no | dup readiness / exact one | pending |
| K13 | 2H | `counts_truncated` post-filter basis | `clinicianPortal` · `buildFinance` | uses post-filter length inconsistently | RAW fetched row count; SCAN+1 | under-report truncation | MANDATORY_HARDENING | yes | no | raw at limit+1; filter doesn't hide truncation | pending |
| K14 | 2H | Admin users cannot use canonical overview | `clinicianPortalGuard` | admin `clinicId=null` → 403 (fail-closed) | admin clinic-scope requires explicit server-controlled selection context (future) | none (fail-closed today) | PRODUCT_DECISION_REQUIRED | no | no | (403 pinned) | deferred |
| K15 | 2H | Report reference case-linkage best-effort (schema-limited) | `validateReportRef` | binds via `executionCaseId` only (no `ancillary_case_id` col) | fully exact report↔case identity | needs schema redesign | PRODUCT_DECISION_REQUIRED | no | no | — | deferred |
| K16 | 2H | Client migration-vs-generic error uses message inspection | `useCanonicalOverview` · `isMigrationMissingError` | inspects RQ error message string | structured error {status, code, message}; behavior unchanged | fragile string parsing (cosmetic) | MANDATORY_HARDENING | yes | no | migration/forbidden/generic distinguishable | pending |
| K17 | 2I | Admin allow-listed but scope-denied PCS/ACS | pcs/acs routes | admin `clinicId=null` → 403 | explicit server-context clinic selection (future) | none (fail-closed) | PRODUCT_DECISION_REQUIRED | no | no | (403 pinned) | deferred |
| K18 | 2I | PCS identity-display reads not migration-wrapped | `pcsCanonicalView` | display reads outside `loadOrNull`; ordinary failure fails whole request | display-only failure → display unavailable/null (no demographic fallback), verified IDs preserved, PHI-free warning; migration-missing still 503 | ordinary read failure fails canonical request | MANDATORY_HARDENING | yes | no | display fail / migration / wrong-clinic / merged / no-demographic-fallback | pending |
| K19 | 2I | `iso()` double-wraps Date | `caseStageVector` · `iso` | harmless `new Date(existingDate)` | (cosmetic) | none | NO_LONGER_APPLICABLE | no | no | — | n/a |
| K20 | 2I | Billing Document fingerprint null-null equality | `caseStageVector` (+ read-model validator) | `null !== null` passes vacuously when both fingerprints null | null/empty on either side → unverifiable → status null / conflicting; never advance on two absent fingerprints | staleness bypass if BD ever writes null fingerprint | MANDATORY_HARDENING | yes | no | null-null / null-one-side / equal / unequal | pending |
| K21 | 2I | Stage-vector identity `available` default loose | `caseStageVector` · `buildOne` identity | `available = ids != null` | `available=false` unless verified by canonical identity validator; PCS overwrites after its verify | flag reads available without proof | MANDATORY_HARDENING | yes | no | ids-present-unverified→false / verified→true / missing / merged-inactive | pending |
| K22 | 2I | `isTerminalHalt` lists only `procedure` | `caseStageVector` | implicit appointment halt | (cosmetic; correct+tested) | none | NO_LONGER_APPLICABLE | no | no | — | n/a |
| K23 | 2I | Appointment blocked/pending_sync coverage | `caseStageVector` | covered by terminal loop | (met) | — | ALREADY_FIXED | no | no | (covered) | already-fixed |
| K24 | 2I | Verified-window ordering-contingent / covering index | `pcs` · `loadVerifiedStream` | ORDER BY + LIMIT window+1; comment added | covering index makes ordering cheap (0057 candidate) | none (correct today) | MANDATORY_HARDENING (index eval) | maybe (0057) | maybe | schema↔migration parity if 0057 | pending |
| K25 | 2I | `loadUnresolvedStream` membership bound | `pcs` | `.limit(MAX*2)` safe under ≤1-membership invariant | (met) | — | NO_LONGER_APPLICABLE | no | no | — | n/a |
| K26 | 2J | Refund does not free receipt capacity | `paymentCommands` · `receiptApplied` | apply-only sum; refund doesn't add back | (return refunded capacity) — changes accepted semantics | conservative (under-allocates only) | PRODUCT_DECISION_REQUIRED | no | no | — | deferred |
| K27 | 2J | `adjustment` allocation event type has no command path | `allocationLineage` | schema allows; fail-closed | new approved adjustment command | none (fail-closed) | PRODUCT_DECISION_REQUIRED | no | no | — | deferred |
| K28 | 2J | DB-level provenance CHECKs on entity tables | schema/migrations | only transitions has `ck_cft_command_provenance` | additive CHECKs on claim/invoice/payment/allocation IF all command paths + fixtures satisfy them | defense-in-depth gap | MANDATORY_HARDENING (0057 eval) | maybe | maybe (0057) | schema↔migration parity | pending |
| K29 | 2J | Explicit overpayment / credit ledger | financial | `is_overpayment` flag only | first-class overpayment surface | none | PRODUCT_DECISION_REQUIRED | no | no | — | deferred |
| K30 | 2J | Exhaustive N+1 matrix at 1/25/100 | tests | batched (proven by count test) | explicit 1/25/100 matrix across all read models | none (already batched) | MANDATORY_HARDENING | no (test) | no | phase2KQueryBoundaries | pending |
| K31 | 2J | Dedicated overflow test for stage identity/parent-claim loads | tests | SCAN+1 folds into truncation | targeted overflow matrix | none (page-bounded) | MANDATORY_HARDENING | no (test) | no | phase2KOverflowTruth | pending |
| K32 | 2J | Unified canonical Finance surface | client Finance | appended read-only panel + legacy behind flag | unify (visual/product) | none | UI_REDESIGN_DEFERRED | no | no | — | deferred |
| K33 | 2J | Replay response reports `from: ""` | `commandSupport`/`claim`+`invoice`Commands | idempotent replay returns empty `from` | `resolveFinancialCommandRace` returns exact prior from/to from the audit row; later advancement doesn't change replay | inaccurate response contract | MANDATORY_HARDENING | yes | no | claim/invoice replay exact from/to; advancement-stable; diff-intent conflict | pending |
| K34 | 2J | Refunded-then-repaid `paid` masks residual refund | `caseStageVector` | `paid` when net==total | (accepted rule; balance exposes refundedAmount) | none | PRODUCT_DECISION_REQUIRED | no | no | — | deferred |
| K35 | 2J | No distinct `imported` receipt path | `paymentCommands` · `recordCanonicalPayment` | imports → `posted` | map imports → `imported` (changes lifecycle) | none | PRODUCT_DECISION_REQUIRED | no | no | — | deferred |
| K36 | 2J | Full refund reopens claim to `submitted` | `paymentCommands` · `negateAllocation` | reopen → `submitted` | reopen to pre-payment status (changes semantics) | adjudication-state downgrade (no false money) | PRODUCT_DECISION_REQUIRED | no | no | — | deferred |
| K37 | 2J | Stage vector assembles lineage inline vs shared builder | `caseStageVector` · `claimLineageCtx`/`invoiceLineageCtx` | invoice ctx already uses the shared loader (2J parity fix); claim ctx still inline | ONE canonical builder set owns lineage assembly for read model + stage + write-path | duplication could drift | MANDATORY_HARDENING | yes | no | 3-consumer parity test | pending |

## Additional Phase 2K mandatory items (from the task, not pre-existing backlog rows)

| ID | Area | Requirement | Classification | Verdict |
|----|------|-------------|----------------|---------|
| K38 | tests | Failure-injection matrix (read/write/post-insert/retry-record failures fail closed) | MANDATORY_HARDENING | pending |
| K39 | tests | Concurrency hardening matrix (ensure/retry/correction/allocation/negation converge, no dup, exact replay) | MANDATORY_HARDENING | pending |
| K40 | security | Tenancy/identity regression across all 2K-touched paths (server/session scope only; never name/DOB/MRN/fuzzy) | MANDATORY_HARDENING | pending |
| K41 | retries | System-wide retry inventory (`PHASE_2K_RETRY_INVENTORY.md`); no dead/queued-unhandled/handled-unqueued/resolve-without-postcondition | MANDATORY_HARDENING | pending |
| K42 | migrations | 0057 policy — create ONLY if genuinely needed for safe additive defense-in-depth (indexes/CHECKs); else "No Phase 2K migration required" | MANDATORY_HARDENING (eval) | pending |

## Totals (pre-implementation)
- MANDATORY_HARDENING: 22 (K1,K2,K3,K5,K7,K8,K10,K11,K12,K13,K16,K18,K20,K21,K24,K28,K30,K31,K33,K37,K38–K42 grouped)
- PRODUCT_DECISION_REQUIRED: 11 (K4,K6,K14,K15,K17,K26,K27,K29,K34,K35,K36) → `POST_2K_PRODUCT_DECISIONS.md`
- UI_REDESIGN_DEFERRED: 1 (K32)
- ALREADY_FIXED: 2 (K9,K23)
- NO_LONGER_APPLICABLE: 3 (K19,K22,K25)

A row reaches **VERIFIED** only after its implementation + behavioral test land and the
fresh-context adversarial review passes. `PRODUCT_DECISION_REQUIRED` rows do **not**
block Phase 2K PASS (2K is behavior-preserving); each is recorded with its tradeoff in
`POST_2K_PRODUCT_DECISIONS.md`.

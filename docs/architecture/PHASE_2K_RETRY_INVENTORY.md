# Phase 2K — Canonical Retry Inventory

Rebuilt from the ACTUAL `ANCILLARY_DOCUMENT_FAILURE_ACTIONS` enum in
`shared/schema/ancillaryDocuments.ts` (19 values). Every enum value has exactly one
row. Final status ∈ {WIRED, INTENTIONALLY_NOT_QUEUED, REMOVED}. This table is kept
honest by the executable `tests/unit/phase2KRetryInventoryCoverage.test.ts`
(K41: 19/19; WIRED=16, INTENTIONALLY_NOT_QUEUED=3) — no future-tense placeholders.

Invariant: no action may be dead, queued-but-unhandled, handled-but-never-queued, or
resolving without proving its post-condition. Dedupe identity for every action is
`(clinicId, ancillaryCaseId, documentKind, sourceTable, sourceId, requestedAction)`;
races converge via the repo's 23505 unique-violation recovery in
`recordAncillaryDocumentFailure`.

| Action | Writer (enqueue) — exact | Worker (dispatch) | source contract | Success post-condition | Status |
|--------|--------------------------|-------------------|-----------------|------------------------|--------|
| `link_order_note` | `orderNoteOrchestration.ts` (`recordAncillaryDocumentFailure`) | `retryWorker.ts` | order_note / clinic+case | current order-note reference exists | WIRED |
| `link_order_note_evidence` | `orderNoteService.ts` | `retryWorker.ts` | order_note evidence / clinic+case+source | immutable admin-review evidence linked | WIRED |
| `link_report` | `documentReferenceWriter.ts` (`RETRY_ACTION[kind]`) | `retryWorker.ts` | report / clinic+case+source | current report reference exists | WIRED |
| `link_consent` | `documentReferenceWriter.ts` (`RETRY_ACTION[kind]`) | `retryWorker.ts` | consent / clinic+case+source | current consent reference exists | WIRED |
| `link_screening_form` | `documentReferenceWriter.ts` (`RETRY_ACTION[kind]`) | `retryWorker.ts` | screening_form / clinic+case+source | current screening-form reference exists | WIRED |
| `link_procedure_note` | `procedureNoteLineage.ts` + `procedureNoteService.ts` | `retryWorker.ts` | procedure_note / clinic+case+note | current procedure-note reference exists (K1 ensure-or-create) | WIRED |
| `link_procedure_note_evidence` | `procedureNoteService.ts` | `retryWorker.ts` | procedure_note evidence / clinic+case+note | immutable procedure-event/report evidence linked | WIRED |
| `generate_procedure_note` | `procedureNoteGenerator.ts` (`recordGenerateRetry`) | `retryWorker.ts` | procedure_note / clinic+case+note | note generated (or truthful terminal); K5 records only genuinely-retryable deferrals | WIRED |
| `reconcile_procedure_note_lineage` | `procedureNoteLineage.ts` | `retryWorker.ts` | procedure_note / clinic+case+note | superseded + amendment created (K2 service-type gated) | WIRED |
| `void_procedure_note` | `procedureNoteLineage.ts` | `retryWorker.ts` | procedure_note / clinic+case+note | note voided when procedure invalid | WIRED |
| `sync_procedure_note_signature` | `procedureNoteService.ts` + `procedureNoteGenerator.ts` | `retryWorker.ts` | procedure_note / clinic+case+note | signature mirrored onto the exact current reference | WIRED |
| `evaluate_billing_readiness` | `billingLifecycleOrchestration.ts` + `billingReadinessEvaluator.ts` | `billingRetryHandlers.ts` | billing_document / clinic+case | current readiness snapshot evaluated | WIRED |
| `generate_billing_document` | `billingLifecycleOrchestration.ts` | `billingRetryHandlers.ts` | billing_document / clinic+case+billingDocumentId | Billing Document generated | WIRED |
| `link_billing_document` | `billingDocumentGenerator.ts` (`recordBillingRefRetry`) | `billingRetryHandlers.ts` | billing_document / clinic+case+billingDocumentId | current BD reference created (K10 non-superseded-only) | WIRED |
| `supersede_billing_document` | `billingLifecycleOrchestration.ts` | `billingRetryHandlers.ts` (`retrySupersede`, K8 exact source-bound) | billing_document / clinic+case+**exact** sourceId=billingDocumentId | no stale current document AND exact reference durably superseded | WIRED |
| `sync_billing_document_reference` | `billingDocumentGenerator.ts` (`recordBillingRefRetry`) | `billingRetryHandlers.ts` | billing_document / clinic+case+billingDocumentId | existing BD reference status mirrored | WIRED |
| `create_reference` | — | — | — | — | INTENTIONALLY_NOT_QUEUED |
| `refresh_projection` | `legacyProjection.ts` | — | — | — | INTENTIONALLY_NOT_QUEUED |
| `supersede_reference` | — | — | — | — | INTENTIONALLY_NOT_QUEUED |

### INTENTIONALLY_NOT_QUEUED — documented reasons
- **`create_reference`** — enum-reserved reference-lifecycle verb; no active writer enqueues it and no worker dispatches it. Reference creation is driven by the exact `link_*` actions (`link_report`/`link_procedure_note`/`link_billing_document`), so a generic `create_reference` retry would be redundant. Not dead (never queued, never handled — nothing to resolve).
- **`refresh_projection`** — legacy projection-refresh verb (`legacyProjection.ts`); not dispatched by a canonical retry worker. Superseded by the exact `link_*`/`generate_*` canonical paths. Retained in the enum for historical rows only.
- **`supersede_reference`** — enum-reserved reference-supersession verb; the canonical supersession path uses `supersede_billing_document` + the exact reference-durability helper (K7/K8/K12). No active writer/worker.

No action is dead-with-a-handler-but-no-writer or written-but-never-handled: every
WIRED action has both; the three INTENTIONALLY_NOT_QUEUED actions have neither a writer
nor a worker (so there is nothing to resolve and no false-durable path). Enforced by the
K41 coverage test.

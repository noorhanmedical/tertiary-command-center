# Phase 2K — Canonical Retry Inventory

Every canonical retry action introduced through Phases 2C–2J, its writer (enqueue site),
its worker (resolver), and its post-condition truth. Source of truth: the
`REQUESTED_ACTIONS` enum in `shared/schema/ancillaryDocuments.ts`, the ancillary-document
retry worker (`server/services/ancillaryDocuments/retryWorker.ts`), and the billing retry
handlers (`server/services/billingLifecycle/billingRetryHandlers.ts`).

Invariant Phase 2K enforces: **no retry action may remain dead, queued-but-unhandled,
handled-but-never-queued, or resolving without proving its post-condition.**

| Action | Writer (enqueue) | Worker (resolve) | Entity / scope | Success post-condition | Failure post-condition | Idempotent / dup | Status → 2K |
|--------|------------------|------------------|----------------|------------------------|------------------------|------------------|------------|
| `link_report` | `documentReferenceWriter` | ancillary retryWorker | clinic+case+report source | current report reference exists | retained | dedup by exact source | wired |
| `link_consent` | `documentReferenceWriter` | ancillary retryWorker | clinic+case+consent source | current consent ref exists | retained | dedup | wired |
| `link_screening_form` | `documentReferenceWriter` | ancillary retryWorker | clinic+case+screening source | current screening-form ref exists | retained | dedup | wired |
| `link_procedure_note` | `procedureNoteService` (322/339/472), `procedureNoteLineage` (204) | retryWorker (233) | clinic+case+procedure_note source | current procedure-note reference exists | retained | dedup by exact note/source | wired; **K1** makes ensure-or-create deterministic so recovery no longer depends on THIS failure existing |
| `link_procedure_note_evidence` | `procedureNoteService` (568) | retryWorker (236) | clinic+case+note | immutable procedure-event/evidence link exists | retained | dedup | wired |
| `generate_procedure_note` | `procedureNoteGenerator` (241) | retryWorker (239) | clinic+case+note | note generated (or truthful terminal) | retained | dedup by exact note | wired; **K5** adds an enqueue on generator `not_yet_eligible` TOCTOU so recovery is self-healing |
| `reconcile_procedure_note_lineage` | `procedureNoteLineage` (178) | retryWorker (242) | clinic+case+note | superseded + amendment created | retained | dedup | wired; **K2** adds explicit `note.serviceType == failure.serviceType` before mutation |
| `sync_procedure_note_signature` | `procedureNoteService` (818), `procedureNoteGenerator` (211) | retryWorker (248) | clinic+case+note | signature mirrored onto the exact current reference | retained until a reference exists | dedup | wired; depends on a reference — **K1** guarantees one exists deterministically |
| `supersede_billing_document` | (none — dead path per 2G backlog) | `billingRetryHandlers.retrySupersede` (40) | clinic+BD lineage | no stale current Billing Document | resolves even on 0-row / transient re-eval (backlog K8) | — | **K7/K8** — wire from a real writer with a proven post-condition, OR remove in favour of `sync_billing_document_reference` if that fully supersedes it |
| `sync_billing_document_reference` | (verify enqueue in Step 12) | `billingRetryHandlers` (`BILLING_RETRY_ACTIONS`) | clinic+BD reference | current BD reference durable (`supersededAt IS NULL`, exact source) | retained | dedup | WIRED (K7): recorded when reference supersession unproven; retrySupersede proves post-condition (K8) |

## Phase 2K actions on this inventory
- **K1** (`link_procedure_note` / `sync_procedure_note_signature`): make reference ensure-or-create deterministic so signature sync no longer depends on a separate `link_procedure_note` failure already existing.
- **K2** (`reconcile_procedure_note_lineage`): explicit service-type revalidation in the worker; wrong service → zero mutation.
- **K5** (`generate_procedure_note`): enqueue a durable generate retry on the generator's `not_yet_eligible` TOCTOU; converge, no duplicate.
- **K7** (`supersede_billing_document` / `sync_billing_document_reference`): eliminate the dead path — either wire `supersede_billing_document` from a real writer with a proven post-condition, or confirm `sync_billing_document_reference` fully supersedes it and remove the dead action (backwards-safe).
- **K8** (`retrySupersede`): resolve only when the post-condition (no stale current doc / durable current reference) is proven; a transient re-evaluation leaves the retry unresolved.

Every "resolves without proving post-condition" and "dead/handled-but-never-queued" case
above is addressed by K7/K8 (billing) and K5 (generator). Ancillary-document actions are
all writer↔worker paired and dedup-safe. Final verification is recorded per row when the
K1/K2/K5/K7/K8 implementations and their concurrency/failure-injection tests land.

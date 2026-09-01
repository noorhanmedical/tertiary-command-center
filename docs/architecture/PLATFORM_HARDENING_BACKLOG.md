# Platform Hardening Backlog

> **Scope:** PR-sized hardening sequence derived from the approved
> audit + main-branch verification. Captures the state on `main`
> (`88c0a1d`). Phase 3 Exception Intelligence work lives on the
> `phase-3-ai-exception-intelligence` branch and is not part of this
> backlog.
>
> This document does **not** implement anything. It lists what exists
> but is unwired, what can be fixed by wiring alone, and what would
> require new schema.

## 1. Top operational failures on main (ranked by severity)

1. **Document upload + consent signing do NOT update readiness or
   write timeline events.** `server/routes/portal.ts:656-827` (upload)
   and `server/routes/portal.ts:716-827` (sign-consent) create
   `documents` rows but do not insert `case_document_readiness` rows
   or append `patient_journey_events`. **High** — silent data drift;
   the ACS workflow snapshot can show "report_needed" after a
   successful upload, and billing readiness will block invoicing for
   cases that are actually ready.
2. **Same person across batches has fragmented notes, calls, and
   billing.** Every patient-attached resource keys off
   `patient_screenings.id`, which turns over per import. See
   [PATIENT_DIRECTORY_SOURCE_OF_TRUTH.md](./PATIENT_DIRECTORY_SOURCE_OF_TRUTH.md).
   **High** — callers cannot see prior call history on the same
   person if it was logged against a different batch's screening row.
3. **Call outcomes are inconsistent across surfaces.** 19 outreach
   enum × 16 engagement triage mappings × 15 canonical planner
   outcomes. Non-canonical outcomes silently skip engagement-side
   side effects. See [CALL_WORKFLOW_MODEL.md](./CALL_WORKFLOW_MODEL.md).
   **High** — managers using Engagement Center won't see follow-ups
   for `wants_more_info` / `hung_up` / `busy` / `disconnected` calls.
4. **`adminApprovalStatus IN (rejected, needs_info)` has no admin
   queue.** Only visible by drilling into the Plexus IQ workspace for
   that facility/date. **Medium-high** — patients can sit in
   `needs_info` indefinitely.
5. **`commitPatient` post-commit pipeline is fire-and-forget**
   (`server/services/patientCommitService.ts:97-182`). All six
   side-effect sub-pipelines run inside `void (async () => {...})()`.
   Errors are logged but do not propagate to the admin-approval
   response. **Medium-high.**
6. **Callbacks invisible on global calendar.** See
   [CALL_WORKFLOW_MODEL.md](./CALL_WORKFLOW_MODEL.md). **Medium-high.**
7. **Engagement Center and Team Portal use slightly different filters
   on the same execution-case set.** See
   [QUEUE_AND_ASSIGNMENT_MODEL.md](./QUEUE_AND_ASSIGNMENT_MODEL.md).
   **Medium.**
8. **Patient Directory canonical service is gated; legacy
   `PatientDatabasePage` mounts at the canonical route.** See
   [PATIENT_DIRECTORY_SOURCE_OF_TRUTH.md](./PATIENT_DIRECTORY_SOURCE_OF_TRUTH.md).
   **Medium.**
9. **`patient_execution_cases.assignedTeamMemberId` references
   `outreach_schedulers.id`, not `users.id`**
   (`shared/schema/executionCase.ts:41`). Cross-portal "who owns this"
   requires a double-join. **Medium** — easy to write code that
   bypasses the indirection.
10. **`patient_journey_events` keys on `(name, dob)`** — normalization
    duplicated across queries rather than centralized at write time.
    **Low-medium.**

## 2. Top UX failures on main (ranked by severity)

1. **`/patient-directory` mounts `PatientDatabasePage` which lacks
   engagement state, owner, next action, notes, or journey timeline.**
   Operators land on a page named "Patient Directory" but get a
   per-person roster aggregate only. **High.**
2. **Disposition outcomes are over-faceted with unclear downstream
   effects.** `wants_more_info` looks like a real outcome but
   generates no triage/task/journey-event. **High.**
3. **No "this is on my call list because …" surface in Team Portal.**
   Hard to debug missing patients. **Medium-high.**
4. **Admin Review `needs_info` / `rejected` never appears in an admin
   queue.** **Medium-high.**
5. **Engagement Center `missingInfo` badge is informative but no
   in-row flow exists to fix it.** **Medium.**
6. **Bulk operations show counts but per-item failure reasons vary in
   UI surfacing.** Routes return a `failed[]` array; the client
   surfacing of those rows is uneven. **Medium.**
7. **Chat dock tile rendered as a disabled icon**
   (`client/src/lib/navigation/navigationRegistry.ts:23` —
   `CHAT_ROUTE_AVAILABLE = false`). **Low** (cosmetic).
8. **"Communications" dock tile goes to `/scheduler-portal`** (a
   dashboard of all schedulers), not to the user's own call queue.
   Mislabel risk. **Low-medium.**
9. **Magic `1234` import-unlock code in Home page**
   (`client/src/pages/home.tsx:56`, `IMPORT_ACCESS_CODE = "1234"`).
   **Low** — obvious debug artifact.
10. **Three parallel state machines on `invoices`** (`status` vs
    `approvalStatus` vs `deliveryStatus`,
    `shared/schema/invoices.ts:14,35-37`) mean UI labels can be
    ambiguous. **Medium.**

## 3. What already exists but is not wired correctly (on main)

These are real files / services on `main` that the audit verified are
present but currently unused or returning 404:

| Surface | File | Activation gate | Default |
| --- | --- | --- | --- |
| Canonical Patient Directory routes + service | `server/routes/patientDirectory.ts:37-43`, `server/services/patientDirectory/*` | `USE_PATIENT_DIRECTORY_ACTIVATION` | OFF |
| Operational queue unified read | `server/routes/operationalQueue.ts:78`, `server/modules/operational-queue/service.ts:57` | additive; no UI consumer | unused |
| Canonical Engagement call list READ | `server/routes/executionCases.ts:260-315` | `isEngagementCanonicalCallListReadEnabled` | 404 by default |
| Canonical `recordCallResult` planner + delegate executors | `server/services/callResult/recordCallResult.ts:365-412`, `recordCallResultOutreachExecutor.ts`, `recordCallResultEngagementExecutor.ts`, `engagementCanonicalCallResultsEndpointFlag.ts` | per-route delegate flags + endpoint flag | OFF |
| Engagement → Call-list bridge | `server/modules/operational-queue/bridge.ts` | `ENGAGEMENT_TO_CALL_LIST_BRIDGE` | OFF |
| Portal call history read | `server/routes/portal.ts:870-914` | `USE_PORTAL_CALL_HISTORY_READ` | OFF (404) |
| Billing Readiness Aggregator V2 | `server/services/billingReadiness/billingReadinessAggregator.ts:55-80` | `USE_BILLING_READINESS_AGGREGATOR_V2` | OFF |
| Engagement Board V2 composer | `server/modules/engagement-board/service.ts` (+ parity tests) | no route wired | OFF |
| Background jobs module contracts | `server/modules/background-jobs/contracts.ts` (+ dormancy QA script `qa-background-jobs-dormant-module.mjs`) | no concrete runner | dormant by design |
| Outreach-as-engagement subworkflow contract | `docs/architecture/outreach-as-engagement-subworkflow-contract.md` | partially wired via the bridge | partial |
| Communication log service | `server/services/communication/communicationLogService.ts` | not consumed by main routes | partial |
| Command Center premium UI (PR #278 surface) | `client/src/features/command-center/*` | only mounted via Home tile | scaffold — **do not touch** |
| `PatientAuditTrailModal` event types dictionary | `client/src/components/patient-directory/PatientAuditTrailModal.tsx:57-82` — 16 event types defined | writers do not append all dictionary entries | partial |

## 4. What can be fixed by wiring alone (no schema change)

These are pure-wiring fixes — they require no migration:

1. Flip-and-validate dormant flags (see §3) under shadow-read parity
   before flipping defaults.
2. Mount `/patient-directory` to a page that uses the canonical
   service (instead of `PatientDatabasePage`) under a feature flag.
3. Append `patient_journey_events` rows from `POST /api/portal/uploads`,
   `POST /api/portal/sign-consent`, and `POST /api/patient-notes` so
   document and note activity is visible on the patient timeline.
4. Wire `/api/operational-queue/me` consumption in Team Portal.
5. Trigger `case_document_readiness` recompute after portal upload +
   sign-consent + procedure-complete.
6. Trigger `billing_readiness_checks` recompute after the same events.
7. Add a "Send to Engagement (manual)" surface in Engagement Center
   for admin recovery when auto-routing fails.
8. Background-job-row for any long-running synchronous POST that
   currently risks timeout at ≥300 entities (see §6).
9. Admin queue for `adminApprovalStatus IN (needs_info, rejected)`.
10. Surface `callback` outcomes as `global_schedule_events` rows so
    callbacks appear on the global calendar.

## 5. What would require new schema (NOT recommended here)

Listed for completeness only. None are part of the recommended
hardening sequence below; all introduce migration risk.

1. **Canonical person identity table** (e.g. `patient_persons(id,
   name, dob, normalizedKey)`) with FKs from `patient_screenings`,
   `patient_execution_cases`, `outreach_calls`, `patient_notes`,
   `documents`, `billing_records`. Today person identity is derived
   from `(name, dob)` strings only.
2. **Unified case_call_outcomes enum reconciliation** — today both
   `outreach_calls.outcome` (19 enum values) and
   `patient_execution_cases.lastCallOutcome` (text, free-form) hold
   call outcome. A new typed enum + view would consolidate them.
3. **`case_document_readiness.documentId` FK to `documents.id`**.
   Currently `integer` with no FK declaration
   (`shared/schema/documentReadiness.ts:78`); stale references are
   possible.
4. **`procedure_events` ↔ `global_schedule_events` ↔
   `case_document_readiness` cross-FK constraints** to prevent
   orphaned readiness rows.
5. **`billing_records` ↔ `invoices` formal join table** — today
   linkage is via `invoice_line_items.billingRecordId` only.
6. **`patient_notes` person-level join** — either an additional
   `patientPersonId` column or a person-level table.

## 6. Scale / failure / resume risks on main

| Flow | Background? | Resume? | Skip completed? | Retry-failed-only? | Risk at 1000 items |
| --- | --- | --- | --- | --- | --- |
| Batch import (paste/CSV/Excel/PDF) | sync (in-request) | n/a | n/a | n/a | timeout risk above ~300 patients; parser is in-memory |
| AI qualification | bg via `analysis_jobs` | yes (`server/routes.ts:75-103` + `failRunningAnalysisJobs`) | **No** — full patient list re-iterated | Only when `resetFailed=true` (`batchAnalysisRunner.ts:62-73`) | OK with monitoring at 1000 |
| Engagement bulk assign | sync POST | per-item ok/failed | yes (already-assigned no-op) | n/a | OK at 100; 500+ holds the request open |
| Engagement bulk cancel-many | sync POST | per-item ok/failed | n/a | n/a | OK at 100; 500+ same |
| Morning scheduler rebuild | bg interval (`morningRebuildScheduler.ts:26`) | runs next morning | depends on engine | n/a | OK at known scale |
| Absence watcher | bg interval (`absenceWatcher.ts:42-44`) | yes | n/a | n/a | OK |
| Invoice batch build | sync POST | partial | yes (already-batched marked) | n/a | At 300+ pending invoices, request timeout risk |
| Invoice delivery | bg via outbox | yes | yes | yes (failed deliveries) | OK |
| Report upload / sign consent (PDF flatten) | sync in request | n/a | n/a | n/a | OK for single docs; bulk upload not supported |

## 7. Recommended hardening sequence (PR-sized)

The order minimizes blast radius and keeps each PR independently
reverable. None implements anything in this doc — these are
candidates for future work.

1. **PR-A — Audit-only timeline append for portal writes.** Add
   `appendJourneyEvent` calls in `server/routes/portal.ts` for
   uploads + sign-consent + patient-notes create. No schema change.
2. **PR-B — Refresh readiness on portal writes.** After upload /
   sign-consent / procedure-event create, trigger
   `case_document_readiness` upsert. No schema change.
3. **PR-C — Admin queue for non-approved screenings.** New
   `/admin/admin-review-queue` page reading `patient_screenings WHERE
   adminApprovalStatus IN (needs_info, rejected) AND deletedAt IS
   NULL`. No schema change.
4. **PR-D — Mount canonical Patient Directory page behind feature
   flag.** Use `isPatientDirectoryActivationEnabled()` to choose the
   component at `client/src/App.tsx:125`. Shadow first.
5. **PR-E — Canonical call outcome reconciliation.** Reduce 19
   outreach enum values toward canonical 15; hide deprecated outcomes
   in UI. Backfill migration to remap historical values (this DOES
   require schema work — gate behind a separate decision).
6. **PR-F — Background-job-ify any long-running synchronous POSTs.**
   Reuse `analysis_jobs` table shape or add a new job row.
7. **PR-G — Promote `/api/operational-queue/me` consumption in Team
   Portal.** Replace `/api/scheduler-portal/cases` +
   `/api/portal/my-tasks` reads with the unified queue. No schema
   change.
8. **PR-H — Surface `callback` outcomes as global calendar events.**
   Insert `global_schedule_events` row (e.g. eventType `callback` or
   reuse `same_day_add`) when a callback is registered.
9. **PR-I — No-silent-failure on commit fan-out.** Wrap
   `commitPatient` background pipeline in an outbox row + journey
   event with success/failure so manager sees if the scheduler-
   assignment write failed.
10. **PR-J — Bridge engagement assignment to call list by default.**
    Flip `ENGAGEMENT_TO_CALL_LIST_BRIDGE=1` after parity-validation
    by the existing `bridge.ts` safety rules.
11. **PR-K — Honest disposition UI.** Disable / hide non-canonical
    outcomes in `DispositionSheet` OR show a banner explaining they
    do not generate triage. Until/unless reconciliation (PR-E) lands.
12. **PR-L — Person-level note timeline view.** Aggregate
    `patient_notes` + `outreach_calls` + `patient_journey_events` per
    `(name, dob)` in a new read endpoint. No schema change.

## 8. Open questions

These are decisions for product / platform owners — not decisions to
make from the audit alone:

- Do we introduce a canonical `patient_persons` table now, or
  continue the `(name, dob)` derivation pattern? §5.1.
- Do we deprecate non-canonical outreach outcomes
  (`wants_more_info`, `will_think_about_it`, etc.) entirely, or keep
  them with a narrowed planner contract? §5.2 + PR-E.
- Do we adopt the unified `/api/operational-queue/me` as the Team
  Portal source of truth, or keep `/api/scheduler-portal/cases` +
  `/api/portal/my-tasks` as the source? PR-G.
- Are `commitPatient` background pipeline failures admin-visible
  enough today, or do they need an outbox + retry? PR-I.

## 9. Branch-only context (NOT on main)

The `phase-3-ai-exception-intelligence` branch ships an exception
detection + recommendation system that is **not** on main and not
part of this backlog. If/when that branch merges, the following
hardening items it introduces would join the operating model:

- exception evaluate-all as a background-jobified endpoint
- canonical AI safety policy contract
- `/admin/operational-summary` and `/admin/ai-recommendations`
  surfaces

These are tracked separately on that branch and intentionally not
included here.

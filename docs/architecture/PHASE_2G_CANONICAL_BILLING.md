# Phase 2G — Canonical Billing Readiness & Billing Document Lifecycle

Phase 2G adds a **canonical, case-scoped** billing-readiness evaluation and
Billing Document lifecycle at the end of the frozen product journey:

```
… → canonical Procedure Note → physician signature → exact reference sync
   → canonical billing readiness → Billing Document → (Phase 2J claim/invoice/payment)
```

Billing readiness is the FIRST Phase 2G step. Every earlier step (Admin Review,
canonical appointment, Order Note, procedure lifecycle, report, Procedure Note,
signature, reference sync) is unchanged.

## 1. Legacy audit (what exists today)

**Tables (reused, extended additively — no parallel duplicate store):**
- `billing_readiness_checks` — legacy identity keys on
  `execution_case_id + patient_screening_id + procedure_event_id + service_type`,
  statuses `not_ready / missing_requirements / ready_to_generate /
  billing_document_generated / sent_to_billing`, `missing_requirements` jsonb.
  No `ancillary_case_id`, no lineage (`superseded_at`), no structured
  billing/claim-blocker split, no evidence snapshot.
- `billing_document_requests` — legacy identity keys on the same legacy columns
  plus `billing_readiness_check_id`; statuses `pending / generating / generated /
  failed / sent_to_billing`; `generated_by_ai` default false; no
  `ancillary_case_id`, no packet body, no lineage, no exact evidence references.

**Legacy behaviors that must NOT become canonical accidentally:**
- readiness deduped by screening/service identity (merges episodes);
- universal static document rules (not service-configured);
- `generated`/`approved` sometimes treated as equivalent to `signed`;
- `billing_document_request` creation can fall back to procedure/service identity;
- async failures may only be logged;
- clinic + ancillary-case identity not consistently exact.

## 2. What is retained / replaced / legacy-only

- **Retained:** the two tables (`billing_readiness_checks`,
  `billing_document_requests`) and all legacy columns/behavior. Legacy writers
  keep working with flags OFF.
- **Replaced (canonical path only, flags ON):** identity is `clinicId +
  ancillaryCaseId` (never screening/service, execution/service, procedure/service,
  or first/newest); the rule engine is **configuration-driven**
  (`ancillary_service_prerequisite_config`, stage `billing_readiness`), never the
  legacy universal rules; `signed` is distinguished from `generated`/`approved`;
  readiness/documents carry lineage (`superseded_at`) and a truthful evidence
  snapshot; async failures record durable PHI-free reconciliation work.
- **Legacy-only (untouched):** the legacy readiness/document writers, the
  billing auditor/policy/reports surfaces, and every existing route/job. Phase 2G
  adds NEW canonical service modules + flag-gated routes; it deletes nothing.

## 3. Flags OFF preserve existing behavior

All three Phase 2G flags default OFF:
`FEATURE_CANONICAL_BILLING_READINESS`, `FEATURE_CANONICAL_BILLING_DOCUMENT`,
`FEATURE_BILLING_DOCUMENT_GENERATOR`. The runtime gate
`billingReadinessRuntimeEnabled()` additionally requires the ENTIRE upstream
canonical chain (ancillary cases, appointments, unified documents, Order Note,
procedure lifecycle, Procedure Note). With any flag OFF:
- zero migration-0055 column reads/writes on the canonical path;
- the legacy readiness/document writers run exactly as before;
- no canonical uniqueness is assumed by legacy writers (the partial-unique
  current-row indexes apply only to `ancillary_case_id IS NOT NULL` canonical
  rows; legacy rows have NULL `ancillary_case_id`);
- no Billing Document generation, retries, or backfill apply execute;
- routes return an explicit disabled contract WITHOUT reading migration-0055.

## 4. Why no parallel duplicate billing system

The existing `billing_document_requests` row already models a
"generate-an-operational-billing-packet" request. Migration 0055 extends it (and
`billing_readiness_checks`) additively with canonical case-scoped identity,
exact evidence references, a deterministic packet body, and lineage — satisfying
the canonical invariants without a second table. The Billing Document is indexed
in the existing Unified Ancillary Documents reference table
(`documentKind = billing_document`), the same index used for Order/Procedure
Notes and reports — one document spine, not a competing one.

## 5. Migration 0055 (additive, unapplied)

`migrations/0055_add_canonical_billing_readiness_documents.sql` adds nullable
canonical columns + partial-unique current-row indexes to both tables, widens
the `document_kind` / `requested_action` / `blocks_stage` CHECKs (strict
supersets), and introduces `documentKind='billing_document'` + five
reconciliation actions. It is additive, idempotent where practical, and
**unapplied** — no `drizzle-kit push` / `db:push` is run in Phase 2G. Migration
0055 remains unapplied; there is no migration 0056.

_(Implementation detail sections — identity, requirements, overrides, snapshot,
generation, reference sync, orchestration, retry, backfill, APIs — are documented
inline in the corresponding `server/services/billingLifecycle/*` modules.)_

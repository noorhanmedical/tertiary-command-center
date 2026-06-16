# Phase 3 PR 3.6 — Document + Billing Exception Intelligence

## What this PR is

PR 3.6 extends the exception engine and the recommendation rule
registry with document- and billing-side coverage. The detectors read
canonical operational tables and emit exceptions; the recommendation
rules attach a human-review proposal to each one. No state is mutated
outside `exception_snapshots` and `ai_recommendation_logs`.

## New detectors (engine v3.6.0)

| Type | Source | When it fires |
| --- | --- | --- |
| `report_missing` | `case_document_readiness` | `documentType=report`, `blocksBilling=true`, status not in the "present" set, age ≥ threshold |
| `order_note_missing` | `case_document_readiness` | same logic for `order_note` |
| `procedure_note_missing` | `case_document_readiness` | same logic for `procedure_note` |
| `billing_readiness_blocked` | `billing_readiness_checks` | status ∈ {`not_ready`,`missing_requirements`} and `updatedAt` age ≥ threshold |
| `invoice_batch_stale` | `invoice_batches` | status ∈ {`draft_preview`,`draft`,`pending_approval`} and `createdAt` age ≥ threshold |
| `invoice_draft_stale` | `invoices` | status = `Draft` and `createdAt` age ≥ threshold |
| `missing_invoice_recipient` | `invoices` | `deliveryStatus = "blocked_missing_recipient"` |
| `high_balance_aging` | `invoices` | balance > 0, status ≠ `Paid`, `createdAt` age ≥ threshold days |

All thresholds and severities resolve through the Phase 3 PR 3.1
admin_settings precedence (`testType > facility > user > global > default`).

## New recommendation rules

Each new detector now has a paired entry in `RECOMMENDATION_RULES`:

| Type | Recommendation |
| --- | --- |
| `report_missing` / `order_note_missing` / `procedure_note_missing` | `request_more_info` — propose to request the document |
| `billing_readiness_blocked` | `request_more_info` — collect missing items |
| `invoice_batch_stale` | `escalate_to_admin` |
| `invoice_draft_stale` | `reassign_owner` |
| `missing_invoice_recipient` | `request_more_info` — collect recipient |
| `high_balance_aging` | `escalate_to_admin` |

Every rule still flows through the AI safety contract: `rules_engine`
provider, `not_applicable` confidence, refused at insert time
otherwise.

## What this PR does NOT do

- It does **not** fabricate documents, auto-upload reports, or sign
  notes.
- It does **not** auto-approve invoices, close batches, or push
  recipients.
- It does **not** advance billing readiness state.
- It does **not** call any external system (no EHR/EMR, no
  clearinghouse, no email/SMS).

## Engine supersede

The engine's auto-supersede whitelist now includes the 8 new detector
types, so when the source condition clears, the engine marks the old
snapshot `superseded` without human intervention. Resolved or dismissed
rows are never touched.

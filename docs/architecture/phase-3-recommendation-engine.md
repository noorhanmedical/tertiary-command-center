# Phase 3 PR 3.5 — Next-Best-Action Suggestion Engine

## What this PR is

A **rule-based recommendation engine** that walks open exception
snapshots and proposes a next-best action for each one. Output lands in
`ai_recommendation_logs` (PR 3.4) where humans accept or reject.

## What this PR does NOT do

- It does **not** execute the proposal. Accepting a recommendation only
  flips its status; no email, SMS, scheduling, invoice marking, or
  document update happens.
- It does **not** call any model. The engine is pure rules.
  `modelProvider = "rules_engine"` and `confidenceLabel = "not_applicable"`
  are hard-forced.
- It does **not** invent exception types. It only proposes for detector
  types covered by the rule registry.

## Coverage

PR 3.5 ships rules for the 6 detectors that PR 3.2 ships:

| Exception type | Recommendation |
| --- | --- |
| `callback_overdue` | `schedule_callback` — schedule the next attempt |
| `payment_overdue` | `resend_invoice` — propose resend |
| `invoice_delivery_failed` | `resend_invoice` — fallback channel |
| `invoice_readiness_blocked` | `request_more_info` — collect missing items |
| `physician_signature_pending` | `request_signature` |
| `denial_followup_due` | `follow_up_denial` — assign biller |

Exception types without a rule are skipped with `unsupported++`.
PR 3.6 / 3.7 register additional rules for document, scheduling, and
billing detectors.

## Determinism

`recommendationKey` = `${exceptionType}:${exceptionSnapshotId}`. Re-running
the engine refreshes the row in place while it is `proposed`. After accept
or reject, a new evaluation supersedes the old log row and inserts a
fresh `proposed` row — humans get a fresh chance to review.

## Endpoint

| Endpoint | Auth | Body | Result |
| --- | --- | --- | --- |
| `POST /api/exceptions/recommend` | admin / biller | `{ facilityId?, testType? }` | `{ proposed, skipped, unsupported }` |

The exception queue page exposes a *"Propose recommendations"* button
which calls this endpoint with the currently filtered facility.

## Audit reproducibility

Each log row stores the policy snapshot (exception policy + AI safety
policy) and the source snapshot from the exception. Re-running the
engine after admin_settings changes still leaves the old row's
explainability intact (PR 3.4 supersede-on-rewrite contract).

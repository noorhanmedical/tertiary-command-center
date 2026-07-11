# Phase 3 PR 3.4 — AI Recommendation Log + Explainability Contract

## What this PR is

PR 3.4 introduces:

1. A **shared AI safety contract** (`shared/contracts/aiRecommendation.ts`)
   that defines canonical vocabulary every recommendation must use:
   `modelProvider`, `confidenceLabel`, `recommendedAction`, and
   `status`. Anything outside the vocabulary is rejected by the logger.
2. An **append-only `ai_recommendation_logs` table** that captures every
   proposal the engine produces along with full explainability
   (`ruleIds`, `rationale`, `inputs`, `policySnapshot`).
3. An **`aiSafetyPolicyService`** that answers two questions:
   *which provider may we use right now?* and *which confidence label
   may we report?* — driven by `admin_settings.ai_safety.*` with the
   Phase 2 precedence (testType > facility > user > global > default).
4. An **`aiRecommendationLogService`** that owns proposal + accept +
   reject (no autonomous execution), keyed deterministically by
   `recommendationKey` for idempotent dedupe.
5. Routes under `/api/ai-recommendations/*` and an admin-gated page at
   `/admin/ai-recommendations` for human review.

## Hard-forced safety rules

- `humanReviewRequired` is **always true** at the contract level.
- `autoActionsEnabled` is **always false** at the contract level.
  Even if admin_settings says otherwise, the route layer in PR 3.4
  through PR 3.9 never executes a recommendation.
- `rules_engine` provider must report `confidenceLabel = "not_applicable"`.
  The logger refuses inserts that violate this.
- An `openai` provider downgrades to `not_configured` when
  `OPENAI_API_KEY` is unset.
- A provider not present in `allowedModelProviders` downgrades to
  `rules_engine`.

## Vocabulary

| Field | Allowed values |
| --- | --- |
| `modelProvider` | `rules_engine`, `openai`, `other`, `not_configured` |
| `confidenceLabel` | `not_applicable`, `low`, `medium`, `high` |
| `recommendedAction` | `schedule_callback`, `request_signature`, `send_invoice`, `resend_invoice`, `follow_up_denial`, `reassign_owner`, `escalate_to_admin`, `request_more_info`, `dismiss_exception`, `other` |
| `status` | `proposed`, `accepted`, `rejected`, `superseded` |

## State machine

```
        +-----------+
        | proposed  |  ← engine writes
        +-----------+
            |  |  \
   accept   |  |   reject(reason)
            v  v
       +---------+      +-----------+
       |accepted | -----| superseded| ← engine re-proposes a new key
       +---------+      +-----------+
       +---------+      +-----------+
       |rejected | -----| superseded|
       +---------+      +-----------+
```

- Re-proposing the same `recommendationKey` while still `proposed`
  refreshes the row in place (idempotent dedupe).
- Re-proposing after the row has been accepted or rejected supersedes
  the old row and inserts a fresh `proposed` row — preserves audit
  trail.

## Endpoints

| Endpoint | Auth |
| --- | --- |
| `GET /api/ai-recommendations/safety-policy` | any auth |
| `GET /api/ai-recommendations` | any auth |
| `GET /api/ai-recommendations/:id` | any auth |
| `POST /api/ai-recommendations/:id/accept` | admin / biller |
| `POST /api/ai-recommendations/:id/reject` | admin / biller |

Accept/reject also append an `exception_review_events` row
(`recommendation_accepted` / `recommendation_rejected`) when the log
references an exception snapshot, keeping the exception audit timeline
unified.

## What this PR does NOT do

- It does **not** generate recommendations. That is PR 3.5.
- It does **not** call any model. The contract is provider-agnostic.
- It does **not** mutate operational state — no invoices marked ready,
  no patients scheduled, no documents signed.

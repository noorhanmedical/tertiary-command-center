# Phase 3 PR 3.8 — Operational Summary Reports

## What this PR is

A **read-only aggregation** over the Phase 3 exception engine and
recommendation log. It does not introduce a new table — every value is
recomputed from `exception_snapshots`, `exception_review_events`, and
`ai_recommendation_logs`. Optional facility scope.

## What it returns

```jsonc
{
  "version": "3.8.0",
  "generatedAt": "...",
  "scope": { "facilityId": null },
  "exceptions": {
    "totalByStatus": { "open": ..., "acknowledged": ..., "resolved": ... },
    "totalByType":   { "callback_overdue": ..., "payment_overdue": ... },
    "bySeverity":    { "critical": ..., "high": ..., ... },
    "avgHoursToAcknowledge": 0.0,
    "avgHoursToResolve": 0.0
  },
  "recommendations": {
    "totalByStatus":   { "proposed": ..., "accepted": ..., "rejected": ... },
    "totalByAction":   { "schedule_callback": ..., ... },
    "totalByProvider": { "rules_engine": ..., "openai": 0, "other": 0, "not_configured": 0 },
    "acceptanceRatePercent": 75.0
  },
  "topFacilitiesByOpen": [ { "facilityId": "...", "openCount": ... } ],
  "topDetectorsByOpen":  [ { "exceptionType": "...", "openCount": ... } ],
  "safety": { ... }  // current AI safety policy
}
```

## Endpoint

`GET /api/operational-summary?facilityId=` — admin / biller gated.

## Page

`/admin/operational-summary` renders the JSON with grouped cards (one
per dimension). No write controls.

## What this PR does NOT do

- It does not persist snapshots. (PR 3.9 could add `operational_summary_runs`
  if needed; PR 3.8 keeps the surface lean.)
- It does not modify any source table.
- It does not call any model. The "safety" block is the *policy* read,
  not an inference.

# Engagement canonical call-result endpoint contract

**Status:** Docs-only (Batch 6 of platform split-brain run).
**Date:** 2026-06-10.
**Companion:** `scripts/qa-engagement-canonical-call-result-endpoint-contract.mjs`.

## 1. Canonical endpoint

**`POST /api/engagement-center/call-results`** (plural) is the FUTURE canonical write endpoint for every call-result side-effect set.

- Resource-style URL (plural collection): consistent with REST norms for "create a call-result record."
- Lives under the Engagement Center namespace because Engagement Center owns the patient engagement workflow (canonical ownership registry, Batch 2).
- Singular `/api/engagement-center/call-result` (without `s`) remains as a backward-compatible alias adapter for the legacy engagement-center handler.

This endpoint is **not yet wired** — Batch 6 only pins the contract. The new route only ships AFTER:
- Batch H Step 5A's execution adapter is dormant (done).
- Batch 7 ships the engagement-center executor (dormant).
- Batches 8 + 9 pin response shape + side-effect matrix.
- Batch 10 ships the delegation flag.
- Batch 11 proves the executor can rebuild the current response shape against a dry-run harness.
- Batch 12 conditionally delegates the legacy route through the executor behind a default-OFF flag.

## 2. Endpoint posture

- HTTP method: `POST` only.
- Authentication: same session model as the existing engagement-center routes.
- Authorization: same role / facility scoping as `POST /api/engagement-center/call-result` today (sessionUserId + role checks).
- Idempotency: not provided in v1. A second POST creates a second outreach_calls row, a second journey-event row, etc. — same as today.
- Default-OFF flag: `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE` (Batch 10). When OFF, the new route handler MUST short-circuit to either (a) 404 Not Found, or (b) delegate to the legacy handler — to be decided in Batch 12. When ON, the route writes through the canonical service.

## 3. Legacy route status

| Route | Status under contract | Behavior |
|---|---|---|
| `POST /api/engagement-center/call-result` (singular) | Compatibility adapter | Continues to accept the existing body shape. Delegates to the canonical service when `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE` is ON. Returns the existing response envelope `{ ok, executionCase, journeyEvent, triageCase, task, ownershipUpdated }`. |
| `POST /api/outreach/calls` | Legacy adapter (separate track) | Owned by Batches 13–19. Outreach delegation has its own flag (`USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE`). Not changed by this contract. |
| `POST /api/engagement-center/call-results` (plural — NEW) | Canonical future endpoint | Default-OFF until staging proves out. Same body shape as singular legacy + optional fields the canonical input supports (sourceSurface, etc.). |

## 4. New canonical write strategy

All new call-result writes MUST eventually go through the canonical Engagement Center service. Specifically:
- Team Portal disposition flow → eventually POSTs to the canonical endpoint (Batch 20 contract, separately approved UI work).
- Engagement Center board disposition flow → eventually POSTs to the canonical endpoint.
- Any future surface that needs to log a call result → MUST use the canonical endpoint, NOT the legacy ones.

## 5. Response strategy

Response shape on the canonical endpoint will be a superset of the existing engagement-center singular response, with the following fields:

```
{
  ok: true,
  executionCase: <patient_execution_cases row | null>,
  journeyEvent: <patient_journey_events row | null>,
  triageCase: <scheduling_triage_cases row | null>,
  task: <plexus_tasks row | null>,
  outreachCall: <outreach_calls row | null>,  // NEW — surfaced by the canonical service
  ownershipUpdated: boolean,
  planned: RecordCallResultOutcome,            // NEW — the canonical envelope used
  ok-steps: number,
  failed-steps: number
}
```

The singular legacy route's response stays at the existing five fields (`ok, executionCase, journeyEvent, triageCase, task, ownershipUpdated`). The plural canonical route adds `outreachCall`, `planned`, `ok-steps`, `failed-steps`. Adding fields is non-breaking. Removing or renaming any existing field would break clients and is OUT of scope.

## 6. Legacy compatibility strategy

- Singular legacy route response shape is byte-equivalent under flag OFF and flag ON (Batches 8 + 9 pin this in fixtures).
- `POST /api/outreach/calls` response stays `res.status(201).json(call)` byte-equivalent (Batch 15 fixture).
- No legacy endpoint will be removed in this run. Removal is a separately-approved future PR after both delegation flags have been ON in production for a stabilization window.

## 7. Rollback strategy

- The delegation flag (`USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE`) defaults OFF. Flipping OFF returns the route to the pre-delegation code path with zero behavior change.
- The canonical endpoint (plural) is not exposed until Batch 12 lands. Until then, no rollback is needed.
- If a runtime issue is detected after delegation ships:
  1. Flip the flag OFF in the affected environment.
  2. Verify the legacy handler resumes byte-equivalent responses.
  3. Open an incident ticket; do NOT amend the production code under fire — fix forward in a new PR.

## 8. Plexus IQ

Plexus IQ is read-only/intelligence-only for this contract. Plexus IQ does NOT call the canonical endpoint, does NOT extend it, does NOT own any part of the call-result write path. Plexus IQ MAY read the resulting `patient_journey_events` rows for reasoning regeneration — same as today.

## 9. Out of scope

- Removal of either legacy endpoint.
- Migration of UI clients to the new endpoint.
- Renaming `scheduler_assignments` or `outreach_schedulers`.
- Flipping ANY flag default ON.
- Adding a billing field, qualification field, PDF field, or Admin Review approval field to the response.
- Any change to the canonical recordCallResult planner — its envelope is already fixture-pinned (Batch B).

End of contract.

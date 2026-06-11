# Engagement canonical call-results endpoint — implementation contract

**Status:** Docs-only (Batch 7 of Engagement completion run).
**Date:** 2026-06-11.
**Companion:** `scripts/qa-engagement-canonical-call-results-endpoint-contract.mjs`.

## 1. Target endpoint

**`POST /api/engagement-center/call-results`** (plural collection) is the future canonical write endpoint.

Distinct from the legacy singular `POST /api/engagement-center/call-result` and the legacy `POST /api/outreach/calls`.

## 2. Posture

- Plural URL is canonical (REST-friendly "create a call-result").
- Singular `/api/engagement-center/call-result` remains a compatibility route owned by `executionCases.ts` — already delegates to the canonical engagement executor when `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE` is ON (Batch 3 of this run, PR #203).
- `/api/outreach/calls` remains a legacy compatibility adapter for now — its delegation is owned by a separate track (Batch 19 of split-brain run blockers).

## 3. Plural endpoint behavior

When `USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_ENDPOINT` is ON:

- Method: `POST` only.
- Auth: same session model as the singular route.
- Body: identical to the singular route's body shape (`callResultBodySchema`).
- Pipeline: identical to the singular delegation path — patient resolution, admin settings, `computedNextActionAt`, then `recordEngagementCallResult` with `engagementStatusSemantics: "coarse"` + closure-captured deps.
- Response: byte-equivalent to the singular response — `{ ok, executionCase, journeyEvent, triageCase, task, ownershipUpdated }`.

When the flag is OFF:

- Endpoint returns `404 Not Found` (or equivalent disabled response per project convention) so that calling clients fail loudly until the canonical route is enabled.

## 4. No split-brain

The plural endpoint MUST NOT duplicate the singular route's business logic. The implementation:

- Re-uses the singular route's patient-resolution helpers.
- Re-uses the singular route's admin-settings + callbackHours computation.
- Re-uses the singular route's dep closures (extracted into a shared helper file).
- Adds NO new triage / task / journey writers.

If the singular delegation path and the plural canonical path ever diverge, the engagement workflow has TWO write brains again — exactly what this run is eliminating.

## 5. Rollback strategy

- Flip `USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_ENDPOINT` OFF.
- Plural endpoint returns 404. Singular endpoint continues to serve callers.
- If an issue is found, fix forward in a new PR.

## 6. Team Portal trajectory

- Today: Team Portal DispositionSheet POSTs to BOTH `/api/outreach/calls` AND `/api/engagement-center/call-result` (Batch 5 UI audit dual-write).
- Future: once the plural endpoint is stable in staging, Team Portal can be rewired to a single POST to `/api/engagement-center/call-results`. This is the Team Portal canonical write contract (#179 of split-brain run).
- Until that switch: NO Team Portal change.

## 7. Plexus IQ

Untouched. Plexus IQ does not consume or own the call-result endpoint.

## 8. Out of scope

- Switching any UI to the new endpoint.
- Removing the singular route.
- Changing `/api/outreach/calls`.
- Flipping the new endpoint flag default ON.
- Migrations.
- Billing / qualification / PDF / Admin Review touched.

## 9. Hard-stops

- Plural endpoint default OFF.
- Singular endpoint behavior preserved byte-equivalent.
- No UI change in this contract or its companion PRs (#207 contract, future #208 endpoint).
- No Plexus IQ runtime touched.

End of implementation contract.

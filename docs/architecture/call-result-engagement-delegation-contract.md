# Engagement call-result delegation contract

**Status:** Docs + flag accessor only (Batch 10 of platform split-brain run).
**Date:** 2026-06-10.
**Companion:** `scripts/qa-record-call-result-engagement-delegate-flag.mjs`.

## 1. Flag

- **Name:** `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE`
- **Default:** OFF.
- **Truthy values:** `"1"`, `"true"`, `"yes"`.
- **Accessor:** `isRecordCallResultEngagementDelegateEnabled()` in `server/services/callResult/recordCallResultEngagementDelegateFlag.ts`.

This flag is **distinct from** the preview flag `USE_RECORD_CALL_RESULT_ENGAGEMENT_PREVIEW` (Batch H Step 2). Preview observes parity without delegation; delegation actually replaces the route's writes with the canonical engagement executor (Batch 7).

## 2. Posture

In this batch the flag accessor exists, but:
- No route imports it.
- No runtime code reads it.
- The Batch 12 engagement-route delegation will be the first runtime caller.

The accessor is callable from tests in Batch 11 (dry-run harness).

## 3. Future use (Batch 12)

When `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE === "1"` AND the singular engagement route handler is invoked:

1. Route parses the body via `callResultBodySchema` (unchanged).
2. Route still performs patient resolution (executionCaseId → patientScreeningId → name+dob) — unchanged.
3. Route detects the flag is ON.
4. Route translates the resolved input into an `EngagementCallResultInput` (opaque IDs only).
5. Route supplies injected dependencies that wrap the existing route-side writers (so byte-equivalent side effects fire).
6. Route delegates to `recordEngagementCallResult` (Batch 7 executor).
7. Route maps the executor result back into the legacy response envelope (Batch 8 fixture pins six keys).

When the flag is OFF:
- The route handler runs as it does today. Zero code-path change.

## 4. Hard-stops

- The delegation wiring MUST NOT change the response shape (Batch 8 fixture pins it).
- The delegation wiring MUST NOT introduce new side effects (Batch 9 matrix pins them).
- The delegation wiring MUST NOT change the route's PHI handling.
- The delegation wiring MUST NOT touch billing, qualification, PDFs, Admin Review approval, scheduler-assignment writes (beyond what the existing route already does), Plexus IQ, migrations.
- The flag default MUST stay OFF.

## 5. Rollback strategy

- Production flip the flag OFF in the affected environment.
- Verify the legacy code-path resumes byte-equivalent responses.
- Open an incident ticket; fix forward in a new PR.

## 6. STOP condition for Batch 12

If during the Batch 12 inspect-before-coding step it becomes clear that:
- The response shape cannot be rebuilt byte-equivalent from the executor's output, OR
- A side effect the legacy route depends on is not covered by the canonical adapter, OR
- The route's patient-resolution flow cannot be cleanly preserved,

then Batch 12 STOPS and ships only `docs/architecture/call-result-engagement-delegation-blockers.md` plus a blockers QA — NOT the delegation wiring. The flag stays OFF and unused.

## 7. Plexus IQ

Untouched. Plexus IQ does not consume the engagement call-result route, does not consume the flag, does not own engagement state.

## 8. Out of scope

- Flipping the flag default to ON.
- Exposing the canonical PLURAL endpoint (`POST /api/engagement-center/call-results`).
- Touching the outreach route.
- Touching the Team Portal UI.

End of contract.

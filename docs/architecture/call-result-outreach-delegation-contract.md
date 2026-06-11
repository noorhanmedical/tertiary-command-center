# Outreach call-result delegation contract

**Status:** Docs + flag accessor only (Batch 17 of platform split-brain run).
**Date:** 2026-06-10.
**Companion:** `scripts/qa-record-call-result-outreach-delegate-flag.mjs`.

## 1. Flag

- **Name:** `USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE`
- **Default:** OFF.
- **Truthy values:** `"1"`, `"true"`, `"yes"`.
- **Accessor:** `isRecordCallResultOutreachDelegateEnabled()` in `server/services/callResult/recordCallResultOutreachDelegateFlag.ts`.

Distinct from `USE_RECORD_CALL_RESULT_OUTREACH_PREVIEW` (Batch H Step 3). The preview flag observes parity; this delegation flag actually replaces the route's writes with the canonical outreach executor (Batch 14). The response shape is the raw row form (`raw_row`) pinned in the Batch 15 fixture.

## 2. Posture

In this batch the flag accessor exists, but:
- No route imports it.
- No runtime code reads it.
- The Batch 19 outreach-route delegation will be the first runtime caller.
- The accessor is callable from tests in Batch 18 (dry-run harness).

## 3. Future use (Batch 19)

When `USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE === "1"` AND the outreach route handler is invoked:

1. Route parses the body via `insertOutreachCallSchema` (unchanged).
2. Route still resolves patient + authorization (route-local).
3. Route translates the resolved input into an `OutreachCallResultInput` (opaque IDs only).
4. Route supplies injected dependencies that wrap `storage.createOutreachCallAtomic`, `storage.markSchedulerAssignmentCompleted`, and the canonical-spine sync.
5. Route delegates to `recordOutreachCallResult` (Batch 14 executor).
6. Route returns the raw outreach_calls row from the captured `createOutreachCall` dep — preserving `res.status(201).json(call)` byte-equivalent (Batch 15 fixture).

When the flag is OFF:
- The route handler runs as it does today. Zero code-path change.

## 4. Hard-stops

- The delegation wiring MUST NOT change the response shape (Batch 15 fixture pins it: 201 + raw row, no wrapper).
- The delegation wiring MUST NOT introduce new side effects (Batch 16 matrix pins them).
- The delegation wiring MUST NOT change PHI handling.
- The delegation wiring MUST NOT touch billing, qualification, PDFs, Admin Review approval, Plexus IQ, migrations, the outreach dashboard, or the outreach_schedulers roster.
- The flag default MUST stay OFF.

## 5. Rollback strategy

- Production flip the flag OFF in the affected environment.
- Verify the legacy code-path resumes byte-equivalent responses.
- Open an incident ticket; fix forward in a new PR.

## 6. STOP condition for Batch 19

Inspect-before-coding. If any of the following hold, Batch 19 STOPS and ships only `docs/architecture/call-result-outreach-delegation-blockers.md` + a blockers QA:
- The response shape cannot be rebuilt byte-equivalent (the raw row from `createOutreachCallAtomic` cannot be returned cleanly via the executor's injected dep).
- The outreach route's terminal-completion semantics drift from the canonical adapter (the route's TERMINAL set is broader than the planner's terminal flag).
- The auth / authorization flow cannot be cleanly preserved.
- The canonical-spine sync (fire-and-forget) cannot be threaded through.

The known divergence — the outreach route does not append a journey event today, while the canonical adapter always invokes `appendJourneyEvent` — is itself a candidate blocker. Batch 14's `OUTREACH_OWNED_STEPS` excludes `journeyEventAppended` deliberately, but the adapter still calls the dep. The route must supply a no-op `appendJourneyEvent` dep OR the adapter must support per-surface step suppression.

## 7. Plexus IQ

Untouched. Plexus IQ does not consume the outreach route, does not consume the flag, does not own outreach state.

## 8. Out of scope

- Flipping the flag default to ON.
- Touching the engagement route.
- Touching the Team Portal UI.
- Touching the outreach dashboard endpoint.
- Renaming any legacy table or role.

End of contract.

# Call-result journey-event metadata contract

**Status:** Docs-only (Batch D of adapter-blockers run). Resolves engagement delegation blocker **B8** without coding route delegation.
**Date:** 2026-06-10.
**Companion:** `scripts/qa-call-result-journey-event-metadata-contract.mjs`.

## 1. Goal

Pin which metadata flows into `patient_journey_events` on a `call_result_logged` event, where each field comes from, what is PHI vs not, and how dependency injection should carry it without leaking PHI through the canonical adapter.

This contract DOES NOT change any runtime. It is the design Ali approves so a future PR can extend `AppendJourneyEventArgs` cleanly.

## 2. Current metadata flow (engagement-center route)

`server/routes/executionCases.ts:264-289` calls `appendJourneyEvent` with:

| Field | Source | PHI? |
|---|---|---|
| `patientName` | resolved patient identity | yes |
| `patientDob` | resolved patient identity | yes |
| `patientScreeningId` | route input | no |
| `executionCaseId` | route resolution | no |
| `eventType` | hard-coded `"call_result_logged"` | no |
| `eventSource` | hard-coded `"scheduler_portal"` | no |
| `actorUserId` | session user id | no |
| `summary` | hard-coded `"call result logged"` | no |
| `metadata.callResult` | request body | no |
| `metadata.callDisposition` | request body | no |
| `metadata.note` | request body | conditional — may carry PHI if user typed it |
| `metadata.nextActionAt` | route-computed | no |
| `metadata.assignedUserId` | request body | no |
| `metadata.assignedRole` | request body | no |
| `metadata.facilityId` | request body | no |
| `metadata.<custom>` | request body `metadata` spread | conditional |

## 3. Current metadata flow (outreach route)

The outreach route does NOT call `appendJourneyEvent` today (Batch 19 B5). No journey event is appended on `/api/outreach/calls`. The canonical adapter's `journeyEventAppended` step is suppressed for the outreach surface per Batch C.

## 4. What metadata MUST be preserved on delegation

For the engagement surface (post-delegation), parity with today requires:
- Patient identity (`patientName`, `patientDob`) appended.
- `eventSource = "scheduler_portal"` (legacy label, preserved per Batch D §6).
- `actorUserId` recorded.
- `summary = "call result logged"`.
- The metadata bag with `callResult`, `callDisposition`, `note`, `nextActionAt`, `assignedUserId`, `assignedRole`, `facilityId`, plus the caller's custom metadata bag.

## 5. PHI handling — where it's allowed

Two zones:

- **Zone 1 — canonical service (planner + adapter + executors):** NO PHI. The canonical surface takes only opaque IDs and outcome labels. This zone is the source-pinned invariant the existing dormancy QAs enforce. The current `AppendJourneyEventArgs` is intentionally bare (no `patientName` / `patientDob`).
- **Zone 2 — route-supplied dep closures:** PHI permitted. The route owns patient resolution, then supplies an `appendJourneyEvent` dep that closes over the resolved `patientName` / `patientDob`. The canonical surface never sees those values; they're captured inside the closure.

## 6. What MUST NOT be logged

Anywhere in canonical code (Zone 1):
- `patientName`
- `patientDob`
- `mrn`
- `ssn`
- `phoneNumber`, `phoneE164`
- `address`
- The free-text `note` (it may carry PHI)

This invariant is already enforced by the dormancy / source-purity QAs on the planner, adapter, and executors.

## 7. Proposed DI extension (design only)

Extend `AppendJourneyEventArgs` (in the adapter) with a typed `metadata` bag that carries ONLY non-PHI keys:

```ts
type AppendJourneyEventArgs = {
  patientScreeningId: string;
  patientExecutionCaseId: string | null;
  eventType: "call_result_logged";
  sourceSurface: CallResultSourceSurface;
  outcome: CallResultOutcome;
  // NEW — typed non-PHI metadata bag.
  metadata?: {
    callDisposition?: string | null;
    nextActionAtIso?: string | null;
    assignedUserId?: string | null;
    assignedRole?: string | null;
    facilityId?: string | null;
    // Caller may add string keys → string|number|boolean|null values
    // for forward-compat fields the canonical contract doesn't yet model.
    [k: string]: string | number | boolean | null | undefined;
  };
};
```

`patientName`, `patientDob`, free-text `note` are NOT in this type. The route-supplied closure injects them at write time by reading from a private closure scope:

```ts
const appendJourneyEvent = (args: AppendJourneyEventArgs) =>
  appendJourneyEventStorage({
    ...args,
    // Closure-captured PHI / free-text never flow through the canonical surface.
    patientName,
    patientDob,
    note,
    summary: "call result logged",
    eventSource: "scheduler_portal",
    actorUserId,
    metadata: { ...(args.metadata ?? {}), note },
  });
```

This pattern preserves the legacy event row exactly while keeping the canonical surface PHI-free.

## 8. Why outreach does not currently append journey events

Two reasons:

1. **Historical separation.** The outreach call log (`outreach_calls`) is itself an audit row; the team treated it as the authoritative trail for the call attempt and did not double-write to `patient_journey_events`.
2. **Engagement-case linkage absent.** `outreach_calls` rows do not always carry an `executionCaseId`. Without one, the engagement-case timeline view (the primary consumer of journey events) wouldn't surface the row anyway.

After Batches A-C, the outreach surface SUPPRESSES `journeyEventAppended` deliberately to match legacy behavior.

## 9. Ali decision required — should outreach calls append a journey event?

**Two options:**

### Option A — Preserve current behavior (no journey event from outreach)

- Outreach surface continues to suppress `journeyEventAppended` per Batch C's `OUTREACH_SUPPRESSED_STEPS`.
- Pro: zero behavior change on flag flip; lowest risk.
- Pro: no additional metadata reconciliation work needed for outreach delegation.
- Con: the engagement-case timeline view continues to omit outreach call activity.
- Con: the dream of "one canonical event log" stays half-realized.

### Option B — Append journey event on outreach too

- Remove `"journeyEventAppended"` from `OUTREACH_SUPPRESSED_STEPS`.
- Engagement-case timeline view gains outreach activity rows.
- Pro: one canonical event log per the platform vision.
- Pro: closes one half of the engagement/outreach split-brain.
- Con: behavior change visible to operators (more rows in timeline views).
- Con: requires outreach route to resolve the `executionCaseId` (which it doesn't always have today) — or the journey event row carries `executionCaseId = null` and the timeline view filters it out.
- Con: requires Ali to communicate the behavior change.

**Recommended:** Option B AFTER B5 (outreach journey-event ownership) gets explicit communicated approval. Until then, Option A is the safe default (already in effect via Batch C).

## 10. Out of scope

- Implementing the `AppendJourneyEventArgs` extension. That's a future PR after Ali sign-off on this contract.
- Modifying `appendJourneyEvent` (the canonical writer).
- Route wiring.
- Plexus IQ touched.

## 11. Hard-stops

- No file under `server/services/journey/*` is modified.
- No file under `server/services/plexusIq/*` is modified.
- No route is modified.
- No flag flipped.
- No migration.

End of contract.

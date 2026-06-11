# Engagement-route delegation readiness — re-check

**Status:** Docs-only (Batch 8 of arg-extensions run).
**Date:** 2026-06-11.
**Companion:** `scripts/qa-call-result-engagement-route-delegation-readiness-recheck.mjs`.

Re-evaluates whether `POST /api/engagement-center/call-result` can be delegated behind `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE` (default OFF) after Batches 1-7 of this run resolved 7 of 8 Batch-12 blockers at the adapter/executor layer.

## 1. Is response shape now rebuildable?

**YES.** The legacy 6-key envelope `{ ok, executionCase, journeyEvent, triageCase, task, ownershipUpdated }` can be reassembled by:

- `ok`: from `EngagementCallResultExecutorResponse.ok` (Batch 2).
- `executionCase`: from a closure-captured EC row inside the route-supplied `updateExecutionCaseEngagement` dep (dry-run §2 pattern).
- `journeyEvent`: from a closure-captured row inside the route-supplied `appendJourneyEvent` dep (dry-run §2 pattern; PHI flows via Batch 3 extension).
- `triageCase`: from a closure-captured row inside the route-supplied `upsertTriageCase` dep (Batch 4 payload extension forwards mainType/subtype/priority/etc).
- `task`: from a closure-captured row inside the route-supplied `createFollowUpTask` dep (Batch 5 payload extension forwards title/desc/priority/urgency).
- `ownershipUpdated`: directly from `EngagementCallResultExecutorResponse.ownershipUpdated` (Batch 2 §3.6 / §3.7 / §3.8).

Response shape fixture (#167 from split-brain run) continues to pin all six keys + nullability.

## 2. Is ownershipUpdated now preserved?

**YES.** Batch 2 added `ownershipPlanned + ownershipUpdated` to the executor response. The boolean matches the legacy route's local computation (planned = any of the three fields supplied; updated = planned AND EC step ran).

## 3. Is Journey Event metadata now preserved?

**YES.** Batch 1 extended `AppendJourneyEventArgs` with typed `metadata?` + closure-PHI fields. Batch 3 wired the engagement executor to thread `journeyEventMetadata + patientName + patientDob` from input into the dep call. The canonical surface still does no logging. PHI flows only through the DI boundary.

## 4. Is task payload now preserved?

**YES.** Batch 5 added 7 optional fields (`taskTitle / taskDescription / taskPriority / taskUrgency / taskAssignedToUserId / taskDueAt / taskMetadata`) and wraps the task dep so the route can build the task row byte-equivalent to the legacy `storage.createTask` call.

## 5. Is triage payload now preserved?

**YES.** Batch 4 added 7 optional fields (`triageMainType / triageSubtype / triagePriority / triageAssignedUserId / triageDueAt / triageNote / triageMetadata`) and wraps the triage dep. The route can supply the full `TRIAGE_MAPPINGS` payload + admin-resolved owner / dueAt.

## 6. Is callbackHours now configurable?

**YES.** Batch 1 typed the option; Batch 6 implemented the adapter consumption. Routes can supply the admin-setting 24h fallback via `options.callbackHours` and get the same `nextActionAt` value the legacy route would have computed.

## 7. Is engagementStatus semantics still unresolved?

**YES — Ali decision pending.** Batch E of the adapter blockers run (#189) laid out three options:

- Option 1: collapse the planner to coarse `"in_progress"` for all non-terminal outcomes.
- Option 2: adopt per-outcome canonical transitions.
- **Option 3 (recommended): add a planner config flag `ENGAGEMENT_STATUS_SEMANTICS = "coarse" | "canonical"`, default coarse.**

Until Ali picks one, delegation cannot ship without changing behavior visible to operators.

## 8. Can route delegation ship with legacy coarse status behind flag?

**YES — conditional on a planner-config PR.** The cleanest path is:

1. Land a planner config PR adding `ENGAGEMENT_STATUS_SEMANTICS` (default coarse). Dormant — no route consumes it yet.
2. Land the engagement-route delegation PR. With the planner config defaulting to coarse and `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE` defaulting to OFF, the entire change is zero-behavior on merge.
3. Operationally, a future PR flips `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE` ON per environment (after staging verification). Behavior stays coarse.
4. A separately-approved future PR flips `ENGAGEMENT_STATUS_SEMANTICS` to canonical.

If Ali prefers Option 1 directly, the planner-config PR is replaced with a one-line PLAN_BY_OUTCOME PR collapsing the four non-terminal transitions to `"in_progress"`. Same downstream sequence.

If Ali prefers Option 2, the planner stays as-is, and the delegation PR ships with the documented behavior change.

## 9. What exact Ali decision remains?

**Pick one of three options for engagementStatus semantics:**

- (1) Collapse the canonical planner to legacy coarse behavior.
- (2) Adopt canonical per-outcome transitions on delegation (visible behavior change, requires operator notification).
- (3) Add a planner config flag, default coarse, staged flip later.

Once chosen, the engagement-route delegation PR can ship.

## 10. Exact next PR recommendation

**Option 3 path:** `ENGAGEMENT_STATUS_SEMANTICS` planner config PR. Dormant. Adds `RecordCallResultExecutionOptions.engagementStatusSemantics?: "coarse" | "canonical"`. When `"coarse"`, the adapter post-processes the plan's `executionCaseEngagementStatus` to `"in_progress"` (or `null` for terminal). When `"canonical"` or absent, behavior unchanged. Tests pin both modes. No route wiring.

Then: engagement-route delegation PR behind `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE` (default OFF). Inspect-before-coding protocol; if any new byte-equivalence concern surfaces, ship blockers doc instead.

## 11. Is delegation safe to ship today?

**Safe to ship the planner-config PR (Option 3).** Safe to ship the delegation wiring AFTER that lands, conditional on default-OFF flag.

NOT safe: shipping delegation wiring while the planner still emits canonical per-outcome semantics by default — Operators would see behavior change the moment the flag flips ON.

## 12. Plexus IQ

Untouched.

## 13. Hard-stops

- No route delegation wired in this batch.
- No flag flipped.
- No response shape change.
- No UI change.
- No migration.
- No Plexus IQ runtime touched.

End of readiness re-check.

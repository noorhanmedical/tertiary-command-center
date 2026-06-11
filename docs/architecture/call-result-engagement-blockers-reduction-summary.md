# Engagement-route delegation blockers — reduction summary

**Status:** Docs-only (Batch 7 of arg-extensions run).
**Date:** 2026-06-11.
**Companion:** `scripts/qa-call-result-engagement-blockers-reduction-summary.mjs`.

## 1. Starting state

After the platform split-brain run (PRs #160-184) + the adapter blockers run (PRs #185-192), engagement delegation was held by 8 blockers (Batch 12 of the split-brain run):

- B1 engagementStatus semantics (decision-level)
- B2 ownership writes (assignedTeamMemberId / assignedRole)
- B3 ownershipUpdated response field
- B4 callbackHours admin-setting divergence
- B5 triage payload preservation
- B6 follow-up task payload preservation
- B7 outreach-call insert on engagement route
- B8 journey-event metadata preservation

## 2. What this run resolved

Six adapter-/executor-level batches (PRs #193-198) plus the resolution summary (this PR):

| Blocker | Batch | PR | Resolution |
|---|---|---|---|
| B2 ownership writes | 2 | #194 | Engagement executor accepts `assignedTeamMemberId / assignedRole / forceReassign` on input + wraps EC dep to forward them. |
| B3 ownershipUpdated | 2 | #194 | Engagement executor surfaces `ownershipPlanned: boolean` + `ownershipUpdated: boolean` on its response envelope. Dry-run §2.6 confirms the legacy envelope can be derived directly. |
| B4 callbackHours | 1 + 6 | #193 + #198 | `RecordCallResultExecutionOptions.callbackHours?: number` typed in Batch 1; adapter consumption added in Batch 6. Routes can pass the legacy admin-settings 24h fallback via options. Tests §13/§14/§15 + §3.15 pin behavior. |
| B5 triage payload | 4 | #196 | Engagement executor accepts seven optional triage fields + wraps triage dep to forward them: `triageMainType / triageSubtype / triagePriority / triageAssignedUserId / triageDueAt / triageNote / triageMetadata`. |
| B6 task payload | 5 | #197 | Engagement executor accepts seven optional task fields + wraps task dep: `taskTitle / taskDescription / taskPriority / taskUrgency / taskAssignedToUserId / taskDueAt / taskMetadata`. |
| B7 outreach-call insert | (already resolved in Batch B of adapter blockers run, #186) | — | Engagement executor suppresses `outreachCallCreated` step. Pre-resolved before this run. |
| B8 journey-event metadata | 1 + 3 | #193 + #195 | `AppendJourneyEventArgs` extended with typed `metadata?` bag + closure-PHI fields (`patientName?`, `patientDob?`) in Batch 1; engagement executor accepts `journeyEventMetadata / patientName / patientDob` on input + wraps journey dep in Batch 3. PHI flows through the DI boundary only; executor still does no logging. |

## 3. What remains unresolved

ONE blocker remains:

### B1 — engagementStatus semantics

- The legacy route writes coarse `"in_progress"` for ALL non-terminal outcomes.
- The canonical planner writes per-outcome transitions (`contacted`, `needs_followup`, `not_reached`, `in_progress`).
- Delegating without resolving this difference would CHANGE engagement-case state writes for most outcomes — visible behavior change.

This is a PRODUCT BEHAVIOR DECISION, not an adapter limitation. Batch E (#189) of the adapter blockers run laid out three options + recommendation:

- **Option 1:** preserve legacy coarse `"in_progress"`. Adapter-level fix: collapse `PLAN_BY_OUTCOME` to coarse semantics.
- **Option 2:** adopt canonical per-outcome transitions. Adapter unchanged. Behavior change visible to operators.
- **Option 3 (recommended):** add a planner-level config flag `ENGAGEMENT_STATUS_SEMANTICS = "coarse" | "canonical"`. Default `coarse` until staged flip.

## 4. Why route delegation is still NOT wired

The wiring would require:
1. **B1 resolution** (Ali decision on Option 1/2/3).
2. The engagement route must then build the executor's `EngagementCallResultInput` from the request body, supply route-resolved deps (`storage.createTask`, `appendJourneyEvent`, `db.update(patientExecutionCases)`, `upsertOpenSchedulingTriageCase`), thread `callbackHours` from the admin settings into options, then translate the executor response back into the six-key legacy envelope.
3. That wiring PR must ship behind `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE` (default OFF).

Steps 2-3 are mechanical and can ship as soon as Ali clears B1.

## 5. Is engagementStatus semantics still the main Ali decision?

**Yes.** It is the ONLY remaining engagement-route blocker that cannot be solved at the adapter / executor layer. Every other Batch 12 blocker has been resolved or has a clear adapter-level path.

## 6. Is journey metadata extension ready?

**Yes.** Batch 1 (#193) extended `AppendJourneyEventArgs` with `metadata?: Record<string, unknown>` + `patientName?` + `patientDob?`. Batch 3 (#195) wired the engagement executor to thread these through. The dry-run §2.7 demonstrates closure-capture of PHI through the DI boundary.

## 7. Is ownershipUpdated now preserved?

**Yes.** Batch 2 (#194) added `ownershipPlanned + ownershipUpdated` to `EngagementCallResultExecutorResponse`. The legacy `{ ok, executionCase, journeyEvent, triageCase, task, ownershipUpdated }` envelope can be rebuilt by reading these fields directly. Tests §3.6 / §3.7 / §3.8 pin the semantics.

## 8. Is task / triage payload now preserved?

**Yes.** Batches 4 (#196) and 5 (#197) added 14 optional fields covering the full legacy task + triage payloads:
- Triage: `mainType / subtype / priority / assignedUserId / dueAt / note / metadata`.
- Task: `title / description / priority / urgency / assignedToUserId / dueAt / metadata`.

Tests §3.11 / §3.12 / §3.13 / §3.14 pin forwarding + absence semantics.

## 9. Exact next PR

**Engagement-route delegation wiring — behind `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE`, default OFF.**

Pre-conditions:
- Ali decision on B1 (Option 1/2/3).
- If Option 3, ship the `ENGAGEMENT_STATUS_SEMANTICS` planner config first as a separate dormant PR.

Then the delegation PR:
- `server/routes/executionCases.ts` reads the flag.
- Flag OFF: legacy code path unchanged.
- Flag ON: route parses body → resolves patient/exec-case → builds `EngagementCallResultInput` with all the extended fields populated → builds dep closures wrapping `appendJourneyEvent`, `db.update(patientExecutionCases)`, `upsertOpenSchedulingTriageCase`, `storage.createTask` → calls `recordEngagementCallResult` → maps the response to the legacy 6-key envelope (executionCase + journeyEvent + triageCase + task captured via dep closures; ownershipUpdated from executor response).
- Response shape MUST stay byte-equivalent (Batch 8 of split-brain run fixture pins it).
- No flag default flipped.
- No migration.
- No UI change.
- No Plexus IQ touched.

If during inspect-before-coding any new byte-equivalence concern surfaces, ship blockers doc instead (same protocol as Batch 12 of split-brain run).

## 10. Plexus IQ

Untouched in every batch of this run. Verified by each batch's QA pinning no-Plexus-IQ-import invariants.

End of summary.

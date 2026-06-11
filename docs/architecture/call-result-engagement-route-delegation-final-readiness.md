# Engagement-route delegation — FINAL readiness

**Status:** Docs-only (Batch 2 of Engagement completion run).
**Date:** 2026-06-11.
**Companion:** `scripts/qa-call-result-engagement-route-delegation-final-readiness.mjs`.

After Batch 1 of this run (#201) added the `engagementStatusSemantics: "coarse" | "canonical"` option, the LAST adapter-level engagement-route delegation blocker is resolved. This doc confirms the engagement route can now be delegated behind `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE` (default OFF) using coarse semantics for byte-equivalent legacy behavior.

## 1. Is response shape rebuildable?

**Yes.** The legacy 6-key envelope `{ ok, executionCase, journeyEvent, triageCase, task, ownershipUpdated }` is reassembled from:
- `ok` — `EngagementCallResultExecutorResponse.ok`
- `executionCase` — captured via closure inside the route-supplied `updateExecutionCaseEngagement` dep
- `journeyEvent` — captured via closure inside `appendJourneyEvent` dep
- `triageCase` — captured via closure inside `upsertTriageCase` dep
- `task` — captured via closure inside `createFollowUpTask` dep
- `ownershipUpdated` — `EngagementCallResultExecutorResponse.ownershipUpdated`

## 2. Is ownershipUpdated preserved?

**Yes.** Batch 2 of the arg-extensions run (#194) added it to the executor response. Matches legacy semantics (planned = any ownership field supplied; updated = planned AND EC step ran).

## 3. Is Journey Event metadata preserved?

**Yes.** Batches 1 + 3 of the arg-extensions run (#193, #195) added typed metadata bag + closure-PHI fields to `AppendJourneyEventArgs`. PHI flows through the DI boundary only — canonical surface stays log-free.

## 4. Is triage payload preserved?

**Yes.** Batch 4 of the arg-extensions run (#196) added seven optional triage fields (mainType, subtype, priority, assignedUserId, dueAt, note, metadata) to the engagement executor input.

## 5. Is task payload preserved?

**Yes.** Batch 5 of the arg-extensions run (#197) added seven optional task fields (title, description, priority, urgency, assignedToUserId, dueAt, metadata).

## 6. Is callbackHours configurable?

**Yes.** Batches 1 + 6 of the arg-extensions run (#193, #198) typed and consumed `options.callbackHours`. Route can pass the legacy admin-settings 24h fallback.

## 7. Is engagementStatus legacy-compatible using coarse mode?

**Yes — finally.** Batch 1 of this run (#201) added `options.engagementStatusSemantics = "coarse"`. When the engagement-route delegation PR supplies this, the adapter post-processes the plan so all non-terminal outcomes write `engagementStatus = "in_progress"`, matching the legacy route exactly. Terminal outcomes (scheduled / declined) keep their canonical `"contacted"` engagementStatus value (the legacy route already produces this for those outcomes).

## 8. Is route delegation safe behind default-OFF flag?

**Yes.** With:
- `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE` default OFF — flag OFF preserves the legacy code path byte-equivalent.
- `engagementStatusSemantics = "coarse"` — flag ON preserves the legacy engagementStatus values byte-equivalent.
- Existing fixtures (Batch 8 of split-brain run, #167) pin the six-key response envelope.

There is no remaining engagement delegation blocker that requires Ali decision before the wiring PR. The wiring PR is safe to ship.

## 9. Exact route wiring (Batch 3 next)

In `server/routes/executionCases.ts`, inside the `POST /api/engagement-center/call-result` handler, AFTER patient resolution + admin settings fetch + computedNextActionAt computation:

```
if (isRecordCallResultEngagementDelegateEnabled() && patientScreeningId !== null) {
  // Build EngagementCallResultInput from the resolved request data
  // (executionCaseId may be null; the executor handles that).
  // Build dep closures that wrap the existing storage / writers and
  // CAPTURE the returned rows for the legacy envelope.
  let executionCaseRow = null;
  let journeyEventRow = null;
  let triageCaseRow = null;
  let taskRow = null;

  const deps = {
    createOutreachCall: () => {},          // engagement-suppressed
    appendJourneyEvent: async (args) => {
      journeyEventRow = await appendJourneyEvent({
        patientName: args.patientName ?? patientName,
        patientDob: args.patientDob ?? patientDob ?? undefined,
        patientScreeningId: patientScreeningId ?? undefined,
        executionCaseId: executionCaseId ?? undefined,
        eventType: args.eventType,
        eventSource: "scheduler_portal",
        actorUserId,
        summary: "call result logged",
        metadata: args.metadata ?? journeyMetadata,
      });
    },
    updateAppointmentStatus: () => {},     // engagement-route does NOT own this
    updateExecutionCaseEngagement: async (args) => {
      // Maps engagementStatus / nextActionAt / ownership fields onto
      // the existing db.update(patientExecutionCases) call.
      ...
    },
    markAssignmentCompleted: () => {},     // engagement-suppressed
    upsertTriageCase: async (args) => {
      const result = await upsertOpenSchedulingTriageCase({...args mapped to legacy fields...});
      triageCaseRow = result.row;
    },
    createFollowUpTask: async (args) => {
      taskRow = await storage.createTask({...args mapped to legacy fields...});
    },
  };

  const execResult = await recordEngagementCallResult(
    {
      patientScreeningId: String(patientScreeningId),
      patientExecutionCaseId: executionCaseId !== null ? String(executionCaseId) : null,
      outcome: data.callResult,
      callbackAt: computedNextActionAt ? computedNextActionAt.toISOString() : null,
      notes: data.note ?? null,
      assignedTeamMemberId: ...,
      assignedRole: data.assignedRole,
      forceReassign: ...,
      journeyEventMetadata: journeyMetadata,
      patientName,
      patientDob: patientDob ?? null,
      triageMainType: mapping?.mainType ?? null,
      triageSubtype: mapping?.subtype ?? null,
      triagePriority: data.callResult === "manager_review" ? "high" : "normal",
      triageAssignedUserId: typeof data.assignedUserId === "string" ? data.assignedUserId : null,
      triageDueAt: computedNextActionAt?.toISOString() ?? null,
      triageNote: data.note ?? null,
      triageMetadata: { callResult: data.callResult, ... },
      taskTitle: `Call result needs follow-up — ${data.callResult}`,
      taskDescription: data.note ?? null,
      taskPriority: data.callResult === "manager_review" ? "high" : "normal",
      taskUrgency: "EOD",
      taskAssignedToUserId: typeof data.assignedUserId === "string" ? data.assignedUserId : null,
    },
    deps,
    {
      callbackHours,
      engagementStatusSemantics: "coarse",
    },
  );

  return res.json({
    ok: true,
    executionCase: executionCaseRow ?? executionCase,
    journeyEvent: journeyEventRow,
    triageCase: triageCaseRow,
    task: taskRow,
    ownershipUpdated: execResult.ownershipUpdated,
  });
}

// Flag OFF — legacy code path unchanged.
```

## 10. What remains out of scope

- Flipping the delegate flag default to ON.
- Changing the response shape.
- Changing the engagement-center UI.
- Changing the outreach route.
- Removing legacy logic.
- Plexus IQ runtime.
- Migrations.

## 11. Rollback plan

- Flip `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE` OFF in the affected environment.
- The legacy `if/else` branch resumes the original code path with zero behavior change.
- Open an incident ticket; fix forward in a new PR.

## 12. Plexus IQ

Untouched.

## 13. Hard-stops respected

- No route delegation wired in this batch.
- No flag flipped.
- No response shape change.
- No UI change.
- No migration.
- No Plexus IQ runtime touched.

End of final readiness.

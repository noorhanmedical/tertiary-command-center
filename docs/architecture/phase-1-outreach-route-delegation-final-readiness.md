# Phase 1 — outreach route delegation FINAL readiness

**Status:** Docs-only (Batch B6 of Phase 1 run).
**Date:** 2026-06-11.
**Companion:** `scripts/qa-phase-1-outreach-route-delegation-final-readiness.mjs`.

After Batches B2–B5 of this run, the canonical planner accepts the 5 outreach terminal outcomes, the outreach executor forwards atomic-write extension fields, and the parity harness verifies the response shape stays byte-equivalent. This doc confirms outreach-route delegation is safe to wire behind `USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE` (default OFF).

## 1. Is response shape rebuildable?

**Yes.** The delegation path supplies a `createOutreachCall` dep that:
- Calls `storage.createOutreachCallAtomic(record, desiredStatus)` — the same atomic helper the legacy route uses.
- Captures the returned call row in a closure.
- The route's `res.status(201).json(capturedCall)` returns the SAME row the legacy path would have returned. Byte-equivalent.

## 2. Is createOutreachCallAtomic behavior preserved?

**Yes.** The atomic helper is called by the dep — not by the canonical adapter directly. The atomic insert + appointmentStatus update is a single transaction inside `storage.createOutreachCallAtomic`. No splitting.

## 3. Is appointmentStatus preserved?

**Yes.** The `desiredStatus = deriveAppointmentStatus(parsed.data.outcome)` is computed in the route BEFORE the executor call, then passed both to `storage.createOutreachCallAtomic` (which writes `patient_screenings.appointmentStatus` atomically) and to the executor input as `desiredAppointmentStatus`.

## 4. Is attemptNumber preserved?

**Yes.** The route computes `attemptNumber = parsed.data.attemptNumber ?? prior.length + 1` BEFORE the executor call and passes it through as `input.attemptNumber`.

## 5. Is terminal assignment completion preserved?

**Yes.** When `desiredStatus` is in the legacy `TERMINAL` set, the route fires `storage.markSchedulerAssignmentCompleted(patientScreeningId)` BEFORE (or after) the executor call — the order doesn't matter because the planner produces `assignmentCompleted: true` for the canonical-set terminal outcomes (scheduled, declined, completed, dnc, do_not_contact, deceased, cancelled). The dep is wired as a no-op closure to avoid double-completion, OR the route fires it once and the dep is a no-op.

Implementation choice for Batch B7: the route fires `markSchedulerAssignmentCompleted` directly (preserving the legacy code path) and the executor's `markAssignmentCompleted` dep is a no-op. This is the safest split — the route owns the actual write.

## 6. Is canonical spine preserved?

**Yes.** `ensureCanonicalSpineForScreening` is fire-and-forget. The route fires it AFTER the executor returns (or after the legacy code path completes when flag OFF). Same code, same timing. The executor's `options.canonicalSpineRequired` is informational only.

## 7. Is Journey Event intentionally suppressed?

**Yes — per Batch B3 contract.** Until Ali approves outreach journey-event ownership, the outreach executor's `OUTREACH_SUPPRESSED_STEPS` continues to include `"journeyEventAppended"`. The route does NOT call `appendJourneyEvent`. Suppression is QA-enforced.

## 8. Is route delegation safe behind default-OFF flag?

**Yes.** With:
- `USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE` default OFF — flag OFF preserves the legacy code path byte-equivalent.
- Engagement-only suppression — flag ON does NOT trigger triage / task / journey / exec-case writes from the outreach surface.
- The route's `res.status(201).json(call)` response stays byte-equivalent under both flag states.
- Existing parity test (Batch B5) pins the response semantics.

## 9. Exact route wiring (Batch B7 next)

Inside `POST /api/outreach/calls` handler, AFTER auth + patient resolution + attemptNumber + desiredStatus computation + authorization check:

```ts
if (isRecordCallResultOutreachDelegateEnabled() &&
    CANONICAL_OUTREACH_OUTCOMES.has(parsed.data.outcome)) {
  let capturedCall: OutreachCall | null = null;
  const deps: CallResultExecutionDependencies = {
    createOutreachCall: async (args) => {
      capturedCall = await storage.createOutreachCallAtomic(
        { ...parsed.data, schedulerUserId: attributedScheduler, attemptNumber },
        args.desiredAppointmentStatus ?? desiredStatus,
      );
    },
    updateAppointmentStatus: () => {},        // owned by atomic helper above
    markAssignmentCompleted: () => {},        // route fires it directly below
    appendJourneyEvent: () => {},             // engagement-suppressed
    updateExecutionCaseEngagement: () => {},  // engagement-suppressed
    upsertTriageCase: () => {},               // engagement-suppressed
    createFollowUpTask: () => {},             // engagement-suppressed
  };
  await recordOutreachCallResult(
    {
      patientScreeningId: String(parsed.data.patientScreeningId),
      outcome: parsed.data.outcome,
      attemptNumber,
      desiredAppointmentStatus: desiredStatus,
      schedulerUserId: attributedScheduler,
      terminalCompletionReason: terminalForCompletion ? parsed.data.outcome : null,
    },
    deps,
  );
  // Terminal completion (route owns the actual write).
  if (terminalForCompletion) {
    try { await storage.markSchedulerAssignmentCompleted(parsed.data.patientScreeningId); }
    catch (err) { console.warn("[outreach] markSchedulerAssignmentCompleted failed:", (err as Error)?.message); }
  }
  // Fire-and-forget spine sync (route owns this).
  void ensureCanonicalSpineForScreening(...).catch(...);
  if (capturedCall) return res.status(201).json(capturedCall);
}

// Legacy code path follows (flag OFF or non-canonical outcome).
```

## 10. Rollback plan

- Flip `USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE` OFF.
- The legacy `if/else` branch resumes the original code path with zero behavior change.
- Open an incident ticket; fix forward in a new PR.

## 11. Plexus IQ + Admin Review

Untouched. Plexus IQ continues to READ outreach_calls for reasoning regeneration. Admin Review continues to consume Plexus IQ outputs.

## 12. Hard-stops in this readiness

- No route wiring in this batch (B7 ships it).
- No flag flipped.
- No response shape change.
- No UI change.
- No migration.
- No Plexus IQ runtime touched.
- No Admin Review runtime touched.

End of readiness.

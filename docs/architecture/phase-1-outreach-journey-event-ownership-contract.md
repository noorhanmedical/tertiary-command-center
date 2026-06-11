# Phase 1 — outreach Journey Event ownership contract

**Status:** Docs-only (Batch B3 of Phase 1 run).
**Date:** 2026-06-11.
**Companion:** `scripts/qa-phase-1-outreach-journey-event-ownership-contract.mjs`.

## 1. Current state

The legacy outreach route (`server/routes/outreach.ts`) does NOT append a `patient_journey_events` row when a call result is logged. Only the engagement-center call-result handler appends journey events today.

The canonical adapter (`recordCallResultExecutionAdapter.ts`) DOES include a `journeyEventAppended` step, but the outreach executor (`recordCallResultOutreachExecutor.ts`) explicitly suppresses it via `OUTREACH_SUPPRESSED_STEPS = [journeyEventAppended, executionCaseUpdated, triageCaseUpserted, followUpTaskCreated]` — preserving the legacy outreach behavior under future flag-ON delegation.

## 2. Final target (Phase 1+)

Every canonical call-result write — engagement OR outreach surface — should append exactly ONE journey event with `eventType: "call_result_logged"`. This yields:

- ONE unified patient timeline (Engagement Center view + Plexus IQ reasoning consumers + Admin Review evidence consumers all see the same story).
- ONE canonical writer (`appendJourneyEvent`) per the canonical ownership registry.
- NO information loss when an operator phones a patient and logs the result through the outreach UI.

## 3. Phase 1 safe path

The outreach route MUST continue to suppress journey-event append until:

1. **Ali approves the operator-communication path.** Operators currently expect outreach activity to be visible ONLY in the call log + outreach dashboard. Surfacing it in the engagement-case timeline view is a behavior change that requires advance notice.
2. **Team Portal renders the unified timeline.** Currently Team Portal renders only the day-of call list + selected per-patient panels. Adding "Journey timeline" to the patient panel is a Segment E concern.
3. **Plexus IQ reasoning regeneration is verified safe with the additional events.** Plexus IQ reads `patient_journey_events`. Increasing event volume per patient should not break reasoning regeneration, but the verification is a separate engineering step.

Until those three conditions are met, the outreach route SUPPRESSES the journey-event append. The suppression is pinned by `OUTREACH_SUPPRESSED_STEPS` in the outreach executor (Batch C of adapter-blockers run, #187).

## 4. Phase 1 implementation rule

- The outreach route MUST NOT call `appendJourneyEvent` directly.
- The outreach route MUST NOT inject a non-no-op `appendJourneyEvent` dep when delegating via the canonical adapter.
- The outreach executor's `OUTREACH_SUPPRESSED_STEPS` list MUST continue to include `journeyEventAppended`.

## 5. Plexus IQ posture

Plexus IQ READS `patient_journey_events` for reasoning regeneration + Admin Review evidence aggregation. Under Phase 1 suppression, Plexus IQ continues to see the SAME journey events it sees today (engagement-center route only). No Plexus IQ runtime change.

## 6. Admin Review posture

Admin Review consumes Plexus IQ outputs that derive from journey events. Under Phase 1 suppression, Admin Review continues to see the SAME outputs it sees today. No Admin Review runtime change.

## 7. Ali decision required to flip

To enable outreach journey-event append:

1. Confirm operator-communication window (training + comms).
2. Confirm Team Portal will render the unified timeline OR confirm operators don't need it.
3. Confirm Plexus IQ reasoning regeneration is verified safe.
4. Update `OUTREACH_SUPPRESSED_STEPS` to remove `"journeyEventAppended"`.
5. Wire an `appendJourneyEvent` dep on the outreach route delegation path that supplies route-resolved metadata (callDisposition, note, facilityId, etc.).
6. Test parity end-to-end in staging with the delegation flag ON.

## 8. Hard-stops in this contract

- No route behavior change in Batches B1-B12 of this run.
- No `OUTREACH_SUPPRESSED_STEPS` list change.
- No Plexus IQ runtime touched.
- No Admin Review runtime touched.
- No migration.

## 9. Rollback / safety

The suppression is preserved by source-pinning the `OUTREACH_SUPPRESSED_STEPS` list. The Batch C QA (`qa-record-call-result-outreach-step-suppression.mjs`) asserts it. Any future PR that removes `"journeyEventAppended"` from the list will trip the QA — protecting against accidental enablement.

End of contract.

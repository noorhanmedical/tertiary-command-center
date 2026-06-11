# Phase 1 — outreach atomic write contract

**Status:** Docs-only (Batch B1 of Phase 1 run).
**Date:** 2026-06-11.
**Companion:** `scripts/qa-phase-1-outreach-atomic-write-contract.mjs`.

## 1. Current outreach behavior

`POST /api/outreach/calls` (server/routes/outreach.ts) is the legacy outreach write surface.

Pipeline:
- Session-auth: `userId` from session; 401 if missing.
- Validation: `insertOutreachCallSchema.safeParse(body)`.
- Patient resolution: `storage.getPatientScreening(patientScreeningId)`; 404 if missing.
- `attemptNumber = body.attemptNumber ?? prior.length + 1` (derived from `storage.listOutreachCallsForPatient`).
- `desiredStatus = deriveAppointmentStatus(outcome)`.
- Authorization: admin OR (assigned scheduler matches session userId).
- **Atomic write:** `storage.createOutreachCallAtomic(record, desiredStatus)` — inserts `outreach_calls` row AND updates `patient_screenings.appointmentStatus` in a single transaction. Returns the call row.
- **Terminal scheduler-assignment completion:** if `desiredStatus` is in the local `TERMINAL` set (`scheduled / completed / declined / dnc / do_not_contact / deceased / cancelled`), the route calls `storage.markSchedulerAssignmentCompleted(patientScreeningId)`.
- **Fire-and-forget spine sync:** `ensureCanonicalSpineForScreening(patientScreeningId, { actorUserId: userId, auto: false })`.
- **Preview helper:** if `USE_RECORD_CALL_RESULT_OUTREACH_PREVIEW` is ON, emits one PHI-safe parity line (Batch H Step 3 from earlier runs).
- **Response:** `res.status(201).json(call)` — the raw call row, no wrapper.

## 2. Outcomes accepted

The route accepts ALL `OutreachCallOutcome` enum values — a superset of the canonical-10 the planner knows. Outreach-only outcomes (`wants_more_info`, `language_barrier`, `mailbox_full`, `hung_up`, `disconnected`, `busy`, `reached`, `refused_dnc`, `moved`, `deceased`, `not_interested`, `will_think_about_it`, plus the terminal-style `completed / dnc / do_not_contact / cancelled`) are validated at the schema layer and fall through `deriveAppointmentStatus` to `pending` if unmapped.

## 3. Side effects NOT performed by the outreach route

- NO journey-event append (Batch 19 B5 of split-brain run blocker).
- NO `patient_execution_cases` update (engagement-case state owned by engagement-center route).
- NO triage upsert (engagement-only).
- NO follow-up task creation (engagement-only).

These side effects are the engagement surface's territory. Outreach delegation will SUPPRESS them via `OUTREACH_SUPPRESSED_STEPS` already pinned by Batch C of the adapter-blockers run.

## 4. Target architecture

- The outreach route stays as a **compatibility adapter**. The legacy URL `POST /api/outreach/calls` is preserved indefinitely; it MUST NOT remain a separate write brain.
- The canonical service (`recordOutreachCallResult` + `recordCallResultExecutionAdapter`) owns the side-effect plan.
- When `USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE` is ON, the route delegates to the canonical service via injected deps that wrap the existing storage calls (`createOutreachCallAtomic`, `markSchedulerAssignmentCompleted`, `ensureCanonicalSpineForScreening`) — so DB effects are byte-equivalent.
- No split-brain: the canonical service is the single planner; the legacy route is one of two compatibility adapters (the other being the engagement-center call-result route, already delegated in Phase A).
- **Team Portal continues to call the legacy route while all flags are OFF.** The Team Portal canonical-write switch (Segment E) flips the UI to call the canonical Engagement endpoint AFTER staging proves out.
- **Engagement Center remains the operational owner.** Outreach is a sub-workflow inside Engagement Center per #163 / #172 / #213.
- **Plexus IQ untouched.** Plexus IQ may READ outreach_calls for intelligence/reasoning aggregation; it MUST NOT write or own the call-attempt workflow.
- **Admin Review untouched.** Admin Review owns reasoning regeneration on `patient_screenings.reasoning`; it does not own the outreach call-attempt workflow.

## 5. Side-effect ownership recap (matrix v2)

From #191 Batch G of split-brain run + #194 / #197 of arg-extensions run:

| Side effect | Outreach surface | Engagement surface | Team Portal future |
|---|---|---|---|
| `outreachCallCreated` | owned | suppressed | owned |
| `appointmentStatusUpdated` | owned | owned | owned |
| `journeyEventAppended` | suppressed (B3 below) | owned | owned |
| `executionCaseUpdated` | suppressed | owned | owned |
| `assignmentCompleted` | owned | suppressed | owned |
| `triageCaseUpserted` | suppressed | owned | owned |
| `followUpTaskCreated` | suppressed | owned | owned |
| `canonicalSpineEnsured` | out_of_band (fire-and-forget) | future | out_of_band |

## 6. Phase 1 outreach posture

- Outreach delegation flag (`USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE`) stays default OFF until B7 of this segment ships the wiring.
- Outreach journey-event ownership remains SUPPRESSED until Ali approves the operator-communication path (Batch B3 below).
- Outreach-only canonical outcomes (`completed`, `dnc`, `do_not_contact`, `deceased`, `cancelled`) need fixture + planner extension before the delegation can accept them (Batch B2 below).
- Response shape `res.status(201).json(call)` is preserved byte-equivalent under both flag states.

## 7. Hard-stops in this contract + downstream Phase 1 outreach batches

- No flag flipped ON.
- No migration.
- No Plexus IQ runtime touched.
- No Admin Review runtime touched.
- No Team Portal panel/playground change.
- No billing / qualification / PDF behavior touched.
- No `outreach_schedulers` table rename.

End of contract.

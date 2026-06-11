# Outreach call-result delegation — BLOCKERS

**Status:** Docs + QA only (Batch 19 of platform split-brain run). **Delegation did NOT ship.**
**Date:** 2026-06-10.
**Companion:** `scripts/qa-record-call-result-outreach-delegation-blockers.mjs`.

**STOP reason:** the canonical execution adapter (Batch H Step 5A) + outreach executor (Batch 14) cannot rebuild a byte-equivalent response for `POST /api/outreach/calls` under the current dormant design. The flag stays default-OFF; no route is wired. The blockers below MUST be resolved before delegation can ship.

## 1. Blockers identified during pre-coding inspection

### B1 — Atomic insert+update transactional guarantee

- **Legacy route** (`server/routes/outreach.ts:213-220`): `storage.createOutreachCallAtomic(record, desiredStatus)` is **atomic** — it inserts the `outreach_calls` row AND updates `patient_screenings.appointmentStatus` in a single transaction. The return is the inserted call row.
- **Canonical adapter** (`recordCallResultExecutionAdapter.ts`): models these as TWO separate steps — `createOutreachCall` then `updateAppointmentStatus`. Splitting them loses the transactional guarantee.
- **Impact:** a failure between the two steps would leave outreach_calls inserted but appointmentStatus stale. Visible state drift on failures.
- **Resolution required:** either (a) keep the atomic helper as a single dep that the route closure binds to `storage.createOutreachCallAtomic`, OR (b) extend the adapter with a "transactional pair" abstraction.

### B2 — `attemptNumber` computation

- **Legacy route** (`outreach.ts:167-168`): queries `storage.listOutreachCallsForPatient(patientScreeningId)` and computes `attemptNumber = parsed.data.attemptNumber ?? prior.length + 1`.
- **Canonical executor:** does not compute `attemptNumber`. The caller must supply it.
- **Impact:** delegating without route-side pre-computation would lose attempt numbering, which is part of the outreach_calls row.
- **Resolution required:** the route pre-computes `attemptNumber` BEFORE invoking the executor (already feasible — no adapter change needed). This is more a pre-condition than a blocker, but documenting it here.

### B3 — Multi-step authorization flow

- **Legacy route** (`outreach.ts:179-211`): admin vs non-admin branch; non-admin checks `getAssignedSchedulerUserIdForPatient` first, then falls back to `getActiveAssignmentForPatientOnDate`, then maps that assignment's `schedulerId` to a user via `getOutreachSchedulers`. Admins may attribute via `body.schedulerUserId`.
- **Canonical executor:** has no authorization model. The route owns authorization.
- **Impact:** none if delegation happens AFTER auth in the route — but the route's auth flow is dense, and the delegation wiring must thread `attributedScheduler` through correctly.
- **Resolution required:** route pre-computes `attributedScheduler` (same as today) and forwards it to the dep. This is a wiring concern, not an adapter limitation.

### B4 — TERMINAL set superset

- **Legacy route** (`outreach.ts:226-227`): `TERMINAL = {scheduled, completed, declined, dnc, do_not_contact, deceased, cancelled}`. The route checks `desiredStatus.toLowerCase()` against this set.
- **Canonical planner:** only knows the canonical 10 outcomes; the route's TERMINAL set covers outcomes the planner has no envelope for (`completed`, `dnc`, `do_not_contact`, `deceased`, `cancelled`).
- **Impact:** delegating a `completed`-or-similar outcome through the planner would throw `unknown outcome`. Visible 500.
- **Resolution required:** either extend the canonical fixture + planner to cover these outcomes (preferred — closes the split-brain) OR have the route bypass the executor for non-canonical outcomes (preserves split-brain inside the route).

### B5 — Journey-event divergence

- **Legacy route:** does NOT append a journey event.
- **Canonical adapter:** always invokes `deps.appendJourneyEvent`.
- **Impact:** delegating would START appending journey events on the outreach surface. This is a feature, but it's a behavior change that requires Ali approval (auditors expected previous behavior).
- **Resolution required:** per-surface step suppression on the adapter (let the executor advertise which steps it owns; the adapter respects the suppression). The Batch 14 `OUTREACH_OWNED_STEPS` already names what the surface advertises — the adapter just needs to USE that list to skip non-advertised steps. This is a small adapter extension.

### B6 — Canonical-spine fire-and-forget

- **Legacy route** (`outreach.ts:236-244`): fires `ensureCanonicalSpineForScreening` fire-and-forget after the atomic write.
- **Canonical adapter:** has no step for canonical-spine sync.
- **Impact:** delegating would skip the spine sync. Patient Directory canonical view would drift.
- **Resolution required:** either add a new adapter step (`canonicalSpineSync`), or have the route call the spine sync explicitly outside the executor (already feasible).

### B7 — Execution-case state writes the outreach surface does not own

- **Legacy route:** does NOT touch `patient_execution_cases`.
- **Canonical adapter:** if `patientExecutionCaseId` is supplied AND the planner emits an `engagementStatus` transition, the adapter runs `updateExecutionCaseEngagement`. The outreach executor's `OUTREACH_OWNED_STEPS` doesn't include this step, but the adapter still calls the dep.
- **Impact:** delegating with a patientExecutionCaseId resolved by the route would START writing engagement-case state from the outreach surface — re-opening the split-brain.
- **Resolution required:** same as B5 — per-surface step suppression. The outreach surface SHOULD NOT update execution-case state from the outreach route; if Ali decides it should, that's a separate Ali-approved PR.

## 2. Why we STOP

Per the platform split-brain run's hard rules ("no BS patches, no parallel brains, no duplicated ownership"), patching the route to bypass the adapter for specific outcomes or surfaces would re-create split-brain inside the executor. The correct fix is **per-surface step suppression on the canonical adapter**, then re-attempt delegation.

## 3. Required follow-up before delegation can ship

1. Adapter extension PR — add per-surface step suppression so the adapter honors the executor's advertised owned-step list.
2. Adapter extension PR — extend `CreateOutreachCallArgs` (and the dep contract) so the route can wire it to the atomic helper as a single transactional callback.
3. Ali decision on B4 — extend canonical fixture/planner to cover `completed`, `dnc`, `do_not_contact`, `deceased`, `cancelled`, OR mark outreach delegation as "canonical-set outcomes only" and document the split.
4. Ali decision on B5 — start appending journey events on the outreach surface? If yes, ship as a separate communicated PR.
5. Re-attempt outreach delegation with the extended adapter. New blockers doc if any remain.

## 4. What this batch actually delivers

- This doc.
- `scripts/qa-record-call-result-outreach-delegation-blockers.mjs` asserting the doc exists with each B1–B7 explanation present, the outreach delegation flag stays default-OFF, and the outreach route has NOT been delegated (no import of `isRecordCallResultOutreachDelegateEnabled` from `outreach.ts`).

## 5. Plexus IQ

Untouched. Plexus IQ is not part of the outreach route or its delegation.

## 6. Hard-stops respected

- No route delegation wired.
- No flag default flip.
- No response shape change.
- No new side effects.
- No billing / qualification / PDF / Admin Review / Plexus IQ runtime touched.
- No migrations.

End of blockers report.

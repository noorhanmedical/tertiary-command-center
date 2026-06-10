# Admin Review approval → commit pipeline inventory

**Status:** Docs-only (Bundle 30). No code changed. No Admin Review behavior change. No qualification logic change. No supporting-button behavior change.
**Date:** 2026-06-09.
**Scope:** Enumerate every file, route, repository call, journey-event write, and downstream side effect involved in the approval → commit → engagement-routing pipeline so future PRs touching ANY adjacent surface can verify they have not regressed the pipeline.

**Cross-references:**
- `protected-flows.md` (Admin Review approval, qualification, supporting buttons listed as load-bearing).
- `do-not-touch.md` (the Admin Review modal + plexusIq services listed).
- `plexus-iq-read-model-contract.md` (Bundle 25, PR #110 — forward-rule for a future aggregate read).
- `backend-route-parity-inventory.md` (Batch 3a).
- `pdf-protection-contract.md` (the reasoning blob the PDF consumes).
- `billing-cleanup-design.md` (Batch 17a, PR #68).

This document is an inventory, not a roadmap. The pipeline is in steady state; this captures the steady-state surface so refactors cannot regress it silently.

---

## 0. Trigger

The approval pipeline starts when a user (admin role) POSTs:

```
POST /api/patient-screenings/:id/admin-approval
body: { status: "approved" | "rejected" | "needs_info" | "pending", note?: string }
```

Source: `server/routes/patients.ts:1048-1201`.

---

## 1. Route handler responsibilities (server/routes/patients.ts:1048-1201)

The handler does, in order:

1. Validates `status` against the four-value allow-list (line 1056-1062).
2. Reads the patient row via `storage.getPatientScreening(id)` (line 1066).
3. Writes the screening row with the new approval state (line 1071-1076):
   - `adminApprovalStatus = status`
   - `adminApprovedAt = new Date() | null`
   - `adminApprovedByUserId = userId | null`
   - `adminApprovalNote = note | null`
4. If `status === "approved"`:
   a. Resolves the scheduler from settings via `lookupSchedulerFromSettings(facility)` (line 1101-1107). Returns `{ scheduler, source }`.
   b. If `updated.commitStatus === "Draft"`: calls `commitPatient(id, userId, { auto: true })` (line 1113-1119). Captures `result.data.schedulerName` for the response payload.
   c. Else: treats as already-routed and sets `routedToEngagement = true` so the client-side query cache invalidation fires.
5. Best-effort journey-event append (line 1136-1167):
   - Looks up the most recent `patientExecutionCases` row for the screening.
   - Appends a `patient_journey_events` row with `eventType: "admin_approval_updated"`, `eventSource: "plexus_iq_admin_review"`, metadata carrying status / note / routing info.
   - If the schema modules are absent (rollout scenario), the audit row is silently dropped.
6. Logs an audit entry via `logAudit(req, "update", "patient", id, {...})` (line 1175).
7. Returns: `{ ok, patient, routedToEngagement, routedSchedulerName, routedSchedulerSettingsSource, routedByScheduledSettings }`.

The handler is the ONE place where approval state, scheduler lookup, and the commit/routing call site live together. Any future architecture PR that splits these MUST preserve the exact call order.

---

## 2. Commit-service responsibilities (server/services/patientCommitService.ts)

`commitPatient(patientId, userId, { auto })` (lines 61-188):

1. Reads the screening.
2. Returns early as `ok: true` if `commitStatus !== "Draft"` (idempotent for Ready/WithScheduler/Scheduled). This is the **idempotency guard** the approval handler depends on.
3. Manual-commit only (`!auto`): enforces the contact-info gate via `missingRequiredFields(patient)` (lines 35-41).
4. Writes the screening row to `commitStatus: "Ready"`, `committedAt: now`, `committedByUserId: userId`.
5. Fire-and-forget execution of the canonical-spine fan-out (lines 97-182):
   - `createOrUpdateExecutionCaseFromScreening(updated, userId)` (executionCase.repo.ts).
   - `createGlobalScheduleEventFromScreeningCommit(updated, executionCase.id, batchScheduleDate, options)` (globalSchedule.repo.ts).
   - `createOrUpdateInsuranceEligibilityReviewFromScreening(updated, executionCase.id)` (insuranceEligibility.repo.ts).
   - `createOrUpdateCooldownRecordsFromScreening(updated, executionCase.id)` (cooldown.repo.ts).
   - Two `appendPatientJourneyEvent` writes (lines 125-167): `screening_committed`, then `execution_case_created | execution_case_updated`.
   - `autoAssignSchedulerForExecutionCase(executionCase.id, options)` (schedulerAutoAssign.ts).
6. Returns `{ ok: true, data: { patient, schedulerName } }` synchronously — the fan-out has already started in the background.

**The fire-and-forget invariant is load-bearing**: the approval handler returns its HTTP response immediately after `commitPatient` returns. The fan-out completes asynchronously. A future PR that turns the fan-out synchronous changes the HTTP latency contract and is OUT OF SCOPE for any safe bundle.

---

## 3. Downstream side effects the pipeline triggers (read-only inventory)

When a Draft screening is approved, the following tables receive writes (transitively, via §2 step 5):

| Table | Origin | Notes |
|---|---|---|
| `patient_screenings` | route handler (line 1071-1076) + commitPatient (line 88-92) | Approval state + commit state. |
| `patient_execution_cases` | `createOrUpdateExecutionCaseFromScreening` (executionCase.repo.ts:163-217) | The canonical spine row. |
| `patient_journey_events` | route handler (line 1149-1167) + commitPatient (lines 125-167) | Three rows: admin_approval_updated, screening_committed, execution_case_created\|updated. |
| `global_schedule_events` | `createGlobalScheduleEventFromScreeningCommit` (globalSchedule.repo.ts) | Only if appointment datetime is parseable. |
| `insurance_eligibility_reviews` | `createOrUpdateInsuranceEligibilityReviewFromScreening` (insuranceEligibility.repo.ts) | Always. |
| `cooldown_records` | `createOrUpdateCooldownRecordsFromScreening` (cooldown.repo.ts) | One per qualifying service. |
| `scheduler_assignments` | `autoAssignSchedulerForExecutionCase` (schedulerAutoAssign.ts) | Only when a scheduler is resolvable. |
| `audit_log` | `logAudit` (auditService.ts) | Always. |

A safe bundle MUST NOT change the columns written by any of these calls. The architecture-surface columns (status, lifecycle, identifiers) are safe to READ.

---

## 4. Frontend contract the modal depends on

The Admin Review modal (`client/src/components/qualification/AdminReviewDialog.tsx`) consumes the route's response shape. Specifically:

- `ok: boolean`.
- `patient: PatientScreening` — full screening row; the modal reads `adminApprovalStatus`, `adminApprovedAt`, `commitStatus`, `qualifyingTests`, `reasoning`.
- `routedToEngagement: boolean` — drives the engagement-assignment query invalidation.
- `routedSchedulerName: string | null` — surfaced as a toast.
- `routedSchedulerSettingsSource: "outreach-schedulers-table" | "missing"` — used to badge the toast.
- `routedByScheduledSettings: boolean`.

A safe bundle MUST NOT change any of these field names or types. PR #110's `plexus-iq-read-model-contract.md` §3.1 forwards `adminApprovalStatus`, `adminApprovedAt`, `adminApprovedByUserId`, `adminApprovalNote` byte-identical — this inventory pins the *source* of those fields.

---

## 5. Forbidden changes for any safe bundle

A safe-bundle PR MUST stop and ask if it would:

1. Edit any of `server/routes/patients.ts:1048-1201`, `server/services/patientCommitService.ts`, `server/services/screening.ts`, or anything under `server/services/plexusIq/`.
2. Change the order of steps in §1 or §2.
3. Add a step that runs BEFORE the journey-event append at §1.5 — the audit row's timing is load-bearing.
4. Change the `commitStatus !== "Draft"` early-return in `commitPatient` (idempotency guard).
5. Change any column written by any side-effect listed in §3.
6. Change any field name in the response payload listed in §4.
7. Move the auto-assign call (§2 step 5e) into the synchronous path.
8. Add a new write to `patient_execution_cases`, `patient_journey_events`, or `scheduler_assignments` from outside the existing helpers.
9. Touch `AdminReviewDialog.tsx`, `AdminApprovalControl.tsx`, `PatientPdfActions.tsx`, or any qualifying-factor / supporting-button file.
10. Touch the canonical reasoning blob (`patient_screenings.reasoning`) write path — Bundle 25's forwarding contract assumes the blob is shape-stable.

---

## 6. Allowed safe-bundle work adjacent to this pipeline

A safe bundle MAY:

- Add docs that describe the pipeline (this document).
- Add QA invariants that pin the existing code paths (e.g. a script that asserts §1's step order via source-text checks).
- Add fixtures that capture the pipeline's external shape (e.g. a canned approve → expected journey-event-shape test).
- Add a read-only module that consumes the pipeline's OUTPUTS (e.g. the dormant Plexus IQ aggregate read module contracted by Bundle 25).

A safe bundle MAY NOT:

- Refactor the pipeline.
- Change the journey-event shape, the audit-log shape, or the response shape.
- Wire any new route into the pipeline.

---

## 7. Test surfaces that already cover the pipeline

These tests / scripts are the existing safety net. A safe bundle MUST keep them green:

- `scripts/qa-engagement-assignment-runtime.mjs` — Engagement Center runtime, the downstream consumer.
- `scripts/qa-plexus-iq-backend.mjs` — Plexus IQ backend, the upstream context.
- `scripts/qa-plexus-iq-interior.mjs` — Plexus IQ interior including the modal.
- `scripts/qa-engagement-board-v2-parity-fixture.mjs` (Bundle 22) — assignment-board projection.
- `server/modules/operational-queue/__tests__/projection-parity.test.ts` (Bundle 12 / 13) — downstream call-list projection.

A new safe bundle that touches a route adjacent to this pipeline MUST re-run all five above.

---

## 8. Non-promises

- This inventory does NOT design the Admin Review modularization (Batch 15 of the orchestrator). It pins the steady state so the future modularization PR has a target.
- This inventory does NOT specify the qualification cleanup. That lives in `qualification-structure-cleanup-design.md` (Bundle 31, the next bundle).
- This inventory does NOT change behavior. Re-running the pipeline after this bundle produces byte-identical results.

End of inventory.

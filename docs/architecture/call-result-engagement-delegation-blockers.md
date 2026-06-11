# Engagement call-result delegation — BLOCKERS

**Status:** Docs + QA only (Batch 12 of platform split-brain run). **Delegation did NOT ship.**
**Date:** 2026-06-10.
**Companion:** `scripts/qa-record-call-result-engagement-delegation-blockers.mjs`.

**STOP reason:** the canonical execution adapter (Batch H Step 5A) + engagement executor (Batch 7) cannot rebuild a **byte-equivalent** response for `POST /api/engagement-center/call-result` under the current dormant design. The flag stays default-OFF; no route is wired. The blockers below MUST be resolved before delegation can ship.

## 1. Blockers identified during pre-coding inspection

### B1 — `engagementStatus` write divergence

- **Legacy route** (`server/routes/executionCases.ts:369-371`): writes `engagementStatus = "in_progress"` for ALL non-terminal results, regardless of outcome.
- **Canonical planner** (`server/services/callResult/recordCallResult.ts` — `PLAN_BY_OUTCOME`): writes per-outcome transitions:
  - `scheduled / declined` → `contacted`
  - `callback / wrong_number / manager_review` → `needs_followup`
  - `no_answer / voicemail` → `not_reached`
  - `needs_records / insurance_prior_auth_issue / facility_specific_issue` → `in_progress`
- **Impact:** delegating would CHANGE the `engagementStatus` value written on most outcomes. Visible state drift on the engagement-case row. Engagement Center board would re-bucket patients.
- **Resolution required:** either (a) extend the canonical planner / fixture to match the legacy route's coarse `"in_progress"` behavior, OR (b) decide the legacy behavior was wrong and Ali-approve the new per-outcome semantics + announce to operators.

### B2 — `assignedTeamMemberId` / `assignedRole` ownership writes

- **Legacy route** (`executionCases.ts:372-394`): conditionally writes ownership fields based on `data.assignedRole`, `data.assignedUserId`, and the `preserveSchedulerOwnership` admin setting + `metadata.forceReassign`.
- **Canonical executor:** does NOT model assignment-ownership writes at all. The `UpdateExecutionCaseEngagementArgs` only carries `engagementStatus` + `nextActionAt`.
- **Impact:** delegating would DROP ownership writes silently. Engagement-board team-member assignment would stop updating.
- **Resolution required:** extend the canonical executor to support ownership-write dependency, with byte-equivalent settings-fetch + forceReassign semantics.

### B3 — `ownershipUpdated` response field

- **Legacy route** (`executionCases.ts:364, 388-393, 438-444`): computes `ownershipUpdated: boolean` from local state and returns it in the response.
- **Canonical executor:** does not surface ownership in its result envelope.
- **Impact:** clients reading `ownershipUpdated` would see it disappear or always-false. Response-shape fixture (Batch 8) requires `"always"` nullability — the field must be present.
- **Resolution required:** extend the engagement executor's response to carry `ownershipUpdated` from a new dep return value, or compute it route-side after delegation.

### B4 — `computedNextActionAt` fallback divergence

- **Legacy route** (`executionCases.ts:184-191, 247-261`): reads `scheduling_triage.default_callback_due_hours` admin setting (defaults to 24h); applies only to `callback / patient_requested_call_later` outcomes; explicit `data.nextActionAt` wins.
- **Canonical planner** (`recordCallResult.ts` — `defaultCallbackTarget`): fixed 4-hour offset; applies to `callback / no_answer / voicemail`; explicit input wins.
- **Impact:** the future `nextActionAt` value would change on most callback-style writes. Visible engagement-case nextActionAt drift.
- **Resolution required:** either configurable callback-hours injection on the planner side, OR carve out the route to compute `computedNextActionAt` BEFORE invoking the executor and pass it through.

### B5 — Triage case metadata loss

- **Legacy route** (`executionCases.ts:295-326`): passes rich metadata to `upsertOpenSchedulingTriageCase` — `mainType` + `subtype` from `TRIAGE_MAPPINGS`, `nextOwnerRole`, `priority` (`high` for `manager_review`), `assignedUserId`, `dueAt`, `note`, plus a metadata bag with `callResult`, `callDisposition`, `createdSource`, and the caller's metadata.
- **Canonical executor:** `UpsertTriageCaseArgs` carries only `patientScreeningId`, `patientExecutionCaseId`, `triageType`, `callbackAt`.
- **Impact:** triage cases created via delegation would lose `mainType`/`subtype` granularity, priority, owner role, note, and metadata.
- **Resolution required:** extend `UpsertTriageCaseArgs` to carry the full triage-mapping payload; or have the route pre-translate `triageType` → full payload before calling the executor.

### B6 — Follow-up task metadata loss

- **Legacy route** (`executionCases.ts:334-356`): `storage.createTask` receives a rich body — `title: "Call result needs follow-up — ${outcome}"`, `description: note`, `taskType: "task"`, `urgency: "EOD"`, `priority: "high"` for `manager_review`, `assignedToUserId`, `createdByUserId`, `patientScreeningId`. Plus the `managerReviewRequiresTask` admin-setting guard.
- **Canonical executor:** `CreateFollowUpTaskArgs` carries `patientScreeningId`, `patientExecutionCaseId`, `taskType`.
- **Impact:** delegated task creation would have a different title, description, priority, urgency, and assignee.
- **Resolution required:** extend `CreateFollowUpTaskArgs` with the full plexus_tasks insert payload OR route pre-translation.

### B7 — Outreach call insert on engagement route

- **Legacy route:** does NOT insert `outreach_calls`. The engagement route is a result-logging surface; outreach calls are tracked by the outreach route.
- **Canonical executor:** always invokes `deps.createOutreachCall` (the `outreachCallCreated` step is `shouldRun: true`).
- **Impact:** delegating would START inserting outreach_calls from the engagement route → split-brain widens, not shrinks.
- **Resolution required:** either pass a no-op `createOutreachCall` dep (current dry-run pattern, Batch 11) OR introduce per-surface step-suppression on the executor.

### B8 — Journey event metadata loss

- **Legacy route** (`executionCases.ts:264-289`): calls `appendJourneyEvent` with rich metadata — `callResult, callDisposition, note, nextActionAt, assignedUserId, assignedRole, facilityId, ...metadata`. The journey event row carries patient name/dob from `patientName`/`patientDob` (PHI fields — the journey-event row schema permits them at the canonical `appendJourneyEvent` writer).
- **Canonical executor:** `AppendJourneyEventArgs` carries only `patientScreeningId, patientExecutionCaseId, eventType, sourceSurface, outcome`.
- **Impact:** journey events appended via delegation would carry empty metadata; downstream consumers reading callDisposition / note / facilityId from event metadata would break.
- **Resolution required:** extend `AppendJourneyEventArgs` with a structured (PHI-safe-at-the-API but storage-allowed-at-the-writer) metadata bag; OR funnel the engagement route's journey-event append THROUGH the route while still delegating the rest.

## 2. Why we STOP instead of patching

Per the platform split-brain run's hard rules: "no BS patches. no parallel brains. no duplicated ownership. no hidden shadow systems." Patching B1–B8 by adding "if engagement: do the legacy thing, if outreach: do the canonical thing" inside the executor would re-create the very split-brain this run is trying to eliminate.

The correct fix is to **extend the canonical contract** so the executor is genuinely capable of rebuilding the legacy response — then both routes can delegate cleanly. That extension is multiple PRs, requires Ali approval on B1 (the only true behavior question — the others are mechanical), and is OUT of scope for this run.

## 3. Required follow-up before delegation can ship

In order, with explicit gates:

1. **Ali decision on B1**: keep coarse `"in_progress"` for all non-terminal, OR adopt per-outcome canonical transitions? This is a product behavior question.
2. **Engagement executor v2** PR series, one per blocker, each landing dormant:
   - B2 → extend executor with ownership-write dep + admin-settings injection.
   - B3 → surface `ownershipUpdated` on executor result.
   - B4 → callback-hours injection.
   - B5 → triage payload extension.
   - B6 → task payload extension.
   - B7 → per-surface step-suppression flag.
   - B8 → journey-event metadata extension.
3. Re-attempt Batch 12 with the extended executor. New blockers doc if any remain.
4. Only after byte-equivalence is proven against the response-shape fixture (Batch 8) + side-effect matrix (Batch 9), the delegation wiring ships behind the default-OFF flag.

## 4. What this batch actually delivers

- This doc.
- `scripts/qa-record-call-result-engagement-delegation-blockers.mjs` asserting:
  - The blockers doc exists with each B1–B8 explanation present.
  - The engagement delegation flag is still default-OFF.
  - The engagement route has NOT been delegated (no import of `isRecordCallResultEngagementDelegateEnabled` from `executionCases.ts`).
  - The engagement executor + adapter remain dormant per their respective dormancy QAs.

## 5. Plexus IQ

Untouched. The blockers do not involve Plexus IQ.

## 6. Hard-stops respected

- No route delegation wired.
- No flag default flip.
- No response shape change.
- No new side effects.
- No billing / qualification / PDF / Admin Review / scheduler-assignment / Plexus IQ runtime touched.
- No migrations.

End of blockers report.

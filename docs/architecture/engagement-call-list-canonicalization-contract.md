# Engagement call-list canonicalization contract

**Status:** Docs-only (Batch A). No runtime change. No UI change. No API change. No route change.
**Date:** 2026-06-10.
**Scope:** Pin the canonical model for the Engagement Center / Team Portal call-list, team-member work-assignment, and call-result write surfaces so the multiple drift points the read-only audit identified cannot become divergence we have to recover from later.
**Cross-references:**
- Read-only audit (preceding turn) — `git log` shows no doc artefact; the audit lives in conversation history.
- `team-portal-playground-wiring-contract.md` (Bundle 11).
- `patient-directory-readonly-envelope-readiness.md` (Bundle 49).
- `team-portal-runtime-wiring-readiness-checklist.md` (Bundle 54).
- `admin-review-approval-commit-inventory.md` (Bundle 30).
- `pdf-protection-contract.md`, `pdf-preview-download-contract.md` (Bundle 56).
- `qa-index-regression-map.md` (Bundle 36).
- Bundle 22 (engagement-board parity), Bundle 23 (engagement-board dormant service), Bundle 50 (cancel-many invariant), Bundle 51 (v2 dormant prep), Bundle 46 (operational-queue read-only invariant), Bundle 47 (team-tasks read-only invariant).

This contract ships zero runtime code. Every future runtime PR adjacent to the surfaces below MUST cite the §-numbers here in its description.

---

## 1. Current state

Three distinct call-list-ish surfaces exist today, backed by three different tables:

- **Engagement Center assignment board** is backed by `patient_execution_cases` (and joined `patient_screenings`, `screening_batches`, `outreach_schedulers`).
  - Read: `GET /api/engagement/assignment-board` (`server/routes/engagementAssignmentBoard.ts:147-410`).
  - Manual assignment write: `POST /api/engagement/assignment-board/assign` (`engagementAssignmentBoard.ts:413-597`).
  - Cancel-many write: `POST /api/engagement/assignment-board/cancel-many` (Bundle 50 invariant).
- **Legacy scheduler / day-of queue** is backed by `scheduler_assignments`.
  - Read: `GET /api/scheduler-assignments` (`server/routes/schedulerAssignments.ts:28-111`).
  - Daily rebuild: `POST /api/scheduler-assignments/rebuild` (`schedulerAssignments.ts:114-146`).
  - PTO redistribute: `POST /api/scheduler-assignments/redistribute` (`schedulerAssignments.ts:148-167`).
- **Team Portal outreach list** consumes `GET /api/portal/outreach-call-list` (`server/routes/portal.ts:286-436`), reading `scheduler_assignments` + derived patient eligibility from `ancillary_appointments`, `screening_batches`, `patient_screenings`.
- **Operational Queue** at `server/modules/operational-queue/` is a **read-only reflection** over the four sources (Bundle 46 invariant pins this). Together with Journey Events + Execution Cases, the read-only reflections form the canonical observability surface.
- **Team Tasks** at `server/modules/team-tasks/` are a **read-only reflection** over `plexus_tasks` + `scheduler_assignments` (Bundle 47 invariant pins this).
- **Two call-result write paths coexist**:
  - `POST /api/outreach/calls` (`server/routes/outreach.ts:151-245`) — inserts `outreach_calls`, updates `patient_screenings.appointmentStatus`, marks `scheduler_assignments.status = "completed"` on terminal outcomes, calls `ensureCanonicalSpineForScreening`.
  - `POST /api/engagement-center/call-result` (`server/routes/executionCases.ts:164-350`) — appends `call_result_logged` journey event, updates `patient_execution_cases.engagementStatus` + `nextActionAt`, optionally opens a `scheduling_triage_case`, optionally creates a `plexus_tasks` row.

---

## 2. Terminology correction

- **Team Member** is the canonical product term for the human a call-list assignment is given to.
- **Patient Care Specialist (PCS)** and **Ancillary Care Specialist (ACS)** are role / capability profiles. Both PCS and ACS may receive assigned call/work lists.
- **"Scheduler"** as it appears in code, table names, route paths, and column names (`scheduler_assignments`, `schedulerAssignments`, `schedulerId`, `originalSchedulerId`, `/scheduler-portal`) is a **legacy / internal implementation term**, not the product-facing role model.
- DB tables MUST NOT be renamed yet — `scheduler_assignments` remains the table name until a deliberate, separately-approved migration plan ships. See `team-member-assignment-terminology-contract.md` (Batch D) for the terminology / migration safety rules.
- Future product-facing contracts SHOULD use **CallListAssignment** (the day-of work assignment) and **TeamWorkAssignment** (the broader work concept) assigned to a Team Member. Legacy `schedulerId` fields are wrapped as `legacySchedulerAssignmentId` / `legacySchedulerId` mapping fields in those contracts.

This document uses the legacy names when referencing concrete code paths and the product terms when describing the canonical model. The mapping is one-to-one.

---

## 3. Canonical ownership

- **`patient_execution_cases` owns long-lived engagement ownership** — who is responsible for advancing the patient through the engagement lifecycle, what stage the patient is at, when the next action is due.
- **`scheduler_assignments` (legacy table) currently stores day-of CallListAssignment rows** — who is calling whom today. The product concept is CallListAssignment; the table name remains `scheduler_assignments` until a future migration.
- **Team Portal must consume assigned call/work items** from the canonical day-of queue. It does NOT generate the queue.
- **Operational Queue reflects assigned work** read-only over `scheduler_assignments`, `plexus_tasks`, `patient_execution_cases.assignedTeamMemberId`, `ancillary_appointments`, `global_schedule_events`. No writes. Bundle 46 pins this.
- **Team Tasks reflect actionable staff work** read-only over `plexus_tasks` + `scheduler_assignments`. They must not silently diverge from call outcomes — every terminal call result that should produce a follow-up task MUST do so through the canonical `recordCallResult` service (§9) and not through a parallel write path.

---

## 4. Call-list creation

A patient enters the day-of call list through one of these paths:

- **Admin Review / commit** — `commitPatient` (`server/services/patientCommitService.ts`) fan-out writes a `patient_execution_cases` row via `createOrUpdateExecutionCaseFromScreening`. The execution case is the source of long-lived ownership.
- **Auto-assignment on commit** — `autoAssignSchedulerForExecutionCase` (`server/services/schedulerAutoAssign.ts:93-203`) sets `patient_execution_cases.assignedTeamMemberId` after `createOrUpdateExecutionCaseFromScreening`.
- **Daily rebuild** — `POST /api/scheduler-assignments/rebuild` → `buildDailyAssignments()` writes `scheduler_assignments` rows for the day from active batches.
- **Manual Engagement Center assignment** — `POST /api/engagement/assignment-board/assign` writes `patient_execution_cases.assignedTeamMemberId` (and, when the flag is on, the engagement-to-call-list bridge mirrors into `scheduler_assignments` — see Batch E).
- **Engagement-to-call-list bridge** — `server/modules/operational-queue/bridge.ts:80-168`, gated by `ENGAGEMENT_TO_CALL_LIST_BRIDGE` (default OFF), mirrors engagement-board assignments into `scheduler_assignments` for the day.

---

## 5. Call-list exclusion

A patient is excluded from the call list when ANY of the following holds at read time:

- `patient_execution_cases.lifecycleStatus` in `{closed, archived, cancelled}` (`engagementAssignmentBoard.ts:169`).
- `patient_execution_cases.engagementStatus` in `{archived, closed, cancelled, completed}` (`engagementAssignmentBoard.ts:173`).
- `patient_screenings.deletedAt IS NOT NULL` (`engagementAssignmentBoard.ts:207`).
- `scheduler_assignments.status` in `{completed, released}` (`schedulerAssignments.ts:56-59, 108`).
- Derived `patientType === "visit"` — the patient has a qualifying appointment in `[asOfDate, asOfDate + 90 days]` (`shared/patientType.ts:37-62`, `portal.ts:344`).
- `patient_screenings.appointmentStatus` in `{scheduled, completed, declined, dnc, deceased, cancelled}` (`portal.ts:349`).

---

## 6. Visit vs outreach

- **Visit patient** (a visit patient) — has a qualifying upcoming appointment (`screening_batches.scheduleDate` OR `ancillary_appointments` with `status="scheduled"`) within `[asOfDate, asOfDate + 90 days]`. Excluded from outreach call lists; their workflow is the scheduled visit workflow.
- **Outreach patient** (an outreach patient) — no qualifying upcoming appointment. Engaged via the call/outreach workflow.
- **Derived patientType can override stored patientType** — `derivePatientType()` in `shared/patientType.ts:37-62` takes precedence when appointment records exist. The stored `patient_screenings.patientType` column is a manual override; consumers MUST prefer the derived value where the helper is available.

---

## 7. Assignment / disbursement mechanisms

| Mechanism | Where | What it writes |
|---|---|---|
| Daily rebuild | `schedulerAssignments.ts:114-146` → `buildDailyAssignments()` | `scheduler_assignments` rows for the asOfDate. |
| PTO redistribution | `schedulerAssignments.ts:148-167` → `releaseAndRedistribute()` | Releases assignments for a team member and reassigns to available team members. |
| Auto-assign on commit | `schedulerAutoAssign.ts:93-203` | `patient_execution_cases.assignedTeamMemberId`. |
| Manual Engagement Center assignment | `engagementAssignmentBoard.ts:413-597` | `patient_execution_cases.assignedTeamMemberId` (+ bridge mirror when flag on). |
| Engagement-to-call-list bridge | `operational-queue/bridge.ts:80-168` | `scheduler_assignments` (flag-gated; default OFF). |
| Team Portal capacity partition | `portal.ts:391-407` | READ-side partition of the eligible pool; does NOT write `scheduler_assignments`. |

---

## 8. Drift risks

Verbatim from the read-only audit. Each is a future stop-condition for any PR in this surface:

1. The engagement-to-call-list bridge can fail silently — flag-gated + fire-and-forget; failures swallowed at `engagementAssignmentBoard.ts:562-567`.
2. `patient_execution_cases.assignedTeamMemberId` can diverge from `scheduler_assignments.schedulerId` — no FK, no joint update.
3. Two call-result paths write different side effects — `outreach.ts:151-245` vs `executionCases.ts:164-350`.
4. The outreach calls path lacks an explicit `appendJourneyEvent` in the route body — spine sync may write one downstream, but the route itself does not.
5. Terminal-status set is local to `outreach.ts:222` — no other code path enforces the same logic.
6. Derived `patientType` can differ from the stored `patient_screenings.patientType` — consumers that read the stored column may see stale values.
7. Operational Queue parity is only observable when the shadow-read flag/logging is enabled.
8. Team Portal capacity partition shifts when `outreach_schedulers.capacityPercent` changes mid-day without re-querying.
9. PTO redistribution is transactional within `releaseAndRedistribute()` but callers do not re-read the board.
10. `patient_execution_cases.assignedTeamMemberId` can orphan if the referenced team member / legacy scheduler row is deleted (no FK).

---

## 9. Canonical call-result service target — `recordCallResult`

A future service `recordCallResult(input): Promise<RecordCallResultOutcome>` is the single write path. The exact module path is reserved (`server/services/callResult/recordCallResult.ts`) but NOT created in this batch.

When implemented, it MUST do all of:

1. **Insert `outreach_calls`** — the audit row of the call itself.
2. **Update `patient_screenings.appointmentStatus`** — derived from outcome via `deriveAppointmentStatus()` (`outreach.ts:37-59`).
3. **Update `patient_execution_cases.engagementStatus`** — the engagement-side state transition.
4. **Update `patient_execution_cases.nextActionAt`** — for callback / no_answer / voicemail outcomes.
5. **Mark legacy `scheduler_assignments.status = "completed"`, `completedAt = now()`** — when outcome is terminal (`scheduled`, `completed`, `declined`, `dnc`, `do_not_contact`, `deceased`, `cancelled`).
6. **Create / update a follow-up Team Task or `plexus_tasks` row** — when outcome is in the existing `CALL_RESULTS_NEEDING_TASK` set (`manager_review`, `insurance_prior_auth_issue`, `needs_records`, `facility_specific_issue`, `technician_unavailable`).
7. **Open a `scheduling_triage_case` row** — when outcome maps to a triage type (callback, contact_issue, etc.).
8. **Append a `call_result_logged` `patient_journey_events` row** via the typed `appendJourneyEvent` writer (Bundle 12c).
9. **Return a canonical `RecordCallResultOutcome` object** — describing what was written (booleans + ids), so the caller can render UI and reviewers can audit.

The service is the choke point; the two routes funnel through it.

---

## 10. Canonical endpoint target

Future routes delegate to `recordCallResult`. **No legacy endpoint is removed** in the canonicalisation series; both routes continue to accept their existing request shapes and side-effect outputs.

- `POST /api/engagement-center/call-result` continues to accept its existing body; the handler delegates to `recordCallResult` and continues to return the documented response shape.
- `POST /api/outreach/calls` continues to accept its existing body; the handler delegates to `recordCallResult` and continues to return the documented response shape.
- Response shapes do NOT break for any caller during the canonicalisation series.
- A future Team Portal call-result route (planned in Batch H §6) ALSO delegates to `recordCallResult` behind a feature flag default OFF.

No UI changes ride alongside the canonicalisation. UI follows in a separate explicitly-approved series (Bundle 32 Step D-H, the Playground design-system PRs).

---

## 11. Team Portal relationship

Team Portal eventually:

- Reads the assigned call/work list (`GET /api/portal/outreach-call-list` today; a future canonical `/api/portal/call-list` endpoint replaces it after Batch H §5).
- Displays prior call history (`GET /api/portal/calls?patientScreeningId=<id>` planned in Batch H §4 + I).
- Allows call-result logging via a Team Portal write surface that delegates to `recordCallResult` (Batch H §6).
- Shows callback due (`patient_execution_cases.nextActionAt`).
- Shows next action (display only — Team Portal does NOT compute the action).
- Shows notes if the viewer's role permits — see `call-history-readonly-envelope-contract.md` (Batch G) for visibility rules.

Team Portal **never** owns:

- The daily rebuild (`buildDailyAssignments`).
- PTO redistribution.
- Auto-assignment on commit.
- The engagement-to-call-list bridge.
- Capacity math.
- Cancellation write semantics (cancel-many — Bundle 50 invariant).
- Assignment completion logic — that's the `recordCallResult` service's responsibility.
- Billing money paths.
- Qualification logic.
- PDF / packet generation (Bundle 56).

---

## 12. Minimum future runtime PR

Per the audit's §30 recommendation, the minimum future runtime PR is the `recordCallResult` service extraction:

1. Add `server/services/callResult/recordCallResult.ts` as a pure service that takes the union of both existing route bodies and produces a canonical `RecordCallResultOutcome`.
2. Add an end-to-end parity test that proves the canonical service produces the SAME side effects as today's two routes when fed canned input (no DB).
3. Both existing call-result routes (`/api/outreach/calls`, `/api/engagement-center/call-result`) delegate to the service; response shapes byte-stable.
4. No UI change.
5. Parity tests prove old side effects preserved BEFORE delegation lands.
6. Then a Team Portal call-result route delegates to the SAME service behind `USE_PORTAL_CALL_RESULT_WRITE` flag default OFF.

This contract pins what that PR must satisfy; the PR itself is out of scope here.

---

## 13. Stop conditions for any runtime PR in this surface

A runtime PR adjacent to call-list / call-result MUST stop and ask if:

1. It would rename `scheduler_assignments`, `schedulerId`, `originalSchedulerId`, or any other legacy column without a separately approved migration plan.
2. It would remove an existing call-result endpoint.
3. It would change either existing call-result endpoint's response shape.
4. It would write `patient_execution_cases.assignedTeamMemberId` from a route other than the engagement-board assign + auto-assign service.
5. It would write `scheduler_assignments` from a route other than the daily rebuild / redistribute / bridge / `recordCallResult` service.
6. It would skip the `appendJourneyEvent` write on any call-result path.
7. It would skip the `markSchedulerAssignmentCompleted` write on a terminal outcome.
8. It would flip the `ENGAGEMENT_TO_CALL_LIST_BRIDGE` flag default in production.
9. It would add a UI change in the same PR as a call-result write path change.
10. It would emit PHI on non-audit logs.
11. It would touch any of: Admin Review approval/commit, qualification, supporting buttons, canonical reasoning writes, PDFs / packets, billing money math, AWS production cutover, migrations.

---

## 14. No runtime behavior change

This contract ships zero code. Every concrete code reference in §§1-11 cites existing files; nothing in those files is altered by this batch. The contract pins the canonical model; the runtime work happens in separate, explicitly-approved PRs that satisfy §13.

End of contract.

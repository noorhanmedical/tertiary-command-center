# Engagement Center route parity inventory

**Date:** 2026-06-09
**Scope:** READ-ONLY inventory.
**Purpose:** Lock down byte-identical parity expectations for every Engagement Center route before any future wrapper or refactor batch touches them.

> Cross-reference: `docs/architecture/backend-route-parity-inventory.md` §4, `docs/architecture/protected-flows.md` §6, `docs/architecture/operational-queue-design.md`, `docs/architecture/canonical-workflow-wiring-map.md`. The Engagement Center → call-list bridge (PR #76, behind `ENGAGEMENT_TO_CALL_LIST_BRIDGE`, default OFF) is the only mutation any future PR should add without an explicit new-batch approval.

---

## 0. How this document is used

Every Engagement Center–touching PR must cite the relevant § from this doc + verify the conflict-guard semantics + verify the bridge-flag check is still **before** the dynamic import.

---

## 1. `GET /api/engagement/assignment-board` *(engagementAssignmentBoard.ts:165–428)*

- **Purpose:** Returns the full Engagement Center board — rows + summary aggregates. Filters by query params.
- **Method:** GET.
- **Request inputs (query):** `q`, `facility`, `assignedTeamMemberId`, `engagementStatus`, `engagementBucket`, `patientType`, `unassignedOnly=1`, `missingInfoOnly=1`.
- **Response shape:** `{ rows: BoardRow[], summary: { total, assigned, unassigned, needsInfo, byFacility, byAssignedTeamMember, byEngagementStatus } }`. `BoardRow` shape mirrored in `shared/contracts/engagementBoard.ts`.
- **Status codes:** 200; 500.
- **DB dependencies:**
  - `patient_execution_cases` filtered by `lifecycleStatus IS NULL OR = 'active'` AND `engagementStatus IS NULL OR NOT IN ('archived','closed','cancelled','completed')`.
  - `patient_screenings` (joined by `id`).
  - `screening_batches` (joined for `scheduleDate`).
  - `outreach_schedulers` (joined for assignee display).
  - `patient_journey_events` (latest per case for `lastActivityAt` + `lastActivitySummary`).
- **Side effects:** none (read-only).
- **Protected flows at risk:** Engagement Center board read; conflict-guard inputs; Scheduler portal indirectly.
- **Current behavior contract:**
  - Filter chain order: `q → facility → assignedTeamMemberId → engagementStatus → engagementBucket → patientType → unassignedOnly → missingInfoOnly`.
  - Default sort: unassigned first → nearest `nextActionAt` ASC → most-recent `lastActivityAt` DESC.
  - `missingInfo[]` computed by `computeMissingInfo(screening)` (lines 151–161).
- **Parity contract for future wrapper:**
  - Filter chain order preserved.
  - Sort order preserved.
  - `missingInfo[]` computation preserved.
  - SQL conditions on lifecycle/engagement status preserved verbatim.
- **Future service boundary:** `server/modules/engagement/readBoard(...)` (additive v2 endpoint per orchestrator Batch 13).
- **Risk level:** **high** (board is primary Engagement Center UI source).
- **Stop conditions:** Any change to filter chain order; any change to sort order; any change to lifecycle/engagement-status SQL.
- **Recommended sub-batch sequence:**
  - **EC-13a:** ship the v2 endpoint as additive alongside this one (orchestrator Batch 13).
  - **EC-13b:** parity test for one canned `(facility, date)` confirming union equality.
  - **EC-13c:** UI cutover (no shape change; toggle via query param or feature flag).

---

## 2. `POST /api/engagement/assignment-board/assign` *(engagementAssignmentBoard.ts:431–578)*

- **Purpose:** Bulk-assign N patients to one scheduler. Per-patient conflict guard.
- **Method:** POST.
- **Request inputs (body, Zod via `assignBoardSchema`):** `patientScreeningIds: number[]` (min 1), `schedulerId: number`, `assignedRole?: "scheduler"|"patientCareSpecialist"|"ancillaryCareSpecialist"` (default `"scheduler"`), `reason?: string`.
- **Response shape:** `{ ok, updated: [{ patientScreeningId, executionCaseId, previousSchedulerId, previousSchedulerName }], failed: [{ patientScreeningId, reason }], summary: { requested, updated, failed, schedulerId, schedulerName, schedulerFacility, assignedRole } }`.
- **Status codes:** 200 (always — `ok: false` carries partial-success); 400 (Zod); 404 (`Scheduler not found`); 500.
- **DB dependencies:** `patient_screenings`, `patient_execution_cases`, `outreach_schedulers`, `screening_batches`, `patient_journey_events`.
- **Side effects (per accepted patient):**
  1. Conflict-guard via `findConflictingActiveAssignment(...)` (lines 29–88).
  2. `UPDATE patient_execution_cases SET assignedTeamMemberId, assignedRole, engagementStatus`.
  3. `INSERT INTO patient_journey_events` with `eventType: "engagement_assignment_changed"`, `eventSource: "engagement_assignment_board"`.
  4. **Optional (PR #76, flag-gated):** Engagement → call-list bridge — only when `ENGAGEMENT_TO_CALL_LIST_BRIDGE` is truthy; never duplicates active rows; never modifies existing rows; never throws.
  - **No transaction across the batch — partial success is possible.**
- **Protected flows at risk:** Engagement bulk assign; conflict guard; Team Portal patient lists (read `assignedTeamMemberId`); Scheduler Portal call list (when bridge is ON).
- **Current behavior contract:**
  - Conflict-guard error message format: `` `Already assigned to <name> for <scheduleDate>. Two schedulers cannot share the same patient for the same date.` ``.
  - `NEW_STATES` set: `["new", "ready", "assigned", "not_reached"]` — only these transition to `"assigned"` on assignment; other engagement statuses preserved.
  - Outreach patients with null `scheduleDate` are conflict-exempt.
  - `eventType: "engagement_assignment_changed"` literal (UI may filter on it).
  - **Bridge gate:** `if (bridgeFlag === "1" || ... === "true" || ... === "yes")` — flag check **must remain BEFORE** the dynamic import of `bridge.ts`.
- **Parity contract for future wrapper:**
  - Conflict-guard error message format preserved verbatim.
  - `NEW_STATES` set preserved.
  - Outreach-patient exemption preserved.
  - Journey event eventType preserved.
  - **Flag check ordering preserved** — never invert the predicate, never lazy-load before checking.
- **Future service boundary:** `server/modules/engagement/bulkAssign(...)`. Conflict-guard moves to `server/modules/engagement/conflictGuard.ts`.
- **Risk level:** **high**.
- **Stop conditions:**
  - Any change to `NEW_STATES` set.
  - Any change to conflict-guard error message format.
  - Any change to the bridge-flag check (ordering, accepted values).
  - Any wrap that introduces a transaction without revisiting partial-success semantics.

---

## 3. `POST /api/engagement/assignment-board/cancel-many` *(engagementAssignmentBoard.ts:588–681)*

- **Purpose:** Bulk cancel — sets `engagementStatus='cancelled'`, `lifecycleStatus='cancelled'`, `assignedTeamMemberId=null` per case. Appends one `engagement_assignment_cancelled` journey event per case (best-effort).
- **Method:** POST.
- **Request inputs (body, Zod):** `executionCaseIds: number[]` (min 1), `reason?: string`.
- **Response shape:** `{ ok, cancelled: [{ executionCaseId, patientScreeningId, previousEngagementStatus, previousLifecycleStatus }], failed: [{ executionCaseId, reason }], summary: { requested, cancelled, failed } }`.
- **Side effects:** Per case — UPDATE + best-effort journey event. Does NOT delete `patient_screenings` rows.
- **Protected flows at risk:** Engagement bulk cancel; Plexus IQ "re-import" assumption (the underlying screening row stays alive).
- **Current behavior contract:**
  - `lifecycleStatus = 'cancelled'` literal.
  - Screening row remains intact.
  - `eventType: "engagement_assignment_cancelled"` literal.
- **Parity contract:** Above literals preserved. No code path that deletes `patient_screenings` in this handler.
- **Risk level:** **medium-high**.
- **Stop conditions:** Any code path that deletes `patient_screenings`; any change to terminal-state literals.

---

## 4. `GET /api/engagement-center/cases` *(executionCases.ts:123–143)*

- **Purpose:** Filtered list via `listEngagementCenterCases`.
- **Method:** GET.
- **Inputs (query):** `engagementBucket`, `facilityId`, `assignedTeamMemberId`, `assignedRole`, `lifecycleStatus`, `engagementStatus`, `qualificationStatus`.
- **Response shape:** `PatientExecutionCase[]` (capped at 500).
- **Risk level:** **medium**.

---

## 5. `POST /api/engagement-center/assign` *(executionCases.ts:152–163)*

- **Purpose:** Algorithmic assignment for a role's bucket scope (distinct from §2's manual bulk-assign).
- **Method:** POST.
- **Inputs (body, Zod):** `targetRole`, `facilityId?`, `limit?`, `assignedTeamMemberId?`, `dryRun?`.
- **Response shape:** `{ ok, ...assignEngagementCasesResult }`.
- **Risk level:** **medium-high** (priority ranking + greedy capacity allocation).

---

## 6. `POST /api/engagement-center/call-result` *(executionCases.ts:174–end)*

- **Purpose:** Logs call result; updates case status; opens scheduling-triage case for scheduling actions; opens a plexus task for manager-action results; appends `call_result_logged` journey event.
- **Method:** POST.
- **Inputs (body, Zod):** `callResult` (required), `executionCaseId?`, `patientScreeningId?`, `patientName?`, `patientDob?`, `callDisposition?`, `note?`, `nextActionAt?`, `assignedUserId?`, `assignedRole?`, `facilityId?`, `metadata?`.
- **Response shape:** `{ ok, executionCase?, journeyEvent?, schedulingTriageCase?, plexusTask?, ... }`.
- **Side effects:** Up to 4 DB writes (execution case update + journey event + scheduling triage OR plexus task).
- **Protected flows at risk:** Scheduler Portal call dialog; manager review; scheduling triage queue.
- **Current behavior contract:**
  - Patient resolution order: `executionCaseId → patientScreeningId → name+dob`.
  - Always-append journey-event behavior (best-effort).
  - `default_callback_due_hours` setting drives the default `nextActionAt`.
- **Parity contract:** Resolution order preserved; best-effort write preserved; setting-driven default preserved.
- **Risk level:** **high**.

---

## 7. `GET /api/scheduler-portal/cases` *(executionCases.ts:423–end)*

- **Purpose:** Scheduler-portal-scoped case list. Listed here because the Engagement Center owns the spine read.
- **Risk level:** **medium**.
- **See also:** `portals-route-parity-inventory.md` §2 for the consumer-side perspective.

---

## 8. Compact risk + sequence table

| Route | Risk | Sequence position |
| --- | --- | --- |
| `GET /engagement-center/cases` | medium | first (read-only filter pass-through) |
| `GET /engagement/assignment-board` | high | additive v2 endpoint (orchestrator Batch 13) |
| `POST /engagement/assignment-board/cancel-many` | medium-high | after the board read is parity-tested |
| `POST /engagement-center/assign` | medium-high | after cancel-many |
| `POST /engagement/assignment-board/assign` | high | **last** — conflict guard + flag-gated bridge stay in place |
| `POST /engagement-center/call-result` | high | independent track; sub-batched (logging, triage, task each as its own wrapper) |

---

## 9. Cross-batch mapping

| Batch | Owns |
| --- | --- |
| **Batch 10** (Execution Case spine) | The state-machine matrix that conflict-guard depends on. |
| **Batch 11** (Team Task spine) | The downstream surface for engagement-assignment derived tasks. |
| **Batch 12** (Journey events) | The append-only audit trail. After Batch 12b's typed writer ships, every event-write site in this file migrates one at a time. |
| **Batch 13** (Engagement Center read-model optimization) | The additive v2 paginated endpoint that this inventory enables. |
| **PR #76** (Batch 11c — already merged) | The flag-gated bridge that turns engagement assignments into call-list rows. |

---

## 10. Program-wide stop conditions

A future Engagement Center wrapper PR MUST stop and ask if:

1. The conflict-guard error message format changes.
2. The `NEW_STATES` set changes.
3. The bridge-flag check is altered (ordering, accepted values, or the dynamic-import position).
4. Any handler introduces a transaction that converts partial-success into all-or-nothing.
5. `lifecycleStatus='cancelled'` is renamed.
6. Outreach-patient (`scheduleDate=null`) exemption from conflict guard is removed.
7. A code path that deletes `patient_screenings` rows is added to any cancel handler.

End of inventory.

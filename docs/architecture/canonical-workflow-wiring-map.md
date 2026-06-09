# Canonical workflow wiring map

**Date:** 2026-06-09
**Scope:** READ-ONLY architecture map. No source code changed by this doc.
**Purpose:** Document the full operational lifecycle of one patient — from Engagement-Center assignment to invoice — and map every stage to the batch that owns it. Every future architecture PR cites this map to justify *which batch* it belongs in.

> Cross-reference: `docs/architecture/canonical-spine.md`, `docs/architecture/execution-case-state-machine.md`, `docs/architecture/team-task-spine-design.md`, `docs/architecture/journey-event-standardization-design.md`, `docs/architecture/billing-cleanup-design.md`, `docs/architecture/operational-queue-design.md`, `docs/architecture/refactor-batches.md`, `docs/architecture/qa-matrix.md`. Per-area parity inventories in `plexus-iq-route-parity-inventory.md`, `engagement-center-route-parity-inventory.md`, `portals-route-parity-inventory.md`.

---

## 0. How this document is used

1. **No new batch is introduced by this doc.** Every stage below maps to one or more of the existing batches **10, 11, 12, 16, 17, 21**. If a future need does not fit, it triggers a Batch 23 discussion — not a hidden expansion of this map.
2. **Every PR that touches lifecycle-relevant code** (`patient_execution_cases`, `plexus_tasks`, `patient_journey_events`, `documents`, billing tables, invoice tables) MUST cite the corresponding §-number from this map in its description.
3. **The "owning batch" for each stage is authoritative.** Work that crosses two batches must be sub-batched (e.g., a billing-packet change that also writes a journey event is Batch 17 for the billing part + Batch 12 for the event-writer migration — two stacked PRs, not one).

---

## 1. The canonical lifecycle (12 stages)

```
[1]  Engagement Center assignment
       │
       ▼
[2]  Scheduler call list row exists
       │
       ▼
[3]  Patient scheduled for visit
       │
       ▼
[4]  Visit appears on schedule/global calendar
       │
       ▼
[5]  Test completed (in-clinic)
       │
       ▼
[6]  Report uploaded
       │
       ▼
[7]  Notes / patient packet generated
       │
       ▼
[8]  Billing packet created
       │
       ▼
[9]  Billing submitted (claim filed)
       │
       ▼
[10] Remittance / payment received
       │
       ▼
[11] Invoice generated (facility-billable scenarios)
       │
       ▼
[12] Missing items create tasks  ← branches BACK into [2]/[6]/[7]/[8] as needed
```

Each stage is enumerated below with: trigger surface, write targets, journey event, derived team task (if any), and the **owning batch**.

---

## 2. Stage [1] — Engagement Center assignment

- **Trigger surface:** `POST /api/engagement/assignment-board/assign` *(engagementAssignmentBoard.ts:431)*. Also `POST /api/engagement-center/assign` *(executionCases.ts:152)* for algorithmic assignment.
- **Write targets:**
  - `patient_execution_cases.assignedTeamMemberId`, `assignedRole`, `engagementStatus`.
  - `patient_journey_events` event `engagement_assignment_changed`.
  - **Optionally (flag ON — PR #76):** `scheduler_assignments` row in `pending` for the patient's `scheduleDate`.
- **Execution-case state:** Engagement-status may transition `new|ready|assigned|not_reached → assigned`. Lifecycle stays `active`.
- **Derived team task:** None at this stage in current model. Future Batch 11 surfaces an `engagement_followup` kind for the assignee.
- **Owning batches:** **10** (execution-case spine — assignment is a state write) + **12** (journey event) + **11c (already shipped via PR #76)** for the optional bridge to call-list.
- **Parity contract:** See `engagement-center-route-parity-inventory.md` §2.

## 3. Stage [2] — Scheduler call list row exists

- **Trigger surface:** `POST /api/scheduler-assignments/rebuild` *(schedulerAssignments.ts:55)* OR PR #76's bridge writing one row at engagement-assign time.
- **Write targets:** `scheduler_assignments` row in `pending` keyed by `(scheduler_id, patient_screening_id, as_of_date)`. The partial unique index `uq_scheduler_assignments_active_per_patient_day` enforces one active row per `(patient, date)`.
- **Read surface:** `GET /api/portal/outreach-call-list` *(portal.ts:286)*. The Scheduler Portal call list.
- **Execution-case state:** Unchanged by row creation itself; later mutated by call-result.
- **Derived team task:** Each `scheduler_assignments` row IS the operational queue item of `kind: "call_list_item"` (Batch 11a model).
- **Owning batches:** **11** (operational queue spine; call-list lives under unified-queue read-model in 11d) + **18** (morning rebuild + absence-watcher will run as background jobs in 18a-c).
- **Parity contract:** See `portals-route-parity-inventory.md` §1.3 + §2.2.

## 4. Stage [3] — Patient scheduled for visit

- **Trigger surface:** `POST /api/engagement-center/call-result` *(executionCases.ts:174)* (when `callResult` corresponds to a scheduling action) OR direct visit-schedule mutation in Scheduler Portal.
- **Write targets:**
  - `patient_screenings.scheduleDate`, `appointmentStatus` ('scheduled'|'confirmed').
  - `patient_execution_cases.engagementStatus = 'scheduled'`; `lifecycleStage` advances to `scheduled`.
  - `patient_journey_events` event `patient_scheduled`.
  - Optional `scheduling_triage_cases` row (when intermediate triage is required).
- **Execution-case state:** `lifecycleStage: new → scheduled`. State-machine in `execution-case-state-machine.md`.
- **Derived team task:** None directly. Tech-task materialization happens at stage [4] via `POST /api/portal/ensure-tech-tasks`.
- **Owning batches:** **10** (execution-case spine — lifecycle transition) + **12** (journey event).

## 5. Stage [4] — Visit appears on schedule / global calendar

- **Trigger surface:** Read-only join across `patient_screenings`, `ancillary_appointments`, `patient_execution_cases`. Tech-task materialization via `POST /api/portal/ensure-tech-tasks` *(portal.ts:444)*.
- **Write targets:**
  - `plexus_tasks` rows of kind `test_completion` per `(patient, testType)`.
  - No journey event at materialization (intentional; events fire on test-result, not on task-creation).
- **Read surface:**
  - `GET /api/portal/today-schedule` *(portal.ts:131)*.
  - Global-calendar source map (`global-calendar-source-map.md`).
  - Visit-schedule source map (`visit-schedule-source-map.md`).
- **Owning batches:** **11** (operational queue — `kind: "scheduler_task"` for the tech tasks) + **11a** source maps already document the joins.

## 6. Stage [5] — Test completed

- **Trigger surface:** Test-completion handler in clinician/tech portal (mutation site varies by test type; consolidated under Batch 11 task close-out in the unified model).
- **Write targets:**
  - `patient_execution_cases.lifecycleStage = 'testing_completed'`.
  - `plexus_tasks.status = 'completed'` for the corresponding `test_completion` task.
  - `patient_journey_events` event `test_completed`.
- **Execution-case state:** `scheduled → testing_completed`.
- **Derived team task:** Opens a `report_upload` task assigned to the test-result role.
- **Owning batches:** **10** + **11** + **12**. **No mutation of canonical reasoning** at this stage (protected).

## 7. Stage [6] — Report uploaded

- **Trigger surface:** `POST /api/portal/uploads` *(portal.ts:584)* with documentKind = report. May also be uploaded via the clinician portal.
- **Write targets:**
  - `documents` row of kind `report_<testType>`.
  - `patient_execution_cases.lifecycleStage = 'report_pending' → 'report_completed'` (two-step when external review is required).
  - `patient_journey_events` event `report_uploaded`.
  - `plexus_tasks` closes the `report_upload` task; may open a `report_review` task.
- **Owning batches:** **16** (documents/reports storage abstraction) + **10** + **11** + **12**.
- **Parity contract:** See `portals-route-parity-inventory.md` §1.7 — upload semantics + storage abstraction MUST stay byte-stable.

## 8. Stage [7] — Notes / patient packet generated

- **Trigger surface:** Read-only via `GET /api/patient-packet` *(patientPacket.ts:40)* and aliases. PDF generation flows consume the same packet.
- **Write targets:**
  - `patient_journey_events` event `packet_generated` (fires from the PDF-render call sites, not from the read endpoint itself).
  - PDF blob stored via documents-storage abstraction (when persisted).
- **Read shape:** The canonical patient-packet response — see `portals-route-parity-inventory.md` §3 stop conditions.
- **Owning batches:** **16** (documents) + **12** (event).
- **Critical:** Six UI consumers depend on the packet response shape staying byte-stable. Wrapper deferred until `shared/contracts/patientPacket.ts` ships under Batch 2.

## 9. Stage [8] — Billing packet created

- **Trigger surface:** Billing-packet creation handler — consolidated under Batch 17 design. Today's surface is documented in `billing-cleanup-design.md`.
- **Write targets:**
  - `billing_packets` row (and any line-items).
  - `patient_execution_cases.lifecycleStage = 'billing_ready'`.
  - `patient_journey_events` event `billing_packet_created`.
  - `plexus_tasks` may close a `report_review` task and open a `billing_review` task.
- **Owning batches:** **17** (billing/invoice architecture is the owning batch — financial calc + claim generation is on the protected list and stays untouched by any other batch) + **10** + **11** + **12**.

## 10. Stage [9] — Billing submitted (claim filed)

- **Trigger surface:** Claim-submit handler (Batch 17). Money math is on the do-not-touch list; this stage's wrapper PRs preserve byte-stable calc.
- **Write targets:**
  - `claims` row (or equivalent submission record).
  - `patient_execution_cases.lifecycleStage = 'claim_submitted'`.
  - `patient_journey_events` event `claim_submitted`.
  - `plexus_tasks` may open a `claim_follow_up` task on a delay (Batch 11 + 18: scheduled follow-up via background job).
- **Owning batches:** **17** + **10** + **11** + **12** + **18** (follow-up scheduling).

## 11. Stage [10] — Remittance / payment received

- **Trigger surface:** Remittance ingest handler (Batch 17). PHI-safe logging applies — no raw remittance payload bodies in logs.
- **Write targets:**
  - `remittances` row.
  - `patient_execution_cases.lifecycleStage = 'paid'` OR back to `exception` if denial.
  - `patient_journey_events` event `remittance_received`.
  - Denial paths open a `denial_follow_up` plexus task.
- **Owning batches:** **17** + **10** + **11** + **12**.
- **Stop condition:** Money math (calc engine) stays untouched — see `do-not-touch.md`.

## 12. Stage [11] — Invoice generated

- **Trigger surface:** Invoice-generation handler (Batch 17). Triggers only on facility-billable scenarios.
- **Write targets:**
  - `invoices` row.
  - `patient_execution_cases.lifecycleStage = 'invoiced'`.
  - `patient_journey_events` event `invoice_generated`.
  - `plexus_tasks` may open an `invoice_follow_up` task on a delay.
- **Owning batches:** **17** + **10** + **11** + **12** + **18**.

## 13. Stage [12] — Missing items create tasks

This is the **branch-back loop**, not a terminal stage. A missing item at any stage opens a `missing_item` plexus task, fires a `missing_item_created` journey event, and re-enters the lifecycle at the appropriate upstream stage.

- **Trigger surface:** Detection happens in multiple places — `POST /api/portal/ensure-tech-tasks` (pre-visit), report-upload validation, billing-packet validation, claim-submit validation, remittance-reconciliation.
- **Write targets:**
  - `plexus_tasks` row of `kind: 'missing_item'` (subKind identifies which artifact: consent, demographics, insurance, report, signature, etc.).
  - `patient_journey_events` event `missing_item_created`.
  - On resolution: `patient_journey_events` event `missing_item_resolved`.
- **Re-entry points** (which upstream stage the loop returns to):
  - Missing consent → stage [4] (visit-schedule context).
  - Missing report → stage [6] (report-upload).
  - Missing report-review signoff → stage [7].
  - Missing billing artifact → stage [8].
  - Denial → stage [9] (claim resubmission) OR stage [11] (invoice if facility-billable).
- **Owning batches:** **11** (the unified team-task spine is where every missing-item task lives) + **12** (the missing-item event pair).

---

## 14. Stage-to-batch crosswalk

| Stage | Owning batch(es) | Doc(s) |
| --- | --- | --- |
| [1] Engagement Center assignment | 10 + 12 + 11c (PR #76) | `engagement-center-route-parity-inventory.md` §2 |
| [2] Scheduler call list row | 11 + 18 | `portals-route-parity-inventory.md` §§1.3, 2.2 |
| [3] Patient scheduled | 10 + 12 | `execution-case-state-machine.md` |
| [4] Visit on schedule/calendar | 11 + 11a | `visit-schedule-source-map.md`, `global-calendar-source-map.md` |
| [5] Test completed | 10 + 11 + 12 | `execution-case-state-machine.md`, `team-task-spine-design.md` |
| [6] Report uploaded | 16 + 10 + 11 + 12 | `portals-route-parity-inventory.md` §1.7 |
| [7] Patient packet generated | 16 + 12 | `portals-route-parity-inventory.md` §3, `pdf-protection-contract.md` |
| [8] Billing packet created | 17 + 10 + 11 + 12 | `billing-cleanup-design.md` |
| [9] Billing submitted | 17 + 10 + 11 + 12 + 18 | `billing-cleanup-design.md`, `background-jobs-design.md` |
| [10] Remittance / payment | 17 + 10 + 11 + 12 | `billing-cleanup-design.md` |
| [11] Invoice generated | 17 + 10 + 11 + 12 + 18 | `billing-cleanup-design.md` |
| [12] Missing items create tasks | 11 + 12 | `team-task-spine-design.md`, `journey-event-standardization-design.md` |

---

## 15. Operational-queue cutover order (informational)

The Operational Queue read-model unifies stages [2]/[4]/[5]/[6]'s task surfaces under a single `getOperationalQueueForUser(userId, { kinds: [...] })` API. Cutover order is:

1. **11d:** Scheduler Portal call list cutover (`kind: "call_list_item"`) — Stage [2] read surface.
2. **11e:** Team Portal `my-tasks` cutover (`kind: "scheduler_task"`) — Stage [4]/[5]/[6] task reads.
3. **11f:** Global Calendar cutover — Stage [4] visit reads.
4. **11g:** Visit Schedule cutover — Stage [4]/[5] joins.

Each cutover is its own PR, gated behind a `USE_OPERATIONAL_QUEUE_<surface>` feature flag (default OFF), and parity-tested against the legacy SQL before flag-flip.

---

## 16. Journey-event writer migration (Batch 12)

Every stage writes one or more events into `patient_journey_events`. Today, each event-writing call site builds its event payload inline. Batch 12b ships a typed `appendJourneyEvent(input)` writer that:

- Validates `eventType` against the discriminated union in `shared/contracts/journeyEvents.ts`.
- Validates `eventSource` against the enum.
- Stamps `actorUserId`, `actorRole`, `occurredAt` consistently.
- Is the single migration target for every event-write site listed in stages [1]–[12].

Migration order:
1. Lowest-risk: `engagement_assignment_changed`, `engagement_assignment_cancelled`, `call_result_logged`.
2. Medium: `patient_scheduled`, `test_completed`, `report_uploaded`, `packet_generated`.
3. Highest: `billing_packet_created`, `claim_submitted`, `remittance_received`, `invoice_generated`, `missing_item_created`, `missing_item_resolved`.

Each migration is one PR. None bundle.

---

## 17. Stop conditions (program-wide)

A future architecture PR MUST stop and ask if any of the following are true:

1. A new stage is introduced that does not fit in the 12 above.
2. A stage's owning batch shifts to a batch not in {10, 11, 12, 16, 17, 18, 21}.
3. A single PR touches more than one stage's mutation surface without sub-batching.
4. Money math, AI batch runner, MRN stamping, canonical reasoning writes, PDF rendering, scheduler assignment persistence, claim/remittance/denial/invoice calc, or supporting-button assignment logic is altered.
5. The operational-queue cutover order is reordered.
6. Any journey-event `eventType` literal is renamed without a coordinated UI + downstream migration.
7. The 12-stage diagram is restructured (e.g., billing inserted before report-upload).

---

## 18. Out of scope

- **Provider portal**, **clinician notes**, **external referral**: read-adjacent flows; will be folded in under a future Batch 23 if introduced.
- **Patient-side notifications**: SMS/email outbound is on the do-not-touch list (PHI risk). Out of scope for this map.
- **Audit / compliance reporting reads**: Documented separately in `qa-matrix.md`.

End of map.

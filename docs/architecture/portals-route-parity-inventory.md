# Portals route parity inventory

**Date:** 2026-06-09
**Scope:** READ-ONLY inventory. Covers Team Portal, Scheduler Portal, technician-liaison/ultrasound-tech, scheduler assignments, and the canonical patient-packet endpoint.
**Purpose:** Lock down byte-identical parity expectations for every portal-adjacent route before any future wrapper or wiring batch.

> Cross-reference: `docs/architecture/backend-route-parity-inventory.md` §§5–7, `docs/architecture/protected-flows.md` §§6–8, `docs/architecture/operational-queue-design.md`, `docs/architecture/canonical-workflow-wiring-map.md`.

---

## 0. How this document is used

Three portal areas covered:
1. **Team Portal** — `server/routes/portal.ts`, 10 routes under `requirePortalRole`.
2. **Scheduler-assignment runtime** — `server/routes/schedulerAssignments.ts`, 5 routes (morning rebuild + redistribute live here).
3. **Patient packet** — `server/routes/patientPacket.ts`, 3 aliased routes that power every team-portal patient detail view + every PDF caller's data source.

Every future portal-touching PR must cite the relevant § here AND verify `requirePortalRole` middleware + `allowedFacilities(req)` allow-list semantics remain in place.

---

## 1. Team Portal — `server/routes/portal.ts`

### 1.1 `GET /api/portal/today-schedule` *(portal.ts:131)*
- **Auth:** `requirePortalRole`.
- **Inputs (query):** `facility`, `date` (YYYY-MM-DD; defaults to today).
- **Response shape:** `{ patients: PatientRow[] }` where `PatientRow` is grouped by patient (per `portal.ts:147–168`).
- **DB deps:** `ancillary_appointments`, `patient_screenings`, `documents` (consent surfaces), `screening_batches`.
- **Side effects:** none (read).
- **Protected flows at risk:** Today's clinic schedule UI.
- **Parity contract:** `consentByTest[]` ordering preserved; `appointmentStatus` mirrors `patient_screenings.appointmentStatus` (NOT `ancillary_appointments.status`); `requirePortalRole` + facility allow-list semantics preserved.
- **Future service boundary:** `server/modules/team-portal/todaySchedule(...)`.
- **Risk level:** **medium**.

### 1.2 `GET /api/portal/month-summary` *(portal.ts:247)*
- **Inputs:** facility, month range.
- **Response shape:** per-day aggregate counts.
- **Risk level:** **low**.

### 1.3 `GET /api/portal/outreach-call-list` *(portal.ts:286)*
- **Auth:** `requirePortalRole`.
- **Inputs (query):** `facility`, `date`.
- **Response shape:** the canonical Scheduler-Portal call list (one row per `scheduler_assignments` joined to `patient_screenings` + `outreach_schedulers` + latest `outreach_calls`).
- **DB deps:** `scheduler_assignments`, `patient_screenings`, `outreach_schedulers`, `outreach_calls`, `patient_execution_cases` (for status).
- **Protected flows at risk:** Scheduler Portal call list. **The bridge writes from `POST /api/engagement/assignment-board/assign` land here when `ENGAGEMENT_TO_CALL_LIST_BRIDGE` is ON (PR #76).**
- **Parity contract for future wrapper:**
  - Sort key preserved (priority-score-derived).
  - One row per `(patient, asOfDate)` — the partial unique index enforces this.
  - Joined demographics shape preserved.
- **Future service boundary:** `server/modules/scheduler-portal/callList(...)`. Reads `getOperationalQueueForUser(userId, { kinds: ["call_list_item"] })` in the future cutover (Batch 11d).
- **Risk level:** **medium-high** (consumed by every scheduler).
- **Stop conditions:** Any change that produces N > 1 active rows per `(patient, asOfDate)`; any change that hides the bridge-created rows; any change to default sort.

### 1.4 `POST /api/portal/ensure-tech-tasks` *(portal.ts:444)*
- **Inputs (body):** facility, scheduleDate, optional patient/test subset.
- **Side effects:** Materialize per-test technician tasks in `plexus_tasks`.
- **Risk level:** **medium**.

### 1.5 `GET /api/portal/my-tasks` *(portal.ts:524)*
- **Response shape:** Tasks for the authenticated user from `plexus_tasks` (with engagement-board-derived task hints layered in by client).
- **Risk level:** low-medium.
- **Future:** Reads `getOperationalQueueForUser(userId, { kinds: ["scheduler_task"] })` after Batch 11e cutover.

### 1.6 `GET /api/portal/consent-templates` *(portal.ts:561)*
- **Response shape:** Per-test consent templates + signature requirement.
- **Risk level:** **low**.

### 1.7 `POST /api/portal/uploads` *(portal.ts:584)*
- **Auth:** `requirePortalRole`, `upload.single("file")`.
- **Side effects:** Stores patient document via `server/services/blobStore.ts` → `documents` row.
- **Protected flows at risk:** Patient document upload from Team Portal.
- **Risk level:** **medium-high** — file upload semantics + storage abstraction.
- **Stop conditions:** Any change to `upload.single("file")` shape; any change to the blob-store-vs-Drive provider switch.

### 1.8 `POST /api/portal/sign-consent` *(portal.ts:644)*
- **Inputs (body):** patient, testType, signature data.
- **Side effects:** Writes a `documents` row of kind `consent_<testType>`.
- **Risk level:** **medium-high** (consent capture; signature is PHI).

### 1.9 `GET /api/portal/patient-documents/:id` *(portal.ts:758)*
- **Response shape:** Documents tied to `patient_screening_id = :id`.
- **Risk level:** **low-medium**.

### 1.10 `GET /api/portal/my-facilities` *(portal.ts:785)*
- **Response shape:** Facilities accessible to the authenticated user (via `allowedFacilities(req)`).
- **Risk level:** **low**.

---

## 2. Scheduler-assignments — `server/routes/schedulerAssignments.ts`

### 2.1 `GET /api/scheduler-assignments` *(schedulerAssignments.ts:26)*
- **Inputs (query):** scheduler id, status, date range.
- **Response shape:** raw `scheduler_assignments` rows.
- **Risk level:** **low**.

### 2.2 `POST /api/scheduler-assignments/rebuild` *(schedulerAssignments.ts:55)*
- **Purpose:** Force-rebuild for a facility/date. Pulls all eligible patients + runs priority ranking + writes assignments.
- **Side effects:** Advisory-locked via `server/lib/advisoryLock.ts`. Touches `scheduler_assignments` transactionally in `schedulerAssignments.repo.ts`.
- **Protected flows at risk:** Morning rebuild semantics; auto-redistribute; the canonical call list anchor.
- **Parity contract:** Advisory-lock semantics preserved; transactional bulk release + create preserved.
- **Risk level:** **high** — this is the canonical morning-rebuild trigger.
- **Stop conditions:** Any change that removes the advisory lock; any change that splits the transaction.

### 2.3 `POST /api/scheduler-assignments/redistribute` *(schedulerAssignments.ts:89)*
- **Purpose:** Redistribute due to absence/handoff.
- **Risk level:** **medium-high** (mid-day distribution; absence-watcher consumes this).

### 2.4 `POST /api/scheduler-assignments/approve-absence` *(schedulerAssignments.ts:112)*
- **Risk level:** **medium**.

### 2.5 `GET /api/scheduler-assignments/dashboard` *(schedulerAssignments.ts:143)*
- **Response shape:** Aggregate dashboard counts.
- **Risk level:** **low-medium**.

---

## 3. Patient packet — `server/routes/patientPacket.ts`

### 3.1 `GET /api/patient-packet` *(patientPacket.ts:40)*
### 3.2 `GET /api/scheduler-portal/patient-packet` *(patientPacket.ts:44)*
### 3.3 `GET /api/technician-liaison/patient-packet` *(patientPacket.ts:48)*

Three aliases for the same handler.

- **Purpose:** Resolve a patient by `executionCaseId`, `patientScreeningId`, or `(patientName, patientDob)`. Returns the full patient packet from `getPatientPacket(lookup)` in `server/repositories/patientPacket.repo.ts`.
- **Method:** GET.
- **Inputs (query):** one of `executionCaseId`, `patientScreeningId`, OR `patientName` (+ optional `patientDob`).
- **Response shape:** Whatever `getPatientPacket(lookup)` returns. **This is the canonical data source for every team-portal view + every PDF caller.**
- **Status codes:** 200; 400 (no lookup provided — message: `"One of executionCaseId, patientScreeningId, or patientName (DOB optional) is required"`); 500.
- **Protected flows at risk:** **ALL Team Portal flows; Clinician PDF; Plexus PDF; Engagement Center bulk PDF; Outreach PDF; selected patient PDF actions.** Any change to the response shape ripples through 6+ UI consumers.
- **Parity contract for future wrapper:**
  - Every field returned by `getPatientPacket` preserved.
  - All three aliases stay identical.
  - Lookup precedence order: `executionCaseId → patientScreeningId → patientName`.
  - 400 envelope message preserved verbatim.
- **Future service boundary:** Already thin over `repositories/patientPacket.repo.ts`. The future move is into `shared/contracts/patientPacket.ts` (a future Batch 2 addition).
- **Risk level:** **high** (single point of failure for many UI views; PDF data source).
- **Stop conditions:** Any change to the response shape; any change to the lookup precedence; any change to the 400 envelope.

---

## 4. Compact risk + sequence table

| Route | Risk | Sequence position |
| --- | --- | --- |
| `GET /portal/consent-templates` | low | first (warm-up) |
| `GET /portal/my-facilities` | low | early |
| `GET /portal/month-summary` | low | early |
| `GET /portal/patient-documents/:id` | low-medium | second |
| `GET /scheduler-assignments` | low | second |
| `GET /scheduler-assignments/dashboard` | low-medium | second |
| `GET /portal/today-schedule` | medium | third |
| `GET /portal/my-tasks` | low-medium | wait for Batch 11e |
| `GET /portal/outreach-call-list` | medium-high | wait for Batch 11d |
| `POST /portal/ensure-tech-tasks` | medium | fourth |
| `POST /portal/uploads` | medium-high | fifth — sub-batch sub-step (file shape preserved first) |
| `POST /portal/sign-consent` | medium-high | sixth — PHI handling preserved first |
| `POST /scheduler-assignments/redistribute` | medium-high | last |
| `POST /scheduler-assignments/approve-absence` | medium | before redistribute |
| `POST /scheduler-assignments/rebuild` | **high** | wrapper deferred until Batch 18 outbox lands |
| `GET /patient-packet` *(× 3 aliases)* | **high** | wrapper deferred until shared/contracts/patientPacket.ts ships |

---

## 5. Cross-batch mapping

| Batch | Owns |
| --- | --- |
| **Batch 10** (Execution Case spine) | Consumed by `today-schedule`, `outreach-call-list`, packet endpoints. |
| **Batch 11** (Team Task spine) | The unified task surface that `my-tasks` migrates to. |
| **Batch 11d** (operational-queue UI cutover for Scheduler Portal) | Switches `outreach-call-list` to read `getOperationalQueueForUser(userId, { kinds: ["call_list_item"] })`. |
| **Batch 11e** (Team Portal cutover) | Switches `my-tasks` to `getOperationalQueueForUser(userId, { kinds: ["scheduler_task"] })`. |
| **Batch 16** (Documents / reports storage) | Owns the consent-document + uploaded-document storage abstraction; `portal/uploads` + `portal/sign-consent` are direct consumers. |
| **Batch 18** (Background jobs) | Morning rebuild + absence-watcher migrate; `POST /scheduler-assignments/rebuild` is the trigger surface. |

---

## 6. Program-wide stop conditions

A future portal-touching PR MUST stop and ask if:

1. `requirePortalRole` middleware is removed from any of the 10 portal routes.
2. `allowedFacilities(req)` allow-list semantics change (e.g., a portal user can suddenly see facilities outside their session allow-list).
3. The patient packet endpoint changes shape in ANY way — six callers depend on byte-stable fields.
4. The patient packet lookup precedence (`executionCaseId → patientScreeningId → name+dob`) is altered.
5. Advisory-lock semantics are removed from `POST /scheduler-assignments/rebuild`.
6. The partial unique index `uq_scheduler_assignments_active_per_patient_day` is dropped.
7. `upload.single("file")` becomes `upload.array(...)` without a sub-batched migration plan.
8. Consent-document signature handling is changed without explicit clinical sign-off (PHI risk).

End of inventory.

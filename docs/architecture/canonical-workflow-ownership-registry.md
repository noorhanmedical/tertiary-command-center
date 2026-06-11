# Canonical workflow ownership registry

**Status:** Docs-only (Batch 2 of platform split-brain run).
**Date:** 2026-06-10.
**Purpose:** Name the target canonical owner for every workflow on the platform. The audit in Batch 1 identified where ownership is ambiguous today; this registry pins the target so future PRs have a single answer to "who owns this?"

This registry is the source of truth for ownership decisions. If a future PR introduces a writer that does not match this registry, the split-brain source scanner (Batch 3) will flag it.

---

## Ownership entries

### Engagement Center
- **Owns:** the patient engagement workflow end-to-end — call list generation, outreach/call attempts, call results, next action computation, follow-up task creation, triage case creation, assignment completion, Team Portal work feed.
- **Canonical writers:** `recordCallResult` planner + execution adapter (Batch H Steps 1 + 5A) once delegation lands.
- **Canonical read model:** `patient_execution_cases` + the engagement-center cases endpoint.
- **Not allowed:** any other module writing call-result side effects.

### Team Portal
- **Owns:** consumption of assigned work; rendering of call list; disposition UX.
- **Does NOT own:** call list generation, assignment, capacity math, terminal-completion logic.
- **Canonical writes:** none directly. All call-result writes go through the canonical Engagement Center service (future state).
- **Canonical reads:** `/api/portal/outreach-call-list`, `/api/portal/calls` (Batch I).

### Patient Directory
- **Owns:** canonical patient identity (name, DOB, MRN, facility).
- **Canonical read model:** Patient Directory aggregate (Bundle 5 / Bundle 49).
- **Canonical writer:** Patient Directory façade (future). Today, `storage.updatePatientScreening` is the writer, called by many surfaces.
- **Not allowed:** new direct writers to `patient_screenings` identity fields (name, DOB, MRN). Status fields (appointmentStatus, commitStatus) remain on the screening row for now.

### Execution Case (patient engagement lifecycle)
- **Owns:** patient engagement lifecycle state — `engagementStatus`, `lifecycleStatus`, `assignedTeamMemberId` (legacy `assignedSchedulerId`), `nextActionAt`.
- **Canonical writer:** Execution Case service (future). Today, six files write `patientExecutionCases` directly; consolidation is sequenced.
- **Canonical read model:** `executionCase.repo.ts`.
- **Not allowed:** Plexus IQ writes to `patient_execution_cases`.

### Journey Events
- **Owns:** patient audit timeline.
- **Canonical writer:** `appendJourneyEvent` (Bundle 12c).
- **Canonical read model:** `listJourneyEvents` repo.
- **Not allowed:** any direct `db.insert(patient_journey_events)` outside `appendJourneyEvent`.

### Team Tasks
- **Owns:** actionable user work (task title, due, assignee, status).
- **Canonical writer:** `storage.createTask` / Team Tasks routes.
- **Canonical read model:** `/api/plexus-tasks`, `/api/team-tasks` family.
- **Not allowed:** new task-row writers outside `storage.createTask`.

### Operational Queue
- **Owns:** read-only operational projection over execution-case + scheduler-assignment state.
- **Canonical writer:** NONE (read-only — invariant pinned by `qa-operational-queue-readonly-invariant.mjs`).
- **Canonical read model:** `/api/operational-queue/*`.
- **Not allowed:** any write from operational-queue routes.

### Admin Review
- **Owns:** approval review flow (approve / commit / reject decisions).
- **Canonical writer:** `routes/admin.ts` for approval/commit state.
- **Canonical read model:** Admin Review endpoints.
- **Not allowed:** Plexus IQ writing approval/commit state. Plexus IQ MAY write `reasoning` (intelligence layer feeds Admin Review without owning the decision).
- **Hard-stop:** approval / commit behavior change in this run.

### Qualification Engine
- **Owns:** qualification logic (rule application, decision derivation).
- **Canonical writer:** Qualification Engine module (future — Bundle 31 design).
- **Canonical read model:** qualification status fields on `patient_screenings`.
- **Not allowed:** parallel qualification deciders outside the Qualification Engine.
- **Hard-stop:** final qualification decision behavior change in this run.

### Billing Readiness
- **Owns:** billing readiness state (when a patient is ready for billing).
- **Canonical writer:** `routes/billingReadiness.ts`.
- **Canonical read model:** billing readiness endpoints.
- **Not allowed:** parallel readiness deciders.
- **Hard-stop:** behavior change in this run.

### Billing (claims / remittance / money)
- **Owns:** all money math — invoices, claims, remittance, totals, revenue share.
- **Canonical writer:** `routes/billing.ts` + `services/billing/*`.
- **Canonical read model:** billing endpoints.
- **Not allowed:** ANY other module touching money fields.
- **Hard-stop:** ZERO behavior change in this run. ZERO money-field reads/writes elsewhere.

### Plexus IQ
- **Owns:** intelligence / aggregation / read-model surface. Reasoning regeneration for Admin Review (writes `patient_screenings.reasoning` only). ICD suggestion (suggestion only — commit lives in Admin Review).
- **Does NOT own:** operational workflow state — engagement, call-list, tasks, triage, journey events, scheduler assignments, execution-case lifecycle.
- **Canonical writes from Plexus IQ:** `storage.updatePatientScreening` for `reasoning` field ONLY.
- **Canonical reads:** all operational tables.
- **Not allowed:** Plexus IQ writes to `patient_execution_cases`, `outreach_calls`, `scheduler_assignments`, `plexus_tasks`, `patient_journey_events`, `scheduling_triage_cases`. (Verified empty at audit time; future scanner pins this.)
- **Hard-stop:** NO Plexus IQ runtime behavior change in any batch of this run.

### Clinical Evidence Store
- **Owns:** normalized clinical evidence storage (dormant per Bundle 38 contract).
- **Canonical writer:** Clinical Evidence Store module (future).
- **Canonical read model:** TBD.

### EMR adapters
- **Owns:** EMR import / sync only.
- **Does NOT own:** business decisions (qualification, billing, approval).
- **Canonical writer:** EMR adapter module (future — Bundle 39 design).
- **Canonical read model:** sync state.
- **Not allowed:** EMR adapter making business decisions or writing operational workflow state.

---

## Cross-cutting invariants

- **One canonical writer per canonical table.**
  - `outreach_calls` ← `storage.createOutreachCallAtomic` only.
  - `patient_journey_events` ← `appendJourneyEvent` only.
  - `scheduler_assignments` ← scheduler-assignment service + `storage.markSchedulerAssignmentCompleted` only.
  - `patient_execution_cases` ← Execution Case service (future) — TODAY this is split across six files; consolidation is sequenced and tracked separately.
  - `plexus_tasks` ← `storage.createTask` and Team Tasks routes only.
  - `scheduling_triage_cases` ← `upsertOpenSchedulingTriageCase` only.

- **One canonical read model per surface.**
  - Engagement Center → `patient_execution_cases` via `listEngagementCenterCases`.
  - Team Portal call list → `/api/portal/outreach-call-list`.
  - Operational Queue → derived from execution case + assignment.

- **No UI surface acts as its own backend brain.** Disposition logic, capacity partitioning, queue buckets, terminal-completion logic all live server-side.

- **No parallel brains.** Adding a "matching" second writer is forbidden — funnel to the canonical writer or extend it.

- **No shadow systems.** No background process that mutates canonical state without going through the canonical writer.

## Plexus IQ rule (repeated for emphasis)

Plexus IQ is the **intelligence / read-model / aggregation layer**, not an operational owner. If a future PR needs Plexus IQ to write an operational workflow table, the run STOPS and the proposed architecture is reported to Ali before any wiring change.

End of registry.

# Engagement / Outreach ownership audit

**Status:** Docs-only (Batch 4 of platform split-brain run).
**Date:** 2026-06-10.
**Companion:** `scripts/qa-engagement-outreach-ownership-audit.mjs`.

## 1. What is Engagement Center today?

Engagement Center is a server-side workflow plus a client-side board. It owns:

- The engagement-case row (`patient_execution_cases`) — `engagementStatus`, `lifecycleStatus`, `nextActionAt`, `assignedTeamMemberId` / `assignedRole`, optional `qualificationStatus`.
- The engagement-center API surface: `GET /api/engagement-center/cases`, `POST /api/engagement-center/assign`, `POST /api/engagement-center/call-result` (server/routes/executionCases.ts).
- The engagement assignment board (`server/routes/engagementAssignmentBoard.ts`) — the "who works what" view.
- The triage case spawn for non-terminal results, the plexus-task spawn for follow-up results, and the journey-event append on every result.

Engagement Center is the only surface that maintains the engagement-case lifecycle. It treats every call attempt + result as a state transition on the engagement case.

## 2. What is Outreach today?

Outreach is a parallel call-attempt log surface plus a per-day call-list dashboard. It owns:

- The outreach call log (`outreach_calls`) via `storage.createOutreachCallAtomic`, which atomically inserts the call row and updates `patient_screenings.appointmentStatus`.
- A standalone outreach dashboard (`GET /api/outreach/dashboard`) that bucketizes the day's work for the per-day "scheduler" assignment view.
- A `/api/outreach/calls` POST that — separately from the engagement-center call-result handler — accepts a call disposition, writes the call log, derives `appointmentStatus`, and conditionally marks the scheduler-assignment as completed on terminal outcomes.
- `outreach_schedulers` (the team-member roster + capacity percentages used by the outreach dashboard's partitioning).

Outreach today behaves as if it were a standalone product brain:
- It owns its own terminal-outcome set (`scheduled / completed / declined / dnc / do_not_contact / deceased / cancelled`).
- It owns its own role label (the literal "scheduler" in roles, route paths, and UI).
- It does NOT append a `patient_journey_events` row on a call result — only Engagement Center does that.
- It does NOT touch `patient_execution_cases` — so the engagement-case's `engagementStatus` and `nextActionAt` drift from the actual call activity if the call came through `/api/outreach/calls`.

## 3. Why Outreach should be a sub-workflow inside Engagement Center

- A single patient has ONE engagement workflow. Splitting it across "outreach" (call attempts) and "engagement" (results / triage / next action) is a product-level fiction that creates real data drift on the engagement case.
- Two terminal-set definitions, two ownership labels, two UI dashboards, two endpoints. Operators waste time reconciling.
- The canonical `recordCallResult` planner (Batch H Step 1) is the unified side-effect contract. Both routes already have flag-gated preview parity (Batch H Steps 2 + 3).
- Engagement Center's `engagementStatus` is the patient-engagement source of truth. Outreach must FEED it, not duplicate it.

The target: outreach is a sub-workflow inside Engagement Center, with `/api/outreach/calls` as a compatibility adapter for legacy callers.

## 4. Which two routes currently log call results

| # | Route | Handler file | Atomic table writes | Other side effects |
|---|---|---|---|---|
| 1 | `POST /api/outreach/calls` | `server/routes/outreach.ts:151` | `outreach_calls` insert + `patient_screenings.appointmentStatus` update (via `storage.createOutreachCallAtomic`) | conditional `scheduler_assignments.status = "completed"` (terminal); fire-and-forget canonical-spine sync. No journey event. No execution-case mutation. No triage. No task. |
| 2 | `POST /api/engagement-center/call-result` | `server/routes/executionCases.ts:174` | `db.update(patientExecutionCases)` — engagementStatus / nextActionAt / assignedTeamMemberId / assignedRole | `appendJourneyEvent` (`call_result_logged`); conditional `upsertOpenSchedulingTriageCase`; conditional `storage.createTask`. No `outreach_calls` insert. No `appointmentStatus` update. |

The two routes carry **non-overlapping** side-effect sets. A call attempt logged via #1 leaves the engagement case unchanged. A call result logged via #2 leaves the outreach call log unchanged. The patient's actual state is split across both.

## 5. Which tables each route mutates

| Table | Outreach route | Engagement-center route |
|---|---|---|
| `outreach_calls` | INSERT (atomic) | — |
| `patient_screenings.appointmentStatus` | UPDATE (atomic) | — |
| `scheduler_assignments` | UPDATE on terminal outcomes | — |
| `patient_journey_events` | — | INSERT via `appendJourneyEvent` |
| `patient_execution_cases` | — | UPDATE (engagementStatus, nextActionAt, assignedTeamMemberId, assignedRole) |
| `scheduling_triage_cases` | — | upsert via `upsertOpenSchedulingTriageCase` |
| `plexus_tasks` | — | INSERT via `storage.createTask` |

No table is touched by both routes. Combined coverage is what the canonical service unifies.

## 6. Which UI surfaces call each route

| UI surface | Calls `/api/outreach/calls` | Calls `/api/engagement-center/call-result` |
|---|---|---|
| Outreach dashboard / scheduler portal page | yes | no |
| Engagement Center board disposition flow | no | yes |
| Team Portal call-list disposition (DispositionSheet) | yes | no |
| Patient Command Canvas / Playground tiles | yes (legacy) | varies (modern paths) |
| CanonicalRowActions in Playground | varies | varies |

Team Portal calling the outreach route — without the engagement case being touched — is the single largest in-the-wild source of state drift.

## 7. Where split-brain exists

- **Two write paths, non-overlapping side effects.** A call logged on either route leaves half the canonical state un-written.
- **Two terminal-set definitions.** Outreach's terminal set differs from Engagement Center's `TERMINAL_ENGAGEMENT_STATUSES_FOR_CALL_RESULT`.
- **Two role vocabularies.** "Scheduler" (outreach) vs "Team Member / PCS / ACS" (engagement). UI and DB still carry "scheduler" everywhere.
- **Two dashboards.** Outreach dashboard vs Engagement Center board.
- **Team Portal disposition path.** DispositionSheet writes through the outreach route, never touching the engagement case.
- **Status field drift.** `appointmentStatus` (screening) vs `engagementStatus` (execution case) — these can disagree silently.

## 8. Target architecture

- ONE canonical write path: `recordCallResult` planner + execution adapter (already built, dormant; Batch H Steps 1 + 5A).
- Each legacy route delegates to the canonical service behind its OWN default-OFF delegation flag (engagement first; outreach later).
- Engagement Center's engagement-case stays the engagement source of truth.
- `outreach_calls` is the canonical call-log row, written by the canonical service via an injected writer.
- `patient_journey_events` is appended on EVERY call result, regardless of which legacy route received the request.
- Team Portal disposition is rebuilt to call the canonical Engagement Center endpoint (out of scope until both delegation flags ship).

## 9. Legacy adapter strategy

- `/api/outreach/calls` and `/api/engagement-center/call-result` remain on the surface area indefinitely.
- Under the delegation flags they become thin adapters: parse body → translate to canonical input → delegate to the service → translate canonical output back to the legacy response shape.
- Response shape is preserved byte-for-byte (Batch 8 + Batch 15 fixtures pin the two response shapes).
- The outreach dashboard and engagement-center board endpoints stay as the read APIs.

## 10. Which changes are safe now

- All docs / contracts / scanners / fixtures — already shipping through this run.
- Adding NEW default-OFF flags (delegation flag accessors).
- Adding NEW dormant service modules and tests.
- Adding NEW source-invariant QA scripts.
- Adding NEW response-shape and side-effect-matrix fixtures.

## 11. Which changes need Ali approval

- Flipping any flag default ON in production.
- Adding the actual `if (flag) delegate(...)` block in either route (Batches 12 and 19 — must inspect-before-coding and STOP if response shape can't be rebuilt safely).
- Renaming `scheduler_assignments`, `outreach_schedulers`, `schedulerId`, etc. (Batch D §6 migration plan).
- Removing legacy endpoints.
- Changing Team Portal disposition UI to call canonical engagement endpoint.
- Removing the standalone outreach dashboard.
- Renaming the legacy `/scheduler-portal` UI page.

## 12. Plexus IQ impact

None expected. Plexus IQ does not own engagement, outreach, journey events, triage, or tasks. Verified by `grep -rn "patientExecutionCases|outreachCalls|schedulerAssignments|plexusTasks|patientJourneyEvents|schedulingTriageCases" server/services/plexusIq/` → zero matches at audit time. The platform split-brain scanner (Batch 3) enforces this as a hard invariant.

End of audit.

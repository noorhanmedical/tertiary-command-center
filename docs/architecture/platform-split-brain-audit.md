# Platform split-brain audit

**Status:** Docs-only (Batch 1 of platform-wide split-brain elimination run).
**Date:** 2026-06-10.
**Scope:** Identify every workflow with duplicate owners, duplicate write paths, duplicate read models, duplicate status fields, or UI surfaces acting as their own backend brain. No runtime change in this batch.

**Core architecture rule** every workflow is measured against:
- one canonical owner
- one canonical write path
- one canonical read model
- clear adapters for legacy routes
- no duplicate side-effect writers
- no hidden shadow systems
- no UI surface acting as its own backend brain

**Hard stops:** no BS patches, no shadow systems, no billing money / qualification final decision / PDF / Admin Review approval behavior change, no migrations, no production flag flips, no Plexus IQ runtime change.
**Stop condition:** if eliminating a split-brain risk requires unsafe runtime change, STOP and document the blocker instead of patching around it.

---

## 1. Engagement Center

- **Canonical owner today:** ambiguous. `server/routes/executionCases.ts` owns `POST /api/engagement-center/call-result`, `GET /api/engagement-center/cases`, `POST /api/engagement-center/assign`. `server/routes/engagementAssignmentBoard.ts` owns the assignment board.
- **Target canonical owner:** Engagement Center service module wrapping execution-case writes + the canonical `recordCallResult` planner/adapter (Batch H Steps 1–5A).
- **Write paths today:**
  - `POST /api/engagement-center/call-result` → appendJourneyEvent, upsertOpenSchedulingTriageCase, storage.createTask, `db.update(patientExecutionCases)`.
  - `POST /api/engagement-center/assign` → engagement-case assignment writes.
- **Read paths today:** `GET /api/engagement-center/cases` (board), `GET /api/execution-cases` (raw), `GET /api/scheduler-portal/cases` (still emits a "scheduler" label).
- **Duplicate state fields:** `engagementStatus` mutated by both the call-result handler and bridge; `assignedTeamMemberId` / legacy `assignedSchedulerId`.
- **Duplicate status concepts:** `appointmentStatus` (screenings) vs `engagementStatus` (execution case) vs scheduler_assignments.status.
- **Duplicate UI surfaces:** Engagement Center board vs legacy day-of "scheduler portal" view (`/scheduler-portal`).
- **Duplicate route ownership:** `engagementAssignmentBoard.ts` and `executionCases.ts` both write engagement-case state.
- **Split-brain risk level:** medium.
- **Runtime fix safe now?** no — preview path exists (Batch H Step 2), delegation is not yet attempted; staging readiness must pass first.
- **Docs/QA guard safe now?** yes — additional contracts + scanners.
- **Ali approval required?** yes for route delegation and for renaming/removing `/scheduler-portal` UI.
- **Plexus IQ involved?** no.

## 2. Outreach / call attempts

- **Canonical owner today:** `server/routes/outreach.ts` (`POST /api/outreach/calls` + dashboard + schedulers).
- **Target canonical owner:** Engagement Center call-result service. Outreach becomes a SUB-WORKFLOW (compatibility adapter route at `/api/outreach/calls`).
- **Write paths today:**
  - `POST /api/outreach/calls` → `storage.createOutreachCallAtomic` (inserts outreach_calls + updates patient_screenings.appointmentStatus), conditional `storage.markSchedulerAssignmentCompleted`, fire-and-forget `ensureCanonicalSpineForScreening`.
- **Read paths today:** `GET /api/outreach/calls`, `GET /api/outreach/dashboard`, `GET /api/portal/calls` (Batch I, flag-gated).
- **Duplicate state fields:** appointmentStatus is also derived in `executionCases.ts` indirectly; outreach_calls.outcome is the source-of-truth log row.
- **Duplicate status concepts:** outreach has its OWN terminal set (`["scheduled", "completed", "declined", "dnc", "do_not_contact", "deceased", "cancelled"]`) distinct from engagement-center's terminal engagement statuses.
- **Duplicate UI surfaces:** outreach dashboard, scheduler portal, Engagement Center, Team Portal — all surface call attempts in different shapes.
- **Duplicate route ownership:** none for outreach_calls inserts — `createOutreachCallAtomic` is the only writer. BUT a second write *path* exists logically via `recordCallResult` planner's `outreachCallCreated` step, which is dormant.
- **Split-brain risk level:** medium-to-high — outreach is conceptually a sub-workflow that today acts as its own product brain (its own dashboard, its own terminal set, its own role string).
- **Runtime fix safe now?** no — preview path exists (Batch H Step 3); delegation is not yet attempted.
- **Docs/QA guard safe now?** yes.
- **Ali approval required?** yes for endpoint consolidation and dashboard merging.
- **Plexus IQ involved?** no.

## 3. Team Portal

- **Canonical owner today:** `server/routes/portal.ts` — serves assigned-work-list views.
- **Target canonical owner:** unchanged — Team Portal is a CONSUMER, not an owner.
- **Write paths today:** zero direct writes to canonical tables. Recent additive route (Batch I) is read-only.
- **Read paths today:** `/api/portal/outreach-call-list`, `/api/portal/my-facilities`, `/api/portal/calls` (Batch I, flag-gated).
- **Duplicate state fields:** none.
- **Duplicate status concepts:** Team Portal interprets `appointmentStatus` to bucket patients into queues — that derivation is duplicated client-side and route-side.
- **Duplicate UI surfaces:** Team Portal disposition flow is implemented client-side independent of Engagement Center disposition.
- **Duplicate route ownership:** none.
- **Split-brain risk level:** low (server) / medium (UI — disposition logic forks).
- **Runtime fix safe now?** no — the UI consolidation is a separate Ali-approved track.
- **Docs/QA guard safe now?** yes.
- **Ali approval required?** yes for UI changes.
- **Plexus IQ involved?** no.

## 4. Operational Queue

- **Canonical owner today:** `server/routes/operationalQueue.ts`.
- **Target canonical owner:** unchanged — Operational Queue is a READ-ONLY projection.
- **Write paths today:** none. QA invariant (`qa-operational-queue-readonly-invariant.mjs`) already pins this.
- **Read paths today:** `/api/operational-queue/*` filtered views.
- **Duplicate state fields:** none.
- **Duplicate status concepts:** Operational Queue derives bucket labels from `patient_execution_cases` + `scheduler_assignments` — this overlap is by design (it's a projection).
- **Duplicate UI surfaces:** none.
- **Split-brain risk level:** none.
- **Runtime fix safe now?** N/A.
- **Plexus IQ involved?** no.

## 5. Team Tasks

- **Canonical owner today:** `server/routes/plexusTasks.ts` + `plexus_tasks` table.
- **Target canonical owner:** unchanged.
- **Write paths today:** task-spec routes; ALSO `storage.createTask` called inside `executionCases.ts` for `CALL_RESULTS_NEEDING_TASK` outcomes.
- **Read paths today:** `/api/plexus-tasks`, `/api/team-tasks` family.
- **Duplicate state fields:** `task.status` lives on the task row; the engagement-case may carry a derived "open follow-up tasks" count in the read model.
- **Duplicate status concepts:** none load-bearing.
- **Duplicate UI surfaces:** Team Tasks panel + Engagement Center "needs follow-up" surface.
- **Duplicate route ownership:** `storage.createTask` is called both by plexusTasks routes AND by `executionCases.ts` call-result handler. Both go through the same `storage.createTask` writer, so this is a duplicate *caller* but a single *writer*. Acceptable.
- **Split-brain risk level:** low.
- **Plexus IQ involved?** no.

## 6. Patient Directory

- **Canonical owner today:** ambiguous — `patient_screenings` rows are the de-facto patient identity, written by many surfaces.
- **Target canonical owner:** Patient Directory aggregate view (Bundle 5 / Bundle 49 / Bundle 20) — read-only first, then canonical writes.
- **Write paths today:** `storage.updatePatientScreening` is called from `outreach.ts`, `patients.ts`, `engagementAssignmentBoard.ts`, multiple Plexus IQ services, the canonical-spine sync service. Many writers.
- **Read paths today:** `/api/patients`, `/api/patient-database`, `/api/patient-screenings`, indirect via every other surface.
- **Duplicate state fields:** patient name / DOB / MRN / facility duplicated wherever screenings is joined.
- **Duplicate status concepts:** `appointmentStatus`, `commitStatus`, `lifecycleStatus` — all on the same row.
- **Duplicate UI surfaces:** Patient Database, Patient Command Canvas, Playground tiles, Admin Review patient cards, Engagement Center patient card.
- **Split-brain risk level:** high — patient identity is touched by many writers without a canonical façade.
- **Runtime fix safe now?** no — shadow-read contract exists (Bundle 20) but not yet runtime-adopted.
- **Docs/QA guard safe now?** yes.
- **Ali approval required?** yes for any canonicalization.
- **Plexus IQ involved?** partially — Plexus IQ Admin Review services write `patient_screenings.reasoning`.

## 7. Patient Execution Cases

- **Canonical owner today:** `server/repositories/executionCase.repo.ts` + `server/routes/executionCases.ts`.
- **Target canonical owner:** Execution Case module.
- **Write paths today:** direct `db.update(patientExecutionCases)` calls in `executionCases.ts`, `engagementAssignmentBoard.ts`, `patients.ts`, `globalSchedule.ts`, `services/patientCommitService.ts`, `services/schedulerAutoAssign.ts`. **Six distinct files write the canonical execution-case table.**
- **Read paths today:** repository functions.
- **Duplicate state fields:** `engagementStatus`, `lifecycleStatus`, `assignedTeamMemberId` / legacy `assignedSchedulerId`, `nextActionAt`.
- **Duplicate status concepts:** engagementStatus vs lifecycleStatus overlap.
- **Duplicate UI surfaces:** none for the raw row.
- **Split-brain risk level:** medium-to-high — multiple writers without a service façade.
- **Runtime fix safe now?** no — needs a writer-funnel service introduced before deletes.
- **Docs/QA guard safe now?** yes — scanner can warn.
- **Ali approval required?** yes for writer consolidation.
- **Plexus IQ involved?** no.

## 8. Journey Events

- **Canonical owner today:** `server/services/journey/appendJourneyEvent.ts` (Bundle 12c).
- **Target canonical owner:** unchanged — appendJourneyEvent is the canonical writer.
- **Write paths today:** appendJourneyEvent called from several routes: `documentReadiness.ts`, `engagementAssignmentBoard.ts`, `documentLibrary.ts`, `globalSchedule.ts`, `executionCases.ts`. All go through the canonical writer.
- **Read paths today:** repository read functions.
- **Duplicate state fields:** none.
- **Duplicate status concepts:** none.
- **Duplicate UI surfaces:** none.
- **Split-brain risk level:** low — multiple callers but one canonical writer. The remaining risk is that `outreach.ts` does NOT currently append a journey event for call-result writes, which is itself a different split-brain (Engagement-center writes journey events, outreach does not).
- **Runtime fix safe now?** no — uneven journey-event coverage between routes is what the canonical `recordCallResult` planner fixes.
- **Plexus IQ involved?** no.

## 9. Scheduler assignments / work assignments

- **Canonical owner today:** `server/routes/schedulerAssignments.ts` + `server/services/schedulerAssignmentService.ts` + `server/services/schedulerAutoAssign.ts`.
- **Target canonical owner:** rename concept to "Work Assignment" / "CallListAssignment"; preserve `scheduler_assignments` table identifier (Batch D §6).
- **Write paths today:** schedulerAssignment routes + auto-assign service + outreach.ts (`markSchedulerAssignmentCompleted` on terminal) + engagementAssignmentBoard.ts.
- **Read paths today:** scheduler portal cases endpoint, operational queue projection.
- **Duplicate state fields:** assignment date, scheduler vs team-member, originalScheduler.
- **Duplicate status concepts:** assignment.status vs engagement-case engagementStatus.
- **Duplicate UI surfaces:** scheduler portal vs Engagement Center.
- **Split-brain risk level:** medium — the legacy + canonical labels coexist intentionally.
- **Runtime fix safe now?** no — `ENGAGEMENT_TO_CALL_LIST_BRIDGE` flag-gated bridge exists.
- **Plexus IQ involved?** no.

## 10. Ancillary scheduling

- **Canonical owner today:** `server/routes/appointments.ts` + visit/outreach tiles.
- **Target canonical owner:** unchanged.
- **Split-brain risk level:** low.
- **Plexus IQ involved?** no.

## 11. Ancillary documents

- **Canonical owner today:** `server/routes/ancillaryDocumentTemplates.ts` + `documentLibrary.ts` + `documentReadiness.ts`.
- **Target canonical owner:** Documents module (Bundle 16 design).
- **Split-brain risk level:** low — documents-storage is a dormant module (`qa-documents-dormant-module.mjs`).
- **Plexus IQ involved?** no.

## 12. PDF preview / download

- **Canonical owner today:** `server/routes/billingDocuments.ts` + `server/routes/documentLibrary.ts`.
- **Target canonical owner:** unchanged.
- **Split-brain risk level:** low — PDF protection invariant QA (`qa-pdf-protection-invariants.mjs`) pins behavior.
- **Hard-stop:** no PDF behavior change in this run.
- **Plexus IQ involved?** no.

## 13. Billing readiness

- **Canonical owner today:** `server/routes/billingReadiness.ts`.
- **Target canonical owner:** unchanged.
- **Split-brain risk level:** low.
- **Hard-stop:** no behavior change in this run.
- **Plexus IQ involved?** no.

## 14. Billing / claims / remittance

- **Canonical owner today:** `server/routes/billing.ts` + `server/services/billing/*`.
- **Target canonical owner:** unchanged.
- **Split-brain risk level:** low.
- **Hard-stop:** NO money math, claim math, remittance math, invoice money, revenue share touched at ALL in this run.
- **Plexus IQ involved?** no.

## 15. Admin Review

- **Canonical owner today:** `server/routes/admin.ts` + several Plexus IQ services that mutate `patient_screenings.reasoning`.
- **Target canonical owner:** Admin Review module — but reasoning regeneration is Plexus IQ's domain (read+derive+write reasoning only).
- **Write paths today:** `storage.updatePatientScreening` from `services/plexusIq/adminReview*` services.
- **Split-brain risk level:** medium — Admin Review approval/commit lives on `admin.ts`, but Plexus IQ services mutate the same `patient_screenings` row for reasoning regeneration. The two writers are logically separate (decision vs reasoning) but touch one row.
- **Hard-stop:** NO Admin Review approval / commit behavior change in this run.
- **Plexus IQ involved?** yes — flagged for the Plexus IQ split-brain audit (Batch 23). Plexus IQ writes `reasoning`, not approval/commit state; this is documented as designed (intelligence layer feeds Admin Review without owning approval).

## 16. Qualification engine

- **Canonical owner today:** distributed across `services/plexusIq/adminReviewRuleEngine.ts` and `routes/admin.ts`.
- **Target canonical owner:** Qualification Engine module (Bundle 31 design).
- **Split-brain risk level:** medium.
- **Hard-stop:** NO final qualification decision behavior change in this run.
- **Plexus IQ involved?** yes — Plexus IQ rule engine is part of the qualification reasoning pipeline. Read-only / decision-feeding, NOT operational.

## 17. Plexus IQ

- **Canonical owner today:** `server/services/plexusIq/*` services + `server/routes/plexusIqClinicalImport.ts` + Plexus IQ UI surfaces.
- **Operational writes from Plexus IQ services:** ONLY `storage.updatePatientScreening` to mutate `reasoning`/ancillary fields tied to Admin Review regeneration. NO writes to `patient_execution_cases`, `outreach_calls`, `scheduler_assignments`, `plexus_tasks`, `patient_journey_events`, `scheduling_triage_cases` directly. Verified by `grep -rn "patientExecutionCases|outreachCalls|schedulerAssignments|plexusTasks" server/services/plexusIq/` → no matches.
- **Target canonical owner:** Plexus IQ stays as the **intelligence / read-model / aggregation layer**.
- **Split-brain risk:** LOW for operational tables (none). MEDIUM for `patient_screenings.reasoning` (Plexus IQ writes alongside other reasoning writers in admin.ts).
- **Hard-stop:** **NO Plexus IQ runtime behavior change** in any batch of this run. Audit, document, and pin invariants only. If a Plexus IQ split-brain fix requires runtime, STOP and propose architecture for Ali approval before continuing.

## 18. Background jobs

- **Canonical owner today:** `server/services/morningRebuildScheduler.ts`, `server/services/absenceWatcher.ts`, `server/services/batchAnalysisRunner.ts`. Dormant background-jobs module (`qa-background-jobs-dormant-module.mjs`) is the future home.
- **Target canonical owner:** background-jobs module.
- **Split-brain risk level:** low — dormancy QA pins the future home.
- **Plexus IQ involved?** no.

## 19. EMR / API integration placeholders

- **Canonical owner today:** Bundle 39 EMR adapter interface design (docs-only) + bundle 38 Clinical Evidence Store contract (docs-only).
- **Target canonical owner:** EMR adapter module — read/sync only, NOT business decisions.
- **Split-brain risk level:** none (no runtime yet).
- **Plexus IQ involved?** no.

## 20. Clinical Evidence Store

- **Canonical owner today:** dormant per Bundle 38 contract.
- **Target canonical owner:** Clinical Evidence Store module.
- **Split-brain risk level:** none.
- **Plexus IQ involved?** no.

## 21. ICD suggestions

- **Canonical owner today:** `services/plexusIq/adminReviewIcdSearch*.ts`.
- **Target canonical owner:** ICD suggestion module under Plexus IQ intelligence layer.
- **Split-brain risk level:** low — suggestion only; commit lives elsewhere.
- **Hard-stop:** NO ICD commit behavior change in this run.
- **Plexus IQ involved?** yes (suggestion engine).

## 22. Research workflows

- Not present as a distinct runtime module today. No risk surface in this run.

---

## Risk-level scale

Every workflow below is classified on the scale: **none / low / medium / high / critical**.

| Level | Meaning |
|---|---|
| none | Single owner, single writer, single read model. No duplicate state. |
| low | Multiple callers but single canonical writer; or duplicate UI but server-side ownership is clean. |
| medium | Multiple writers or duplicate status fields; runtime fix possible but needs Ali approval. |
| high | Duplicate ownership across modules; runtime fix requires sequencing through preview + delegation flags. |
| critical | Active production drift between writers; data corruption risk. Stops the run if encountered. |

No workflow audited in this batch is at the `critical` level. Any future audit that escalates to `critical` MUST stop the run and trigger an Ali-approval cycle before any fix.

## Summary risk table

| # | Area | Risk | Runtime fix safe? | Plexus IQ involved? |
|---|---|---|---|---|
| 1 | Engagement Center | medium | no | no |
| 2 | Outreach / call attempts | medium-high | no | no |
| 3 | Team Portal | low/med | no | no |
| 4 | Operational Queue | none | N/A | no |
| 5 | Team Tasks | low | yes (small) | no |
| 6 | Patient Directory | high | no | partial |
| 7 | Patient Execution Cases | medium-high | no | no |
| 8 | Journey Events | low | no | no |
| 9 | Scheduler assignments | medium | no | no |
| 10 | Ancillary scheduling | low | N/A | no |
| 11 | Ancillary documents | low | N/A | no |
| 12 | PDF preview/download | low | NO (hard-stop) | no |
| 13 | Billing readiness | low | NO (hard-stop) | no |
| 14 | Billing/claims/remittance | low | NO (hard-stop) | no |
| 15 | Admin Review | medium | NO (hard-stop) | yes (reasoning only) |
| 16 | Qualification engine | medium | NO (hard-stop) | yes |
| 17 | Plexus IQ | low/medium | NO (audit-only this run) | self |
| 18 | Background jobs | low | N/A | no |
| 19 | EMR / API placeholders | none | N/A | no |
| 20 | Clinical Evidence Store | none | N/A | no |
| 21 | ICD suggestions | low | NO (hard-stop) | yes |

---

## Anti-patterns this run will NOT tolerate

- **No BS patches.** A "fix" that hides the split-brain (e.g. silencing a scanner instead of fixing ownership) is a regression.
- **No parallel brains.** Adding a second writer that "matches" the first is forbidden — funnel to one canonical writer.
- **No duplicated ownership.** If two modules own the same write, name one canonical and make the other a thin adapter.
- **No shadow systems.** No hidden background sync that mutates canonical state.
- **No UI as backend brain.** Disposition logic, queue partitioning, capacity math live server-side.
- **No unsafe runtime fixes.** If eliminating a split-brain requires risky runtime change, STOP and document the blocker.

## Plexus IQ rule

Plexus IQ is the **intelligence / read-model / aggregation surface**. It MAY:
- Read operational tables.
- Aggregate / derive / score.
- Write `patient_screenings.reasoning` for Admin Review regeneration (current behavior — preserved).

Plexus IQ MUST NOT (without explicit approval):
- Own operational workflow state.
- Duplicate Engagement Center, Team Tasks, or Patient Directory writes.
- Become an alternative Admin Review approver.

If a Plexus IQ split-brain fix would require runtime changes, this run STOPS and reports for Ali approval.

End of audit.

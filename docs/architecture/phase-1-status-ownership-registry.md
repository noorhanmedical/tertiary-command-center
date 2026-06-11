# Phase 1 — status ownership registry

**Status:** Docs-only (Batch C3 of Phase 1 run).
**Companion:** `scripts/qa-phase-1-status-ownership-registry.mjs`.

Pins ownership of every Phase 1 status field: who may write it, who reads it, who is forbidden, and what audit event accompanies a transition.

## Visit vs Outreach

- **Source owner:** Plexus IQ reasoning derivation (per qualification logic).
- **Allowed writer:** Plexus IQ reasoning service + Admin Review approval/commit.
- **Read consumers:** Engagement Center board (bucket filter), Team Portal call-list scoping, Operational Queue.
- **Forbidden writers:** Team Portal, Engagement Center call-result handlers, RingCentral adapter.
- **Audit event:** `patient_journey_events` on commit.
- **No-split-brain rule:** Visit vs Outreach derives from qualification reasoning; not from Team Portal disposition.

## Qualification / reasoning status

- **Source owner:** Plexus IQ reasoning generation.
- **Allowed writer:** Plexus IQ services (`services/plexusIq/adminReview*`) writing `patient_screenings.reasoning`.
- **Read consumers:** Admin Review surface, Engagement Center context, Plexus IQ aggregation.
- **Forbidden writers:** Engagement Center, Team Portal, RingCentral, Ancillary, Billing.
- **Audit event:** Journey event on reasoning regeneration.
- **No-split-brain rule:** Reasoning regeneration is Plexus IQ's territory by design (per #161 Batch 2 registry).

## Admin Review status

- **Source owner:** Admin Review (`routes/admin.ts`).
- **Allowed writer:** Admin Review routes (approve / commit / reject).
- **Read consumers:** Engagement Center (gates handoff), Plexus IQ aggregation.
- **Forbidden writers:** Plexus IQ services (write reasoning only, not approval), Engagement Center, Team Portal.
- **Audit event:** Journey event on approval/commit/reject.
- **No-split-brain rule:** Admin Review owns the approve/commit decision; Plexus IQ supports but does not decide.

## Engagement status

- **Source owner:** Execution Case service / `patient_execution_cases.engagementStatus`.
- **Allowed writer:** Execution Case service (future canonical writer); today engagement-center call-result handler + bridge + manual assignment routes per #160 Batch 1 audit §7.
- **Read consumers:** Engagement Center board, Team Portal call-list bucketing, Operational Queue, Plexus IQ aggregation.
- **Forbidden writers:** Plexus IQ, Admin Review, RingCentral, Ancillary, Billing.
- **Audit event:** Journey event `call_result_logged` (when transitioned via call result).
- **No-split-brain rule:** Engagement status is engagement-case lifecycle; Plexus IQ READS, never writes.

## Assignment status

- **Source owner:** Scheduler assignment service / `scheduler_assignments.status`.
- **Allowed writer:** Scheduler assignment service + `storage.markSchedulerAssignmentCompleted` (called from outreach route + outreach executor wrapper).
- **Read consumers:** Team Portal call-list, Operational Queue projection.
- **Forbidden writers:** Plexus IQ, Admin Review, Ancillary, Billing, Engagement Center (engagement does NOT mark assignments completed per #184 #186 / Batch B7 ownership matrix).
- **Audit event:** Journey event when assignment closes via call result.
- **No-split-brain rule:** Assignment lifecycle owned by the scheduler-assignment service; engagement surface suppresses `assignmentCompleted` step.

## Call result status

- **Source owner:** Outreach route `outreach_calls.outcome` (canonical row).
- **Allowed writer:** `storage.createOutreachCallAtomic` (canonical writer); driven by either outreach route or future canonical Engagement endpoint via deps.
- **Read consumers:** Team Portal call history, Engagement Center timeline (when journey event landed), Plexus IQ reasoning, audit trail.
- **Forbidden writers:** Plexus IQ, Admin Review, Ancillary, Billing.
- **Audit event:** Journey event `call_result_logged` (engagement surface only; outreach suppression per Batch B3 contract).
- **No-split-brain rule:** Single canonical `outreach_calls` row per call attempt.

## Next action

- **Source owner:** Engagement Center / `patient_execution_cases.nextActionAt`.
- **Allowed writer:** Engagement Center call-result handler + future delegation deps (via planner-computed `executionCaseNextActionAt`).
- **Read consumers:** Engagement Center board, Team Portal call-list (sort), Operational Queue, Plexus IQ aggregation.
- **Forbidden writers:** Plexus IQ, Admin Review, Ancillary, Billing, RingCentral, Team Portal directly (Team Portal POSTs the call-result endpoint which computes next action server-side).
- **Audit event:** Journey event when transitioned.
- **No-split-brain rule:** Next action computed server-side via planner; not by Team Portal UI.

## Task status

- **Source owner:** Team Tasks / `plexus_tasks.status`.
- **Allowed writer:** Team Tasks routes + `storage.createTask` + future canonical-service deps.
- **Read consumers:** Team Tasks UI, Team Portal patient panel chips, Engagement Center board.
- **Forbidden writers:** Plexus IQ services (read only), Admin Review, Ancillary, Billing, RingCentral.
- **Audit event:** Journey event when state transitions matter (open/done).
- **No-split-brain rule:** Task creation goes through `storage.createTask`; no parallel writers.

## Triage status

- **Source owner:** Scheduling triage / `scheduling_triage_cases.status`.
- **Allowed writer:** `upsertOpenSchedulingTriageCase`.
- **Read consumers:** Triage UI, Team Portal blocker chips, Engagement Center.
- **Forbidden writers:** Plexus IQ, Admin Review, Ancillary, Billing, RingCentral, Team Portal directly.
- **Audit event:** Journey event when triage opens/closes.
- **No-split-brain rule:** Triage upsert is the canonical writer.

## Ancillary status

- **Source owner:** Ancillary documents module (Segment F).
- **Allowed writer:** Ancillary service (future).
- **Read consumers:** Team Portal blocker chips, Billing Readiness, Engagement Center, Plexus IQ aggregation.
- **Forbidden writers:** Plexus IQ, Admin Review, Engagement Center call-result handler, RingCentral, Billing.
- **Audit event:** Journey event on ancillary transitions.
- **No-split-brain rule:** Ancillary state owned by ancillary module; Plexus IQ READS only.

## Document status

- **Source owner:** Documents module (Segment F).
- **Allowed writer:** Documents service.
- **Read consumers:** Documents library, Physician signing queue, Billing Readiness, Team Portal patient panel.
- **Forbidden writers:** Plexus IQ, Admin Review (Admin Review approves; doesn't mutate document state), Engagement, Ancillary (ancillary linkages only), Billing.
- **Audit event:** Journey event on document state changes.
- **No-split-brain rule:** Document state owned by documents service.

## Signature status

- **Source owner:** Physician signing queue (Segment F).
- **Allowed writer:** Signing service.
- **Read consumers:** Documents library, Billing Readiness, audit trail.
- **Forbidden writers:** Plexus IQ, Admin Review, Engagement, Ancillary, Billing.
- **Audit event:** Journey event on signature.
- **No-split-brain rule:** Signature events through the signing service only.

## Billing readiness status

- **Source owner:** Billing Readiness module (Segment G).
- **Allowed writer:** Billing Readiness service.
- **Read consumers:** Billing Readiness UI, Invoicing, Team Portal blocker chips, Plexus IQ aggregation.
- **Forbidden writers:** Plexus IQ (read-only aggregation), Admin Review, Engagement, Ancillary, Documents (these set their own statuses which billing readiness READS).
- **Audit event:** Journey event on readiness transitions.
- **No-split-brain rule:** Readiness computed from upstream statuses; not duplicated.

## Invoice status

- **Source owner:** Invoicing module (Segment G).
- **Allowed writer:** Invoicing service.
- **Read consumers:** Invoicing UI, audit trail.
- **Forbidden writers:** Plexus IQ, Admin Review, Engagement, Ancillary, Documents, Billing Readiness (readiness gates invoice; doesn't set invoice status).
- **Audit event:** Journey event on invoice state changes.
- **No-split-brain rule:** Invoicing is NOT claims submission. Status owned by invoicing module.

## Phase 1 rules

- One canonical writer per status field.
- Plexus IQ READS every status; writes only `patient_screenings.reasoning`.
- Admin Review writes approval/commit only.
- Team Portal POSTs canonical write endpoints; does not mutate state directly.
- All operational status transitions emit a journey event.
- No split-brain. No duplicate writers.

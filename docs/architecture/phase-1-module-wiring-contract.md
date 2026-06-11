# Phase 1 — module wiring contract

**Status:** Docs-only (Batch C1 of Phase 1 run).
**Companion:** `scripts/qa-phase-1-module-wiring-contract.mjs`.

Pins the end-to-end module handoffs so Phase 1 modules are wired together as one operating platform, not isolated screens.

## Handoff 1 — Batch Flow → Plexus IQ → Admin Review

- **Source owner:** Batch Flow ingestion routes (`server/routes/batches.ts`).
- **Target consumer:** Plexus IQ reasoning services (`server/services/plexusIq/*`) → Admin Review (`server/routes/admin.ts`).
- **Canonical ID:** `batchId` + `patientScreeningId`.
- **Status field:** `qualificationStatus` on `patient_screenings` (Visit vs Outreach derived).
- **Audit event:** `patient_journey_events` via `appendJourneyEvent`.
- **Failure/blocker behavior:** failed reasoning generation leaves `patient_screenings.reasoning` empty; Admin Review surfaces as needs-review.
- **No split-brain rule:** Plexus IQ is the reasoning generator; Admin Review owns the approval/commit. NEITHER may bypass the other.

## Handoff 2 — Admin Review → Engagement Center

- **Source owner:** Admin Review (`server/routes/admin.ts`).
- **Target consumer:** Engagement Center read views (`/api/engagement-center/cases`, `/api/engagement-center/call-list`).
- **Canonical ID:** `patientScreeningId` + `patientExecutionCaseId`.
- **Status field:** `lifecycleStatus` + `engagementStatus` on `patient_execution_cases`.
- **Audit event:** `patient_journey_events` row appended on commit.
- **Failure/blocker behavior:** rejected Admin Review prevents Engagement entry; flagged cases sit in needs-review until resolved.
- **No split-brain rule:** Engagement Center reads from execution-case state; never bypasses Admin Review for commit decisions.

## Handoff 3 — Engagement Center → Team Portal

- **Source owner:** Engagement Center (`patient_execution_cases` + `scheduler_assignments`).
- **Target consumer:** Team Portal (`/api/portal/outreach-call-list`).
- **Canonical ID:** `patientScreeningId` + `schedulerAssignmentId`.
- **Status field:** `scheduler_assignments.status` + execution-case `engagementStatus`.
- **Audit event:** `patient_journey_events` on assignment.
- **Failure/blocker behavior:** unassigned cases NOT in Team Portal call list.
- **No split-brain rule:** Team Portal CONSUMES the call list; does not generate it.

## Handoff 4 — Team Portal → RingCentral → canonical call result

- **Source owner:** Team Portal disposition UI (`DispositionSheet.tsx` / `CanonicalRowActions.tsx`).
- **Target consumer:** Canonical engagement call-result endpoint (`POST /api/engagement-center/call-results` plural, or singular adapter).
- **Canonical ID:** `patientScreeningId` + (optional) `ringCentralCallId`.
- **Status field:** call result outcome label.
- **Audit event:** `patient_journey_events` via `appendJourneyEvent` (engagement surface owns this).
- **Failure/blocker behavior:** failed POST surfaces error toast; no partial state.
- **No split-brain rule:** RingCentral is a telephony adapter only; metadata attaches to the call result via the canonical endpoint.

## Handoff 5 — Call Result → Journey Events / Tasks / Triage / Next Action

- **Source owner:** Canonical recordCallResult service.
- **Target consumer:** `patient_journey_events`, `plexus_tasks`, `scheduling_triage_cases`, `patient_execution_cases.nextActionAt`.
- **Canonical ID:** journey event ID + task ID + triage case ID.
- **Status field:** outcome-specific (taskStatus, triageStatus, engagementStatus).
- **Audit event:** journey event row carries the outcome.
- **Failure/blocker behavior:** best-effort writes per legacy semantics; failures logged.
- **No split-brain rule:** ONE write path (recordCallResult) drives all side effects.

## Handoff 6 — Engagement/Team Portal → Ancillary Workflow

- **Source owner:** Engagement Center (engagement-case lifecycle).
- **Target consumer:** Ancillary documents/orders/notes (Segment F).
- **Canonical ID:** `patientScreeningId` + `ancillaryType`.
- **Status field:** ancillary status (Segment F contract).
- **Audit event:** journey event on ancillary transitions.
- **Failure/blocker behavior:** blocker chip surfaces in Team Portal.
- **No split-brain rule:** Ancillary Documents module owns document/order/note state.

## Handoff 7 — Ancillary Workflow → Documents → Physician Signing

- **Source owner:** Ancillary Documents.
- **Target consumer:** Physician Signing queue (Segment F).
- **Canonical ID:** `documentId` + `signatureId`.
- **Status field:** signature status (signed / needs-signature / rejected).
- **Audit event:** journey event on signature actions.
- **Failure/blocker behavior:** unsigned documents surface as billing blockers.
- **No split-brain rule:** Documents own document state; Signing queue owns signature state.

## Handoff 8 — Documents/Signing → Billing Readiness

- **Source owner:** Documents + Signing.
- **Target consumer:** Billing Readiness module (Segment G).
- **Canonical ID:** `billingReadinessId` + `patientScreeningId`.
- **Status field:** ready / blocked / blocker reasons.
- **Audit event:** journey event on readiness transitions.
- **Failure/blocker behavior:** unmet prerequisites surface as named blockers.
- **No split-brain rule:** Billing Readiness consumes status; does not own underlying doc/sig state.

## Handoff 9 — Billing Readiness → Invoicing

- **Source owner:** Billing Readiness.
- **Target consumer:** Invoicing (Segment G).
- **Canonical ID:** `invoiceId` + `patientScreeningId`.
- **Status field:** invoice draft / sent / paid / overdue.
- **Audit event:** journey event on invoice transitions.
- **Failure/blocker behavior:** invoice cannot be sent without readiness=ready.
- **No split-brain rule:** Invoicing is NOT claims submission.

## Handoff 10 — Phase 1 state → Plexus IQ visibility

- **Source owner:** Various Phase 1 modules (engagement, ancillary, billing).
- **Target consumer:** Plexus IQ as INTELLIGENCE / READ-MODEL layer.
- **Canonical ID:** All Phase 1 IDs.
- **Status field:** aggregated read-model surface.
- **Audit event:** Plexus IQ READS journey events; does not write them.
- **Failure/blocker behavior:** Plexus IQ shows aggregated state with blockers surfaced.
- **No split-brain rule:** **Plexus IQ is not Mission Control. Plexus IQ does not own operational workflow state. Mission Control comes later.**

## Phase 1 rules

- Engagement Center owns operational workflow.
- Team Portal CONSUMES assigned work.
- Plexus IQ is the intelligence / read-model layer.
- Admin Review owns approval / commit.
- No split-brain. No duplicate write brains. No BS patches.

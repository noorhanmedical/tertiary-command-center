# Phase 1 — wiring smoke-test contract

**Status:** Docs-only (Batch C4 of Phase 1 run).
**Companion:** `scripts/qa-phase-1-wiring-smoke-test-contract.mjs`.

Pins the end-to-end smoke path each module is expected to satisfy under Phase 1. No runtime implementation in this batch — it's the contract the future Segment I smoke test will exercise.

## Step 1 — Batch Flow

- **Source owner:** Batch Flow ingestion (`routes/batches.ts`).
- **Target consumer:** `screening_batches` + `patient_screenings` rows.
- **Canonical ID passed forward:** `batchId` + `patientScreeningId`.
- **Status changed:** `patient_screenings.commitStatus` = "pending".
- **Audit event:** `patient_journey_events` via `appendJourneyEvent` for batch ingest.
- **Failure/blocker behavior:** failed ingest leaves no screening row.

## Step 2 — Plexus IQ reasoning + Visit vs Outreach

- **Source owner:** Plexus IQ reasoning services.
- **Target consumer:** `patient_screenings.reasoning` populated; Visit vs Outreach bucket derived.
- **Canonical ID:** `patientScreeningId`.
- **Status changed:** Visit vs Outreach bucket set on the screening row.
- **Audit event:** Journey event on reasoning regeneration.
- **Failure/blocker behavior:** reasoning generation failure leaves the field empty; surfaces in Admin Review as needs-review.

## Step 3 — Admin Review

- **Source owner:** Admin Review (`routes/admin.ts`).
- **Target consumer:** Admin Review approval/commit.
- **Canonical ID:** `patientScreeningId`.
- **Status changed:** Admin Review status = approved / committed / rejected.
- **Audit event:** Journey event on commit.
- **Failure/blocker behavior:** rejection prevents Engagement entry.

## Step 4 — Engagement candidate / handoff

- **Source owner:** Engagement Center commit (triggered by Admin Review approval).
- **Target consumer:** `patient_execution_cases` row created.
- **Canonical ID passed forward:** `patientScreeningId` + `executionCaseId`.
- **Status changed:** `lifecycleStatus` = "active"; `engagementStatus` set.
- **Audit event:** Journey event on execution-case creation.
- **Failure/blocker behavior:** invalid handoff leaves no execution case; cannot be assigned.

## Step 5 — Engagement bulk assignment

- **Source owner:** Engagement Center assignment surface (`POST /api/engagement-center/assign`).
- **Target consumer:** `scheduler_assignments` rows for the day.
- **Canonical ID:** `assignmentId` + `executionCaseId` + `patientScreeningId`.
- **Status changed:** assignment.status = "open".
- **Audit event:** Journey event on assignment.
- **Failure/blocker behavior:** no assigned work for unassigned cases.

## Step 6 — Team Portal sees assigned work

- **Source owner:** `/api/portal/outreach-call-list`.
- **Target consumer:** Team Portal call-list panel.
- **Canonical ID:** `assignmentId` + `patientScreeningId`.
- **Status changed:** none (read-only).
- **Audit event:** none (read-only).
- **Failure/blocker behavior:** empty list if no assignments.

## Step 7 — RingCentral call starts (if enabled)

- **Source owner:** Team Portal click-to-call UI → RingCentral SDK.
- **Target consumer:** RingCentral session.
- **Canonical ID:** `ringCentralCallId` / `sessionId`.
- **Status changed:** call session state managed by RingCentral.
- **Audit event:** none in the workflow tables; will attach to call result via metadata.
- **Failure/blocker behavior:** call failure surfaces in Team Portal toast.

## Step 8 — User selects call result

- **Source owner:** Team Portal disposition UI (DispositionSheet / CanonicalRowActions).
- **Target consumer:** Canonical Engagement call-result endpoint (singular today; plural under flag).
- **Canonical ID:** `patientScreeningId` + optional `executionCaseId` + optional `ringCentralCallId`.
- **Status changed:** triggers Step 9-10 side effects via the canonical service.
- **Audit event:** Journey event `call_result_logged` from the engagement surface.
- **Failure/blocker behavior:** failed POST surfaces error toast; no partial state.

## Step 9 — Callback / task / triage updates

- **Source owner:** Canonical recordCallResult (engagement surface) — drives planner-determined side effects.
- **Target consumer:** `patient_execution_cases.nextActionAt` (callback), `plexus_tasks` (follow-up tasks), `scheduling_triage_cases` (triage cases).
- **Canonical ID:** `taskId`, `triageCaseId`, executionCaseId.
- **Status changed:** task.status = "open"; triage.status = "open"; engagementStatus updated.
- **Audit event:** Journey event captures the transition.
- **Failure/blocker behavior:** best-effort writes per legacy semantics.

## Step 10 — Journey Event appears

- **Source owner:** `appendJourneyEvent` (canonical writer).
- **Target consumer:** `patient_journey_events` row.
- **Canonical ID:** `journeyEventId` + `patientScreeningId` + optional `executionCaseId`.
- **Status changed:** none (audit-only).
- **Audit event:** itself.
- **Failure/blocker behavior:** missing journey event indicates upstream write failure.

## Step 11 — Ancillary status visible

- **Source owner:** Ancillary documents module (Segment F future).
- **Target consumer:** Team Portal blocker chips, Billing Readiness, Engagement Center.
- **Canonical ID:** `ancillaryId` + `patientScreeningId`.
- **Status changed:** ancillary status surfaced.
- **Audit event:** Journey event on ancillary transitions.
- **Failure/blocker behavior:** missing ancillary surfaces as blocker chip.

## Step 12 — Report uploaded

- **Source owner:** Documents upload surface (Segment F future).
- **Target consumer:** `documents` table (Segment F).
- **Canonical ID:** `documentId`.
- **Status changed:** document.status = "uploaded".
- **Audit event:** Journey event on upload.
- **Failure/blocker behavior:** failed upload leaves document.status = "missing".

## Step 13 — Document generated / tracked

- **Source owner:** Documents generation / upload service.
- **Target consumer:** Documents library.
- **Canonical ID:** `documentId`.
- **Status changed:** document.status transitions.
- **Audit event:** Journey event on document state changes.
- **Failure/blocker behavior:** PDF generation failure surfaces in documents library.

## Step 14 — Physician signs

- **Source owner:** Physician signing queue (Segment F future).
- **Target consumer:** `signatures` table (Segment F).
- **Canonical ID:** `signatureId` + `documentId`.
- **Status changed:** signature.status = "signed".
- **Audit event:** Journey event on signature.
- **Failure/blocker behavior:** unsigned documents surface as billing blockers.

## Step 15 — Billing readiness = ready

- **Source owner:** Billing Readiness service (Segment G future).
- **Target consumer:** `billing_readiness` row.
- **Canonical ID:** `billingReadinessId`.
- **Status changed:** billingReadiness.status = "ready" (if all blockers clear) or "blocked" otherwise.
- **Audit event:** Journey event on readiness transitions.
- **Failure/blocker behavior:** named blockers surface.

## Step 16 — Invoice drafted / sent

- **Source owner:** Invoicing service (Segment G future).
- **Target consumer:** `invoices` table.
- **Canonical ID:** `invoiceId`.
- **Status changed:** invoice.status = "draft" → "sent".
- **Audit event:** Journey event on invoice state changes.
- **Failure/blocker behavior:** cannot send invoice without readiness=ready.

## Step 17 — Plexus IQ remains focused

- **Source owner:** Plexus IQ (read-model + intelligence layer).
- **Target consumer:** Plexus IQ dashboards (Batch Flow, qualification reasoning, Admin Review support).
- **Canonical ID:** all (reads only).
- **Status changed:** none (Plexus IQ is read-only on operational state).
- **Audit event:** none (Plexus IQ reads journey events; does not write them).
- **Failure/blocker behavior:** Plexus IQ NOT a Mission Control / billing dashboard / productivity dashboard. Mission Control comes later.

## Phase 1 smoke-test rules

- Each step has a single canonical owner.
- Each step emits exactly one audit event (or none for read-only).
- No step writes outside its owner.
- Plexus IQ READS operational state at every step; does not write any of it (except `patient_screenings.reasoning`).
- Admin Review writes approval/commit at Step 3 only.
- Team Portal POSTs canonical endpoints at Steps 7-8; does not mutate workflow tables directly.

End of contract.

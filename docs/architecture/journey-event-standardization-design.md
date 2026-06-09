# Journey-event standardization design (Batch 12 read-only foundation)

**Branch:** `architecture/batch-10-12-spine-readonly-helpers`
**Scope:** Design doc + read-only server module. No new schema, no migration, no writer. The centralized writer ships in **Batch 12b**.

> Cross-reference: `shared/contracts/journeyEvents.ts` (Batch 2), `shared/schema/executionCase.ts:70-95`, `docs/architecture/backend-route-parity-inventory.md` §12, `docs/architecture/canonical-spine.md` §9.

---

## 1. Why this needs to happen

`patient_journey_events` is the canonical audit-event timeline per patient. Today the table is written **inline from many call sites** with no centralized writer:

- `server/services/patientCommitService.ts` — `screening_committed`, `execution_case_created/updated`.
- `server/routes/engagementAssignmentBoard.ts` — `engagement_assignment_changed`, `engagement_assignment_cancelled`.
- `server/repositories/executionCase.repo.ts` — `engagement_assigned`.
- `server/services/schedulerAutoAssign.ts` — `scheduler_assigned`.
- `server/routes/executionCases.ts` — `call_result_logged`.
- `server/routes/globalSchedule.ts` — `scheduled_ancillary`.
- `server/routes/plexusTasks.ts` — `task_created`.
- `server/routes/documentLibrary.ts` — `document_sent`.
- `server/routes/documentReadiness.ts` — `document_completed`.
- `server/routes/completedBillingPackages.ts` — `billing_payment_updated`, `added_to_invoice`.
- `server/routes/patients.ts` — `admin_approval_updated`.

Coverage is uneven (the original architecture review §3.9 + §4.6 documents the missing-event gaps in Admin Review regenerate, billing status changes, invoice payments, etc). Some writes are fire-and-forget; failures are silent. The orchestrator's Batch 12 entry standardizes this behind a typed writer.

This **read-only foundation** ships:

- The canonical event-kind catalogue (`JOURNEY_EVENT_KINDS`) extracted from the inventory above.
- Typed read helpers (`getJourneyTimelineForPatient`, `listJourneyEvents`, `getLatestJourneyEventByExecutionCaseIds`).
- This design doc.

The typed centralized **writer** (`writeJourneyEvent(kind, payload, options?)`) is **Batch 12b** in a future PR.

---

## 2. Event-kind catalogue (today)

```ts
JOURNEY_EVENT_KINDS = [
  "screening_committed",
  "execution_case_created",
  "execution_case_updated",
  "engagement_assigned",
  "engagement_assignment_changed",
  "engagement_assignment_cancelled",
  "scheduler_assigned",
  "call_result_logged",
  "scheduled_ancillary",
  "task_created",
  "document_sent",
  "document_completed",
  "billing_payment_updated",
  "added_to_invoice",
  "admin_approval_updated",
] as const;
```

This catalogue is the union of every `eventType` literal observed at the call sites in §1. New writers MUST use one of these kinds; new kinds need a separate batch + an update here.

---

## 3. Missing events to add (Batch 12b scope; documented now)

The original review §3.9 + the parity inventory §1 identify several places where a journey event SHOULD fire but doesn't today. Batch 12b will add them additively:

- `admin_review_regenerated` — Admin Review regenerate-* handlers (PRs #57-#60).
- `admin_review_approved` — Admin Review approval (the Batch 3b.8 handler).
- `admin_review_rejected` — Admin Review approval (rejected status).
- `regenerate_all` — Admin Review regenerate-all (when full reasoning rewrite happens).
- `billing_record_status_changed` — `routes/billing.ts` PATCH.
- `invoice_payment_recorded` — `routes/invoices.ts` POST /:id/payments.

Each is **additive** — Batch 12b adds them one per commit so any one can be reverted in isolation.

---

## 4. Centralized writer design (Batch 12b)

```ts
// Future server/platform/audit/journeyEventWriter.ts
export type WriteJourneyEventInput = {
  kind: JourneyEventKind;
  patientName: string;
  patientDob?: string | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  actorUserId?: string | null;
  eventSource: string;
  summary: string;
  metadata?: Record<string, unknown> | null;
};

export async function writeJourneyEvent(
  input: WriteJourneyEventInput,
  options?: { allowFireAndForget?: boolean },
): Promise<{ ok: true; id: number } | { ok: false; reason: string }>;
```

Behavior:
- Typed `kind` union — typo-proof.
- Inserts into `patient_journey_events` using the existing `appendPatientJourneyEvent` repo helper (which stays in place; the typed writer is a wrapper).
- When `allowFireAndForget: true`, errors are caught + logged but don't propagate. Default is throw-on-error.
- The writer does NOT introduce a new audit table; it standardizes the writes into the existing one.

---

## 5. Read surface (this batch)

`server/modules/journey-events/`:

- `contracts.ts` — `JourneyEventKind` union, `JourneyEventSnapshot`, `ListJourneyEventsFilters`.
- `repo.ts` — `listJourneyEvents(filters, limit)`, `getJourneyTimelineForPatient(patientScreeningId, limit)`, `getLatestJourneyEventByExecutionCaseIds(ids)`.
- `service.ts` + `index.ts` — barrels.

**Not wired to any route.** The existing engagement-board route inlines its own latest-journey-event lookup; future PRs can switch to the shared helper one at a time.

---

## 6. What this batch deliberately does NOT do

- No typed writer. (Batch 12b.)
- No new event kinds. (Batch 12b.)
- No `appendPatientJourneyEvent` repo change.
- No edit to any existing route that writes events.
- No new column / index / migration.
- No client/ change.

---

## 7. Rollback

`git rm -r server/modules/journey-events/` + `git rm docs/architecture/journey-event-standardization-design.md`. Zero runtime state.

---

## 8. Stop conditions for follow-up batches

A future batch MUST stop and ask if:

1. A new event kind is added without an update to `JOURNEY_EVENT_KINDS` in the same PR.
2. The centralized writer rejects (rather than tolerates) a historical event-type value not in the catalogue.
3. Any retrofit of an existing event-emitting route changes the event payload shape (column-by-column parity is required).
4. The new writer fires events from inside a hot loop (e.g., billing-records auto-create scan); volume safeguards must be in place first.

End of design.

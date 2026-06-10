# Team Portal call-list consumption readiness

**Status:** Docs-only (Batch F). No runtime change. No UI change. No new endpoint.
**Date:** 2026-06-10.
**Scope:** Pin how Team Portal will consume the canonical call-list / call-result surfaces once the `recordCallResult` service (Batch A §9) and the canonical call-list read paths exist. Defines what Team Portal MAY read, what it MUST NOT own, and the role-aware envelope the consumer surface uses.
**Cross-references:**
- `engagement-call-list-canonicalization-contract.md` (Batch A).
- `call-result-canonicalization` parity fixture (Batch B).
- `team-member-assignment-terminology-contract.md` (Batch D).
- `team-portal-runtime-wiring-readiness-checklist.md` (Bundle 54).
- `team-portal-playground-wiring-contract.md` (Bundle 11).

This document ships zero code. It pins what Team Portal's eventual consumption surface looks like.

---

## 1. What Team Portal reads

When the canonical surfaces ship, Team Portal will read (and ONLY read) these:

- **Assigned call/work list** for the signed-in Team Member, scoped to the Team Member's tenant + facility — today via `GET /api/portal/outreach-call-list`, eventually via a canonical `GET /api/portal/call-list` once the v2 read endpoint lands.
- **Prior call history per patient** — via `GET /api/portal/calls?patientScreeningId=<id>` once that endpoint exists (Batch I). Until then, Team Portal does NOT surface prior call history.
- **Callback due** — derived from `patient_execution_cases.nextActionAt` exposed through the call-list read.
- **Next action** — derived (display-only) from the execution case's engagement state.
- **Notes if role allows** — per the RBAC visibility rules in `call-history-readonly-envelope-contract.md` (Batch G).

That's the complete read surface. Nothing else is added to Team Portal's read scope without an explicit additive PR that cites this document.

---

## 2. What Team Portal MUST NOT own

Team Portal NEVER owns:

- **Call-list generation.** The day-of call list is produced by `buildDailyAssignments` (daily rebuild) + `releaseAndRedistribute` (PTO) + the engagement→call-list bridge — all server-side, none of them in `routes/portal.ts`.
- **Assignment / disbursement.** Auto-assign on commit (`schedulerAutoAssign.ts`), manual Engagement Center assignment (`engagementAssignmentBoard.ts`), and the capacity partition (the eligible-pool slicer in `portal.ts:391-407`, which is read-side only) all stay where they are.
- **Cancellation write semantics.** Cancel-many is the Engagement Center's responsibility (Bundle 50 invariant).
- **Assignment completion logic.** That is the canonical `recordCallResult` service's job — Team Portal delegates to that service when it writes a call result, never marks an assignment completed itself.
- **Capacity math.** The per-Team-Member capacity calculation stays in `portal.ts:391-407` route-side; the UI receives the partition and renders it.
- **Direct writes** to `scheduler_assignments`, `patient_execution_cases`, `outreach_calls`, or `patient_journey_events` — Team Portal must have **no direct writes** to any of these tables. Batch C invariant pins this. Operational Queue + Team Tasks remain read-only reflections; Team Portal observes them via existing read endpoints and the canonical Journey Event audit trail without owning any write path.
- **Billing money math, qualification logic, PDF / packet generation, Admin Review approval flows.** General hard-stops.

---

## 3. Future call-result write path from Team Portal

Once the `recordCallResult` service exists:

- A future `POST /api/portal/call-result` route (path reserved; not added by this batch) accepts the call-result body and **delegates to `recordCallResult`** — no parallel implementation.
- The route is gated by `USE_PORTAL_CALL_RESULT_WRITE` feature flag (default OFF, per Bundle 54 §5).
- The response shape mirrors what the canonical service returns; no Team-Portal-specific reshaping.
- All side effects (insert `outreach_calls`, update `appointmentStatus`, update execution case, mark assignment completed on terminal, create follow-up task, open triage case, append journey event) happen inside the canonical service — Team Portal sees only the resulting `RecordCallResultOutcome`.

Team Portal MAY render success / failure UI from the outcome but MUST NOT branch on the outcome to perform additional writes. The canonical service is the choke point.

---

## 4. Role-aware visibility

Team Portal surfaces follow the existing role profiles:

- **Patient Care Specialist (PCS)** — sees assigned call list for their tenant + facility scope; sees clinical-context fields on patients.
- **Ancillary Care Specialist (ACS)** — same scope; ancillary-context fields surfaced where appropriate.
- **Both roles** may log call results via the canonical write path when the flag is ON. Both may view prior call history.
- **Admin / manager** roles get an aggregated view but do NOT bypass the canonical write path.

Per Bundle 11 §21 + Batch G:
- Team Members never see another Team Member's call results outside their own facility scope by default.
- Cross-tenant access is forbidden at every level.
- Notes visibility is gated per Batch G §3.

---

## 5. Display contract — what the UI may render

The UI receives the call list + call history + canonical outcome objects. It MAY render:

- Patient identifier (within RBAC scope; per Bundle 49 §1).
- Patient phone (`patient_screenings.phoneNumber` — the audit-trail-allowed field).
- Insurance summary (display string only; no money / claim fields).
- Qualifying tests (`patient_screenings.qualifyingTests`).
- Appointment status (current value).
- Last call outcome + timestamp.
- Callback-due indicator from `nextActionAt`.
- Reasoning summary at the level the PDF protection contract permits (no raw `reasoning` blob).

The UI MUST NOT render:

- Money fields, claim amounts, invoice totals (Bundle 29 hard-stop).
- Raw `reasoning` blob keys.
- ICD codes in patient-facing display (Bundle 11 §22).
- Cross-team-member PTO, performance review, payroll data.
- Other Team Members' call notes outside the viewer's facility scope.
- Admin announcement edit history.
- Bridge audit failure logs (those go to the audit trail, not the UI).

---

## 6. Adoption sequence

Per Batch H §1-§7, the runtime work happens in this order; Team Portal's consumption follows that order:

1. `recordCallResult` service exists + parity tests green.
2. Both legacy call-result routes delegate; response shapes byte-stable.
3. Team Portal `GET /api/portal/calls?patientScreeningId=<id>` ships (Batch I).
4. Team Portal `GET /api/portal/call-list` v2 (canonical) ships behind a flag.
5. Team Portal `POST /api/portal/call-result` ships behind `USE_PORTAL_CALL_RESULT_WRITE` flag default OFF.
6. UI hook updates (Bundle 55's Batch 4 PR-A pattern with test-id parity gates).
7. Flag flip in staging → production (separately approved PRs).

Each step is its own PR. Team Portal's UI is not modified before step 5.

---

## 7. Stop conditions for any Team Portal adjacent PR

A future PR adjacent to Team Portal consumption MUST stop and ask if:

1. It would have Team Portal generate the call list.
2. It would have Team Portal own assignment / disbursement.
3. It would write `scheduler_assignments`, `patient_execution_cases`, `outreach_calls`, or `patient_journey_events` directly from `routes/portal.ts`.
4. It would mark assignment-completed outside the canonical `recordCallResult` service.
5. It would render a forbidden data class (§5).
6. It would expose call notes outside the role envelope.
7. It would cross tenants.
8. It would flip a feature-flag default in production.
9. It would change response shape on an existing portal route.
10. It would touch Admin Review approval / commit, qualification, PDF / packet, billing money, or AWS production cutover.

---

## 8. Non-promises

- No commitment that the canonical `recordCallResult` service ships in any particular timeframe.
- No commitment to a specific UI layout for Team Portal's call-list surface.
- No commitment that the v2 call-list endpoint replaces `/api/portal/outreach-call-list` — the v2 endpoint is additive until a separate retirement PR ships.
- No commitment that `USE_PORTAL_CALL_RESULT_WRITE` is ever default-ON.

End of contract.

# Phase 1 — Admin Review boundary contract

**Status:** Docs-only (Batch D2 of Phase 1 run).
**Companion:** `scripts/qa-phase-1-admin-review-boundary-contract.mjs`.

Pins the Admin Review scope in Phase 1. Hard guardrails to prevent Admin Review from absorbing operational workflow ownership.

## 1. Admin Review scope in Phase 1

Admin Review remains:

- **Reasoning review** — human reviewer reads the Plexus-IQ-generated `patient_screenings.reasoning`.
- **Evidence review** — reviewer evaluates Clinical Evidence Store contents + Plexus IQ aggregated signals.
- **Regeneration triggers** — reviewer can trigger Plexus IQ reasoning regeneration via the existing services.
- **Approval / commit** — reviewer approves or commits the qualification decision; this is the gate before Engagement Center entry.
- **Reject** — reviewer rejects a screening (returns to Plexus IQ / batch surface).

## 2. Admin Review is upstream of Engagement

The flow is strictly:

Batch Flow → Plexus IQ → **Admin Review** → Engagement Center → Team Portal

Admin Review is the gate. Engagement Center reads execution-case state that exists ONLY because Admin Review committed it.

## 3. What Admin Review does NOT own

- **Call list** — call-list generation is Engagement Center / scheduler-assignment service territory.
- **Team assignment** — assignment is the scheduler-assignment service + Engagement Center bulk-assign route.
- **Call results** — call-result writes go through the canonical Engagement endpoint (singular legacy or plural canonical).
- **Invoicing** — invoicing module owns invoice state.
- **Billing final state** — billing readiness + invoicing modules own readiness/invoice statuses.
- **Team Portal work** — Team Portal call-list panel is Team Portal's surface, fed from scheduler assignments.

## 4. Admin Review UI protection

Existing Admin Review UI surfaces are PROTECTED in Phase 1:

- No file under the Admin Review UI surface tree may be edited unless Ali explicitly approves.
- Admin Review panels (reasoning, evidence, ICD search, regeneration, approval) continue to render with current behavior.
- Admin Review approval / commit / reject buttons continue to behave as today.

## 5. Admin Review runtime protection

Existing Admin Review runtime (`server/routes/admin.ts` + dependent services) is PROTECTED in Phase 1:

- No modification to `server/routes/admin.ts` approval/commit logic unless Ali explicitly approves.
- No modification to the Plexus IQ reasoning regeneration services that back Admin Review unless Ali explicitly approves.
- The 5 `services/plexusIq/adminReview*` services continue to write `patient_screenings.reasoning` ONLY (their canonical write target per #161 Batch 2 registry + #182 Batch 23 audit).

## 6. Admin Review does NOT bypass

- Admin Review does NOT mutate `patient_execution_cases` directly. Execution-case creation comes from the engagement-commit path triggered by Admin Review approval.
- Admin Review does NOT call the canonical recordCallResult service.
- Admin Review does NOT write `outreach_calls`, `scheduler_assignments`, `plexus_tasks`, `scheduling_triage_cases`.

## 7. What requires Ali explicit approval to change in Admin Review

- Any Admin Review UI change.
- Any Admin Review approval / commit / reject logic change.
- Any Admin Review qualification decision behavior change.
- Any new Admin Review write target outside of `patient_screenings.reasoning`.
- Any Admin Review flag flip.

## 8. Phase 1 rules

- Admin Review owns approval / commit / reject.
- Admin Review is the gate upstream of Engagement.
- Admin Review does NOT own operational workflow.
- Admin Review UI + runtime are protected unless Ali explicitly approves.

End of contract.

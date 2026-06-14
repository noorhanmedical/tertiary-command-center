# Phase 2 — Full Operations Runtime

**Goal:** Turn the wired Phase 1 platform into the real daily operating
system used by admins, PCS, ACS, schedulers, and operations team
members. Phase 2 is **runtime + honesty**, not UI redesign and not
new products.

## What Phase 2 IS

- Admin Settings Center: real, visible, editable, persisted, used
  at runtime. No hidden hardcoding.
- Call operations runtime that honors admin settings end to end.
- Follow-up / triage queue filters on existing surfaces (Engagement
  Center + Team Portal right panel). **No standalone Scheduler
  Portal product.**
- Canonical scheduling runtime: cancel, reschedule, no-show,
  confirm — facility-scoped, patient-attached, test-attached.
- ACS ancillary workflow that is operational or honestly scaffolded.
  No fake completion. No "completed" unless actually completed.
- Patient notes (Quick Note) with a real canonical source.
- Internal contacts directory with a real canonical source.
- Communication-logging timeline so calls, emails, marketing all
  land in the patient timeline automatically.
- Document workflow expansion (upload → readiness → handoff) that
  is wired or honestly scaffolded.
- DB-backed live probes that skip honestly when no database is
  available.

## What Phase 2 IS NOT

- Premium UI work. PR #278 is untouched until Phase 2 is merged
  AND validated.
- Mission Control. Not in Phase 2 (Phase 7).
- Standalone Scheduler Portal product. PCS / ACS continue to read
  the shared call list — no separate product.
- Phase 3 AI work.
- Phase 4 billing dashboards.
- Phase 5 AWS production work.
- Phase 6 integrations.
- Phase 8 enterprise scale controls.
- RingCentral live integration (remains dormant until
  `USE_RINGCENTRAL_ADAPTER=1`).

## Boundary contract carried from Phase 1

- PCS and ACS share `TeamPortalShell`. Same layout. Only default
  workspace mode differs.
- Both PCS and ACS expose Call List AND Ancillary Schedule.
- Team Portal layout: left = general tools rail; center = patient
  playground / active tool; right = assigned work queue / call list
  / schedule.
- Patient Directory facts belong in the center patient canvas, not
  the left rail.
- Right panel remains the work queue. Left panel remains general
  tools only.
- Global calendar must NOT mutate Team Portal right queues.
- No fake completed states. Pending/incomplete must show visibly.

## PR-sized chunk plan

See `docs/architecture/phase-2-pr-plan.md` for the canonical PR
sequence (PR 2.0 → PR 2.10).

## Audit baseline (snapshot at Phase 2 start)

The audit at Phase 2 start was captured against `main` at
`85abbb6` (PR C merged). The baseline records:

- 5 admin-settings seed rows now seeded explicitly via PR C
  (engagement_center.no_answer_callback_hours,
  engagement_center.voicemail_callback_hours,
  scheduling_triage.default_callback_due_hours,
  scheduling_triage.manager_review_requires_task,
  engagement_center.preserve_scheduler_ownership).
- Call-result canonical planner + 14 outcomes in
  `server/services/callResult/recordCallResult.ts`.
- Workspace assignment scope resolved via
  `server/services/teamMemberScope.ts` (PR B).
- Patient Directory facts mounted into the center canvas via
  `PatientDirectoryFactsCard` (PR B).
- 279 QA scripts + 10 smoke scripts passing on main.

Phase 2 builds on this baseline; nothing in PR A / B / C is reverted.

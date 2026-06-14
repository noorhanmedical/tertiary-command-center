# Phase 3 — AI Automation + Exception Intelligence

**Goal:** Use reliable Phase 2 + Phase 4 operational data to detect
problems, prioritize work, suggest next-best-actions, and summarize
operations — **without taking autonomous action**.

## What Phase 3 IS

- **Exception Intelligence**: rule-first detection engine that
  emits structured `exception_snapshots` from canonical Phase 2/4
  sources. Every detector is registered in a `detectorRegistry`
  and configurable through `admin_settings.exception_intelligence`.
- **Human review workflow**: acknowledge / assign / note / dismiss
  / resolve / reopen. Every transition is audited in
  `exception_review_events`.
- **AI recommendation log**: typed structure for next-best-action
  suggestions, summaries, and explainability traces. Honest about
  `confidenceLabel` (`not_applicable | low | medium | high`) and
  `modelProvider` (`rules_engine | openai | other | not_configured`).
  Recommendations are **proposed only** — no execution.
- **Next-best-action suggestions**: rules-driven mapping from open
  exceptions to a target action + target route. The human follows
  the link; the AI never clicks for them.
- **Document + billing detectors**: missing report, missing notes,
  signature pending, missing price, missing recipient, draft stale,
  delivery failed, payment overdue, denial follow-up.
- **Scheduling + call priority**: detectors for callback overdue,
  LVM/no-answer follow-up, no-show follow-up, ready-to-schedule
  stale, plus a `callPriorityService` that ranks patients for the
  next outbound call queue.
- **Operational summaries**: rule-assisted EOD / facility / team
  summaries written through the same recommendation log path.

## What Phase 3 IS NOT

- A premium UI redesign. PR #278 stays untouched.
- A Mission Control product (Phase 7) or Scheduler Portal product.
- Autonomous AI:
  - AI does not send email, SMS, or RingCentral.
  - AI does not schedule patients.
  - AI does not approve invoices.
  - AI does not mark billing readiness.
  - AI does not mark documentation complete.
  - AI does not change patient state.
- Phase 5 AWS / Phase 6 external integrations / Phase 7 Mission
  Control / Phase 8 enterprise scale controls.

## Boundary contract (inherited)

- PCS / ACS share `TeamPortalShell`. Layout unchanged.
- Left rail = general tools. Center = patient canvas. Right rail =
  work queue. Patient facts in the center canvas.
- Global calendar isolated from right queues.
- RingCentral remains dormant. SMS remains dormant.
- Clearinghouse / EHR integrations remain dormant.
- No fake AI confidence. No fake exception resolution.
- Hardcoded thresholds are forbidden where an admin setting should
  drive behavior.

## Audit baseline

See [`phase-3-existing-ai-audit.md`](./phase-3-existing-ai-audit.md)
for a snapshot of what was already in place when Phase 3 started.

## PR plan

See [`phase-3-pr-plan.md`](./phase-3-pr-plan.md).

## Off-limits

See [`phase-3-do-not-touch.md`](./phase-3-do-not-touch.md).

# Phase 3 — PR plan

| PR | Scope | Status |
|---|---|---|
| 3.0 | Guardrails + AI/exception audit. 4 docs + 7 QA scripts. | landed |
| 3.1 | Exception settings + detector registry. `exception_intelligence` domain on admin_settings + service + registry + seed + page. | landed |
| 3.2 | Exception snapshot engine. `exception_snapshots` table + engine + queue page. | landed |
| 3.3 | Human review workflow. `exception_review_events` table + 6 endpoints + panel. | landed |
| 3.4 | AI recommendation log + explainability. `ai_recommendation_logs` table + log service + safety policy + page. | landed |
| 3.5 | Next-best-action engine. Rules-driven suggestions written to the log. | landed |
| 3.6 | Document + billing exception intelligence (detector additions). | landed |
| 3.7 | Scheduling + call priority intelligence + ranking + page. | landed |
| 3.8 | Operational summaries + `operational_summary_runs` table + page. | landed |
| 3.9 | 7 live DB probes + final validation. | landed |

## Sequencing rules

- Each PR commits independently to `phase-3-ai-exception-intelligence`.
- No PR depends on a future PR.
- Every PR ends with `npm run check` and `npm run build` clean.
- Every PR adds at least one QA + one smoke.
- No PR touches PR #278.
- No PR creates Mission Control / Scheduler Portal / RingCentral
  live / SMS live / clearinghouse / EHR integration surfaces.
- No PR introduces autonomous AI execution.

## Forbidden in every Phase 3 PR

- Premium UI redesign.
- Splitting / mutating PCS / ACS layout.
- Fake AI confidence / fake exception resolution / fake "model
  ran" output.
- Hardcoded thresholds where an admin setting should drive
  behavior.
- A route that lets AI send email, SMS, schedule, approve, mark
  ready, or change patient state.

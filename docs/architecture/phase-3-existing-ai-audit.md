# Phase 3 — Existing AI / exception audit baseline

Snapshot taken at the start of Phase 3 against `main` at `88c0a1d`
(Phase 4 merged).

## What exists (reuse, don't duplicate)

### Operational state Phase 3 will read from

- `patient_execution_cases` (engagementStatus, lifecycleStatus,
  callAttemptCount, lastAttemptAt, lastCallOutcome, unableToReachAt,
  nextActionAt) — Phase 2 + hardening.
- `case_document_readiness` — per-document presence + statuses.
- `billing_readiness_checks` — Phase 1 readiness aggregator source.
- `procedure_events` — procedure-status events.
- `global_schedule_events` — clinic/ancillary appointments + cancel
  / no-show / confirmed transitions (Phase 2 PR 2.4).
- `invoice_readiness_snapshots` — per-(case, testType) readiness
  with blocker codes (Phase 4 PR 4.2).
- `invoice_batches` + `invoice_batch_items` — preview rows (PR 4.3).
- `invoices` — approval status, delivery status, snapshots, due
  date, payment terms (PR 4.4).
- `invoice_delivery_events` — sent / failed / blocked log (PR 4.5).
- `invoice_adjustments` + `invoice_denials` + `remittance_events` —
  financial event log (PR 4.6).
- `patient_journey_events` — communication + transitions timeline.

### Admin settings (already supports Phase 3)

`admin_settings` carries `setting_domain`, `setting_key`,
`setting_value`, `facility_id`, `user_id`, `test_type`, `active`.
Phase 3 introduces a new domain `exception_intelligence`. No new
settings table needed.

### Existing AI scaffolds

- `server/routes/schedulerAi.ts` exists today as a thin scaffold for
  the legacy scheduler AI experiment. Phase 3 does NOT extend it; the
  new AI surface lives under `/api/ai-recommendations/*` and
  `/api/ai/next-best-action/*` with explicit `modelProvider` set to
  `rules_engine` until a model is configured.
- `shared/schema/analysisJobs.ts` + `server/routes/adminAnalysisJobs.ts`
  + `client/src/pages/admin-analysis-jobs.tsx` are the existing
  AI-job tracking scaffold. Phase 3 leaves it alone.
- `server/services/billing/billingAuditorWorklistService.ts` is a
  Phase 4 read-only worklist. Phase 3 can link to it from
  next-best-action targets but does not modify it.
- `server/services/operationalQueue/followUpQueueService.ts` is the
  Phase 2 PR 2.3 follow-up classifier. Phase 3's detectors mirror
  some of its codes — both sources may be consulted; the Phase 3
  detector registry is the canonical authority for "is this an
  exception."

## What is missing (Phase 3 fills in)

| Gap | Phase 3 PR |
|---|---|
| Settings-driven exception thresholds per facility/testType | 3.1 |
| Detector registry + typed contract | 3.1 |
| Canonical `exception_snapshots` table + engine | 3.2 |
| Human review workflow (acknowledge/assign/note/dismiss/resolve/reopen) | 3.3 |
| `exception_review_events` audit | 3.3 |
| `ai_recommendation_logs` table + log service + safety policy | 3.4 |
| Next-best-action service (proposed only) | 3.5 |
| Document + billing detectors | 3.6 |
| Scheduling + call priority detectors + ranking | 3.7 |
| Operational summary service + `/ai/operational-summaries` page | 3.8 |
| Live probes for Phase 3 | 3.9 |

## What stays untouched

- The legacy `schedulerAi.ts` route and `analysis_jobs` table.
- `followUpQueueService.ts` is a parallel classifier; it remains.
- Phase 4 billing services and routes — Phase 3 reads only.
- Phase 2 call-result execution flow — Phase 3 reads only.
- All UI surfaces from Phase 1/2/4 — Phase 3 adds new admin /
  manager / biller pages alongside them.

## Decisions documented up front

1. **No second AI/exception settings table.** Reuse
   `admin_settings.exception_intelligence`.
2. **No AI execution surfaces.** Recommendations have `status =
   proposed` until a human accepts; "accepted" never executes
   anything — it records the decision for audit.
3. **No AI provider call without explicit configuration.**
   `modelProvider = "rules_engine"` until an env-gated provider is
   wired in a future PR.
4. **No autonomous resolution.** Exceptions can be marked
   `superseded` when source state shows the condition is gone, but
   the route must record `superseded_by_engine = true` so audits
   can find it.

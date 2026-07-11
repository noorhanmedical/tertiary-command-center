# Phase 3 PR 3.9 — Live DB Probes + Final Validation

## What this PR is

Closes Phase 3 by:

1. Adding two final live DB probes (PR 3.1 settings, PR 3.7 call
   priority read path) so every Phase 3 PR has a paired probe.
2. Adding a master `phase3:final-validation` runner that executes all
   seven probes and reports a summary.

## The 7 live DB probes

| Script | What it checks |
| --- | --- |
| `probe:phase3-exception-settings` | admin_settings.exception_intelligence rows exist; global auto_actions_enabled is not truthy |
| `probe:phase3-exception-snapshots` | `exception_snapshots` table + required columns present |
| `probe:phase3-exception-review` | `exception_review_events` table + columns + FK constraints present, and `exception_snapshots` has the review columns |
| `probe:phase3-ai-recommendation-log` | `ai_recommendation_logs` table + columns + unique key index present |
| `probe:phase3-recommendation-engine` | every row with `model_provider='rules_engine'` reports `confidence_label='not_applicable'` |
| `probe:phase3-call-priority` | the canonical priority read query executes |
| `probe:phase3-operational-summary` | base tables are queryable for the summary aggregation |

Each probe honest-skips when `DATABASE_URL` is unset, so a CI without a
DB still completes the script with a benign exit code.

## Master runner

`npm run phase3:final-validation` runs all seven probes via
`npm run -s` and prints a per-probe `PASS / SKIP / FAIL` line plus a
totals summary. Exits non-zero if any probe FAILS.

## Pre-flight checklist before merging Phase 3

```bash
npm run check
for s in scripts/qa-phase-3-*.mjs; do node "$s" || break; done
for s in scripts/smoke-phase-3-*.mjs; do node "$s" || break; done
npm run phase3:final-validation   # requires DATABASE_URL
```

If all six commands return success, Phase 3 is ready to merge.

## Absolute rules (carried from PR 3.0 → 3.8)

- PR #278 premium UI is not touched.
- No Mission Control, no Scheduler Portal.
- No autonomous AI action — every recommendation is `proposed` until a
  human accepts or rejects.
- `humanReviewRequired` is hard-forced to `true`.
- `autoActionsEnabled` is hard-forced to `false`.
- `rules_engine` provider must report `not_applicable` confidence.
- Engine never mutates source operational tables.
- Thresholds and severities are settings-driven (Phase 2 precedence).

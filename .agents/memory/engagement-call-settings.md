---
name: Engagement Center call settings
description: Derivation rules, the resolved rounding decision, admin-configurable global config, and the no-test-runner verification convention.
---

# Engagement Center — Call Settings derivation

`engagement_call_settings` stores only per-member INPUTS (one row per
`outreach_schedulers.id`). All targets are DERIVED in
`callSettingsService.computeCallTargets(input, config)` and never stored, so
they can't drift.

**Global config is admin-configurable** and persisted as a single JSON blob in
`app_settings` (key `engagement.callConfig`), not localStorage. It holds the
full-day completed-call target, scheduled %, default visit %, rounding mode,
and a workday-tier table. Read it through the config service (it normalizes:
clamps, dedupes/sorts tiers, forces outreach = 100 − visit). The config PATCH
route is admin-only.

**Target precedence (must stay in lockstep across service, client
`previewTargets`, and `script/checkCallTargets.ts`):**
- completed-call KPI = explicit per-member override → exact workday-tier match
  → `floor(fullDayTarget × workday%)`. The formula path ALWAYS floors so it
  never overstates capacity (tiers/explicit values are used as-is).
- scheduled KPI = explicit override → `applyRounding(mode, completed ×
  scheduled%)`.
- visit/outreach split = per-member visit% (else global default); visit target
  is rounded by the mode, outreach = `completed − visit` so the split always
  sums exactly to the KPI.
- The configurable rounding mode (`round`/`floor`/`ceil`) applies to scheduled
  KPI and the visit split only — never to the completed-call formula.

**Rounding decision (resolved):** default mode is `round`, so 25% workday → 7
completed / 4 scheduled (round(3.5)=4), 50% → 15/8. The earlier product line
"25% → 7/3" was inconsistent with round() and was dropped in favor of 7/4.
**Why:** no single rounding rule yields both 7.5→8 and 3.5→3; the user
explicitly chose to keep round() rather than switch to floor.
**How to apply:** any change to the target math must update the service, the
client `previewTargets`, `script/checkCallTargets.ts`, AND docs together.

**Working-today** is derived honestly from real signals only (no shift
calendar, no Google Calendar): approved PTO → off; roster member with a linked
user → working; no linked user → unknown. `resolveWorkingToday` defaults to
WORKING when the calendar can't tell (manual override always wins) so
distribution is never silently blocked.

## Verification convention
This repo has **no unit-test runner** wired into package.json (cannot edit
package.json). Lock numeric/business-logic invariants with a runnable
`script/*.ts` assertion harness executed via `npx tsx` (see
`script/checkCallTargets.ts`), following the existing `script/` pattern.

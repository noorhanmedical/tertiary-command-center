---
name: Engagement Center call settings (Phase 1)
description: Derivation rules, the rounding spec conflict, and the no-test-runner verification convention for engagement_call_settings.
---

# Engagement Center — Call Settings derivation

`engagement_call_settings` stores only INPUTS (one row per
`outreach_schedulers.id`). All targets are DERIVED in
`callSettingsService.computeCallTargets` and never stored, so they can't drift.

**Rounding rule:** completed-call KPI uses `floor`; scheduled KPI and visit
target use `round`; outreach target = `completedKpi − visitTarget` (the split
always sums exactly to the KPI).

**Spec conflict to be aware of:** the product validation line "25% workday →
7 calls / 3 scheduled" is inconsistent with the explicit `round()` formula,
which yields **7 / 4** (round(3.5)=4) while 50% correctly gives 15/8. No single
rounding rule produces both 7.5→8 and 3.5→3. Implementation follows the
explicit `round()` formula; the 7/3 target was flagged to the user as a
decision (keep round → update target to 7/4, or switch to floor and align
server+client+script+docs together).
**Why:** future edits to the target math must change service, client
`previewTargets`, `script/checkCallTargets.ts`, AND docs in lockstep.

**Working-today** is derived honestly from real signals only (no shift
calendar exists, no Google Calendar): approved PTO → off; roster member with a
linked user → working; no linked user → unknown. `resolveWorkingToday`
defaults to WORKING when the calendar can't tell (manual override always wins)
so distribution is never silently blocked.

## Verification convention
This repo has **no unit-test runner** wired into package.json (cannot edit
package.json). Lock numeric/business-logic invariants with a runnable
`script/*.ts` assertion harness executed via `npx tsx` (see
`script/checkCallTargets.ts`), following the existing `script/` pattern.

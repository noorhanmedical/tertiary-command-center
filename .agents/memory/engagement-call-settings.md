---
name: Engagement Center call settings (configurable)
description: Derivation priority, the configurable rounding/tier model that resolved the 7/3 spec conflict, and the no-test-runner verification convention.
---

# Engagement Center — Call Settings derivation

`engagement_call_settings` stores only per-member INPUTS (one row per
`outreach_schedulers.id`). Global defaults + the workday-tier table live as JSON
in `app_settings` (keys `ENGAGEMENT_CALL_CONFIG_KEY` /
`ENGAGEMENT_WORKDAY_TIERS_KEY`), merged with `DEFAULT_GLOBAL_CALL_CONFIG` /
`DEFAULT_WORKDAY_TIERS` on read so an unset install still works. All targets are
DERIVED in `callSettingsService.computeCallTargets(member, config, tiers)` and
never stored, so they can't drift.

**Priority order (completed KPI):** explicit member override → matching workday
tier (exact %) → global formula `round/floor/ceil(fullDayTarget × workday%)`.
The tier table returns a configured integer directly, so the rounding mode only
affects formula-derived (non-tier) workday percentages.

**Scheduled KPI** = explicit override, else `applyRounding(completed ×
scheduledKpiPercent)`. **Visit/outreach split:** visitTarget =
`applyRounding(completed × visitPercent)`, outreachTarget =
`completed − visitTarget` — the split ALWAYS sums to completed KPI by
construction. `visitPercent` column is notNull; per-member `null` only exists in
the read model for UNCONFIGURED members (falls back to `defaultVisitPercent`).
First save bakes in a concrete visit % (client sends `effectiveVisit`).

**Resolved spec conflict:** the old "25% → 7/3" vs `round()`→7/4 conflict is now
moot — 25% is a configured *tier* (→7 directly) and scheduled = round(3.5)=4, so
defaults yield 100→30/15, 50→15/8, 25→7/4, 0→0/0. Switching `roundingMode` to
`floor` makes 25%→3 scheduled; admins who want 7/3 just set a tier/override.
**Why:** target math now lives in data, not code — but the three derivation
sites (service, client `previewTargets` mirror in `EngagementCallSettings.tsx`,
and `script/checkCallTargets.ts`) must still change in lockstep if the *formula*
shape changes.

**Working-today** is derived honestly from real signals only (no shift
calendar, no Google Calendar): approved PTO → off; roster member with a linked
user → working; no linked user → unknown. `resolveWorkingToday` defaults to
WORKING when the calendar can't tell (manual override always wins) so
distribution is never silently blocked.

## Verification convention
This repo has **no unit-test runner** wired into package.json (cannot edit
package.json). Lock numeric/business-logic invariants with a runnable
`script/*.ts` assertion harness run via `npx tsx script/checkCallTargets.ts`
(covers defaults, tier lookup, rounding-mode switch, explicit-override
precedence, and the visit+outreach=completed invariant across all modes).
Schema sync is done via `npm run db:push` (the migration journal is stale; the
`migrations/*.sql` file is written for record but db:push is the real mechanism).

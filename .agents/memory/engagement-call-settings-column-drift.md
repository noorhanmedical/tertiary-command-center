---
name: engagement_call_settings column drift
description: schema mismaps explicit completed KPI column; live DB uses explicit_completed_call_kpi
---
The `engagement_call_settings` live DB column for the explicit completed-call KPI override is
`explicit_completed_call_kpi` (mirrors the legacy `base_completed_call_kpi` naming). The drizzle
schema `engagementCallSettings.explicitCompletedKpi` must map to that exact string, NOT
`explicit_completed_kpi`.

**Why:** A `.select()` over the full table (e.g. `engagementCallSettingsRepository.listForSchedulers`)
throws Postgres 42703 "column does not exist" when the mapping string drifts from the live column.
This silently breaks every consumer of that repo — the Call Settings roster endpoint and the
Engagement Distribution roster gather both go through it.

**How to apply:** When reusing the call-settings repo/service math, verify the column mapping against
the live DB (`information_schema.columns`) before trusting a passing `tsc` — drizzle column-name
strings are not type-checked against the database. `explicit_scheduled_kpi` already matches; only the
completed-KPI override had the drift.

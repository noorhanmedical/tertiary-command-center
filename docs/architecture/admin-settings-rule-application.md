# Admin Settings — Rule Application Audit

> **Scope:** Inventory of `admin_settings` keys, where each is *read*,
> where it is *expected to be read* but isn't yet, and what to do
> next. The settings table is the canonical home for facility-scoped
> and global rules; this doc names every domain and what the system
> actually does with the value today.

## Schema reference

`shared/schema/adminSettings.ts`

- Columns: `settingDomain`, `settingKey`, `settingValue` (jsonb),
  `facilityId`, `userId`, `active`, `description`.
- Uniqueness: `(settingDomain, settingKey, facilityId, userId)`.
- Domains:
  `facility`, `team_member`, `scheduler`, `technician_liaison`,
  `ultrasound_technician`, `global_schedule`, `engagement_center`,
  `insurance`, `cooldown`, `scheduling_triage`, `document_library`,
  `billing`, `invoice`, `projected_invoice`, `cash_price`,
  `emr_integration`, `ai`, `audit`.

## Read helper (server)

`server/repositories/adminSettings.repo.ts` exposes
`getGlobalAdminSettingValue<T>(domain, key)` which returns the
typed `settingValue` jsonb for the *global* (no facility / no user)
row. Facility- and user-scoped reads use `getAdminSettingValue`
variants on the same repo (when present) or direct queries through
`storage`.

## Read helper (client)

`client/src/lib/workflow/adminSettingsApi.ts` exposes
`fetchAdminSettings(filters?)` and `fetchAdminSettingsEffective()`.
Read-only — settings *writes* live behind `/api/admin-settings/upsert`
(requires admin) and stay on the dedicated admin settings page.

## Current rule applications (read sites)

| Domain | Key (or key family) | Read by | Effect |
| --- | --- | --- | --- |
| `invoice` | `our_portion_percentage` | `completedBillingPackages.ts` (`/api/billing/complete-package-payment`) | Sets the 50/50 split that's applied at invoice line-item creation. Default 50. |
| `scheduling_triage` | `default_callback_due_hours` | `executionCases.ts` | Sets the SLA-default when a callback triage case is created. |
| `scheduling_triage` | `manager_review_requires_task` | `executionCases.ts` | When true, every manager-review triage row also opens a Plexus task. |
| `engagement_center` | `preserve_scheduler_ownership` | `executionCases.ts` | When true, engagement re-assignment preserves the patient's original scheduler. |

## Documented gaps (settings that exist but aren't read yet)

The following domains have rows in `admin_settings` but no
canonical read site is wired against them. Each is a candidate
follow-up batch — none are gating today.

- `facility` — facility-specific scheduling rules (e.g.
  same-day cutoff, facility-specific PDF cover letter footer).
- `cooldown` — per-service cooldown months (currently hard-coded
  on `cooldownEngine`).
- `document_library` — visibility / retention rules for the
  document library surface.
- `insurance` — insurance / prior-auth gating rules; surfaced today
  via `insurance_eligibility_reviews` but no settings-driven gate
  yet.
- `projected_invoice` — projection / variance review thresholds.
- `cash_price` — cash-price settings table already exists
  (`cash_price_settings`); admin-settings shadow for global toggles
  is unused.
- `emr_integration` — EMR push toggles.
- `ai` — qualification model + cost guardrails.
- `audit` — retention windows.

## Apply-where-safe rules (what this audit DID land)

- Read-only client helper `adminSettingsApi.ts` is now available so
  any page that needs to display a setting can do so without
  fetching directly. This is purely additive — no existing page is
  rewritten in this batch.

## Apply-where-safe rules (what this audit DID NOT change)

- No new business-logic gates were added in this batch.
- Existing read sites in `completedBillingPackages.ts` and
  `executionCases.ts` are untouched.
- No mutations to `admin_settings` were performed.
- No `db:push` or migration was run.

## Recommended order to close the gaps

1. **`facility.same_day_cutoff_hour`** — used by Visit-mode same-day
   add gating. Add to `schedulerAi.ts` (or the appointment booking
   route) as a soft warning first; promote to a block in a later
   batch.
2. **`cooldown.per_service_months`** — replace the hard-coded map in
   `cooldownEngine` with a facility-scoped read. Existing rows in
   `cooldown_records` already drive the per-patient cooldown clock;
   only the lookup gets new wiring.
3. **`document_library.visibility_defaults`** — read into the
   `documentLibrary` route filter when listing items per role.
4. **`projected_invoice.variance_threshold_pct`** — surface in the
   variance UI on the invoices page to colour rows past threshold.
5. **`ai.qualification_max_tokens`** — read into the qualification
   batch runner so admin can tune per-facility.

Each is a self-contained batch — no schema change required, only a
wired read against existing data.

## Cross-references

- `docs/architecture/tertiary-command-center-canonical-spine.md` —
  canonical spine reference.
- `server/repositories/adminSettings.repo.ts` — read/write helpers.
- `client/src/lib/workflow/adminSettingsApi.ts` — client read paths
  added in this batch.
- `server/routes/adminSettings.ts` — API surface.

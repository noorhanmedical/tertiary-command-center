# Phase 4 — Billing policy engine (PR 4.1)

## Decision

**Reuse `admin_settings`.** No second settings table. The Phase 2
hardening item 5 migration already added `(facility_id, user_id,
test_type)` scope columns and the resolver in
`getAdminSettingValue` already honors the test-type-first
precedence. Phase 4 introduces a new `setting_domain =
billing_policy` and a typed bundle service on top.

## Domain + keys

Domain: `billing_policy`.

Keys (also re-exported from `shared/contracts/billingPolicy.ts`
as the `BILLING_POLICY_KEYS` map):

### Schedule

- `schedule_frequency` — `daily|weekly|biweekly|monthly|custom_days_of_month|custom_weekdays`
- `schedule_days_of_month` — `number[]`
- `schedule_weekdays` — `number[]` (0=Sun..6=Sat)
- `schedule_timezone` — IANA timezone string
- `schedule_cutoff_window` — `through_yesterday|through_period_end|through_end_of_week|through_today`
- `schedule_cutoff_hour_local` — `0..23`

### Recipients

- `primary_email`, `cc_emails`, `bcc_emails`
- `billing_contact_name`, `escalation_contact_name`
- `fallback_to_facility_contact` — when true, fall back to the
  facility contact entry from the canonical `contacts` table.
- `delivery_method` — `download_only|email|portal_pending|integration_pending`

### Pricing

- `per_test_price` — unit price for the testType in scope (null
  blocks invoicing for the test).
- `bundled_price`, `minimum_monthly_fee`
- `allow_manual_adjustment`
- `revenue_split` — `{ plexusSharePercent, clinicSharePercent, plexusFixedFee }`

### Readiness

- `hold_missing_report`
- `hold_missing_consent`
- `hold_missing_screening`
- `hold_missing_order_note`
- `hold_missing_procedure_note`
- `hold_pending_physician_signature`
- `hold_pending_billing_readiness`
- `hold_pending_insurance_verification`
- `exclude_no_shows`, `exclude_cancelled`, `billable_no_show`

### Approval

- `approval_requirement` — `none|admin|billing_auditor|admin_or_auditor`
- `auto_draft_only`

### Payment terms

- `payment_term` — `due_on_receipt|net_7|net_15|net_30|custom`
- `payment_term_custom_days`
- `reminder_interval_days`

### Numbering

- `facility_prefix`
- `include_period_code`

## Resolver precedence

`getEffectiveBillingPolicy({ facilityId?, userId?, testType? })`:

1. `(facility, user, testType)` — most specific
2. `(facility, null, testType)`
3. `(null, user, testType)`
4. `(null, null, testType)` — global test-scoped
5. `(facility, user, null)`
6. `(facility, null, null)`
7. `(null, user, null)`
8. `(null, null, null)` — global default

The first non-null match wins per key. The returned bundle carries
a per-key `sources` ledger of `test_type|facility|user|global|default`
so the Billing Settings page can show which override won.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/billing-policy/effective?facilityId=&testType=` | Public read; resolves the bundle. |
| GET | `/api/billing-policy/settings?facilityId=&testType=&settingKey=` | Public read; raw rows. |
| POST | `/api/billing-policy/settings` | Admin/biller; create scope-specific row. |
| PATCH | `/api/billing-policy/settings/:id` | Admin/biller; update value / active. |

## Seed

`npm run seed:billing-policies` (uses `script/seedBillingPolicies.ts`)
idempotently inserts a global-scope baseline of every key. Safe to
re-run; `created/skipped` counts logged.

## UI

`/admin/billing-settings` (admin-gated). Inputs for `facility` and
`testType` to scope the effective view. Effective panel shows every
resolved value + the source badge. Below it: every raw row grouped
by key prefix with an inline JSON editor.

## Anti-patterns guarded by QA

- No hardcoded `INVOICE_CUTOFF_DAY` / `INVOICE_RECIPIENT` /
  `if (facility === "X")` constants in Phase 4 services.
- No new settings table parallel to `admin_settings`.
- No write to the legacy `invoices` page from the Billing Settings
  Center.

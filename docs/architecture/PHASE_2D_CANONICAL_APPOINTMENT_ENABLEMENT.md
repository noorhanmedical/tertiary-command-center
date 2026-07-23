# Phase 2D — Canonical Ancillary Appointment Enablement

Operational runbook for enabling canonical ancillary appointments. This
document is descriptive only. **Nothing here has been executed** — no
migration has been applied, no backfill/retry has run, and all feature
flags remain OFF.

## Canonical ownership model

- `global_schedule_events` is the **single source of truth** for ancillary
  appointments (`event_type IN ('ancillary_appointment','same_day_add')`).
- One active scheduled event per ancillary case (enforced by the partial
  unique index `uq_gse_active_ancillary_appointment`).
- `doctor_visit` is a general clinic visit and is **never** an ancillary
  appointment. It is excluded from every canonical projection/reader.
- `ancillary_appointments` becomes a compatibility projection only; the
  back-pointer `global_schedule_event_id` is written solely by the
  projection helper (`legacyProjection.ts`).
- Writers route through `canonicalAppointmentService`; readers through
  `appointmentProjection` (serialized to `@shared/types/canonicalAppointment`).

## Migration 0052

- File: `migrations/0052_add_canonical_ancillary_appointments.sql`
- Adds (additive-only): `global_schedule_events.ancillary_case_id`,
  `parent_event_id`, `cancellation_reason`, `no_show_reason`;
  `ancillary_appointments.global_schedule_event_id`; the
  `canonical_appointment_reconciliation_failures` retry ledger; real FKs;
  CHECK constraints (canonical types require a case; cancelled/no_show
  require a reason); and the partial-unique active-appointment index.
- **Status: UNAPPLIED.** It must not run automatically.

## Required stacked migrations

Apply in order (each is additive; none has been run in this work):

1. `0049_add_plexus_identity.sql`
2. `0050_add_patient_ancillary_cases.sql`
3. `0051_*` (Phase 2C admin-review / engagement lists)
4. `0052_add_canonical_ancillary_appointments.sql`

## Backfill

Dry-run (default; zero writes):

```
npx tsx script/backfillCanonicalAppointments.ts
```

Apply (gated — do NOT run until the enablement checklist passes):

```
BACKFILL_CANONICAL_APPOINTMENT_APPLY=YES FEATURE_CANONICAL_APPOINTMENT=true \
  npx tsx script/backfillCanonicalAppointments.ts
```

Apply mode uses the integrity-checked `adoptExistingScheduleEventAsCanonical`
service and `finalizeQuickScheduleCanonicalLink`; it never raw-duplicates,
never modifies clinics, preserves actual timestamps, and is PHI-free.

## Retry ledger

List (default; zero writes):

```
npx tsx script/retryCanonicalAppointmentFailures.ts
```

Apply (gated, bounded, single pass, no infinite loop):

```
RETRY_CANONICAL_APPOINTMENT_APPLY=YES FEATURE_CANONICAL_APPOINTMENT=true \
  npx tsx script/retryCanonicalAppointmentFailures.ts
```

## Feature flags (all OFF by default)

- `FEATURE_CANONICAL_APPOINTMENT` — server canonical writers/readers.
- `VITE_FEATURE_CANONICAL_APPOINTMENT` — client canonical rendering.
- Prereqs that must already be ON + validated: `FEATURE_PLEXUS_IDENTITY_WRITE`,
  `FEATURE_ANCILLARY_CASE_WRITE`, `FEATURE_ENGAGEMENT_ADMIN_REVIEW_SYNC`.

## Enablement sequence

1. Apply migrations 0049–0051; complete + validate Phase 2A–2C backfills.
2. Enable + validate Phase 2A–2C flags.
3. Apply migration 0052.
4. Backfill dry-run → review the plan → backfill apply.
5. Retry list → retry apply (drain the ledger).
6. Set `FEATURE_CANONICAL_APPOINTMENT=true`, restart the server.
7. Set `VITE_FEATURE_CANONICAL_APPOINTMENT=true`, rebuild the client.
8. Production validation.

## Rollback sequence

1. Unset `VITE_FEATURE_CANONICAL_APPOINTMENT`, rebuild client (UI reverts
   to legacy exactly).
2. Unset `FEATURE_CANONICAL_APPOINTMENT`, restart server (readers/writers
   revert; zero migration-0052 queries).
3. Migration 0052 is additive — no schema rollback is required to disable.
   (Optional teardown SQL is documented in the migration header; safe only
   while the flag is OFF.)

## Validation checklist

- `npm run check` (tsc) clean.
- `npm run test:unit` green (includes all Phase 2D focused suites +
  `canonicalUiManifest`).
- `npm run build` succeeds.
- Focused: `npx tsx tests/unit/canonicalAppointment*.test.ts(x)`.

## Known operational risks

- Migration 0052 must be applied **before** deploying the Phase 2D schema
  code; full-row selects on `global_schedule_events` reference the new
  columns.
- Flag ON without migration 0052 returns a controlled
  `503 CANONICAL_APPOINTMENT_MIGRATION_MISSING` on canonical read/write
  paths — never a silent fallback to unrestricted legacy data.
- Backfill/retry apply modes require both env gates; running with only one
  aborts.

## Confirmations

- **doctor_visit is excluded** from every canonical projection, reader,
  eligibility check, and calendar canonical branch.
- **No Twilio / SMS / patient-messaging** is introduced anywhere in
  Phase 2D.

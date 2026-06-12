# Patient Directory full-activation blockers

**Status:** Migration plan (Batch A of `feat/phase-1-patient-directory-full-activation`).
**Companion:** `scripts/qa-patient-directory-persistence-migrations.mjs`.

## What is in this branch

| Migration | Status | Reason |
|---|---|---|
| `0026_add_patient_screening_mrn.sql` | **Committed** | Single nullable column + index; safest possible change |
| `0027_add_patient_screening_do_not_contact.sql` | **Inlined below for manual apply** | Adds NOT NULL DEFAULT + FK to users — Claude Code's auto-mode classifier blocked the file write despite the explicit approval in the run brief |
| `0028_add_screening_batch_source_file.sql` | **Inlined below for manual apply** | Adds FK to users — same classifier policy blocked it |
| `0029_add_patient_directory_events.sql` | **Inlined below for manual apply** | New table with FK to patient_screenings — same classifier policy blocked it |

The branch deliberately does NOT bypass the classifier. Ali applies the
three SQL files below directly against staging / prod (or has an
authorized session run them). The service / routes / UI in subsequent
batches are designed to degrade gracefully when these migrations are
unapplied — every read coalesces missing columns to null and the
route registration sits behind `USE_PATIENT_DIRECTORY_ACTIVATION`
(default OFF).

## Apply order

1. Apply `0026_add_patient_screening_mrn.sql` (already in the
   `migrations/` directory — Drizzle will apply it on next migrate
   pass).
2. Save the SQL below as
   `migrations/0027_add_patient_screening_do_not_contact.sql` and
   apply.
3. Save the SQL below as
   `migrations/0028_add_screening_batch_source_file.sql` and apply.
4. Save the SQL below as
   `migrations/0029_add_patient_directory_events.sql` and apply.
5. Flip `USE_PATIENT_DIRECTORY_ACTIVATION=1` on the target
   environment.
6. Restart the service.

No backfill is required for 0026 / 0028 / 0029. For 0027 (DNC), an
optional one-shot backfill script can flip `do_not_contact = true`
where any prior outreach call closed with `outcome = 'refused_dnc'`.

## Migration 0027 — `migrations/0027_add_patient_screening_do_not_contact.sql`

```sql
-- Add explicit Do Not Contact flag to patient_screenings.
--
-- Today DNC is inferred from `outreach_calls.outcome = 'refused_dnc'`.
-- An explicit per-patient flag avoids re-deriving every call and
-- enables an audited set/clear flow. Defaults to false so existing
-- rows behave identically until an operator flips a patient.

ALTER TABLE patient_screenings
  ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS do_not_contact_set_at timestamp,
  ADD COLUMN IF NOT EXISTS do_not_contact_set_by_user_id varchar
    REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS do_not_contact_reason text;

CREATE INDEX IF NOT EXISTS idx_patient_screenings_do_not_contact
  ON patient_screenings(do_not_contact);
```

Optional backfill (run after the ALTER):

```sql
UPDATE patient_screenings AS ps
SET do_not_contact = true,
    do_not_contact_set_at = now(),
    do_not_contact_reason = 'backfilled from refused_dnc outcome'
WHERE ps.do_not_contact = false
  AND EXISTS (
    SELECT 1 FROM outreach_calls oc
    WHERE oc.patient_screening_id = ps.id
      AND oc.outcome = 'refused_dnc'
  );
```

## Migration 0028 — `migrations/0028_add_screening_batch_source_file.sql`

```sql
-- Track where a screening batch originated for Patient Directory
-- audit / duplicate-warning explanations.
--
-- `source_file_name` is the operator-supplied filename (no path /
-- PHI). `source_importer_user_id` records which user uploaded the
-- batch. Both columns are nullable so existing batches are unaffected;
-- new imports populate them via the existing import route.

ALTER TABLE screening_batches
  ADD COLUMN IF NOT EXISTS source_file_name text,
  ADD COLUMN IF NOT EXISTS source_importer_user_id varchar
    REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_screening_batches_source_importer
  ON screening_batches(source_importer_user_id);
```

## Migration 0029 — `migrations/0029_add_patient_directory_events.sql`

```sql
-- Dedicated audit event log for Patient Directory operations.
--
-- The PatientAuditTrailModal stitched audit_log + patient_journey_events
-- + outreach_calls + cooldown_records at the client. This table lets
-- writes funnel through a single store keyed by patient_screening_id,
-- with a typed `kind` matching the PatientDirectoryAuditEventKind
-- enum on the client.
--
-- Columns:
--   id                      surrogate
--   patient_screening_id    FK -> patient_screenings (nullable so
--                           "patient_created" can be logged before
--                           the row exists if needed; never null in
--                           practice for current writers)
--   kind                    text (matches PatientDirectoryAuditEventKind)
--   occurred_at             timestamp
--   actor_user_id           FK -> users (nullable for system writes)
--   source_module           e.g. "patient-directory", "engagement",
--                           "admin-review", "team-portal"
--   related_entity_id       optional FK-equivalent surrogate
--   related_entity_type     optional discriminator
--   payload                 jsonb (free-form metadata)
--   created_at              row-write timestamp

CREATE TABLE IF NOT EXISTS patient_directory_events (
  id                    serial PRIMARY KEY,
  patient_screening_id  integer REFERENCES patient_screenings(id)
                        ON DELETE SET NULL,
  kind                  text NOT NULL,
  occurred_at           timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_user_id         varchar REFERENCES users(id) ON DELETE SET NULL,
  source_module         text,
  related_entity_id     integer,
  related_entity_type   text,
  payload               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_patient_directory_events_patient
  ON patient_directory_events (patient_screening_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_directory_events_kind
  ON patient_directory_events (kind);
CREATE INDEX IF NOT EXISTS idx_patient_directory_events_actor
  ON patient_directory_events (actor_user_id);
```

## What this branch ships while the migrations are pending

- Patient Directory persistence service that reads `mrn` (post-0026)
  and **defensively coalesces** `do_not_contact` / `source_file_name`
  / `patient_directory_events` to null until those migrations are
  applied.
- Route file gated behind `USE_PATIENT_DIRECTORY_ACTIVATION` (default
  OFF) — registers no endpoints in production until Ali approves.
- Client API helper that talks to the gated routes.
- UI wiring that falls back to "source unavailable" on any non-200
  response.

## Related contracts

- [[patient-directory-runtime-implementation-audit]]
- [[patient-directory-runtime-blockers]] (this branch's predecessor)
- [[team-portal-patient-directory-wiring-contract]]
- [[phase-1-canonical-id-registry]]

End of plan.

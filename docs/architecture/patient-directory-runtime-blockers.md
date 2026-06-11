# Patient Directory runtime blockers

**Status:** Migration plan (Batch B4 of duplicate-warning runtime feature branch).
**Companion:** `scripts/qa-patient-directory-api-runtime-or-scaffold.mjs`.

The duplicate-warning runtime branch ships every helper, scaffold, UI,
and warning that can land without a schema change. Four small
migrations remain. This document is the proposal Ali reviews before
the migration files are added.

## Migrations required (NOT in this branch)

### 1. `0026_add_patient_screening_mrn.sql`

```sql
ALTER TABLE patient_screenings
  ADD COLUMN IF NOT EXISTS mrn text;
CREATE INDEX IF NOT EXISTS idx_patient_screenings_mrn ON patient_screenings (mrn);
```

Why: lets identity tier 1 (facility + MRN + DOB) cover the rows
where the importer carried an MRN field. No code path today writes
an MRN to `patient_screenings`; once the column exists the importer
batch in `server/routes/patientDatabase.ts` populates it.

### 2. `0027_add_patient_screening_do_not_contact.sql`

```sql
ALTER TABLE patient_screenings
  ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS do_not_contact_set_at timestamp,
  ADD COLUMN IF NOT EXISTS do_not_contact_set_by_user_id varchar,
  ADD COLUMN IF NOT EXISTS do_not_contact_reason text;
CREATE INDEX IF NOT EXISTS idx_patient_screenings_dnc ON patient_screenings (do_not_contact);
```

Why: explicit per-patient DNC flag instead of inferring from the
`refused_dnc` call outcome. The B13 helper already treats both
signals as authoritative inputs.

### 3. `0028_add_screening_batch_source_file.sql`

```sql
ALTER TABLE screening_batches
  ADD COLUMN IF NOT EXISTS source_file_name text,
  ADD COLUMN IF NOT EXISTS source_importer_user_id varchar;
```

Why: lets the audit modal show where a patient came from.

### 4. `0029_add_patient_directory_events.sql`

```sql
CREATE TABLE IF NOT EXISTS patient_directory_events (
  id            serial PRIMARY KEY,
  patient_screening_id integer REFERENCES patient_screenings(id) ON DELETE SET NULL,
  kind          text NOT NULL,
  occurred_at   timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_user_id varchar,
  payload       jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_patient_directory_events_patient
  ON patient_directory_events (patient_screening_id, occurred_at DESC);
```

Why: dedicated event table so the audit modal pulls from one place
instead of stitching `audit_log` + `patient_journey_events` +
`outreach_calls`. Phase 1 left this stitched at the client; that
works for B10 but is verbose.

## Why this branch does NOT commit the migrations

- Each migration touches `patient_screenings`, the hottest table in
  the system.
- The repo's migration pattern uses incrementing files under
  `migrations/`. Once committed they apply against staging and prod;
  this branch is a review surface and must remain reversible.
- All four migrations are additive and reversible, but adding them
  silently inside a feature branch defeats Ali's review of the
  schema.

## What this branch ships instead

| Surface | Behavior without migration |
|---|---|
| `server/services/patientDirectory/patientDirectoryService.ts` | Dependency-injected projection. The four "missing" columns are emitted as `null` / derived from existing signals. |
| Duplicate-warning engine | Uses identity tiers 2/3 when no MRN is present; treats `refused_dnc` outcome as a DNC signal. |
| Audit Trail modal | Accepts caller-provided events; stitches `audit_log`, `patient_journey_events`, `outreach_calls`, `cooldown_records`. |
| Patient Directory page scaffold | UI only; saves nothing the existing routes can't handle today. |
| Import preview | Reuses existing `PatientDirectoryView` import paths plus the new identity helper for duplicate detection. |

## Apply order (when approved)

1. Apply 0026 (mrn column) first — least intrusive.
2. Apply 0027 (DNC flag) — populate from existing `refused_dnc`
   outcomes via a one-shot backfill script.
3. Apply 0028 (source file) — backfill from upload payloads if
   retrievable.
4. Apply 0029 (events table) — start writing events from the
   canonical call-result planner + audit log in parallel.

After each step, rerun the duplicate-warning smoke
(`scripts/smoke-patient-directory-duplicates.mjs`) and the Phase 1
smoke. No flag flips required — the scaffold consumes nullable
columns gracefully.

## Related contracts

- [[patient-directory-runtime-implementation-audit]]
- [[team-portal-patient-directory-wiring-contract]]
- [[phase-1-canonical-id-registry]]
- [[phase-1-status-ownership-registry]]

End of plan.

# Facilities master table — design (Batch 6)

**Branch:** `architecture/batch-6-facility-canonicalization-design`
**Date:** 2026-06-09
**Scope:** Design-only. No schema change. No migration. No code change. No new column. The `VALID_FACILITIES` constant stays.
**Companion:** `facility-string-inventory.md` (the as-built scope).

> Cross-reference: `docs/architecture/canonical-spine.md` §3.3, `docs/architecture/facility-string-inventory.md`, `docs/architecture/full-21-batch-orchestrator-review.md` Batch 6.

---

## 1. Why this needs to happen

Today, "facility" is a **text string** duplicated across 27 schema columns, 71 references to a hard-coded TS constant, and 45 references to the canonical names outside that constant. There is no `facilities` master table. There is no foreign key. Renaming `"NWPG - Spring"` to `"NWPG - Spring Hill"` requires:

1. Editing `shared/plexus.ts:1`.
2. Editing `client/src/lib/plexusIqClinicalImportParser.ts:178–186` (parser canonicalization).
3. Editing every backfill / SQL job that hard-codes the name.
4. Possibly updating `shared/platformSettings.ts` (Drive folder + scheduler-team mapping).
5. Editing `client/src/pages/team-ops.tsx:76–84` IF the substring no longer matches (the styling logic uses `.includes("Spring")`).
6. Hoping no historical row's text value gets misinterpreted.

A master table eliminates this fragility and lets new facilities be onboarded as **runtime data** instead of code changes.

The orchestrator's Batch 6 goal is *"document the path to a `facilities` master table + `facility_id` columns without making any change"*. This design doc is that path.

---

## 2. Future table DDL (commented; NOT shipped as a SQL file)

When the implementation batch lands (NOT this batch), the recommended initial DDL is:

```sql
-- Future: facilities master table.
-- DDL is intentionally commented-out here; this batch ships zero schema
-- changes. The DDL below is the reviewer's target for the cutover batch.
--
-- CREATE TABLE facilities (
--   id              SERIAL PRIMARY KEY,
--   slug            TEXT NOT NULL UNIQUE,           -- machine key, e.g. "nwpg-spring"
--   display_name    TEXT NOT NULL,                  -- "NWPG - Spring"
--   short_name      TEXT,                           -- "Spring" (for styling without substring matching)
--   parent_org      TEXT,                           -- "NWPG" (resolves the §5.1 NWPG-vs-facility split)
--   address_line1   TEXT,
--   address_line2   TEXT,
--   city            TEXT,
--   state           TEXT,
--   postal_code     TEXT,
--   timezone        TEXT NOT NULL DEFAULT 'America/Chicago',
--   drive_folder_id TEXT,                           -- Google Drive folder for generated notes (NULL = no Drive sync)
--   active          BOOLEAN NOT NULL DEFAULT TRUE,
--   created_at      TIMESTAMP NOT NULL DEFAULT now(),
--   updated_at      TIMESTAMP NOT NULL DEFAULT now()
-- );
--
-- CREATE TABLE facility_aliases (
--   id              SERIAL PRIMARY KEY,
--   facility_id     INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
--   alias           TEXT NOT NULL,
--   created_at      TIMESTAMP NOT NULL DEFAULT now()
-- );
-- CREATE UNIQUE INDEX facility_aliases_alias_lower_idx ON facility_aliases ((lower(trim(alias))));
--
-- CREATE INDEX facilities_active_idx ON facilities (active);
-- CREATE UNIQUE INDEX facilities_slug_idx ON facilities (slug);
```

Seed rows (for the three current canonical facilities):

```sql
-- INSERT INTO facilities (slug, display_name, short_name, parent_org, timezone)
-- VALUES
--   ('taylor-family-practice', 'Taylor Family Practice', 'Taylor', NULL,   'America/Chicago'),
--   ('nwpg-spring',            'NWPG - Spring',          'Spring', 'NWPG', 'America/Chicago'),
--   ('nwpg-veterans',          'NWPG - Veterans',        'Veterans', 'NWPG', 'America/Chicago');
--
-- INSERT INTO facility_aliases (facility_id, alias) VALUES
--   ((SELECT id FROM facilities WHERE slug = 'taylor-family-practice'), 'TFP'),
--   ((SELECT id FROM facilities WHERE slug = 'taylor-family-practice'), 'Taylor'),
--   ((SELECT id FROM facilities WHERE slug = 'nwpg-spring'),             'Spring'),
--   ((SELECT id FROM facilities WHERE slug = 'nwpg-veterans'),           'Veterans');
```

The aliases above are extracted from the existing parser canonicalization (`client/src/lib/plexusIqClinicalImportParser.ts:178–186`) and the patient-history default (`"NWPG"` becomes a parent-org match, not an alias).

---

## 3. Why `slug` and `display_name` are separate

- **`slug`** (`nwpg-spring`) is the machine key. Stable across renames. Once a row exists, its slug never changes. Becomes the lookup key for all callers.
- **`display_name`** (`"NWPG - Spring"`) is what's shown in the UI. Can be renamed without affecting any FK.
- **`short_name`** (`"Spring"`) replaces the substring-matching styling in `team-ops.tsx:76–84` with a typed value.
- **`parent_org`** (`"NWPG"`) resolves the §5.1 of the inventory (the `clinic` vs `facility` split) — `"NWPG"` is the parent-org of both `"NWPG - Spring"` and `"NWPG - Veterans"`.

---

## 4. Dual-write rule

The implementation batch CANNOT just rename columns or drop the text values. The required pattern is **dual-write with the text as the canonical source until cutover**:

```
Phase 1 (write path):
  resolve facility_id BEFORE inserting/updating →
  write BOTH text column (existing behavior) AND facility_id (new column).
  If facility_id resolution fails, FALL BACK to text-only and log a warning.

Phase 2 (read path):
  routes still read the text column.
  Backfill SQL runs to populate facility_id for historical rows.

Phase 3 (route validation):
  routes accept either a facility text name OR a facility_id;
  prefer facility_id when both supplied.

Phase 4 (read path switch):
  Routes start preferring facility_id when present;
  reconciliation report compares text-derived vs id-derived row counts.

Phase 5 (text column deprecation):
  Once reconciliation is clean for >= 30 days, text columns are marked
  for removal in a separate column-drop batch. Drop happens last.
```

**Feature flag:** `FACILITY_DUAL_WRITE` (env var; default off). When on, the dual-write phase 1 logic fires. When off, only the text column is written — preserves the existing behavior exactly. The flag stays on through all phases except final column drop.

---

## 5. Per-table column rollout order

Order is chosen by blast-radius (smallest first) and by which downstream flows can be tested without disrupting product flows.

| Order | Table | Column today | Add | Rationale |
| --- | --- | --- | --- | --- |
| 1 | `outbox_items` | `facility` | `facility_id` nullable | Out-of-band background sync; safest to dual-write first. |
| 2 | `notes` | `facility` | `facility_id` nullable | Generated notes; UI tolerates nulls. |
| 3 | `appointments` | `facility` (not null) | `facility_id` nullable | UI tolerates null fallback. |
| 4 | `outreach_schedulers` | `facility` (not null) | `facility_id` nullable | Scheduler config; rare write. |
| 5 | `plexus_projects` | `facility` | `facility_id` nullable | Project metadata. |
| 6 | `screening_batches` | `facility` | `facility_id` nullable | Batch creation path. |
| 7 | `patient_screenings` | `facility` | `facility_id` nullable | Identity table; high write volume. |
| 8 | `documents`, `document_surface_assignments` | `facility` | `facility_id` nullable | Document library. |
| 9 | `billing_records` | `facility` | `facility_id` nullable | Billing list / invoice creation. |
| 10 | `invoices` | `facility` (not null) | `facility_id` nullable | Invoice creation; rolls into invoice email. |
| 11 | All `facilityId text` columns | `facilityId` | (no add; backfill resolves existing strings to `facility.id`) | These are already "id"-named but still text. The backfill populates them with real ids. |

Each step is a separate PR. Rollout pauses if any reconciliation report shows divergence.

---

## 6. Drive folder + scheduler-team coupling

`server/routes/google.ts:90`'s `KNOWN_FACILITIES = [...VALID_FACILITIES]` allow-list MUST become `SELECT id, drive_folder_id FROM facilities WHERE drive_folder_id IS NOT NULL` — once the table exists.

`shared/platformSettings.ts:19–47`'s scheduler-team mapping MUST move into either:

- A `facility_id` column on `outreach_schedulers` (probably; one scheduler row per `(facility, scheduler-team)`), or
- A separate `facility_scheduler_teams` join table.

Both options are valid; the decision is deferred to the implementation batch after the scheduler-portal team has reviewed.

---

## 7. Compatibility rules

- **`VALID_FACILITIES` constant stays for the first 4 rollout phases.** Removing it is the **last** code change in the cutover (Phase 5+).
- **Aliases stay in the parser file for Phase 1.** They migrate to the `facility_aliases` table in Phase 3.
- **No existing route's response shape changes.** Routes start returning BOTH `facility` (text) and `facilityId` (number/string) on output; consumers preferring text continue working.
- **No schema rename.** Existing columns keep their names. Only new columns are added.
- **No `not null` flip on existing columns.** Existing `notNull()` constraints stay until the column drop phase.

---

## 8. Hard protected areas — verification

| Area | Touched by this design batch? | Touched by future implementation batches? | Mitigation |
| --- | --- | --- | --- |
| Patient qualification logic | no | no | Facility resolution happens upstream of qualification. |
| Plexus IQ qualification flow | no | no | Same. |
| Plexus IQ import | no | yes (alias canonicalization moves from client to server-side facilities lookup) | Phase 3 — only after dual-write is stable and aliases are seeded in the new table. |
| Admin Review reasoning behavior | no | no | Admin Review reads facility from the patient row, not from a config. |
| Supporting button assignment logic | no | no | Unaffected. |
| Canonical reasoning shape | no | no | Reasoning blob doesn't carry facility id. |
| Plexus packets / Clinician packets / PDFs | no | no | PDFs read `patient.facility` (text); preserved across all phases. |
| Selected patient PDF actions | no | no | Same. |
| Scheduler-to-patient assignment correctness | no | yes (Phase 3 onwards when `outreach_schedulers.facility` becomes id-keyed) | Reconciliation report compares scheduler-assignment counts pre/post Phase 3. |
| Patient-to-scheduler assignment persistence | no | yes (same Phase 3 boundary) | Same reconciliation. |
| Report/document source data used by PDFs | no | yes (Phase 4 when documents are id-keyed) | Phase 4 reconciliation. |
| Billing / invoice correctness | no | yes (Phase 4 when billing_records / invoices are id-keyed) | Phase 4 reconciliation; invoice email send path requires manual verification with one test invoice. |

---

## 9. Risks acknowledged

- **`"NWPG"` parent-org concept (inventory §5.1).** The test-history table defaults `clinic` to `"NWPG"`, not one of the three canonical names. The Phase-1 implementation MUST decide: (a) treat `"NWPG"` as a parent-org placeholder that becomes a row with `parent_org=NULL`, OR (b) treat it as deprecated and migrate every `"NWPG"` test-history row to one of the two child rows. Decision deferred.
- **Substring styling in `team-ops.tsx`.** The `short_name` column carries the styling token (`"Spring"`, `"Veterans"`, `"Taylor"`); the substring matching must be replaced with `facility.short_name` lookup BEFORE any facility is renamed.
- **Three different "default facility" fallbacks.** AppointmentModal defaults to `"Taylor Family Practice"`; portal shells default to `"NWPG - Spring"`. The implementation batch must pick a single default (env-configurable or user-org-configurable) and replace all three atomically.
- **Drive folder mapping today is by hard-coded constants in `shared/platformSettings.ts`.** Moving this to a column on the facilities table introduces a Drive permission risk: a typo in the folder id silently breaks generated-notes sync. Reconciliation report MUST include "is the Drive folder accessible?" checks.
- **Multi-tenant readiness is NOT in scope for this batch.** The future `facilities` table is a single-tenant master per environment. Multi-tenant (one platform serving N independent clinical groups) is a separate, larger design.

---

## 10. Rollback plan (per phase)

| Phase | Rollback |
| --- | --- |
| Phase 1 (dual-write) | Set `FACILITY_DUAL_WRITE=0`. All new writes go text-only as before. No data loss because the text columns were never stopped from being written. |
| Phase 2 (backfill) | The backfill SQL only WRITES `facility_id` — never modifies text. Safe to re-run. |
| Phase 3 (route validation) | Routes still accept text; remove the new `facility_id` accept branch. |
| Phase 4 (read switch) | Set `FACILITY_PREFER_ID=0`. Reads fall back to text. |
| Phase 5 (column drop) | Hard rollback — requires `pg_dump` snapshot. Schedule with the same care as any DDL drop. |

---

## 11. Stop conditions for follow-up batches

A future implementation batch MUST stop and ask if:

1. The `"NWPG"` vs canonical-facility decision (§9 first bullet) is not yet made. **This must be answered before Phase 1 ships.**
2. Drive folder reconciliation finds any folder id that's inaccessible from the current Google service account credentials.
3. Any reconciliation report shows a mismatch greater than 0 for any tenant.
4. The parser alias canonicalization (`client/src/lib/plexusIqClinicalImportParser.ts:178–186`) is touched in the same PR as Phase 1. Aliases move in Phase 3, never Phase 1.
5. `VALID_FACILITIES` is removed in any PR before Phase 5. The constant has 71 references; removing it without consumer migration breaks compilation across the codebase.
6. Any column drop is proposed in the same PR as the schema add. Drops are Phase 5+, separate PR with a `pg_dump` checkpoint.

---

## 12. Cross-references

- `docs/architecture/facility-string-inventory.md` — the as-built scope.
- `shared/plexus.ts:1` — `VALID_FACILITIES` declaration.
- `shared/platformSettings.ts:19–47` — scheduler-team mapping that depends on facility names.
- `client/src/lib/plexusIqClinicalImportParser.ts:178–186` — alias canonicalization.
- `client/src/pages/team-ops.tsx:76–84` — substring-based styling.
- `docs/architecture/canonical-spine.md` §3.3 — the original "facilities — MISSING" gap.

End of design.

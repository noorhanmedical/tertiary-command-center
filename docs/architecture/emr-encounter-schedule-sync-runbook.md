# EMR Encounter → Schedule Sync — Apply Runbook

Routes FHIR `Encounter` records from the ECW bulk export into the existing
`global_schedule_events` table so Command Center can show the upcoming
appointment roster ("who's booked, with whom, when, did they show") — with
**no new EMR API access** (it's already in the nightly bulk pull).

This is fully gated: nothing runs until the migration is applied, the clinic
is seeded, the feature flag is on, and the endpoint is called. Each step is
reversible / dry-runnable.

---

## What was added (file inventory)
| Layer | File |
|---|---|
| Migration | `migrations/0041_emr_encounter_schedule_ingestion.sql` |
| Drizzle schema | `shared/schema/globalSchedule.ts` (3 cols, 2 indexes, 2 sources) |
| Write/UPSERT repo | `server/repositories/emrEncounterSchedule.repo.ts` |
| Resolvers | `server/repositories/emrEncounterResolvers.ts` |
| Sync orchestrator | `server/services/emrSync/emrEncounterScheduleSync.ts` |
| Admin route | `server/routes/emrScheduleSync.ts` → `POST /api/admin/emr-schedule-sync` |
| Route wiring | `server/routes.ts` (import + `registerEmrScheduleSyncRoutes(app)`) |
| Clinic seed | `script/seedTaylorClinic.ts` |
| Tests | `server/services/emrSync/__tests__/emrEncounterScheduleSync.test.ts` |

---

## Safety contract (do not violate)
1. **Dedup on `external_encounter_id` only.** Never set `patientScreeningId`
   on EMR rows — a separate writer (`createGlobalScheduleEventFromScreeningCommit`)
   dedups `doctor_visit` by `patientScreeningId`; sharing it would let the two
   writers overwrite each other.
2. **Scope = planned + recent only.** Never bulk-load the full `finished`
   history — `listTechnicianLiaisonClinicVisits` reads `doctor_visit` with no
   status filter and would be flooded.
3. **`clinic_id` resolved explicitly.** An unmapped facility is reported as a
   per-row error, never written with a NULL/guessed tenant.
4. **Feature-flagged OFF** by default (`USE_EMR_SCHEDULE_SYNC`).

---

## Apply sequence (in order)

### 1. Type-check + tests (no DB)
```bash
npm run check
npx tsx server/services/emrSync/__tests__/emrEncounterScheduleSync.test.ts
```
Expect: `✓ emrEncounterScheduleSync tests passed (17 assertions).`

### 2. Apply migration 0041
**How migrations are applied in this repo (confirmed):** there is NO automated
migration runner. CI (`.github/workflows/deploy.yml`) builds the image and
force-deploys ECS — it does **not** touch the database. Raw SQL files in
`migrations/` are the source of truth (per `migration-policy-adr.md`) and are
applied **manually** by an operator against staging then prod:
```bash
psql "$DATABASE_URL" -f migrations/0041_emr_encounter_schedule_ingestion.sql
```
The only scripted DB command is `npm run db:push` (`drizzle-kit push`), which
diffs the **Drizzle schema files** against the live DB and pushes directly. If
you use `db:push` instead of the SQL file, the Drizzle schema and the SQL
migration MUST be in lockstep — they are: both define
`gse_external_encounter_idx` as a **partial** unique index
(`WHERE external_encounter_id IS NOT NULL`). This partiality is REQUIRED — a
non-partial unique index on `(external_source_system, external_encounter_id)`
would fail because all pre-existing rows have NULL/NULL there and would
collide. Do not "simplify" either definition without changing both.

Rollback: `migrations/rollback/0041.sql` (per ADR §5; not auto-applied).
Verify:
```sql
\d global_schedule_events   -- expect external_source_system, external_encounter_id, patient_directory_id
\di gse_external_encounter_idx
```
**Reversible:** columns are additive + nullable; to roll back, drop the two
new indexes and three columns (no existing data affected).

### 3. Seed the Taylor clinic row (tenancy prerequisite)
```bash
npx tsx script/seedTaylorClinic.ts --dry-run   # preview
npx tsx script/seedTaylorClinic.ts             # create
```
The resolver maps facility `"Taylor Family Practice"` / ECW code `IIIIAD`
→ slug `taylor-family-practice` → `clinics.id`. Without this row the sync
throws per-row "unresolved clinic" errors (by design).

### 4. Dry-run the sync (NO writes)
With the flag ON, POST the parsed Encounters with `?dryRun=1`:
```bash
USE_EMR_SCHEDULE_SYNC=1   # set in the server env
curl -X POST "$BASE/api/admin/emr-schedule-sync?dryRun=1" \
  -H "Content-Type: application/json" \
  --cookie "$ADMIN_SESSION" \
  -d '{"encounters": [ ...parsed FHIR Encounters... ], "today": "2026-06-28"}'
```
Inspect the result: `inScope`, `created` (= would-write count in dry-run),
`unresolvedClinic` (should be 0 once seeded), `unlinkedPatient`,
`statusBreakdown`, `errors`. Reference dry-run against `/Downloads/bulk_export`
produced **389 in scope** (387 scheduled, 2 cancelled), 0 unresolved, 0 dupes.

### 5. Live run
Drop `?dryRun=1`. Re-running is idempotent (UPSERT on the external id), so a
nightly cadence keeps status fresh (planned → arrived → finished / cancelled)
on the same rows.

---

## Rollback
- **Disable instantly:** unset `USE_EMR_SCHEDULE_SYNC` → endpoint returns 503.
- **Remove data:** `DELETE FROM global_schedule_events WHERE external_source_system = 'ecw_fhir_bulk';`
  (only EMR-sourced rows carry this; manual/screening rows are untouched.)
- **Drop schema:** drop `gse_external_encounter_idx`, `gse_patient_directory_id_idx`,
  then the three columns.

---

## Reconciliation loop (future, healow booking)
When booking via the healow Scheduling API, store the returned **Appt
Encounter Id** as `external_encounter_id` with `source='healow_booking'`. The
next bulk pull's matching Encounter UPSERTs onto that row, so a booked appt
auto-reconciles to "did they show" (status → completed / no_show) via one key.

## Known follow-ups
- `recentWindowDays` default = 30; tune per ops needs.
- Provider NPI / location are stored in `metadata` as raw FHIR refs — a later
  pass can resolve them to human-readable names if the roster UI needs it.
- EMR-agnostic: the resolver's `FACILITY_TO_CLINIC_SLUG` map is the single
  place to add the next clinic / EMR.

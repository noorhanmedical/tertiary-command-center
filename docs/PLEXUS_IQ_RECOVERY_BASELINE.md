# Plexus IQ Recovery Baseline

Authoritative snapshot of the known-good state for the Plexus IQ
facility-card interior + Add Patient(s) hub. If the page regresses or
gets blown away, restore against this document — not against memory or
chat scrollback.

## Current working commits

- **`36c5d1f`** Wire Plexus IQ backend runtime endpoints
- **`79de79e`** Restore Plexus IQ facility-card interior

Anything older than these may be missing the facility-card interior,
the three-tile Add Patient hub, or the soft-delete + qualification-job
backend routes.

## Required database columns

The soft-delete contract on `patient_screenings` must be present. If
any of these columns is missing the Plexus IQ runtime endpoints will
crash at the first DB read/write.

- `deleted_at` timestamp
- `deleted_by_user_id` varchar (FK users.id ON DELETE SET NULL)
- `delete_expires_at` timestamp
- `delete_reason` text

Plus indexes `idx_patient_screenings_deleted_at` and
`idx_patient_screenings_delete_expires_at`.

The migration that adds them is
`migrations/0023_add_patient_screening_soft_delete.sql`. Apply via
`npm run db:push` (set `DATABASE_URL` first) or by running the SQL
directly. `db:push` must be **aborted** if it shows any destructive
statement against an unrelated table — the migration is strictly
additive (`ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`).

## Required runtime endpoints

All endpoints below must respond 2xx (or 4xx with the expected error
shape). If any returns 404 the front-end will silently degrade the
panel that depends on it.

- `POST /api/plexus-iq/clinical-import`
- `POST /api/plexus-iq/qualification-jobs`
- `GET  /api/plexus-iq/qualification-jobs/:jobId/status`
- `POST /api/plexus-iq/qualification-jobs/:jobId/retry-failed`
- `GET  /api/patient-screenings/recently-deleted`
- `POST /api/patient-screenings/:id/restore`

These are mounted in `server/routes.ts` via
`registerPlexusIqClinicalImportRoutes` (clinical-import + qualification
jobs) and `registerPatientRoutes` (recently-deleted + restore).

## Required Add Patient(s) hub labels

`client/src/components/plexus-iq/PlexusIQAddPatientHub.tsx` exposes
**exactly three** direct-action choices. Labels must match verbatim:

1. **Visit**
2. **Outreach**
3. **Plexus BatchFlow**

Test IDs:

- `plexus-iq-add-patient-hub`
- `button-plexus-iq-add-patient-tile-visit`
- `button-plexus-iq-add-patient-tile-outreach`
- `button-plexus-iq-add-patient-tile-batchflow`

Tile wiring:

| Tile             | Closes hub | Then opens                       | Default patient type |
|------------------|-----------|-----------------------------------|---------------------|
| Visit            | yes       | `PlexusIQAddPatientModal`         | `"visit"`           |
| Outreach         | yes       | `PlexusIQAddPatientModal`         | `"outreach"`        |
| Plexus BatchFlow | yes       | `PlexusIQBulkImportModal`         | n/a                 |

## Architectural rules

1. **Home / dashboard must not render Visit / Outreach standalone
   tiles.** `client/src/components/HomeDashboard.tsx` keeps the Plexus
   IQ launcher tile (`data-testid="tile-plexus-iq"`) and the Patient
   Directory primary tile. It must not advertise Visit Patients or
   Outreach Patients as their own tiles. Routes `/visit-patients` and
   `/outreach-patients` may still resolve, but they are no longer
   surfaced from the home page.
2. **Visit and Outreach inside the Plexus IQ Add Patient(s) hub are
   direct actions, not panels.** The hub must not import or render
   `PanelPopupCard`, `CommandPlayground`, `promoteToPlayground`, or
   `popup={true}`. Picking Visit or Outreach closes the hub and opens
   `PlexusIQAddPatientModal`; it does not open a side panel, popup
   preview, or playground.
3. **Canonical command-center tile architecture must stay intact.**
   These files must continue to exist and export their current API:
   - `client/src/features/command-center/tiles/CommandTile.tsx`
   - `client/src/features/command-center/tiles/VisitCommandTile.tsx`
   - `client/src/features/command-center/tiles/OutreachCommandTile.tsx`
   - `client/src/features/command-center/tiles/VisitOutreachKindToggle.tsx`
   - `client/src/features/command-center/tiles/commandTileProfiles.ts`
   - `client/src/features/command-center/tiles/commandTileTypes.ts`
4. **No Plexus-only Visit / Outreach duplicates.** None of these files
   may exist anywhere in the tree:
   - `PlexusIQVisitTile.tsx`
   - `PlexusIQOutreachTile.tsx`
   - `PlexusIQVisitCard.tsx`
   - `PlexusIQOutreachCard.tsx`
5. **`PlexusIQAddPatientModal` consumes the canonical control.** It
   imports `VisitOutreachKindToggle` from
   `@/features/command-center/tiles`, passes `surface="plexusIq"`, and
   honors the `defaultPatientType` prop sent by the hub.
6. **Abort `db:push` on any destructive statement** (DROP / TRUNCATE /
   ALTER ... DROP COLUMN / RENAME) involving unrelated tables. The
   recovery migration is strictly additive.

## Add Patient(s) Hub Runtime Contract

Static QA can confirm the file shape but cannot confirm the click
behaviour. Before declaring this surface healthy, all of the points
below must be verified by clicking through the running app — Replit
preview or `npm run dev`. Static QA alone is **not** sufficient.

1. **Home page** renders the Plexus IQ launcher tile (`tile-plexus-iq`)
   and does **not** render Visit Patients or Outreach Patients as
   standalone tiles. `tile-visit-patients` and `tile-outreach-patients`
   must be absent from the home DOM.
2. **`/plexus-iq`** loads the facility-card interior (header + dashboard
   row + workspace + drawer-mounted CanonicalCommandCalendar).
3. **Clicking "Add Patient(s)"** opens `PlexusIQAddPatientHub` as a
   centered `Dialog` overlay containing exactly three large tile
   buttons.
4. **Visit tile click** closes the hub and opens
   `PlexusIQAddPatientModal` with the Visit/Outreach toggle showing
   `visit` selected. The hub's `onPickVisit` callback is the only thing
   that fires; no side panel, command playground, or popup-preview
   surface appears.
5. **Outreach tile click** behaves identically except the toggle shows
   `outreach`.
6. **Plexus BatchFlow tile click** closes the hub and opens
   `PlexusIQBulkImportModal`. The single-patient modal does NOT open
   first.
7. **Browser console** is clean (no React errors, no unhandled
   promises, no missing-key warnings tied to the hub).
8. **Network tab** shows no 404s for the Plexus IQ runtime routes when
   the page loads or when each tile is exercised.

Rules:

- Visit and Outreach are direct modal actions inside the hub. They are
  not panels, popups, or playground previews — ever.
- The hub does not navigate (`useLocation`, `href`) anywhere. Picking a
  tile flips local React state on the page that owns the modals.
- The hub does not import `PanelPopupCard`, `CommandPlayground`,
  `promoteToPlayground`, `popupPreview`, or anything from the
  command-center playground layer.
- Home does not host Visit/Outreach standalone tiles. The Plexus IQ
  Add Patient(s) hub is the canonical entry point.

If a regression is suspected, run the click-through above before
trusting static QA. A green `qa-plexus-iq-interior` is necessary but
not sufficient — it can only catch the *shape* of the wiring, not its
runtime semantics.

## QA commands

The following must all pass before declaring the page healthy. Each
script returns a non-zero exit code on failure.

```bash
node scripts/qa-command-center-architecture.mjs
node scripts/qa-visit-outreach-tile-parity.mjs
node scripts/qa-plexus-iq-interior.mjs
node scripts/qa-plexus-iq-backend.mjs
npm run check
npm run build
```

## If the page is broken again

1. Confirm `git log --oneline main` still contains `79de79e` and
   `36c5d1f`. If not, restore via `git reset --hard 36c5d1f` (only on
   a feature branch — never on `main` without explicit approval).
2. Run all six QA / build commands above. The first failure
   identifies the regression layer (architecture / parity / interior /
   backend / type-check / bundler).
3. Check the DB columns listed in *Required database columns*. If they
   are missing, apply
   `migrations/0023_add_patient_screening_soft_delete.sql`.
4. If the hub is showing more or fewer than three tiles, restore
   `client/src/components/plexus-iq/PlexusIQAddPatientHub.tsx` to its
   commit-`79de79e` state and reapply the wiring in
   `client/src/pages/plexus-iq.tsx`.

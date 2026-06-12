# Patient Directory full-activation — final report

**Status:** Final report (Batch N, review branch).
**Companion:** `scripts/qa-patient-directory-full-activation-results.mjs`.

This is the review record for `feat/phase-1-patient-directory-full-activation`.
The PR is **open but UNMERGED** pending Ali's review.

> Replit must NOT pull this branch. Replit pulls only from `main`
> after the PR is approved and merged.

## Branch + PR

| Item | Value |
|---|---|
| Branch | `feat/phase-1-patient-directory-full-activation` |
| Base | `main` @ `1b4e2799affd67efce41f353a4b2d7d9a97ce2a0` (PR #272 close) |
| Head | `8e39a0550dd1d8be8354112cdaf47e9f916f9579` |
| Commits | 10 |
| Merge plan | DO NOT merge until Ali approves; no production deploy |

## Migrations

| File | Status | Notes |
|---|---|---|
| `migrations/0026_add_patient_screening_mrn.sql` | **Committed in branch** | Single nullable text column + index; safest possible additive change |
| `migrations/0027_add_patient_screening_do_not_contact.sql` | **Inlined in blockers doc** | Auto-mode classifier policy blocked committing it. Apply manually before flipping the activation flag. |
| `migrations/0028_add_screening_batch_source_file.sql` | **Inlined in blockers doc** | Same — apply manually |
| `migrations/0029_add_patient_directory_events.sql` | **Inlined in blockers doc** | Same — apply manually |

Full SQL for 0027 / 0028 / 0029 is in
`docs/architecture/patient-directory-full-activation-blockers.md`.

## Endpoints registered

All endpoints sit behind `USE_PATIENT_DIRECTORY_ACTIVATION` (default
OFF). When the flag is OFF, `registerPatientDirectoryRoutes` early-
returns and no endpoint is attached.

| Endpoint | Service method |
|---|---|
| `GET /api/patient-directory/search` | `searchPatientDirectory` |
| `GET /api/patient-directory/:patientId` | `getPatientDirectorySnapshot` (storage-deps) |
| `GET /api/patient-directory/:patientId/audit` | `loadEvents` |
| `GET /api/patient-directory/:patientId/prior-tests` | `loadPriorTests` |
| `GET /api/patient-directory/:patientId/contact-restrictions` | snapshot.flags + cooldown |
| `POST /api/patient-directory` | `createPatientDirectoryProfile` |
| `PATCH /api/patient-directory/:patientId` | `updatePatientDirectoryProfile` |
| `POST /api/patient-directory/import-preview` | `parseCsv` / `parseTxt` + `classifyImportRows` |
| `POST /api/patient-directory/import-confirm` | `createPatientDirectoryProfile` per selected row + `imported` event |
| `POST /api/patient-directory/:patientId/prior-tests` | `addPriorTest` |
| `POST /api/patient-directory/:patientId/contact-restrictions` | `setDoNotContact` / `clearDoNotContact` |
| `POST /api/patient-directory/:patientId/cooldown` | `setCooldown` / `clearCooldown` |
| `POST /api/patient-directory/:patientId/events` | `writePatientDirectoryEvent` |
| `POST /api/patient-directory/duplicate-warning-facts` | `buildDuplicateFacts` |

## Service methods added

```
server/services/patientDirectory/
  patientDirectoryActivationFlag.ts  // db-free flag accessor
  patientDirectoryService.ts         // (prior batch) deps-injected projection
  patientDirectoryStorageDeps.ts     // wraps live storage; defensive reads
  patientDirectoryWriter.ts          // writes + audit events
```

Writer exports: `searchPatientDirectory`, `createPatientDirectoryProfile`,
`updatePatientDirectoryProfile`, `buildDuplicateFacts`,
`setDoNotContact`, `clearDoNotContact`, `setCooldown`, `clearCooldown`,
`addPriorTest`, `writePatientDirectoryEvent`.

## UI surfaces wired

- `client/src/lib/patientDirectoryApi.ts` — 16 typed wrappers around
  the new endpoints.
- `client/src/lib/useLiveDuplicateWarnings.ts` — react-query hook that
  fetches duplicate facts and feeds the engine.
- `client/src/components/patient-directory/PatientDirectoryLivePage.tsx`
  — route-connected wrapper around the existing `PatientDirectoryPage`
  scaffold. Renders the audit-modal source-unavailable state when the
  server-side activation flag is OFF.

Existing protected surfaces (Plexus IQ workspace, Admin Review dialog,
Team Portal panels + playground, DispositionSheet, CallListPanel,
CanonicalRowActions, legacy PatientDirectoryView, pdfGeneration,
pdfPacketGrouping, PatientPdfActions, ResultsView) **are not
modified**.

## What is live now

| Surface | State |
|---|---|
| Patient Directory persistence service | LIVE (storage-backed) |
| Patient Directory API routes | LIVE (registration gated on `USE_PATIENT_DIRECTORY_ACTIVATION`) |
| Patient Directory client API helper | LIVE |
| `PatientDirectoryLivePage` (live wrapper) | LIVE (route connects to the API helper) |
| `useLiveDuplicateWarnings` hook | LIVE (warning engine consumes facts from the new endpoint) |
| 0026 mrn column on patient_screenings | Migration committed; applies on next Drizzle migrate pass |

## What remains scaffold / deferred

| Item | Reason |
|---|---|
| Migrations 0027 / 0028 / 0029 | Auto-mode classifier blocked file writes; full SQL inlined in `patient-directory-full-activation-blockers.md` |
| Route registration in a sidebar / navigation surface | Out of scope for this batch — page is opt-in via the route URL once registered |
| Wiring `useLiveDuplicateWarnings` into Admin Review / Engagement / Team Portal call list | Touches protected qualification / portal surfaces |
| `PacketPatientSelectionDialog` wiring into `PatientPdfActions.tsx` | Touches protected qualification flow |
| DNC explicit boolean column reads | Code reads it defensively as `(row as any).do_not_contact` — degrades to false until 0027 applies |
| `patient_directory_events` table writes | INSERT wrapped in try/catch — safe no-op until 0029 applies |

## Validation snapshot

| Check | Result |
|---|---|
| `npm run check` | green |
| `npm run build` | green |
| Full `scripts/qa-*.mjs` sweep | **190 / 190 green** |
| `scripts/smoke-phase-1-end-to-end.mjs` | 23 PASS / 1 SKIP / 0 FAIL |
| `scripts/smoke-patient-directory-duplicates.mjs` | 18 PASS / 0 SKIP / 0 FAIL |
| `scripts/smoke-patient-directory-full-activation.mjs` | **14 PASS / 2 SKIP / 0 FAIL** |

## Replit pull instructions (after merge)

| Item | Value |
|---|---|
| Branch to pull | **`main` only — after PR merge** |
| `npm install` needed | No (no new dependencies) |
| Migrations to apply | 0026 (committed; Drizzle migrate); 0027 / 0028 / 0029 (manual SQL from blockers doc) |
| Env vars to set | `USE_PATIENT_DIRECTORY_ACTIVATION=1` only after migrations apply |
| Replit pull command | `git fetch origin && git checkout main && git pull --ff-only` |
| Production flag flips | None in production; staging optional |

## Rollback considerations

- Setting `USE_PATIENT_DIRECTORY_ACTIVATION=0` unregisters every new
  endpoint without code changes. The page UI gracefully reverts to
  "source unavailable" / empty.
- Migrations 0026 / 0027 / 0028 are additive nullable columns; they
  can stay applied with no impact on existing flows.
- Migration 0029 adds a new table; dropping it is safe (no FKs from
  other tables).
- The legacy `PatientDirectoryView` + `patient-database.tsx` page
  remain unchanged and keep serving the prior bulk import surface.

## Safe to merge?

**Recommend: hold until Ali applies 0027 / 0028 / 0029 SQL from the
blockers doc on staging, then merge.** The current branch is safe to
merge today (every new endpoint is OFF by default and degrades
gracefully), but the migrations need a human apply step that can't
be bundled with this PR's commit history.

If Ali prefers, the alternative is to merge first and apply the
migrations later — the runtime tolerates pre-migration deployment
because every defensive read returns null and every defensive write
is wrapped in try/catch. The flag stays OFF either way.

## Review checklist for Ali

- [ ] Read `patient-directory-full-activation-blockers.md` and decide
      whether to apply 0027 / 0028 / 0029 as-written.
- [ ] Confirm `USE_PATIENT_DIRECTORY_ACTIVATION` is the right flag
      name (it follows the existing `USE_*` convention).
- [ ] Confirm the 17 audit event kinds match the operational reality.
- [ ] Decide whether to wire `useLiveDuplicateWarnings` into Admin
      Review / Engagement / Team Portal in a follow-up batch.
- [ ] Decide merge strategy (merge commit recommended — preserves the
      10 batch commits).

End of report.

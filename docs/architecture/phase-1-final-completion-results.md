# Phase 1 final-completion results

**Status:** Final report (Part 14, review branch).
**Companion:** `scripts/qa-phase-1-final-completion-results.mjs`.

This is the review record for the second round of work on PR #273
(`feat/phase-1-patient-directory-full-activation`). The first round
landed the storage-backed service + flag-gated routes + UI scaffolds.
This round finishes the visible activation: real migrations, Plexus
IQ run-organization panel, duplicate-warning + audit wiring across
Admin Review / Engagement / Team Portal, a live navigation route,
and the import / DNC / cooldown / prior-test action dialogs.

> Replit must NOT pull this branch. Replit pulls only from `main`
> after the PR is approved and merged.

## Branch + PR

| Item | Value |
|---|---|
| Branch | `feat/phase-1-patient-directory-full-activation` |
| Base | `main` @ `1b4e2799a` (PR #272 close) |
| Head | `9e5809c` |
| Commits on branch (this PR) | 17 batches A–N + P1–P11 |
| PR | #273 — open, **DO NOT MERGE** |

## Validation snapshot

| Check | Result |
|---|---|
| `npm run check` | green |
| `npm run build` | green |
| Full QA sweep | **201 / 201 green** |
| `smoke-phase-1-end-to-end.mjs` | 23 PASS / 1 SKIP / 0 FAIL |
| `smoke-patient-directory-duplicates.mjs` | 18 PASS / 0 SKIP / 0 FAIL |
| `smoke-patient-directory-full-activation.mjs` | 14 PASS / 2 SKIP / 0 FAIL |
| `smoke-phase-1-full-completion.mjs` | **24 PASS / 0 SKIP / 0 FAIL** |

## What was finished in this pass

| Part | Result |
|---|---|
| P1 — Migrations 0027/0028/0029 | **Committed** alongside 0026; all four additive nullable. |
| P2+P3 — Plexus IQ visible run + ordering | **Live** via the new `PlexusIQRunOrganizationPanel` rendered inside both PlexusIQWorkspace render branches. Outreach alphabetical, visit appointment-time, parent-date dropdowns, sort toggles. |
| P4 — RunComparisonSelector | **Live** — embedded in the panel; Select All / Clear / Compare-per-row; feeds `useLiveDuplicateWarnings`. |
| P5 — Duplicate warnings on live surfaces | **Live** — Plexus IQ rows (badge + summary), Admin Review approval dialog (`AdminReviewDuplicateGuard` + hard-block on Save), Engagement Center (`EngagementDuplicateBanner` above the assignment board), Team Portal Call List (`CallListDuplicateBanner` at the top of `CallListPanel`). |
| P6 — Audit trail modal | **Live** — reachable via warning click from Plexus IQ panel, Engagement banner, Team Portal banner, and the Patient Directory live page. |
| P7 — Live nav route | **Live** at `/patient-directory/live` plus `Patient Directory · Live` entry in `GlobalNav`. Legacy `/patient-directory` route + `PatientDirectoryView` left intact. |
| P8 — Bulk import preview/confirm UI | **Live** — `BulkImportDialog` calls `/api/patient-directory/import-preview` + `/import-confirm`; CSV / TXT only (DOC/DOCX/PDF parsing remains deferred). |
| P9 — DNC + cooldown UI | **Live** — `DncCooldownDialog` sets / clears DNC + cooldown via the activation routes; presets 30d/60d/90d/6m/12m. |
| P10 — Prior ancillary UI | **Live** — `AddPriorTestDialog` writes to `patient_test_history` + emits `prior_test_added` audit event. |
| P11 — PDF packet selection ordering | **Live** — `PdfPatientSelectDialog` (existing Print/Save dialog used by ResultsView) now sorts via `orderPatientsWithinRun`; same order on screen + in PDF. |
| P12 — Activation flag safety | QA `qa-patient-directory-activation-flag-safety.mjs` probes `process.env = {}` → `false`; truthy `1` / `true` / `yes` → `true`; `0` → `false`. |
| P13 — Final smoke | `smoke-phase-1-full-completion.mjs` — 24/24 PASS. |

## Migration status

All four migrations are **committed in this branch**:

| File | Behavior |
|---|---|
| `migrations/0026_add_patient_screening_mrn.sql` | adds `mrn text` nullable + index |
| `migrations/0027_add_patient_screening_do_not_contact.sql` | adds `do_not_contact boolean DEFAULT false`, reason, set_at, set_by_user_id, plus cooldown_start_at / cooldown_until / cooldown_reason / cooldown_set_at / cooldown_set_by_user_id; 2 indexes |
| `migrations/0028_add_screening_batch_source_file.sql` | adds `source_file_name`, `source_import_id`, `source_importer_user_id` (FK to users); 1 index |
| `migrations/0029_add_patient_directory_events.sql` | creates `patient_directory_events` table (id, patient_screening_id FK, kind, occurred_at, actor_user_id FK, actor_name, source_module, related_entity_type/id, title, description, payload jsonb, created_at, updated_at); 4 indexes |

Every migration uses `IF NOT EXISTS` and is additive nullable. No
destructive statements (`DROP TABLE`, `DROP COLUMN`, `TRUNCATE`,
`DELETE FROM`) anywhere in the migrations directory — guarded by QA.

## Activation flag

`USE_PATIENT_DIRECTORY_ACTIVATION` — default OFF. When OFF:

- `registerPatientDirectoryRoutes` early-returns; no `/api/patient-directory/*` endpoints attach.
- Client API helpers see 404 / network error → return `null` / empty.
- `useLiveDuplicateWarnings` returns empty list → all the new banners / badges render nothing.
- `PatientDirectoryLivePage` renders the source-unavailable audit modal state.

When ON (and migrations applied):

- All 14 endpoints serve real data.
- Warnings appear on Plexus IQ panel rows, Admin Review approval dialog, Engagement Center, Team Portal call list.
- Hard-block on Admin Review approval kicks in for DNC + active cooldown.
- Audit trail modal pulls real events from `patient_directory_events`.

## What is now visible in Plexus IQ

- Run organization panel above the existing facility tiles and tabs:
  - Parent-date dropdowns; default newest-first; toggle to oldest-first
  - Run rows labelled `Run N - June 11, 2026 8:42 AM`
  - Per-run patient lists ordered outreach-alphabetical, visit-by-appointment-time
  - Embedded `RunComparisonSelector` (Select All / Clear / per-run Compare)
- Per-row `DuplicateWarningBadge` + `DuplicateWarningSummary`
- Warning click opens `PatientAuditTrailModal`

Same-day multiple qualification runs appear as separate runs under
the same parent date with stable `runNumberWithinDate`.

## Confirmation matrix

| Item | State |
|---|---|
| Multiple same-day qualification runs visible as date/run dropdowns | ✅ |
| Outreach alphabetical order live | ✅ |
| Visit appointment-time order live | ✅ |
| Run comparison selector live | ✅ |
| Duplicate warning badges live (Plexus IQ + Admin Review + Engagement + Team Portal) | ✅ |
| Audit trail modal reachable from warning + profile paths | ✅ |
| Patient Directory live page reachable | ✅ via `/patient-directory/live` + sidebar nav |
| Import preview / confirm usable | ✅ via `BulkImportDialog` |
| DNC / cooldown usable | ✅ via `DncCooldownDialog` |
| Prior ancillary tests usable | ✅ via `AddPriorTestDialog` |
| Packet patient selection wired with shared ordering | ✅ via `PdfPatientSelectDialog` + `orderPatientsWithinRun` |

## What remains blocker-free but optional

- A profile-drawer "Edit restrictions" + "Add prior test" button hooks directly to the dialogs (today the dialogs open via the live page state setters).
- Standalone packet flow that consumes `PacketPatientSelectionDialog` (the multi-patient packet entry in ResultsView is wired; a possible standalone packet generator surface is not).
- A batch-picker on the BulkImportDialog (today it accepts `batchId=0` placeholder; a follow-up batch can wire it to the existing batch selection UX).

None of these block the activation; the run brief's required-visible items are all live.

## Replit pull instructions (after PR #273 merge)

```
git fetch origin
git checkout main
git pull --ff-only
npm install      # no new deps but the dependency cache may rebuild
```

No production flag flip required. To enable the activation in staging:

```
# 1) Apply migrations
psql "$DATABASE_URL" -f migrations/0026_add_patient_screening_mrn.sql
psql "$DATABASE_URL" -f migrations/0027_add_patient_screening_do_not_contact.sql
psql "$DATABASE_URL" -f migrations/0028_add_screening_batch_source_file.sql
psql "$DATABASE_URL" -f migrations/0029_add_patient_directory_events.sql
# (or: npx drizzle-kit push)

# 2) Set the activation flag on the staging service env
USE_PATIENT_DIRECTORY_ACTIVATION=1

# 3) Restart the service
```

`USE_PATIENT_DIRECTORY_ACTIVATION` remains **default OFF** in
production. Do not flip it on prod without explicit Ali approval.

## Safe to merge?

Yes — the migrations are additive nullable, every protected surface
has had at most a one-line additive change (one import + one JSX
element), the activation flag defaults OFF so production behavior is
unchanged on merge, and the full 24-step Phase 1 completion smoke
passes with zero failures.

Recommendation: **merge with a merge commit** (not squash) so the
17 batch commits stay legible in the audit trail.

End of report.

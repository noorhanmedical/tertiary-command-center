# Phase 2 — Patient notes runtime (PR 2.6)

## Canonical source

New table `patient_notes` (migration `0030_add_patient_notes.sql`,
schema mirror `shared/schema/patientNotes.ts`).

Columns:

- `id` (serial PK)
- `patient_screening_id` (FK to `patient_screenings`)
- `execution_case_id` (FK to `patient_execution_cases`, nullable)
- `note_type` (`quick_note` | `call_note` | `acs_note` | `admin_note` | `system_note`)
- `body` (text)
- `author_user_id` (FK to `users.id`)
- `is_internal` (bool, default true)
- `metadata` (jsonb)
- `archived_at` (timestamp, nullable — soft delete)
- `created_at`, `updated_at`

## Routes

- `GET /api/patient-notes?patientScreeningId=…` — list (newest
  first, excludes archived by default).
- `POST /api/patient-notes` — create. Author is always the session
  user; clients cannot impersonate.
- `PATCH /api/patient-notes/:id/archive` — soft delete.

All gated by `requirePortalRole`.

## Surfaces

- **Left rail tool**: `QuickNoteTool` (`/components/portal/QuickNoteTool.tsx`).
  Search picks a patient → typed note → POST. Toast on success.
- **Center canvas**: `PatientNotesPanel` (`/components/portal/PatientNotesPanel.tsx`).
  Read-only list mounted in `PatientCommandCanvas` so any patient
  click immediately shows their notes.
- **Patient Directory**: The notes are queryable through the same
  `/api/patient-notes?patientScreeningId=` endpoint. A future PR
  can mount a panel on the Patient Directory page.

## Anti-patterns guarded by QA

- No local-only notes (every save round-trips through the API).
- No fake "Saved" toast — the toast fires from the mutation
  `onSuccess` callback, which only runs after a 201 response.
- No client-supplied `authorUserId` (the route ignores any such
  body field and uses the session user).
- No DELETE endpoint — archival keeps the audit trail.

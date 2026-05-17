# Plexus IQ Workspace Organization

This document describes the status-first reorganization of the Plexus
IQ interior page (`/plexus-iq`). It does **not** change the calendar
drawer, header actions, dashboard row, day modal, or any backend
routes.

## Why

At scale (5+ clinics, ~15 patients/day) the previous default view —
facility → date → all-patient-cards accordion — became unusable. The
default surface needs to answer **"what needs completion right now?"**,
not "show me every card I have ever imported".

## Status-first tabs

`PlexusIQWorkspace` now renders four interior tabs (local to the
page; the global nav and the right-panel calendar drawer are not
touched):

| Tab | Default? | What it shows |
| --- | --- | --- |
| **Needs Completion** | ✅ | Only facility/date groups with `incompleteCount > 0` or `errorCount > 0`. Each group expands to its **incomplete** patients only. |
| **Finalized** | | Groups with `finalizedCount > 0`. Each group expands to its **completed** patients only (dark-blue / finalized cards). |
| **Scheduled** | | Groups with a `scheduleDate` (or any `scheduled` patient). Each row exposes **Open final schedule** + expandable patient view. |
| **All Patients** | | The **previous** facility → date → patient-cards accordion is preserved verbatim, default-collapsed. Power users go here for the full archive and for the facility/date delete buttons. |

Above the tabs is a compact aggregate snapshot:
`X needs completion · Y finalized · Z dates scheduled · N total`.

Per-group expansion state is shared across tabs so toggling a group
open in Needs Completion keeps it open when switching to Finalized
(and vice-versa).

## Classification rules

In `PlexusIQWorkspace.tsx`:

- **`isFinalized(p)`** — `p.status === "completed"`.
- **`isIncomplete(p)`** — anything that is not finalized (draft,
  pending, processing, error, missing qualification).
- **`isErrored(p)`** — `p.status === "error"`.
- **`isScheduled(p, scheduleDate)`** — conservative: dated batch OR
  `p.patientType === "visit"`.

Sorting:

- **Needs Completion** — errors first, then highest `incompleteCount`,
  then newest/nearest `scheduleDate`, then facility name.
- **Finalized / Scheduled** — newest/nearest `scheduleDate` first,
  then facility name.
- **All Patients** — preserves the existing facility / date sort.

## What is intentionally untouched

- The header calendar icon and the right-panel
  `UniversalCalendarDrawer` (profile `"plexusIq"`).
- `PlexusIQDayModal` / `ResultsView` opened from a date click in the
  drawer.
- `PlexusIQDashboardRow`.
- All page-level callbacks: `onGenerateBatch`,
  `onOpenFinalSchedule`, `onDeleteAllForBatch`,
  `onDeleteAllForFacility`, `onUpdatePatient`, `onDeletePatient`,
  `onAnalyzeOnePatient`.
- Backend: no new routes, no schema changes.
- Plexus IQ clinical-import parser / qualification-job flow.

## Top-of-page shelves

The Plexus IQ interior renders, in order, above the workspace tabs:

1. `PlexusIQDashboardRow` — existing snapshot.
2. `PlexusIQQualificationJobsStatus` — active jobs banner (multi-job).
3. **`PlexusIQRecentQualificationCards`** *(new)* — for every job in
   `activeQualificationJobs`, expands to the actual patient cards from
   `batchDetails[batchId]`. Same patient actions as the workspace
   (update / delete / analyze one). Default-collapsed per job so
   8+ recent jobs don't dump hundreds of cards at once. Soft-deleted
   patients are already filtered server-side, so the shelf only ever
   shows active rows.
4. **`PlexusIQRecentlyDeleted`** *(new)* — compact card listing
   patients soft-deleted within the last 14 days with a **Reactivate**
   button that calls the canonical restore endpoint.

Order is intentional: jobs first (status + their cards), then the
restore shelf, then the full status-first tabbed workspace.

## Soft delete + restore

Deleting a patient from any UI surface now performs a **soft delete**:

- `DELETE /api/patients/:id` sets `deleted_at`, `deleted_by_user_id`,
  `delete_expires_at` (now + 14 days), and `delete_reason`. The row
  stays in `patient_screenings` so downstream references
  (`patient_execution_cases`, `analysis_jobs`, `patient_journey_events`,
  `global_schedule_events`, etc.) remain valid.
- The screening repository filters `deletedAt IS NULL` on every read
  path used by the active workspace: `listScreeningsByBatch`,
  `listAllScreenings`, `getScreening`, `searchPatientsByName`,
  `getGroupScreenings`, the roster + cooldown + history-import CTEs.
- Direct ad-hoc queries from `documentLibrary`, `email`, `outreach`,
  `executionCases`, `plexusTasks`, and `patientPacket.repo` were
  also patched to `deletedAt IS NULL` so a soft-deleted patient
  doesn't sneak into a downstream document / email / scheduling
  lookup.
- Batch/facility "Delete all" loops continue to call the single-patient
  endpoint per id, so they inherit soft-delete automatically.

Restore:

- `POST /api/patient-screenings/:id/restore` clears `deletedAt`,
  `deletedByUserId`, `deleteExpiresAt`, and `deleteReason`. Returns
  410 if the restore window has expired; idempotent if the patient
  is already active.
- The frontend invalidates the `recently-deleted` query, the
  screening-batches list, the calendar summary, and any cached batch
  detail so the restored patient reappears in the workspace
  immediately.
- A patient deleted while a qualification job is running may still be
  processed server-side if the runner already started its iteration —
  the row's `status` may transition normally. The UI hides it until
  restored, at which point any AI result (`qualifyingTests`,
  `reasoning`) is preserved exactly as it was.

Migration: `migrations/0023_add_patient_screening_soft_delete.sql`
adds the four nullable columns and two indexes. No application code
hard-deletes `patient_screenings` rows except the explicit batch /
test-fixture cleanup paths.

## Send to Engagement

Finalized/dark-blue completed patient cards expose a **Send to
Engagement** action. The action keeps the existing send/arrow icon
(`Send` from `lucide-react`) and uses the canonical
`POST /api/patients/:id/commit` endpoint, which delegates to
`commitPatient()`:

- Sets `commitStatus = Ready`.
- Creates/updates the `patient_execution_case`.
- Inserts a `global_schedule_events` row when an appointment datetime
  exists.
- Creates insurance-eligibility review and cooldown records.
- Appends `patient_journey_events`.
- Calls `autoAssignSchedulerForExecutionCase()` so a scheduler is
  assigned by the platform after the engagement case exists — the UI
  no longer describes this as sending the patient directly to a
  scheduler.

User-facing copy was renamed in this batch:

| Surface | Before | After |
| --- | --- | --- |
| `ResultsView` Send-All button | `Send All to Scheduler` | `Send All to Engagement` |
| `ResultsView` per-patient icon | `aria-label="Send to scheduler"` | `aria-label="Send to Engagement"` |
| `ResultsView` toasts | `Sent to scheduler queue` / `Already sent to scheduler` / `Could not send patient to scheduler` / `Send to scheduler complete` | `Sent to Engagement` / `Already in Engagement` / `Could not send patient to Engagement` / `Send to Engagement complete` |
| `outreach-qualification` & `home` handoff toast | `Sent to schedulers.` | `Sent to Engagement.` |
| `schedule-dashboard` empty state | `…when a patient is sent to schedulers it will appear here.` | `…when a patient is sent to Engagement it will appear here.` |
| `POST /api/patients/:id/commit` validation error | `Cannot send to schedulers — missing required field …` | `Cannot send to Engagement — missing required field …` |

What did **not** change:
- Endpoint paths, request shapes, response shapes.
- Function/handler names (`handleSendOneToScheduler`,
  `sendPatientToScheduler`, etc.) — internal-only.
- `commitStatus` values (`Draft` / `Ready` / `WithScheduler` etc.).
- `data-testid`s used by automated tests.
- The `Send` lucide icon — the arrow/send look is preserved.

Where the UI legitimately refers to a *scheduler user* (e.g. assigned
scheduler name on a batch, the Schedule Dashboard for schedulers), the
word "Scheduler" is unchanged.

## File map

| File | Purpose |
| --- | --- |
| `client/src/components/plexus-iq/PlexusIQWorkspace.tsx` | New tabs + `WorklistGroupCard` + legacy accordion (under All Patients) |
| `client/src/pages/plexus-iq.tsx` | Unchanged for this batch — same callbacks, same drawer wiring |
| `docs/plexus-iq-workspace-organization.md` | This document |

## Clinic-first interior

The Plexus IQ interior now opens on a clean **clinic tile board** by
default. Each tile shows incomplete + completed counts (plus
missing-info / ready-for-engagement / error counters when > 0). The
status-first tabs from the prior batch still exist, accessible via a
small "Legacy full view" link, so power users can browse the full
facility/date accordion when needed.

### Clinic tiles

- One tile per facility, sorted alphabetically.
- Each tile shows totals + colored sub-counts: incomplete (amber),
  completed (emerald), missing info (rose), ready for engagement
  (sky), errors (rose).
- Clicking a tile opens the clinic detail.

### Clinic detail

- Header: facility name + back-to-clinics control.
- Six status tiles: `Needs Completion`, `Completed`, `Missing Info`,
  `Ready for Engagement`, `Sent to Engagement`, `All Patients`.
- Each status tile is clickable; selecting one filters the rendered
  patient cards below to only that subset.
- Cards render via the existing `QualificationPatientCardsPane` — no
  new card renderer.
- Definitions:
  - **Needs Completion** — `p.status !== "completed"` (draft, error,
    pending, processing).
  - **Completed** — `p.status === "completed"`.
  - **Missing Info** — completed AND missing name/DOB/phone/facility.
  - **Ready for Engagement** — completed AND has name+DOB+phone+facility AND `commitStatus === "Draft"`.
  - **Sent to Engagement** — `commitStatus !== "Draft"` (Ready / WithScheduler / Scheduled).
  - **All Patients** — every active patient in the clinic.

### Legacy full view

A "Legacy full view" link in the clinic board (and the clinic detail
header) switches to the prior tab-based UI (Needs Completion /
Finalized / Scheduled / All Patients). A "Back to clinic tiles"
link at the top of the legacy view returns to the clinic board.

The Recent Qualification Cards and Recently Deleted shelves
remain above the workspace in both modes.

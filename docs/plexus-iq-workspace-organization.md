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

## File map

| File | Purpose |
| --- | --- |
| `client/src/components/plexus-iq/PlexusIQWorkspace.tsx` | New tabs + `WorklistGroupCard` + legacy accordion (under All Patients) |
| `client/src/pages/plexus-iq.tsx` | Unchanged for this batch — same callbacks, same drawer wiring |
| `docs/plexus-iq-workspace-organization.md` | This document |

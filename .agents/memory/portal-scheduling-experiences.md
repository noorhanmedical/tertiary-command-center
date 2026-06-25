---
name: Team Portal scheduling experiences (popup + full)
description: How the two patient-scheduling surfaces in the Team Member Portal share one type/write path and where their data limits are.
---

Two scheduling surfaces, ONE shared contract:
- Mode 1 popup = `SchedulePatientDialog.tsx` (modal, opened from right Work Queue calendar icon; keeps Playground intact behind it).
- Mode 2 full = `SchedulePatientPlayground.tsx` (takes over center Playground; prominent chrome-free `CanonicalMonthCalendar` on the left, summary + sticky confirm on the right).

Both write through the SAME real path: `schedulePatientAncillary` → POST `/api/global-schedule-events/schedule-ancillary`. The shared patient context type `SchedulePatientDialogPatient` lives in `SchedulePatientDialog.tsx` and the playground imports it plus shared constants/helpers (`SERVICE_OPTIONS`, `APPOINTMENT_TYPES`, `TIME_SLOTS`, `buildScheduleNote`, etc.) from there — keep them exported from the dialog, do not duplicate.

Persisting extra fields: appointment type + location have no dedicated columns; they ride in `metadata` AND are folded into `note` via `buildScheduleNote`.

**Why the playground needs a `key`:** TeamPortalShell keeps `<SchedulePatientPlayground>` MOUNTED while `schedulePatientPlaygroundContext` changes, and the component seeds local form state from props only once. Without a `key` tied to patient identity + selectedDate, opening another patient reuses the previous patient's date/time/service/note AND the calendar's internal month cursor. Always key the render by patient+date.

**Honest data limits:** the call list (`TeamWorkspaceCallListItem`) carries NO phone/insurance — only render those chips/rows when present (they come from a patient-tab entry, not the call list). `callReason` is derived via `deriveCallReason(row)`; `nextActionAt` is on the row. Clinician/Plexus PDF buttons in the full scheduler are intentionally DISABLED with a title reason because clinical/reasoning data isn't loaded in the scheduler context.

**Not built:** a unified "Complete & Submit" — no single backend completion endpoint exists (only piecemeal: case-document-readiness/complete, procedure-events/complete, engagement-center/call-result). Needs a design decision before wiring.

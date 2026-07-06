---
name: Team Portal e2e testing recipe
description: How to drive Playwright tests through the auth-gated Team Member Portal (rails, settings pref, quick-schedule gate, view-as for call rows)
---

# Team Portal e2e testing recipe

- The TeamPortalShell workspace has NO /team-portal route — it renders via role-portal pages (e.g. /patient-care-specialist-portal, /technician-portal); /team-portal 404s.
- Auth: create a temp admin user directly in `users` with a bcryptjs hash (bcryptjs is importable in the sandbox), log in through the normal "/" login form, delete the user after. Secret deletion/env tricks not needed.
- Both portal side rails rest slid-away (translate-x ~82%); Playwright reports inner buttons as clipped. Pin them FIRST via `button-pin-left-rail` / `button-pin-right-rail` (force-click acceptable for the pin buttons only), then interact normally.
- The left-rail Calendar tool opens the Quick Schedule pop-up BY DEFAULT (`calendarBehavior` default = "quickSchedule"; "playground" is the opt-out that opens the full calendar view). Prefs persist per user in the DB (`workspace_prefs`), not session-only. Day clicks on the left-rail compact calendar and the playground mini month calendar also open the pop-up pre-filled.
- Quick Schedule direct booking persists to `global_schedule_events` (event_type `ancillary_appointment`) via POST /api/global-schedule-events/schedule-ancillary — verify persistence THERE, not in `ancillary_appointments`.
- Quick Schedule supports walk-ins end-to-end: the pop-up has a "New patient" button that hands off to SchedulePatientDialog in editable name/DOB/facility mode, and the server creates an execution-case stub from patientName (no screening id needed). Cleanup after tests: delete from global_schedule_events AND patient_execution_cases by patient_name.
- Admin "(self)" sees an empty call list; use the header "Viewing as" select to pick a roster member with open cases (check `patient_execution_cases` by `assigned_team_member_id` + facility) before asserting call rows.
- Seeding a clinic-schedule row = insert into `ancillary_appointments` (text scheduled_date/scheduled_time) linked to a `patient_screenings` row that has a matching `patient_execution_cases` row, else schedule-ancillary submit 404s.

**Why:** three test runs failed on rail hover/clipping and the hidden settings pref before one passed; this recipe gets it right first try.
**How to apply:** any Playwright test plan touching TeamPortalShell surfaces.

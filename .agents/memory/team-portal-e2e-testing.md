---
name: Team Portal e2e testing recipe
description: How to drive Playwright tests through the auth-gated Team Member Portal (rails, settings pref, quick-schedule gate, view-as for call rows)
---

# Team Portal e2e testing recipe

- Auth: create a temp admin user directly in `users` with a bcryptjs hash (bcryptjs is importable in the sandbox), log in through the normal "/" login form, delete the user after. Secret deletion/env tricks not needed.
- Both portal side rails rest slid-away (translate-x ~82%); Playwright reports inner buttons as clipped. Pin them FIRST via `button-pin-left-rail` / `button-pin-right-rail` (force-click acceptable for the pin buttons only), then interact normally.
- The left-rail Calendar tool opens the Quick Schedule pop-up ONLY when the session-only workspace pref `calendarBehavior` = "quickSchedule" (Settings tool → `setting-calendar-behavior`). Default opens a calendar view instead. Prefs reset on reload — set them in the same page session.
- Quick Schedule pop-up with a free-text patient name hands off to SchedulePatientDialog, but Confirm stays disabled: `canSubmit` requires `patientScreeningId ?? executionCaseId`. This is an honest gate (server 404s without a resolvable execution case), not a test flakiness issue. The persisting path is a patient/call row that carries a screening id.
- Admin "(self)" sees an empty call list; use the header "Viewing as" select to pick a roster member with open cases (check `patient_execution_cases` by `assigned_team_member_id` + facility) before asserting call rows.
- Seeding a clinic-schedule row = insert into `ancillary_appointments` (text scheduled_date/scheduled_time) linked to a `patient_screenings` row that has a matching `patient_execution_cases` row, else schedule-ancillary submit 404s.

**Why:** three test runs failed on rail hover/clipping and the hidden settings pref before one passed; this recipe gets it right first try.
**How to apply:** any Playwright test plan touching TeamPortalShell surfaces.

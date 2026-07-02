---
name: Portal patient-search endpoints
description: Which patient-search APIs actually exist server-side; some client helpers still call routes that were never implemented.
---

# Portal patient-search endpoints

The rule: before wiring a patient typeahead/search, verify the endpoint is actually registered — client helpers calling phantom routes get the SPA HTML fallback (fetch succeeds, JSON parse fails silently or downstream is empty).

**Status of the known lookup endpoints:**
- `GET /api/plexus/patients/search?q=` — always registered, works. Returns `[{ id, name, dob, insurance }]` where `id` = patient_screenings.id. Min 2 chars.
- `GET /api/portal/patient-search?query=` and `GET /api/portal/my-patients` — NOW IMPLEMENTED in `server/routes/portal.ts` (requirePortalRole + allowedFacilities scoping; effective facility = COALESCE(screening.facility, batch.facility); min 2 chars for search). My-patients derives "touched by me" from outreach_calls (scheduler_user_id) UNION patient_journey_events (actor_user_id).
- `GET /api/patient-directory/search?q=&limit=` — exists but gated behind `USE_PATIENT_DIRECTORY_ACTIVATION` (default OFF), so effectively dead in most envs. PopupPatientPicker was repointed away from it to the portal search.
- `GET /api/portal/patient-command-center/:id` and `POST /api/portal/patient-communications` — still NEVER implemented server-side, though PatientCommandCanvas / CallWorkspace / CaseOverview / SchedulingWorkspace call them.

**Why:** a global auth middleware 401s unknown /api routes when logged out, so a 401 probe does NOT prove a route exists; when logged in, unmatched /api routes fall through to the Vite SPA catch-all and return HTML with status 200.

**How to apply:** grep server/ for the literal path before trusting any client fetch helper; verify with an authenticated curl that the response is JSON, not HTML.

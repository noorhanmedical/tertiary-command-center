---
name: Portal patient-search endpoints
description: Which patient-search APIs actually exist server-side; several client helpers call routes that were never implemented.
---

# Portal patient-search endpoints

The rule: before wiring a patient typeahead/search, verify the endpoint is actually registered — several client helpers call phantom routes and get the SPA HTML fallback (fetch succeeds, JSON parse fails silently or downstream is empty).

**Status of the known lookup endpoints:**
- `GET /api/plexus/patients/search?q=` — always registered, works. Returns `[{ id, name, dob, insurance }]` where `id` = patient_screenings.id. Min 2 chars.
- `GET /api/patient-directory/search?q=&limit=` — exists but gated behind `USE_PATIENT_DIRECTORY_ACTIVATION` (default OFF), so effectively dead in most envs.
- `GET /api/portal/patient-search`, `/api/portal/my-patients`, `/api/portal/patient-command-center/:id` — called by `client/src/lib/portal/commandCenterApi.ts` but NEVER implemented server-side.

**Why:** a global auth middleware 401s unknown /api routes when logged out, so a 401 probe does NOT prove a route exists; when logged in, unmatched /api routes fall through to the Vite SPA catch-all and return HTML with status 200.

**How to apply:** grep server/ for the literal path before trusting any client fetch helper; verify with an authenticated curl that the response is JSON, not HTML.

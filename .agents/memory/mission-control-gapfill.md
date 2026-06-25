---
name: Mission Control gap-fill
description: Honest header/overlay additions to /mission-control and the constraints that shaped them
---

Mission Control (`/mission-control`, admin-gated) was already substantially wired with honest `{value,sourceMissing}` empty states. Genuine gaps were UI-only and added in `client/src/pages/mission-control.tsx` with NO backend change.

- **Facility scope (top-level lens):** a header Select drives `facilityScope`; lanes scope via `lanesForScope`, and lane-derived spine cards recompute their counts client-side from the scoped lanes. Cards with `sourceMissing` stay N/A and the non-lane `tasks` card stays account-wide — do not fabricate scoped values for sources you don't have.
  **Why:** mixing a single facility selector with metrics that have no facility column is misleading; only recompute what is honestly derivable from the lane rows.

- **Access preview:** Popover sourced from `GET /api/auth/me` role via a `ROLE_CAPS` map. Gate on `meQuery.isSuccess` — never `role ?? "admin"`, or the preview misrepresents permissions while loading.

- **Global patient search:** use the UNGATED `/api/plexus/patients/search?q=` (min 2 chars). `/api/patient-directory/search` is gated behind env `USE_PATIENT_DIRECTORY_ACTIVATION` and may be unregistered. The default react-query fetcher does `queryKey.join("/")`, so a `?q=` endpoint needs a **custom queryFn**.

- **Plexus Chat / RingCentral:** no assistant backend and (usually) no telephony connection exist — render honest boundaries (disabled input, "not connected"), never fake responses or call data.

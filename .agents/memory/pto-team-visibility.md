---
name: PTO team-visibility privacy shaping
description: Cross-team PTO/staffing endpoints must shape the response, not just hide fields in the UI.
---

When a portal/staffing surface shows "who is off" across the team, the PTO list
endpoint (`scope=approved-team`, non-admin) must return a minimal DTO —
name + dates + status ONLY. Never return `note`/reason, reviewer metadata, or raw
`userId` for rows the caller does not own.

**Why:** A UI that merely refrains from rendering other people's notes still leaks
them over the API response; coworkers' PTO reasons are private. Shaping must happen
server-side, branched by scope.

**How to apply:** In the GET PTO route, track a `teamScope` flag; for team scope
build an explicit shaped object instead of spreading the full row. Full rows are
fine only for `scope=mine` and admin views. Portal callers can't use the
admin-only users list, so resolve display names server-side via
`storage.getAllUsers()` and attach `userName`.

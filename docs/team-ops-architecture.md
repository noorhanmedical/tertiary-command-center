# Team Ops Architecture

> Honest map of the team-member / PTO / capacity surface.

## Canonical tables

| Concern | Table | Notes |
| --- | --- | --- |
| Users | `users` | Authentication + role. |
| Outreach scheduler roster | `outreach_schedulers` | `name`, `facility`, `capacityPercent`, `userId` FK. |
| PTO | `pto_requests` | `userId`, `startDate`, `endDate`, `status`, `reviewedBy`, `reviewedAt`. |
| Team-member profiles | `admin_settings` (keyed by `settingDomain="team_member"`, `settingKey="workspace_profile"`, per-user) | Workspace type (PCS / ACS), assigned facilities, capability bits, allowed service types. |
| Assignment workload | `patient_execution_cases.assignedTeamMemberId` | Already feeds Engagement Assignment Board + Team Workspace Call List. |
| Communications activity | `patient_communications.actorUserId` | Already feeds "My Patients" in the team-portal. |

## Routes (wired today)

### Users
- `GET /api/users` (admin) — list users + roles.

### Outreach schedulers
- `GET /api/outreach/schedulers` — full list used by the assignment dialogs + Engagement Board.

### PTO
- `GET /api/pto-requests`, `POST /api/pto-requests`, `PATCH /api/pto-requests/:id`, `DELETE /api/pto-requests/:id`, `GET /api/pto-requests/_meta/statuses`.

### Team-member profile
- `GET /api/admin-settings/effective?settingDomain=team_member&settingKey=workspace_profile&userId=<id>` — the canonical workspace profile read.
- `POST /api/admin-settings/upsert` — write path (used by Admin Users page).

## Frontend

- `client/src/pages/admin-users.tsx` — user list + role select + per-user "Profile" button opening `TeamMemberProfileDialog` (workspace type, assigned facilities, capability checkboxes).
- `client/src/pages/team-ops.tsx` — operations dashboard placeholder.
- The Engagement Assignment Board (already wired) shows current per-team-member workload via `patient_execution_cases.assignedTeamMemberId`.

## Gaps (named, not faked)

1. **PTO-aware assignment** — `pto_requests` exists, but the Engagement Assignment Board's scheduler ranking doesn't currently consult it. A scheduler on PTO can still receive new assignments today.
2. **Capacity ranking is alphabetical inside ties** — `outreach_schedulers.capacityPercent` is used, but the board doesn't enforce a hard cap.
3. **KPI dashboard** — Team Ops page is a placeholder; the canonical metrics it could surface (calls completed, patients assigned, marketing sent, completed procedures) are all already in canonical tables, but no aggregation endpoint exists.
4. **PCS / ACS workload view** — admins can already filter the Engagement Assignment Board by team member; a dedicated "team workload" page would be a thin read-model over the same data.

## QA

- `npm run qa:engagement-assignment-board` — verifies scheduler list, execution-case reads, and safe assignment writes on `isTest=true` patients.
- `npm run qa:document-billing-invoice-spine` — includes a `pto_requests` + `outreach_schedulers` + `admin_settings` read smoke.

## How to extend safely

- Add a new role: extend `USER_ROLES` in `shared/schema/users.ts`, then map it in the team-member workspace profile defaults (`shared/teamMemberProfile.ts`).
- Add a new capability bit: extend `TEAM_MEMBER_CAPABILITY_IDS`; the profile dialog + Engagement gating both flow from those bits.
- New KPI: aggregate from canonical tables (`patient_communications`, `outreach_calls`, `patient_execution_cases`, `procedure_events`). Don't create a separate "team_kpi" table.

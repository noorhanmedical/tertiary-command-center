---
name: Portal roster vs login identity
description: Why call-list assignments + admin "View as" key on outreach_schedulers.id, not users.id
---

# Roster is the canonical assignment owner, not login users

`patient_execution_cases.assigned_team_member_id` is an INTEGER FK to
`outreach_schedulers.id` (the clinic roster — one row per member per facility).
Engagement Center writes assignments against that roster id.

**Data fact (env, not in code):** in this org every `outreach_schedulers` row has
`user_id = NULL` — the roster is NOT linked to any login account. So any feature
that resolves "view as" through a login-user UUID (role-filtered user list, or
`resolveAdminViewAsUserId`) returns empty / null and silently no-ops.

**Rule:** admin "View as" carries the roster id (outreach_schedulers.id as a
string). Resolve it through `server/services/teamMemberScope.ts`
(`resolveViewAsRosterMember`, `resolveCallListAssignmentScope`,
`listAssignableTeamMembers`). Facility scope during view-as must use the roster
member's facility (`allowedFacilities({ viewAsRosterFacility })`), because the
login-user path can't narrow it.

**Why:** the call list filters by `assignedTeamMemberId`; without roster-based
resolution, Engagement-assigned cases never appear in the member's queue and the
view-as picker is empty.

**How to apply:** for any portal feed/scope keyed on a team member, bridge through
teamMemberScope, not the login-users table. Non-admin self-scoping still relies on
the (currently unset) userId linkage — until roster rows get linked to login
accounts, only admin view-as actually narrows.

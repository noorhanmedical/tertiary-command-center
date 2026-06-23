---
name: Call list engine (Option 2)
description: How engagement-assigned call work flows to the Team Member Portal, and the per-card scoping rule that prevents cross-scheduler leaks.
---

# Call list engine — Option 2 source of truth

`patient_execution_cases` is the canonical source of truth for Engagement
Center–assigned call work. The Team Member Portal call list reads
`GET /api/operational-queue/me` (returns `{ items, meta }`). `scheduler_assignments`
is the legacy auto daily pool only — it is **not** written for engagement
assignments (the bridge flag stays OFF).

## Per-card scoping is mandatory on the client
**Rule:** `/api/operational-queue/me` returns engagement cases for *every*
`outreach_schedulers` row the logged-in user is mapped to — potentially across
multiple facilities/cards. Any per-card consumer (`useOutreachData(schedulerId)`)
MUST scope those items to the selected card before merging, or one card shows
another scheduler's patients.

**How to apply:** map each case's `metadata.assignedTeamMemberId` (an
`outreach_schedulers.id`) to a card id using the SAME slug the server uses —
`cardIdFor(name, facility)` = ``${name}__${facility}`` lowercased with spaces→`-`
(see `server/services/outreachService.ts`). Build the scheduler→cardId map from
`/api/outreach/schedulers` (full select, includes name+facility). Include an item
only when its mapped cardId === `card.id`; fall back to `facility === card.facility`
only when the assigned scheduler id can't be resolved.

**Why:** card ids are name+facility slugs, NOT scheduler ids. Facility-only
scoping leaks across same-facility schedulers; scheduler-id-only scoping breaks
because the card key is not the scheduler id.

## Scheduler↔user mapping
A user only sees engagement work for the `outreach_schedulers` row whose
`user_id` = their id. When unmapped, `/me` `meta.schedulerMapping ===
"missing_user_mapping"` — render a banner instead of an ambiguous empty list.
All `outreach_schedulers.user_id` were NULL historically, so without an explicit
link nobody sees their assigned work. Mapping suggestions (by name match) are
never auto-applied; linking is admin-gated.

## next_action_at
`server/services/callList/nextActionPolicy.ts` is the single policy for "when
should this case next surface". The assignment path preserves an existing
*future* callback (`existingFuture ?? policyNext`); terminal/scheduled/
admin_review buckets are null. Audit backfill only touches rows where
`next_action_at IS NULL`, so it can never clobber a pending callback.

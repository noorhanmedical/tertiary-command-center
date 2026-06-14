# Phase 2 — Follow-up / triage runtime (PR 2.3)

## Goal

Surface operational queues (callbacks due now, LVM follow-up,
no-answer follow-up, ready-to-schedule, manager review, etc.)
inside the existing Engagement Center + Team Portal right panel
**without creating a Scheduler Portal product**.

## How rows are classified

A row's tag(s) are derived from real persisted columns:

- `engagementStatus`, `lifecycleStatus`, `qualificationStatus`
- `nextActionAt`
- `lastCallOutcome` (projected from the most recent journey event)

The classifier is intentionally pure and lives in two parallel files
(server + client) so the Engagement Center server-side count and
the Team Portal client-side tabs always agree.

- Server: `server/services/operationalQueue/followUpQueueService.ts`
- Client: `client/src/lib/portal/followUpQueueClassifier.ts`

If you change one, change the other. PR 2.10's live probe exercises
the server side; PR 2.3's QA pins the contract.

## Tags

| Tag | When it applies |
|---|---|
| `callbacks_due_now` | `nextActionAt` is in the past |
| `lvm_follow_up` | `lastCallOutcome === "voicemail"` |
| `no_answer_follow_up` | `lastCallOutcome === "no_answer"` |
| `ready_to_schedule` | qualified AND (`lastCallOutcome === "ready_to_schedule"` OR `engagementStatus === "ready_to_schedule"`) |
| `needs_follow_up` | `engagementStatus === "needs_followup"` and none of LVM / no-answer / manager-review apply |
| `unable_to_reach` | `engagementStatus` or `lifecycleStatus` is `unable_to_reach` |
| `manager_review` | `engagementStatus === "needs_followup"` AND `lastCallOutcome === "manager_review"` |
| `dnc_or_declined` | `lastCallOutcome` is `dnc` / `do_not_contact` / `declined` |
| `completed` | `engagementStatus` or `lifecycleStatus` is `completed` / `closed` |

A row can carry multiple tags. The tabs render whichever applies and
show a count. The tab a user clicks narrows the visible rows; it
does NOT mutate the data.

## Layout boundary

The filter tabs sit ABOVE the right-panel list inside the
`portal-right-rail` container. They do not exit the right rail and
they do not consume left-rail tool slots.

## No new product surface

- No new page.
- No new route.
- No new top-level navigation entry.
- The Engagement Center already has filter tabs (server-side); this
  PR exposes the same classification to the Team Portal client side.
- The "Scheduler Portal" route remains a backwards-compat alias that
  mounts the existing outreach page.

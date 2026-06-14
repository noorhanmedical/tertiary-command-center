# Phase 2 — Call Operations Runtime (PR 2.2)

## Goal

Make the call list truly operational by routing every call result
through admin-settings-driven logic, recording the audit identity
correctly (even under admin view-as), and emitting a structured
routing plan that downstream services can consume.

## What changed in PR 2.2

### Server services

- `server/services/callResult/applyCallResultRouting.ts` — pure
  function. Inputs: outcome + explicit callbackAt + current attempt
  count + the effective settings bundle. Outputs: a structured plan
  with terminal, nextActionAt, openTriageCase, openFollowUpTask,
  nextActionReason, shouldTransitionToUnableToReach, and the
  appliedSettings ledger.
- `server/services/callResult/callResultAuditIdentity.ts` —
  resolves the audit identity once per call. `actorUserId` is
  always the real session user (never the view-as user).
  `viewAsTeamMemberId` records the impersonation when admin
  view-as is active. The metadata helper writes both onto every
  journey event.

### Route handler

`server/routes/executionCases.ts` (call-result handler):

- Resolves the audit identity at the top of the handler.
- Loads the effective settings bundle (with the actor user's scope)
  before computing the legacy `journeyMetadata`.
- Computes the routing plan and writes its summary onto the
  journey-event metadata under `routing_plan`.
- The engagement-delegation path also writes the audit metadata so
  the two paths are byte-equivalent for the new fields.

The legacy DB-write semantics are preserved exactly. The route still
owns the actual writes; PR 2.2 is additive — the routing plan and
identity metadata are appended, not substituted.

### Routing decisions driven by admin settings

| Decision | Driven by setting | Default |
|---|---|---|
| Callback default hours | `scheduling_triage.default_callback_due_hours` | 24h |
| No-answer re-queue hours | `engagement_center.no_answer_callback_hours` | 4h |
| LVM re-queue hours | `engagement_center.voicemail_callback_hours` | 4h |
| Max attempts → unable-to-reach | `engagement_center.max_call_attempts` | 6 |
| DNC is terminal | `engagement_center.dnc_is_terminal` | true |
| Declined is terminal | `engagement_center.declined_is_terminal` | true |
| Ready-to-schedule → triage | `engagement_center.ready_to_schedule_routes_to_triage` | true |
| Scheduled closes assignment | `engagement_center.scheduled_closes_assignment` | true |
| Queue re-entry enabled | `engagement_center.queue_reentry_enabled` | true |
| Manager review creates a task | `scheduling_triage.manager_review_requires_task` | true |

### Audit identity contract

- The session user is ALWAYS recorded as `actor_user_id` on the
  journey event metadata.
- When admin view-as is active, the impersonated user is recorded
  as `view_as_user_id` on the same metadata. The actor identity is
  never overwritten.
- `actor_is_admin` is also recorded so downstream audit queries can
  distinguish "admin operating on their own behalf" from "admin
  operating on behalf of a viewed-as PCS / ACS user".

## Honest scope (not yet wired)

- The routing plan's `shouldTransitionToUnableToReach` is computed
  but NOT YET applied — the route does not currently track an
  attempt count per execution case. A future PR can add a counter
  column and consume the plan flag.
- The routing plan's `terminal`, `openTriageCase`, and
  `openFollowUpTask` are advisory in PR 2.2 — the route's own
  triage/task logic still wins. A future PR can switch the route
  to consume the plan directly once the parity is verified.

These intentional gaps are guarded by QA: the plan ships into the
metadata so any future PR that switches the route over has a
deterministic contract to validate against.

# Phase 3 PR 3.3 — Exception Human Review Workflow

## What this PR is

PR 3.3 introduces an auditable human-review workflow on top of the
`exception_snapshots` table produced by PR 3.2.

- Engine output is treated as a **proposal**. A human must acknowledge,
  assign, resolve, or dismiss every exception.
- Every transition is logged to a new `exception_review_events` table for
  immutable history.
- No automatic execution. No AI action. The engine still only detects
  and explains; the human is the actor.

## What this PR is NOT

- It is **not** a workflow engine. It does not call out to email/SMS, schedule
  callbacks, mark invoices ready, or change patient state.
- It does **not** mutate the engine output beyond the review state machine.
  The detector signal stays intact in `source_snapshot` / `policy_snapshot`.
- It is **not** a UI rebuild — the queue page from PR 3.2 still renders
  the list; the right-side panel gets the action surface.

## State machine

```
                +------------+
                |    open    |  ← engine writes this
                +------------+
                  |        |
       acknowledge|        |assign (with assignedToUserId or role)
                  v        v
            +---------+ +------------+
            |acknowled| | in_review  |
            |   ged   | |            |
            +---------+ +------------+
                  |        |
                  +---+----+
                      |
        +-------------+--------------+
        |             |              |
     resolve(reason) dismiss(reason) reopen
        |             |              ^
        v             v              |
    +---------+   +-----------+      |
    |resolved |   | dismissed |--+---+
    +---------+   +-----------+
        |              |
        +-----reopen---+
```

Notes:
- `superseded` is set by the engine, not by humans. Humans cannot
  acknowledge / dismiss / resolve a `superseded` row (409).
- `reopen` on an already-`open` row returns 409.
- `resolve` and `dismiss` require a non-empty `reason` (audit hygiene).
- `assign` requires at least one of `assignedToUserId` or `assignedRole`.
- `assign` from `open` transitions status to `in_review`. From any other
  status it does not change status — assignment is non-destructive.

## Auth contract

| Endpoint | Allowed roles |
| --- | --- |
| `POST /api/exceptions/:id/acknowledge` | any authenticated user |
| `POST /api/exceptions/:id/assign` | any authenticated user |
| `POST /api/exceptions/:id/note` | any authenticated user |
| `POST /api/exceptions/:id/dismiss` | `admin`, `biller` |
| `POST /api/exceptions/:id/resolve` | `admin`, `biller` |
| `POST /api/exceptions/:id/reopen` | `admin`, `biller` |
| `GET  /api/exceptions/:id/review-events` | any authenticated user |

## Tables

`exception_snapshots` — extended in PR 3.2 with `assignedToUserId`,
`assignedRole`, `acknowledgedAt`, `acknowledgedByUserId`,
`resolutionReason`, `dismissedReason`, `resolvedAt`.

`exception_review_events` — appended-only audit log, one row per
transition. Columns:

- `exception_snapshot_id` (FK, ON DELETE CASCADE)
- `event_type` — `acknowledged | assigned | note_added | dismissed |
  resolved | reopened | recommendation_accepted | recommendation_rejected`
- `actor_user_id` (FK to users, ON DELETE SET NULL)
- `assigned_to_user_id`, `assigned_role` — populated on assign
- `reason` — required for dismiss / resolve
- `note` — populated by `note_added`
- `metadata` jsonb
- `created_at`

Indexes: `(exception_snapshot_id)`, `(event_type)`.

`recommendation_accepted` and `recommendation_rejected` event types are
reserved for PR 3.4 / 3.5 and unused by PR 3.3.

## What is NOT in PR 3.3

- AI explanations or recommendations (PR 3.4 / 3.5).
- Specialized detectors for documents / scheduling / call priority
  (PR 3.6 / 3.7).
- Operational summary reports (PR 3.8).

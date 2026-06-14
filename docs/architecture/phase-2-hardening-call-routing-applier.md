# Phase 2 hardening — Call routing applier (item 2)

## Goal

When `applyCallResultRouting` returns a plan, surface the
applicability of each plan flag against actual canonical writers
so the route handler can apply what is wired and HONESTLY mark
pending what is not.

## Service

`server/services/callResult/callResultRoutingApplier.ts`:

```ts
deriveRoutingApplication(plan, capabilities = DEFAULT_CAPABILITIES)
```

Inputs:
- `plan` — the `CallResultRoutingPlan` from
  `applyCallResultRouting`.
- `capabilities` — what writers are wired in the current handler.
  Defaults to `{ triageWriter: true, taskWriter: true,
  closeAssignmentWriter: false }`.

Output:
```ts
{
  nextActionAt,
  openTriageCase,        // (plan says open) AND (writer wired)
  openFollowUpTask,
  closeAssignment,
  requiresWriter: { triage, task, closeAssignment },
}
```

`requiresWriter.*` is the "honestly pending" signal — it is true
when the plan wanted the action but the route handler doesn't
have a wired writer yet.

## Default capability map (justified)

| Capability | Wired? | Why |
|---|---|---|
| `triageWriter` | ✓ | `upsertOpenSchedulingTriageCase` is invoked in the legacy handler path. |
| `taskWriter` | ✓ | `storage.createTask` is invoked. |
| `closeAssignmentWriter` | ✗ | The legacy disposition path does NOT call the engagement assignment "cancel" writer. Until that wiring lands, terminal outcomes mark `engagementStatus` + `lifecycleStatus` only — the open assignment row remains visible. Marked as `requires_writer.closeAssignment = true` so audits can find pending work. |

## Route wiring

`server/routes/executionCases.ts` writes the application outcome
under `journey metadata → routing_plan.requires_writer`. Existing
triage / task writes are unchanged — the plan and the route's own
decisions are now byte-equivalent for the wired capabilities.

## Why no fake DB writes

A premature "close assignment" call would corrupt the engagement
board because the assignment writer expects a specific dry-run /
audit flow. Until the disposition flow is migrated to that flow,
we surface `requires_writer.closeAssignment = true` rather than
silently mark the row terminal.

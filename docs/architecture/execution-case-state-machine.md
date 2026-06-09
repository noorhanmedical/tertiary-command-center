# Execution-case state machine (Batch 10 read-only foundation)

**Branch:** `architecture/batch-10-12-spine-readonly-helpers`
**Scope:** Read-only design doc + read-only server module. No new schema, no migration, no writer.

> Cross-reference: `shared/schema/executionCase.ts:17-27`, `docs/architecture/backend-route-parity-inventory.md` §1.9 + §4, `docs/architecture/canonical-spine.md` §7.

---

## 1. Why this needs to happen

`patient_execution_cases` is the canonical operational spine row per committed patient. Today the row is created **fire-and-forget** as a side effect of `commitPatient`, and the four state columns (`lifecycleStatus`, `engagementStatus`, `qualificationStatus`, `engagementBucket`) are mutated inline from multiple call sites with no centralized validation. The existing partial unique index `uq_scheduler_assignments_active_per_patient_day` enforces one-active-per-(patient,date) on the call list side, but the execution-case state has no equivalent guard.

Batch 10 is the orchestrator's "execution-case spine" batch. This **read-only foundation** ships the transition matrix as code (so callers can validate intended transitions) plus typed read helpers. The transactional writer is **Batch 10b** in a future PR with its own approval — that batch adds an opt-in `EXECUTION_CASE_TX` feature flag and rewrites `patientCommitService.ts` to wrap the six side-effect writes in a single transaction.

---

## 2. State enums (today)

Declared at `shared/schema/executionCase.ts:17-27`:

```ts
ENGAGEMENT_BUCKETS     = ["visit", "outreach", "scheduling_triage"]
QUALIFICATION_STATUSES = ["unscreened", "qualified", "not_qualified", "pending_review"]
LIFECYCLE_STATUSES     = ["active", "completed", "archived", "cancelled"]
ENGAGEMENT_STATUSES    = ["new", "contacted", "scheduled", "completed", "not_reached"]
```

All four columns are `text` in Postgres — historical drift values (typos, deprecated values) are tolerated at the column level. The transition matrix below mirrors the LEGAL transitions observed in today's codebase; the read-only `checkTransitionLegality` helper preserves today's permissive behavior for unknown from-states.

---

## 3. Transition matrix

### 3.1 `lifecycleStatus`

| from \ to | active | completed | archived | cancelled |
| --- | :---: | :---: | :---: | :---: |
| active | yes (self) | yes | yes | yes |
| completed | — | yes (self) | yes | — |
| cancelled | — | — | yes | yes (self) |
| archived | — | — | yes (self) | — |

### 3.2 `engagementStatus`

| from \ to | new | contacted | scheduled | completed | not_reached |
| --- | :---: | :---: | :---: | :---: | :---: |
| new | yes (self) | yes | yes | — | yes |
| contacted | — | yes (self) | yes | yes | yes |
| not_reached | — | yes | yes | yes | yes (self) |
| scheduled | — | — | yes (self) | yes | yes |
| completed | — | — | — | yes (self) | — |

### 3.3 `qualificationStatus`

| from \ to | unscreened | qualified | not_qualified | pending_review |
| --- | :---: | :---: | :---: | :---: |
| unscreened | yes (self) | yes | yes | yes |
| pending_review | — | yes | yes | yes (self) |
| qualified | — | yes (self) | — | yes |
| not_qualified | — | — | yes (self) | yes |

### 3.4 `engagementBucket`

Bucket changes are administrative — qualification can flip a patient from `visit`→`outreach` or vice versa when their schedule changes. Today's writers admit all pairs; the matrix mirrors that permissiveness. A future batch can tighten the bucket transitions once the qualification flow is documented separately.

---

## 4. Read surface (this batch)

`server/modules/execution-cases/`:

- `contracts.ts` — `ExecutionCaseStateSnapshot`, `ExecutionCaseTransitionRequest`, `ExecutionCaseTransitionLegality`.
- `state-machine.ts` — `checkTransitionLegality(request)` returning a discriminated outcome. `requireLegalTransition(request)` throws on illegality.
- `repo.ts` — `getExecutionCaseSnapshot(id)`, `listExecutionCasesByAssignee(assignedTeamMemberId, filters)`, `listExecutionCasesByPatientScreeningId(id)`.
- `service.ts` + `index.ts` — barrels.

**Not wired to any route.** Module ships dormant; future Batch 10b consumes it.

---

## 5. What this batch deliberately does NOT do

- No transactional writer.
- No `EXECUTION_CASE_TX` flag.
- No edit to `patientCommitService.ts`.
- No edit to `engagementAssignmentBoard.ts`.
- No new column / index / migration.
- No client/ change.
- No journey-event write (covered by the sibling `journey-event-standardization-design.md`).

---

## 6. Rollback

`git rm -r server/modules/execution-cases/` + `git rm docs/architecture/execution-case-state-machine.md`. Zero runtime state.

---

## 7. Stop conditions for follow-up batches

A future batch MUST stop and ask if:

1. A writer ships without the `EXECUTION_CASE_TX` flag.
2. A transition matrix entry is *tightened* without a backfill plan for historical rows that may have used the looser semantic.
3. The bucket transitions become non-symmetric without an explicit clinical sign-off.
4. The lifecycle terminal states (`archived`, `cancelled`) become reversible.

End of design.

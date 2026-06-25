---
name: applyDistribution post-commit audit flush
description: Why distribution apply collects journey events and writes them after commit, plus its test seam
---
# applyDistribution: audit events must flush AFTER commit

`applyDistribution` (server/services/engagement/distributionService.ts) locks each
case row with `SELECT … FOR UPDATE` inside its transaction, then assigns it. The
journey/audit event for that assignment must NOT be written inside the transaction.

**Why:** `appendJourneyEvent` → `appendPatientJourneyEvent` inserts into
`patient_journey_events`, which has an FK to `patient_execution_cases`. That insert
needs a `FOR KEY SHARE` lock on the parent row. But `appendPatientJourneyEvent`
runs over the GLOBAL `db` pool connection — a *different* connection from the open
tx that still holds `FOR UPDATE` on that same row. `FOR KEY SHARE` conflicts with
`FOR UPDATE`, so the insert blocks; the tx waits for the insert at the JS `await`
level (not a PG lock), so Postgres cannot see the cycle and never aborts it →
the apply hangs forever on EVERY successful assignment. Originally written inline
with a try/catch, so it looked harmless but deadlocked in practice.

**How to apply:** collect the events into a `pendingEvents[]` during the tx and
flush them best-effort after `db.transaction(...)` returns (locks released). Same
trap applies to ANY in-tx write that does a cross-connection FK insert referencing
a row the tx has locked FOR UPDATE — defer it past commit or use the tx executor.

**Test seam:** `applyDistribution(actor, role, deps?)` takes optional
`{ gatherCases, gatherMembers }` (ApplyDistributionDeps). Default = live global
gather (unchanged). Tests pass scoped gathers so the real lock/re-validation
write-path runs against a seeded, isolated pool without mutating the ~hundreds of
real eligible cases. See script/applyDistribution.test.ts (run via tsx).

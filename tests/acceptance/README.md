# Acceptance regression tests

Permanent regression coverage for the critical Team Operations / Engagement
guarantees built in Phases 3–6. These convert the earlier throwaway
verification scripts into tests that stay in the repo.

## Running

```bash
# Pure tests (no DB) run standalone:
npx tsx tests/acceptance/distributionCapacity.test.ts
npx tsx tests/acceptance/handoffPolicy.test.ts

# DB-backed tests need DATABASE_URL loaded (they use real Postgres because the
# guarantees are about atomic conditional UPDATEs / FOR UPDATE / partial-unique
# constraints that a mock cannot prove). They are self-cleaning.
set -a && . ./.env && set +a && npm run test:acceptance
```

`npm run test:acceptance` runs every `tests/acceptance/*.test.ts` in order and
stops on the first failure.

## What is covered (maps to Final Acceptance §14 + §15)

| File | Guarantees |
|---|---|
| `distributionCapacity.test.ts` | A: capacity 100% / 50%; C: overflow 40/25 → 25 assigned + 15 coverage + 0 lost (pure allocator) |
| `handoffPolicy.test.ts` | D/E: handoff capacity-exceed rules; F: P1/P2 acknowledgement required; SLA overdue/awaiting-ack (pure) |
| `concurrency.test.ts` | G: concurrent handoff → one effective, loser superseded; H: concurrent team-task claim + status transition → one winner (DB) |
| `workforceRecovery.test.ts` | B(partial)/I: deactivated-user recovery all work types; J: reactivation no-resurrect; L: call-result external_call_id idempotency; M: manager-scope authz; N: team-message membership authz (DB) |
| `redistribution.test.ts` | B: PTO/absence canonical release+redistribute never strands a case (DB) |
| `dataIntegrity.test.ts` | §9 workforce accounting invariant + §15 data-integrity invariants (DB, read-only) |

K (repeated-episode readiness isolation) is covered by the pre-existing
`tests/unit/journeyLookupScoping.test.ts`.

## Discipline

Every DB-backed test tags its rows with a `[[ACCEPT ...]]` marker, deletes them
in `cleanup()`, and asserts the DB is clean at the end. They never mutate a
real user's `active` flag or standing manager relationships (temp rows only,
removed on completion).

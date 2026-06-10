# Team / Scheduler Portal cutover readiness checklist

**Status:** Docs-only (Bundle 18). No code changed.
**Date:** 2026-06-09.
**Purpose:** Pre-flight checklist a future projection-backed read cutover PR (Batch 11d.3 onwards) MUST satisfy before it is opened. Captures every gate the prior bundles erected so reviewers can verify them in one place.
**Cross-references:**
- `operational-queue-call-list-projection-design.md` §3 (cutover sequence), §4 (verification gates), §6 (log schema), §7 (staging gate).
- `operational-queue-staging-runbook.md` (operational steps for §7).
- `shadow-read-parity-log-analyzer-design.md` (analyzer contract).
- `team-portal-playground-wiring-contract.md` §13 (Operational Queue wiring), §23 (safe cutover sequence), §24 (stop conditions).
- `pdf-protection-contract.md` (hard-stop region).
- `do-not-touch.md` (hard-stop file list).

This document is a checklist, not a roadmap. The cutover PR opens only after every box below is checked AND a separately approved staging report is attached.

---

## 0. Scope

The "cutover" this checklist gates is one specific change:

- `server/routes/schedulerAssignments.ts` `GET /api/scheduler-assignments` handler returns rows derived from `getOperationalQueueForUser(...)` → `projectQueueItemsToSchedulerAssignments(...)` when `USE_OPERATIONAL_QUEUE_CALL_LIST=1`, instead of (or in addition to) the legacy `storage.listActiveSchedulerAssignments(filters)` path.

Out of scope:
- Any Team Portal UI redesign.
- Any change to `routes/engagementAssignmentBoard.ts`.
- Any change to admin-review, PDF, or billing paths.
- Any production flag default flip — that is yet another separate PR.
- Removing the legacy code path — that's Batch 11d.4, not this checklist's PR.

---

## 1. Pre-PR readiness — module gates

- [ ] `server/modules/operational-queue/projections/schedulerAssignment.ts` exists on main, is pure (no DB / schema / drizzle imports — pinned by `scripts/qa-operational-queue-projection-parity.mjs`), and exports `projectQueueItemsToSchedulerAssignments`, `MISSING_ROW_LOG_PREFIX`, `LegacySchedulerAssignmentRowShape`, `SchedulerAssignmentFetchByIds`.
- [ ] `server/modules/operational-queue/projections/schedulerAssignmentDefaultFetcher.ts` exists on main and imports `inArray`, the `schedulerAssignments` table, and `db`. Default fetcher is the cutover's only DB binding.
- [ ] `server/modules/operational-queue/projections/index.ts` re-exports both halves.
- [ ] `server/modules/operational-queue/__tests__/projection-parity.test.ts` runs in <5s, no DB, no network, and §10 / §11 assertions pass.
- [ ] All 19 `scripts/qa-*.mjs` pass on main with no env vars set.

---

## 2. Pre-PR readiness — log schema gates

- [ ] Route source `server/routes/schedulerAssignments.ts` shadow-read block still emits exactly the five canonical fields (`parityMatch`, `legacyCount`, `queueCount`, `inLegacyOnly`, `inQueueOnly`) — `scripts/qa-shadow-read-parity-log-schema.mjs` exits 0.
- [ ] Route has exactly three `[USE_OPERATIONAL_QUEUE_CALL_LIST]` log emissions: success, skip, failed.
- [ ] No PHI identifier appears in the shadow-read block.

---

## 3. Pre-PR readiness — staging evidence

- [ ] Pre-staging fixture pass per `operational-queue-staging-runbook.md` §1.
- [ ] Staging env has `USE_OPERATIONAL_QUEUE_CALL_LIST=1`. Production env is OFF.
- [ ] 7 consecutive UTC days of staging logs captured. Window includes at least one weekday morning.
- [ ] `scripts/parity-log-analyzer.mjs --logs-dir <window-dir>` exits 0 (overall `pass`). Both `report.txt` and `report.json` archived alongside the PR.
- [ ] `tripwires=0` for every day in the window. A non-zero tripwire count fails the gate regardless of `parityMatch`.
- [ ] No `[USE_OPERATIONAL_QUEUE_CALL_LIST] shadow-read failed:` lines for the window.
- [ ] Rollback drill per `operational-queue-staging-runbook.md` §7 performed inside the window. Flag-OFF response on staging is byte-identical to flag-ON response (same `curl ... | sha256sum`).

---

## 4. The cutover PR — allowed scope

The cutover PR edits **only**:

- `server/routes/schedulerAssignments.ts` — wires the projection into the `GET /api/scheduler-assignments` handler under the same `USE_OPERATIONAL_QUEUE_CALL_LIST` flag the shadow read already uses.
- A new `scripts/qa-operational-queue-call-list-projection-cutover.mjs` that asserts the route now imports `projectQueueItemsToSchedulerAssignments` and `defaultFetchSchedulerAssignmentsByIds`, gates the call behind `isOperationalQueueCallListEnabled()`, keeps the legacy `res.json(rows)` as the flag-OFF response, and never logs PHI.
- A small docs append to `operational-queue-call-list-projection-design.md` recording the PR # and link to the staging report.

It MUST NOT:

- Edit `server/modules/operational-queue/service.ts`, `repo.ts`, or `contracts.ts`.
- Add a new route or rename the existing one.
- Change the response shape — the projection guarantees `LegacySchedulerAssignmentRowShape` and a future shape change is its own PR.
- Edit the projection module (the projection is frozen by the time of the cutover PR).
- Change `USE_OPERATIONAL_QUEUE_CALL_LIST` default (still OFF in production).
- Edit any file in `do-not-touch.md`.
- Edit any UI source file.

---

## 5. The cutover PR — runtime invariants

Under `USE_OPERATIONAL_QUEUE_CALL_LIST=1`:

- [ ] The route returns the projection's output, NOT the legacy `rows` array. The response JSON shape is byte-stable (the projection produces `LegacySchedulerAssignmentRowShape[]` rows).
- [ ] Auth gates (admin vs non-admin scheduler resolution at lines 35-48 in the pre-cutover route) are preserved. The projection path does NOT bypass them.
- [ ] The projection's bulk fetch runs at most once per request.
- [ ] On projection failure, the route logs `[USE_OPERATIONAL_QUEUE_CALL_LIST] cutover failed:` (new variant; the QA wrapper adds this to its allow-list) AND falls back to the legacy `res.json(rows)` path. The flag is a safety net, not a guillotine.

Under `USE_OPERATIONAL_QUEUE_CALL_LIST=0`:

- [ ] The route returns the legacy `rows` array, byte-identical to today.
- [ ] No projection import is invoked at request time. The projection module loads (it's static), but no DB call goes through `defaultFetchSchedulerAssignmentsByIds`.

---

## 6. Rollback plan

If the cutover PR ships and the production flag is later flipped ON (a separate PR) and a regression is observed:

1. Flip `USE_OPERATIONAL_QUEUE_CALL_LIST=0` in production via the deploy platform's env-var surface (no code change). The route immediately returns to the legacy path.
2. Confirm via `grep` that the next minute of production logs contains no `[USE_OPERATIONAL_QUEUE_CALL_LIST]` lines.
3. Open an incident retrospective. The next steps live in a separate PR; this checklist does not own the post-mortem.

The legacy code path remains in the route until Batch 11d.4. Until then, the rollback is one env-var change.

---

## 7. Stop conditions for the cutover PR

The cutover PR MUST STOP and ask if:

1. Any box in §1–§3 is unchecked.
2. The staging window is shorter than 7 consecutive UTC days.
3. The staging window has any `fail` day or any `tripwires` line.
4. The projection module is edited in the same PR as the route wiring (separation of concerns; the projection is frozen).
5. The default-fetcher's bulk-fetch behavior is changed in the same PR.
6. The response shape would change for any caller (any field added, removed, or reordered).
7. The PR removes the legacy `storage.listActiveSchedulerAssignments(filters)` call — that's Batch 11d.4, not this PR.
8. The PR also touches Admin Review, qualification, PDF, billing, scheduler-assignment writes, or any UI file.
9. The PR flips a feature flag default.
10. The PR includes a migration.

---

## 8. Sign-off

The cutover PR description MUST cite the §-numbers from this checklist and attach:

- The staging window's `report.txt` and `report.json`.
- The rollback drill date and the matching `sha256sum` results from §3 / §7.
- The 7-day analyzer command + output.
- A link to the projection module on main and the parity test pass output.

Without these artifacts the PR is non-compliant and MUST be paused.

End of checklist.

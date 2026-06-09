# Background jobs / workers design (Batch 18 design-first foundation)

**Branch:** `architecture/batch-18-19-infrastructure-design`
**Scope:** Design doc only. No production job moved. No worker code shipped. No queue infrastructure added. No registration of a new background runner.

> Cross-reference: `docs/architecture/refactor-batches.md` Batch 12, `docs/architecture/full-21-batch-orchestrator-review.md` Batch 18, `shared/schema/outboxItems.ts`, `server/lib/advisoryLock.ts`.

---

## 1. Why this needs to happen

All background work runs **in-process** today, sharing the Express event loop:

| Job | File | Trigger | Lock |
| --- | --- | --- | --- |
| Morning scheduler rebuild | `server/services/morningRebuildScheduler.ts` | 7 AM weekdays | Postgres advisory lock |
| Absence watcher | `server/services/absenceWatcher.ts` | Every 10 min during business hours | Internal interval |
| Invoice reminder watcher | `server/services/invoiceReminderService.ts` | Periodic | None |
| Drive / Sheets sync | `server/services/syncService.ts` | Fire-and-forget from route handlers | None |
| Batch AI analysis runner | `server/services/batchAnalysisRunner.ts` | Triggered by `/api/plexus-iq/qualification-jobs` | Internal concurrency cap |

Two of the jobs use advisory locks for HA safety; three rely on the fact that there's only one Node process. Once we move to multiple processes (Phase 19c — ECS scaling), the lockless jobs can fire twice and the AI batch runner can lose in-flight work.

Batch 18 is the orchestrator's "background jobs / workers" batch. This **design-first** PR ships the design + a typed queue interface in code, but registers NO new runner and moves NO production job. The actual job-moves are individually-gated future batches (18b–18f, each with its own approval).

---

## 2. Per-job analysis

### 2.1 `morningRebuildScheduler` — advisory-locked, HA-safe today

- Reads eligible patients per facility.
- Runs priority ranking via `callListEngine.buildCallList()`.
- Writes `scheduler_assignments` rows in a transaction.
- Advisory lock prevents double-rebuild on the same `(facility, date)`.

**Move-to-worker risk:** LOW. The advisory lock makes the job HA-safe today. Future work can leave this in-process and just split the per-facility work across multiple workers.

### 2.2 `absenceWatcher` — interval-driven, no lock

- Polls scheduler-presence signals.
- Creates `absence_alert` plexus tasks when a scheduler is silent.
- After 30 minutes of no operator response, auto-executes `redistribute`.

**Move-to-worker risk:** MEDIUM. Without a lock, two Node processes both fire the watcher and create duplicate `absence_alert` tasks. Batch 18b must add an advisory lock OR move it to a queue-driven cron.

### 2.3 `invoiceReminderService` — interval-driven, no lock

- Periodically scans `invoices` with `Sent` status and overdue follow-up date.
- Sends reminder emails.

**Move-to-worker risk:** MEDIUM-HIGH. Double-firing produces double-emails. Add a "last reminder sent at" column + skip-when-recent rule OR migrate to queue-based singleton scheduling.

### 2.4 `syncService` — fire-and-forget Drive/Sheets exports

- Pushed from route handlers via `void backgroundSyncBilling()` etc.
- Lossy by design today.

**Move-to-worker risk:** LOW for behavior change (already lossy), HIGH for design (we should fix the lossiness). Outbox-driven sync (writes a row to `outbox_items`; a worker drains it with retries + DLQ) is the right end state.

### 2.5 `batchAnalysisRunner` — long-running, in-process

- Triggered by `/api/plexus-iq/qualification-jobs`.
- Runs Claude API calls with an internal concurrency cap.
- Persists per-patient results.

**Move-to-worker risk:** HIGH. AI calls take minutes to hours. If the Node process restarts mid-batch, in-flight work is lost (the route caller may or may not know). Worker move requires:
- Outbox-row per-patient handoff (not per-batch).
- Idempotency on the patient key.
- Resume-from-last-completed semantics.

---

## 3. The outbox pattern (incumbent foundation)

`outbox_items` (`shared/schema/outboxItems.ts`) already exists. It's used for Drive sync and other fan-outs. The Batch 18 design recommends EXTENDING this pattern rather than introducing a new queue table:

```ts
// Conceptual; not shipped in this batch.
//
// Each outbox row carries a `kind` discriminator. Workers register a
// handler per kind. The worker reads from outbox_items WHERE
// status = 'pending' AND visible_at <= now() ORDER BY visible_at,
// claims a batch (UPDATE ... RETURNING) with a stale-lease timeout,
// and processes one row at a time.
//
// Retries: on failure, increment attempts + push visible_at forward
// by exponential backoff. After N attempts (default 5) move to
// status = 'failed' for manual review (a "DLQ" pattern without a
// separate table).
//
// Lock semantics: a row claim uses Postgres SKIP LOCKED so multiple
// workers don't fight for the same row. This is the SQS-of-PostgreSQL
// pattern.
```

The Batch 18 PR (this one) ships only the **typed interface** that future per-job moves will consume:

```ts
// Future server/platform/queue/contracts.ts (NOT shipped in this batch
// because it would tempt premature wiring — design only).
//
// export type QueueJob<TKind extends string = string, TPayload = unknown> = {
//   id: string;
//   kind: TKind;
//   payload: TPayload;
//   attempts: number;
//   visibleAt: Date;
// };
//
// export interface Queue<TKind extends string = string> {
//   publish<TPayload>(kind: TKind, payload: TPayload, options?: { visibleAt?: Date }): Promise<void>;
//   consume(handler: (job: QueueJob<TKind, unknown>) => Promise<void>): { stop: () => void };
// }
```

---

## 4. Phased rollout

| Phase | Ships |
| --- | --- |
| **18 (this batch)** | Design doc only. |
| **18a** | `server/platform/queue/` skeleton: contracts.ts + in-process implementation reading `outbox_items`. **NOT registered.** Sample handler. Parity test against a captured-state fixture. |
| **18b** | Add advisory lock to `absenceWatcher`. Verify with a synthetic two-process test. |
| **18c** | Move `syncService.backgroundSyncBilling` to outbox-driven. Both paths coexist behind `SYNC_VIA_OUTBOX` flag. |
| **18d** | Move `syncService.backgroundSyncPatients` to outbox-driven. |
| **18e** | Move `invoiceReminderService` to outbox-driven with idempotency column. |
| **18f** | Move `batchAnalysisRunner` to outbox-driven per-patient row. Highest risk; ships with checkpoint + resume tests. |
| **18g** | Switch outbox transport from in-process polling to SQS. Behind `OUTBOX_TRANSPORT=sqs` env. |

Each phase is a separate PR. None ship in this batch.

---

## 5. Hard protected areas

| Area | Touched this batch? | Touched future phases? | Mitigation |
| --- | --- | --- | --- |
| Patient qualification logic | no | yes (18f moves `batchAnalysisRunner`) | Resume-from-last-completed semantics + per-patient idempotency tests. |
| Plexus IQ qualification flow | no | yes (18f) | Same. |
| Admin Review | no | no | — |
| Scheduler assignment correctness | no | yes (18b advisory-locks `absenceWatcher`) | Synthetic two-process test before flip. |
| Billing money / claims | no | yes (18c/18d/18e billing/invoice fan-outs) | Outbox idempotency; coexist behind flag. |
| Migrations | no | yes (18e adds `last_reminder_sent_at` column) | Phase-by-phase; each migration its own PR. |

---

## 6. Rollback

`git rm docs/architecture/background-jobs-design.md`. Zero runtime state. No registration was added; no infrastructure introduced.

---

## 7. Stop conditions for follow-up phases

A future phase MUST stop and ask if:

1. A job move ships without an idempotency key (the same row processed twice MUST produce the same end state).
2. A job move ships without a backoff schedule.
3. A job move removes the existing in-process path before the outbox path has soaked in staging for >= 1 week.
4. The SQS migration (18g) ships before the in-process outbox runner has handled all five jobs.
5. Any phase changes the public response shape of a route that triggers a job (e.g., `/api/plexus-iq/qualification-jobs`).

End of design.

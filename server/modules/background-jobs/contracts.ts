// Background jobs — module contracts (Batch 18 / Bundle 9).
//
// READ-ONLY type skeleton. NOT WIRED to any runtime in this batch.
// No existing background job is migrated. The morning-rebuild
// scheduler, absence watcher, scheduler auto-assign, AI batch runner
// and outreach service continue to run unchanged.
//
// Why this exists:
//   Today each background job has its own scheduling shape
//   (setInterval, advisory-locked periodic fn, in-process queue).
//   The Batch 18 plan unifies them under a single JobDescriptor +
//   JobRunner interface so we can:
//     - Move to an outbox-driven queue (Postgres-backed → SQS) later
//       without per-job rewiring.
//     - Observe job health centrally (timings, last-run-at, last-error).
//     - Run jobs with explicit lock semantics + idempotency keys.
//
//   This bundle ships the contracts. The runtime cutover lands one
//   job at a time, each behind its own feature flag.
//
// Cross-reference:
//   - docs/architecture/background-jobs-design.md
//   - server/lib/advisoryLock.ts (existing lock primitive)
//   - server/services/outbox.ts (existing in-process outbox)

/**
 * What kind of work the job represents. Each job MUST declare one
 * kind so the runner / dashboard can group + filter.
 */
export type JobKind =
  | "morning_rebuild"
  | "absence_watcher"
  | "scheduler_auto_assign"
  | "ai_batch_runner"
  | "outreach_sync"
  | "outbox_drain"
  | "invoice_reminder"
  | "cooldown_canonical_sweep";

/**
 * How the job is scheduled. `cron` runs on a wall-clock cadence,
 * `interval` runs at a fixed gap, `once` runs once on boot, `manual`
 * never auto-runs (operator-triggered only).
 */
export type JobSchedule =
  | { kind: "cron"; expr: string }
  | { kind: "interval"; ms: number }
  | { kind: "once" }
  | { kind: "manual" };

/**
 * Outcome of a single job run. Always a discriminated union — never
 * a raw error thrown. The runner catches and converts so the run
 * record is always written.
 */
export type JobRunOutcome =
  | { kind: "ok"; durationMs: number; metadata?: Record<string, unknown> }
  | { kind: "skipped"; reason: "disabled" | "lock_held" | "duplicate" }
  | { kind: "failed"; durationMs: number; errorMessage: string };

/**
 * The descriptor every job registers. The runner reads this to decide
 * when + how to run + how to record outcomes.
 *
 * Invariants the runner enforces:
 *   - `lockName` is acquired via withAdvisoryLock before `run()` fires.
 *     If the lock can't be acquired, outcome is `skipped: lock_held`.
 *   - `run()` is wrapped in try/catch; thrown errors become
 *     `failed: { errorMessage }` not propagated to the caller.
 *   - `featureFlag` (when present) is read EACH run; flag-OFF means
 *     `skipped: disabled`.
 */
export type JobDescriptor = {
  name: string;
  kind: JobKind;
  schedule: JobSchedule;
  lockName: string;
  /** Optional env var. When set, the runner reads it each invocation
   *  and skips when the value is not truthy ("1" | "true" | "yes"). */
  featureFlag?: string;
  /** Maximum allowed run time. Runner kills + records `failed` when
   *  exceeded. */
  timeoutMs: number;
  /** The actual work. PHI-safe by contract — no patient names, DOBs,
   *  raw payloads in the outcome metadata. */
  run: () => Promise<JobRunOutcome>;
};

/**
 * What gets recorded per run. Lands in a job_runs table in a future
 * batch (no schema change in this bundle).
 */
export type JobRunRecord = {
  jobName: string;
  kind: JobKind;
  startedAt: Date;
  outcome: JobRunOutcome;
};

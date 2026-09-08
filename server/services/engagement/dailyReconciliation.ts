// Clinic-local 5 AM canonical reconciliation (Phase 2, reliability-hardened in
// Phase 2B).
//
// A RECONCILIATION TRIGGER, not a rebuild. It coordinates the EXISTING
// canonical services against the ONE continuous execution-case spine and now
// records DURABLE execution state in the engagement_reconciliation_runs ledger
// (authoritative), backed by a Postgres advisory lock.
//
//   scheduler tick
//        │
//        ▼  per ACTIVE clinic:
//   valid clinic timezone?  ── no ─▶ record configuration_error (fail closed; DON'T run)
//        │ yes
//        ▼
//   local hour >= 5 AM?  ── no ─▶ skip (before hour)
//        │ yes
//        ▼
//   durable SUCCESS already exists for (clinic, localDate)?  ── yes ─▶ skip
//        │ no
//        ▼
//   acquire advisory lock  ── contended ─▶ skip (another instance owns the run)
//        │ acquired
//        ▼
//   RE-CHECK durable success under lock  ── success ─▶ skip
//        │ none
//        ▼
//   beginRun (STARTED, attempt++)
//        │
//        ▼
//   applyDistribution (canonical allocator, scoped to the clinic)
//        │
//        ├─ throws ─▶ completeRunFailure (FAILED, retryable next tick)
//        ▼ ok
//   completeRunSuccess (+ non-PHI counts) ─▶ release lock
//
// The durable ledger — NOT an in-memory Set — is the authority for "did this
// clinic reconcile today". applyDistribution remains the ONLY allocator; this
// file records state and never fabricates patient work, call attempts, or
// duplicate assignments (all Phase 1/1B invariants are inherited).

import { eq } from "drizzle-orm";
import { db } from "../../db";
import { clinics } from "@shared/schema/clinics";
import { withAdvisoryLock } from "../../lib/advisoryLock";
import { operationalDateInTimeZone, hourInTimeZone } from "../../lib/clinicTime";
import { resolveClinicTimeZone } from "./clinicTimeZone";
import { applyDistribution, gatherEligibleCases, gatherDistributionMembers } from "./distributionService";
import {
  hasSucceededRun,
  beginRun,
  completeRunSuccess,
  completeRunFailure,
  recordConfigurationError,
} from "../../repositories/reconciliationRuns.repo";
import type { ReconciliationTriggerType } from "@shared/schema/reconciliationRuns";

/** Clinic-LOCAL hour at/after which the daily reconciliation runs. Default 5 AM. */
const RECONCILE_HOUR = Number(process.env.CLINIC_RECONCILE_HOUR ?? 5);
const JOB_TYPE = "daily_engagement_reconciliation";

export type ClinicReconciliationStatus =
  | "reconciled"
  | "skipped_before_hour"
  | "skipped_already_succeeded"
  | "skipped_lock_contended"
  | "configuration_error"
  | "error";

export type ClinicReconciliationOutcome = {
  clinicId: number;
  clinicName: string;
  /** Usable zone (valid configured, or Central fallback). See timeZoneStatus. */
  timeZone: string;
  timeZoneStatus: "valid" | "invalid_timezone" | "missing_timezone";
  operationalDate: string;
  localHour: number;
  triggerType?: ReconciliationTriggerType;
  status: ClinicReconciliationStatus;
  applied?: number;
  skipped?: number;
  failureCode?: string;
  error?: string;
};

/**
 * Reconcile ONE clinic against the current instant. Fails closed on an
 * invalid/missing timezone; otherwise gates on local 5 AM + a DURABLE success
 * check + a cross-instance advisory lock; records started/succeeded/failed in
 * the ledger. NEVER throws — one misconfigured/failed clinic cannot stop the
 * loop.
 */
/** The action run under the lock after beginRun. Production runs the canonical
 *  clinic-scoped allocator; tests inject deterministic success/failure. */
export type ReconcileAction = (clinicId: number) => Promise<{ applied: number; skipped: number }>;

export async function reconcileClinic(
  clinic: { id: number; name: string },
  now: Date = new Date(),
  actorUserId: string | null = null,
  opts: { reconcile?: ReconcileAction } = {},
): Promise<ClinicReconciliationOutcome> {
  // Default = the CANONICAL allocator, scoped to this clinic (no new engine).
  const runReconcile: ReconcileAction =
    opts.reconcile ??
    (async (clinicId) => {
      const result = await applyDistribution(actorUserId, "scheduler", {
        gatherCases: (exec) => gatherEligibleCases(exec, { clinicId }),
        // Phase 3 — the 5 AM job allocates the DAY'S PLANNED staffing: members
        // SCHEDULED to work this operational date (time-of-day irrelevant — most
        // shifts start after 5 AM). Live daytime distribution uses real-time
        // availability (the default gatherDistributionMembers mode).
        gatherMembers: () => gatherDistributionMembers({ mode: "planned", now }),
      });
      return { applied: result.summary.applied, skipped: result.summary.skipped };
    });
  const tz = await resolveClinicTimeZone(clinic.id);

  // ── PART 7: invalid/missing timezone → FAIL CLOSED (do NOT reconcile). ─────
  if (!tz.valid) {
    // The clinic-local date is uncomputable without a valid zone → use the UTC
    // calendar date as a deterministic durable key (config-error record only).
    const utcDate = now.toISOString().slice(0, 10);
    const failureCode = tz.status === "invalid_timezone" ? "invalid_timezone" : "missing_timezone";
    try {
      await recordConfigurationError({
        clinicId: clinic.id,
        operationalDate: utcDate,
        jobType: JOB_TYPE,
        timeZone: tz.configuredTimeZone,
        failureCode,
        failureSummary:
          tz.status === "invalid_timezone"
            ? `clinics.timezone "${tz.configuredTimeZone}" is not a valid IANA zone`
            : "clinics.timezone is not set",
      });
    } catch (err) {
      console.error(`[dailyReconcile] clinic ${clinic.id} failed to record configuration_error:`, err);
    }
    return {
      clinicId: clinic.id,
      clinicName: clinic.name,
      timeZone: tz.timeZone,
      timeZoneStatus: tz.status,
      operationalDate: utcDate,
      localHour: -1,
      status: "configuration_error",
      failureCode,
    };
  }

  const operationalDate = operationalDateInTimeZone(now, tz.timeZone);
  const localHour = hourInTimeZone(now, tz.timeZone);
  const base = {
    clinicId: clinic.id,
    clinicName: clinic.name,
    timeZone: tz.timeZone,
    timeZoneStatus: tz.status,
    operationalDate,
    localHour,
  } as const;

  if (localHour < RECONCILE_HOUR) {
    return { ...base, status: "skipped_before_hour" };
  }

  const key = { clinicId: clinic.id, operationalDate, jobType: JOB_TYPE };

  // Fast durable success check (also re-checked under the lock).
  try {
    if (await hasSucceededRun(key)) {
      return { ...base, status: "skipped_already_succeeded" };
    }
  } catch (err) {
    // Ledger read failed (DB issue) → do NOT claim success; observable; retry.
    console.error(`[dailyReconcile] clinic ${clinic.id} ledger read failed:`, err);
    return { ...base, status: "error", error: (err as Error).message };
  }

  // scheduled = ran during the clinic's 5 o'clock hour; catch_up = later.
  const triggerType: ReconciliationTriggerType =
    localHour === RECONCILE_HOUR ? "scheduled" : "catch_up";

  try {
    const lock = await withAdvisoryLock(`daily_reconcile:${clinic.id}:${operationalDate}`, async () => {
      // Re-check durable success UNDER the lock (a prior holder may have just
      // succeeded between our fast check and acquiring the lock).
      if (await hasSucceededRun(key)) {
        return { skipped: true as const };
      }
      const run = await beginRun({
        clinicId: clinic.id,
        operationalDate,
        jobType: JOB_TYPE,
        timeZone: tz.timeZone,
        triggerType,
      });
      try {
        const counts = await runReconcile(clinic.id);
        await completeRunSuccess(run.id, {
          assignedCount: counts.applied,
          skippedCount: counts.skipped,
        });
        return { skipped: false as const, applied: counts.applied, skipped2: counts.skipped };
      } catch (reconcileErr) {
        // Durably record FAILED (retryable) BEFORE surfacing — never SUCCESS.
        await completeRunFailure(run.id, {
          failureCode: "reconcile_error",
          failureSummary: (reconcileErr as Error).message?.slice(0, 500) ?? null,
        });
        throw reconcileErr;
      }
    });

    if (!lock.acquired) {
      return { ...base, triggerType, status: "skipped_lock_contended" };
    }
    const r = lock.result!;
    if (r.skipped) {
      return { ...base, status: "skipped_already_succeeded" };
    }
    console.log(
      `[dailyReconcile] clinic=${clinic.id} "${clinic.name}" tz=${tz.timeZone} ` +
        `localDate=${operationalDate} localHour=${localHour} trigger=${triggerType} ` +
        `applied=${r.applied} skipped=${r.skipped2}`,
    );
    return { ...base, triggerType, status: "reconciled", applied: r.applied, skipped: r.skipped2 };
  } catch (err) {
    // Reconciliation threw AFTER a FAILED row was durably recorded (or the lock
    // helper errored). Observable; the guard is the ledger, so a later tick
    // retries. Do NOT claim success.
    console.error(`[dailyReconcile] clinic ${clinic.id} "${clinic.name}" reconciliation failed:`, err);
    return { ...base, triggerType, status: "error", error: (err as Error).message };
  }
}

/**
 * Enumerate ACTIVE clinics and reconcile each. Each clinic is independent — an
 * invalid timezone or a failure on one clinic never stops the others. Never
 * throws.
 */
export async function runClinicReconciliations(
  now: Date = new Date(),
  actorUserId: string | null = null,
): Promise<ClinicReconciliationOutcome[]> {
  const activeClinics = await db
    .select({ id: clinics.id, name: clinics.name })
    .from(clinics)
    .where(eq(clinics.active, true));

  const outcomes: ClinicReconciliationOutcome[] = [];
  for (const clinic of activeClinics) {
    outcomes.push(await reconcileClinic(clinic, now, actorUserId));
  }
  return outcomes;
}

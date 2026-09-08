// Phase 2B — durable daily reconciliation RUN ledger.
//
// Records the EXECUTION STATE of the clinic-local 5 AM canonical engagement
// reconciliation (server/services/engagement/dailyReconciliation.ts). This is
// NOT a second scheduler/allocator and NOT the legacy scheduler_assignments
// history snapshot — it only records whether a given clinic's reconciliation
// for a given local operational date started / succeeded / failed, so the
// system has DURABLE (not just in-memory) knowledge of run status across
// restarts, crashes, catch-ups, and multiple instances.
//
// IDENTITY / RETRY: one logical run per (clinic_id, operational_date, job_type)
// — enforced by a unique index — with MUTABLE status + attempt_count. A failed
// or started row is UPDATED in place on retry (started → succeeded/failed →
// started → succeeded), so a failure never blocks a later successful retry.
// "Has this clinic already reconciled today?" = a row exists with
// status='succeeded'.
//
// PHI POLICY: NO patient identifiers. Only clinic id, an operational date
// string, a timezone id, run status, attempt/trigger metadata, and non-PHI
// aggregate COUNTS (candidate / assigned / needs-coverage / skipped).
//
// Migration: 0082_add_engagement_reconciliation_runs.sql (applied manually,
// like the other engagement ledgers).

import {
  sql,
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
  createInsertSchema,
  z,
} from "./_common";
import { clinics } from "./clinics";

/** The one canonical job identity for this ledger. Kept distinct from the
 *  legacy scheduler_assignments history snapshot. */
export const RECONCILIATION_JOB_TYPES = ["daily_engagement_reconciliation"] as const;
export type ReconciliationJobType = (typeof RECONCILIATION_JOB_TYPES)[number];

/** Run lifecycle statuses.
 *  • started              — a reconciliation attempt is in progress (or the
 *                            process died mid-run, in which case this is NOT a
 *                            success and a later tick may retry).
 *  • succeeded            — the canonical reconciliation completed; the clinic
 *                            is done for this operational date.
 *  • failed               — the reconciliation threw / DB error; safe to retry.
 *  • configuration_error  — the clinic could not be reconciled due to an
 *                            invalid/missing timezone (fail-closed); NOT a
 *                            success and does not run the allocator. */
export const RECONCILIATION_RUN_STATUSES = [
  "started",
  "succeeded",
  "failed",
  "configuration_error",
] as const;
export type ReconciliationRunStatus = (typeof RECONCILIATION_RUN_STATUSES)[number];

/** How the run was initiated (operational observability only). */
export const RECONCILIATION_TRIGGER_TYPES = ["scheduled", "catch_up"] as const;
export type ReconciliationTriggerType = (typeof RECONCILIATION_TRIGGER_TYPES)[number];

export const engagementReconciliationRuns = pgTable(
  "engagement_reconciliation_runs",
  {
    id: serial("id").primaryKey(),
    clinicId: integer("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    /** Clinic-LOCAL operational date (YYYY-MM-DD). For a configuration_error
     *  where the local date is uncomputable (invalid tz), the UTC calendar
     *  date is used as a deterministic key fallback. */
    operationalDate: text("operational_date").notNull(),
    jobType: text("job_type").notNull().default("daily_engagement_reconciliation"),
    /** IANA timezone actually used for this run (or the invalid/normalized
     *  value on a configuration_error, for operator diagnosis). */
    timeZone: text("time_zone"),
    triggerType: text("trigger_type"),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    failureCode: text("failure_code"),
    /** PHI-SAFE short failure summary (never patient data). */
    failureSummary: text("failure_summary"),
    // Non-PHI aggregate outcome counts.
    candidateCount: integer("candidate_count"),
    assignedCount: integer("assigned_count"),
    needsCoverageCount: integer("needs_coverage_count"),
    skippedCount: integer("skipped_count"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    // ONE logical run per clinic/date/job — the retry-safe identity.
    uniqueIndex("uq_err_clinic_date_job").on(
      table.clinicId,
      table.operationalDate,
      table.jobType,
    ),
    index("idx_err_clinic").on(table.clinicId),
    index("idx_err_status").on(table.status),
  ],
);

export const insertEngagementReconciliationRunSchema = createInsertSchema(
  engagementReconciliationRuns,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type EngagementReconciliationRun = typeof engagementReconciliationRuns.$inferSelect;
export type InsertEngagementReconciliationRun = z.infer<
  typeof insertEngagementReconciliationRunSchema
>;

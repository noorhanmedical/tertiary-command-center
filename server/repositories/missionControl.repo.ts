// Mission Control repository — bounded scoped counts only.
//
// Every helper here returns a single scalar count from an indexed WHERE
// clause. No unbounded selects, no broad getAll. New helpers must
// follow the same pattern.
//
// Every read is optionally clinic-scoped via the `clinicId` filter
// argument. When clinicId is null the query returns platform-wide
// counts (admin-only per the route guard). When clinicId is set, the
// query filters by the tenancy column on the source table.

import { db } from "../db";
import { and, eq, gte, isNull, lt, ne, or, sql } from "drizzle-orm";
import { patientExecutionCases } from "@shared/schema/executionCase";
import { plexusTasks } from "@shared/schema/plexus";
import { analysisJobs } from "@shared/schema/analysisJobs";
import { globalScheduleEvents } from "@shared/schema/globalSchedule";
import { outreachCalls } from "@shared/schema/outreach";
import { billingReadinessChecks } from "@shared/schema/billingReadiness";
import { caseDocumentReadiness } from "@shared/schema/documentReadiness";
import { patientScreenings } from "@shared/schema/screening";

export type MissionScope = {
  clinicId?: number | null;
  // Today, in UTC. Callers pass in a controlled date so tests can pin the
  // clock; live callers supply new Date().toISOString().slice(0,10).
  todayIso?: string;
};

function utcMidnight(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
function utcNextDay(iso: string): Date {
  const d = utcMidnight(iso);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

// ─── Active execution cases ──────────────────────────────────────
// Definition: lifecycleStatus IS NULL OR = 'active'.
export async function countActiveExecutionCases(
  scope: MissionScope = {},
): Promise<number> {
  const conds = [
    or(
      isNull(patientExecutionCases.lifecycleStatus),
      eq(patientExecutionCases.lifecycleStatus, "active"),
    ),
  ];
  if (scope.clinicId != null) {
    conds.push(eq(patientExecutionCases.clinicId, scope.clinicId));
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(patientExecutionCases)
    .where(and(...conds));
  return row?.n ?? 0;
}

// ─── Open Plexus tasks ──────────────────────────────────────────
// NOTE: plexus_tasks has no clinic_id column — tenancy is indirect via
// patient_screening_id → patient_screenings.clinic_id. Clinic scoping
// therefore requires a JOIN; for Mission Control (admin-only route)
// the platform-wide count is acceptable. If a clinic filter becomes
// necessary here, add a helper that JOINs patient_screenings.
const OPEN_TASK_STATUSES = ["open", "active", "in_progress"] as const;
export async function countOpenPlexusTasks(
  _scope: MissionScope = {},
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(plexusTasks)
    .where(or(...OPEN_TASK_STATUSES.map((s) => eq(plexusTasks.status, s))));
  return row?.n ?? 0;
}

// ─── Qualification backlog (running analysis jobs) ──────────────
// Definition: analysis_jobs.status = 'running'. Platform-wide count —
// analysis_jobs has no clinic_id column; tenancy is via batch_id.
export async function countRunningAnalysisJobs(
  _scope: MissionScope = {},
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(analysisJobs)
    .where(eq(analysisJobs.status, "running"));
  return row?.n ?? 0;
}

// ─── Callbacks pending ───────────────────────────────────────────
// Definition: outreach_calls with a future callbackAt.
// idx_outreach_calls_callback_at supports this.
// outreach_calls has no clinic_id column; the count is platform-wide.
export async function countCallbacksPending(
  _scope: MissionScope = {},
): Promise<number> {
  const now = new Date();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(outreachCalls)
    .where(gte(outreachCalls.callbackAt, now));
  return row?.n ?? 0;
}

// ─── Scheduled today (doctor_visit + ancillary_appointment) ─────
export async function countScheduledToday(
  scope: MissionScope = {},
): Promise<number> {
  if (!scope.todayIso) return 0;
  const start = utcMidnight(scope.todayIso);
  const end = utcNextDay(scope.todayIso);
  const conds = [
    or(
      eq(globalScheduleEvents.eventType, "doctor_visit"),
      eq(globalScheduleEvents.eventType, "ancillary_appointment"),
    ),
    gte(globalScheduleEvents.startsAt, start),
    lt(globalScheduleEvents.startsAt, end),
    // Cancelled events do not count as scheduled today
    ne(globalScheduleEvents.status, "cancelled"),
  ];
  if (scope.clinicId != null) {
    conds.push(eq(globalScheduleEvents.clinicId, scope.clinicId));
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(globalScheduleEvents)
    .where(and(...conds));
  return row?.n ?? 0;
}

// ─── Ready for billing ──────────────────────────────────────────
// Definition: billing_readiness_checks.readiness_status = 'ready_to_generate'.
const READY_BILLING_STATUSES = ["ready_to_generate", "ready"] as const;
export async function countReadyForBilling(
  scope: MissionScope = {},
): Promise<number> {
  const conds = [
    or(
      ...READY_BILLING_STATUSES.map((s) =>
        eq(billingReadinessChecks.readinessStatus, s),
      ),
    ),
  ];
  if (scope.clinicId != null) {
    conds.push(eq(billingReadinessChecks.clinicId, scope.clinicId));
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(billingReadinessChecks)
    .where(and(...conds));
  return row?.n ?? 0;
}

// ─── Reports missing / outstanding ──────────────────────────────
// Definition: case_document_readiness with document_type='report' and
// document_status IN ('pending','uploaded') — i.e., not yet complete.
export async function countReportsMissing(
  scope: MissionScope = {},
): Promise<number> {
  const conds = [
    eq(caseDocumentReadiness.documentType, "report"),
    or(
      eq(caseDocumentReadiness.documentStatus, "pending"),
      eq(caseDocumentReadiness.documentStatus, "uploaded"),
    ),
  ];
  if (scope.clinicId != null) {
    conds.push(eq(caseDocumentReadiness.clinicId, scope.clinicId));
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(caseDocumentReadiness)
    .where(and(...conds));
  return row?.n ?? 0;
}

// ─── Prescreen — patient_screenings pending review ──────────────
export async function countPrescreenPending(
  scope: MissionScope = {},
): Promise<number> {
  const conds = [
    or(
      eq(patientScreenings.status, "pending"),
      eq(patientScreenings.status, "pending_review"),
      eq(patientScreenings.status, "draft"),
    ),
  ];
  if (scope.clinicId != null) {
    conds.push(eq(patientScreenings.clinicId, scope.clinicId));
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(patientScreenings)
    .where(and(...conds));
  return row?.n ?? 0;
}

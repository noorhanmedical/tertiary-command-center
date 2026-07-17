// Home Stats repository — bounded scoped aggregates for the Home tiles.
//
// Every helper is a single COUNT / SUM against an indexed WHERE clause,
// optionally scoped by clinicId and by a date window (startsAt / endsAt).
// No unbounded selects, no getAll, no join fan-out — the Home page is
// on the auth-gated fast path and must never do the persistence branch's
// broad getAllScreeningBatches × getAllPatientScreenings materialisation.

import { db } from "../db";
import { and, eq, gte, isNull, lt, or, sql, ne } from "drizzle-orm";
import { patientScreenings } from "@shared/schema/screening";
import { patientExecutionCases } from "@shared/schema/executionCase";
import { globalScheduleEvents } from "@shared/schema/globalSchedule";
import { outreachCalls } from "@shared/schema/outreach";
import { invoices } from "@shared/schema/invoices";

export type HomeStatsScope = {
  clinicId?: number | null;
};
export type DateWindow = { start: Date; end: Date };

// ─── Patients added in a window (patient_screenings.createdAt) ─
export async function countPatientsAddedInRange(
  win: DateWindow,
  scope: HomeStatsScope = {},
): Promise<number> {
  const conds = [
    gte(patientScreenings.createdAt, win.start),
    lt(patientScreenings.createdAt, win.end),
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

// ─── Active schedules in a date window ─────────────────────────
export async function countActiveSchedulesInRange(
  win: DateWindow,
  scope: HomeStatsScope = {},
): Promise<number> {
  const conds = [
    gte(globalScheduleEvents.startsAt, win.start),
    lt(globalScheduleEvents.startsAt, win.end),
    or(
      eq(globalScheduleEvents.eventType, "doctor_visit"),
      eq(globalScheduleEvents.eventType, "ancillary_appointment"),
    ),
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

// ─── Outreach calls made in window ─────────────────────────────
export async function countOutreachCallsInRange(
  win: DateWindow,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(outreachCalls)
    .where(
      and(
        gte(outreachCalls.startedAt, win.start),
        lt(outreachCalls.startedAt, win.end),
      ),
    );
  return row?.n ?? 0;
}

// ─── Ancillary event count by category in window ───────────────
// Bucket globalScheduleEvents.serviceType into brainwave / vitalwave /
// ultrasound via serviceType LIKE. Falls to zero on missing rows.
export async function countAncillaryByCategoryInRange(
  win: DateWindow,
  scope: HomeStatsScope = {},
): Promise<{ brainWave: number; vitalWave: number; ultrasound: number }> {
  const baseConds = [
    gte(globalScheduleEvents.startsAt, win.start),
    lt(globalScheduleEvents.startsAt, win.end),
    eq(globalScheduleEvents.eventType, "ancillary_appointment"),
    ne(globalScheduleEvents.status, "cancelled"),
  ];
  if (scope.clinicId != null) {
    baseConds.push(eq(globalScheduleEvents.clinicId, scope.clinicId));
  }
  const [row] = await db
    .select({
      brainWave: sql<number>`count(*) FILTER (WHERE lower(${globalScheduleEvents.serviceType}) LIKE '%brainwave%' OR lower(${globalScheduleEvents.serviceType}) LIKE '%eeg%')::int`,
      vitalWave: sql<number>`count(*) FILTER (WHERE lower(${globalScheduleEvents.serviceType}) LIKE '%vitalwave%' OR lower(${globalScheduleEvents.serviceType}) LIKE '%ekg%' OR lower(${globalScheduleEvents.serviceType}) LIKE '%ecg%')::int`,
      ultrasound: sql<number>`count(*) FILTER (WHERE lower(${globalScheduleEvents.serviceType}) LIKE '%ultrasound%' OR lower(${globalScheduleEvents.serviceType}) LIKE '%doppler%' OR lower(${globalScheduleEvents.serviceType}) LIKE '%echo%')::int`,
    })
    .from(globalScheduleEvents)
    .where(and(...baseConds));
  return {
    brainWave: row?.brainWave ?? 0,
    vitalWave: row?.vitalWave ?? 0,
    ultrasound: row?.ultrasound ?? 0,
  };
}

// ─── Finance windows: paid in last-7 days + upcoming due ───────
export async function sumInvoicesPaidInRange(
  win: DateWindow,
): Promise<number> {
  // Invoices has no `updated_at` column; use created_at as a bounded
  // proxy for the "billed / posted this window" filter. This is
  // acceptable because the Home Stats finance card headlines "last 7
  // days billed activity" and Paid/Partially Paid rows created in the
  // window are the only ones that contribute to totalPaid > 0.
  const [row] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${invoices.totalPaid}), 0)::numeric`,
    })
    .from(invoices)
    .where(
      and(
        gte(invoices.createdAt, win.start),
        lt(invoices.createdAt, win.end),
        or(eq(invoices.status, "Paid"), eq(invoices.status, "Partially Paid")),
      ),
    );
  const n = parseFloat(String(row?.total ?? "0"));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export async function sumInvoicesOutstanding(): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${invoices.totalBalance}), 0)::numeric`,
    })
    .from(invoices)
    .where(ne(invoices.status, "Paid"));
  const n = parseFloat(String(row?.total ?? "0"));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

// ─── Active execution cases (upcoming ancillary patient count) ──
// Kept null-safe for lifecycleStatus.
export async function countActiveExecutionCasesForUpcoming(
  scope: HomeStatsScope = {},
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

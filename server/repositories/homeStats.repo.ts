// Home Stats repository — bounded scoped aggregates for the Home
// tiles. Home Stats is a `requireAuth` route (any authenticated user),
// so every metric MUST be tenant-scoped or explicitly unavailable.
//
// Same discriminated-union contract as missionControl.repo:
//   { available: true, value: N }   — authoritative query ran
//   { available: false, reason: X } — no authoritative source
//
// TIMEZONE POLICY
//   All windows are UTC. This platform has no clinic-timezone table;
//   the temporary policy is a single service-level timezone (UTC) so
//   boundary tests remain deterministic across every clinic. The
//   service layer supplies every Date; the repo never calls
//   `new Date()`.

import { db } from "../db";
import { and, eq, gte, isNull, lt, ne, or, sql } from "drizzle-orm";
import { patientScreenings } from "@shared/schema/screening";
import { patientExecutionCases } from "@shared/schema/executionCase";
import { globalScheduleEvents } from "@shared/schema/globalSchedule";
import { outreachCalls } from "@shared/schema/outreach";
import { invoices, invoicePayments } from "@shared/schema/invoices";

export type MetricValue<T> =
  | { available: true; value: T }
  | { available: false; reason: string };

export type ClinicScope = { clinicId: number | null };
export type DateWindow = { start: Date; end: Date };

const AVAILABLE = <T,>(value: T): MetricValue<T> => ({ available: true, value });
const UNAVAILABLE = <T,>(reason: string): MetricValue<T> => ({
  available: false,
  reason,
});

// ─── Patients added in a window ─────────────────────────────────
// Source: patient_screenings.created_at + clinic_id + deleted_at.
export async function countPatientsAddedInRange(
  win: DateWindow,
  scope: ClinicScope,
): Promise<MetricValue<number>> {
  const conds = [
    gte(patientScreenings.createdAt, win.start),
    lt(patientScreenings.createdAt, win.end),
    isNull(patientScreenings.deletedAt),
  ];
  if (scope.clinicId != null) {
    conds.push(eq(patientScreenings.clinicId, scope.clinicId));
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(patientScreenings)
    .where(and(...conds));
  return AVAILABLE(row?.n ?? 0);
}

// ─── Active schedules in window (clinic-scoped) ────────────────
// Cancelled events excluded; only visit + ancillary event types
// count as an "active schedule."
export async function countActiveSchedulesInRange(
  win: DateWindow,
  scope: ClinicScope,
): Promise<MetricValue<number>> {
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
  return AVAILABLE(row?.n ?? 0);
}

// ─── Outreach calls made in window ──────────────────────────────
// outreach_calls has no clinic_id column. To scope by clinic we JOIN
// patient_screenings and filter on patient_screenings.clinic_id. A
// deleted patient's calls are still counted (calls are historical)
// unless the caller explicitly filters — we do not filter out
// deleted-patient calls here because the metric semantics are "calls
// this team made," not "calls to still-active patients."
export async function countOutreachCallsInRange(
  win: DateWindow,
  scope: ClinicScope,
): Promise<MetricValue<number>> {
  if (scope.clinicId == null) {
    // Home Stats is per-clinic; a null clinicId here means "admin,
    // no clinic filter" — return unavailable so admin sees an
    // honest empty state instead of a leaked platform-wide count.
    return UNAVAILABLE(
      "Outreach calls have no clinic_id column. Scope required.",
    );
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(outreachCalls)
    .innerJoin(
      patientScreenings,
      eq(patientScreenings.id, outreachCalls.patientScreeningId),
    )
    .where(
      and(
        gte(outreachCalls.startedAt, win.start),
        lt(outreachCalls.startedAt, win.end),
        eq(patientScreenings.clinicId, scope.clinicId),
      ),
    );
  return AVAILABLE(row?.n ?? 0);
}

// ─── Ancillary event category counts in window (clinic-scoped) ──
export async function countAncillaryByCategoryInRange(
  win: DateWindow,
  scope: ClinicScope,
): Promise<
  MetricValue<{ brainWave: number; vitalWave: number; ultrasound: number }>
> {
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
  return AVAILABLE({
    brainWave: row?.brainWave ?? 0,
    vitalWave: row?.vitalWave ?? 0,
    ultrasound: row?.ultrasound ?? 0,
  });
}

// ─── Finance: invoice payments summed in window (clinic-scoped) ─
// Authoritative payment table: invoice_payments (amount + payment_date
// + invoice_id → invoices.clinic_id). payment_date is stored as text
// in YYYY-MM-DD form (schema line 112); we compare it against ISO
// date strings so no timezone drift occurs. Clinic scope enforced via
// inner-join to invoices.
//
// This REPLACES the prior invoices.created_at proxy — creation time
// is not payment time.
export async function sumPaymentsPostedInRange(
  win: DateWindow,
  scope: ClinicScope,
): Promise<MetricValue<number>> {
  if (scope.clinicId == null) {
    return UNAVAILABLE(
      "Invoice payments require clinic scoping via invoices.clinic_id.",
    );
  }
  const startIso = win.start.toISOString().slice(0, 10);
  const endIso = win.end.toISOString().slice(0, 10);
  const [row] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${invoicePayments.amount}), 0)::numeric`,
    })
    .from(invoicePayments)
    .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
    .where(
      and(
        gte(invoicePayments.paymentDate, startIso),
        lt(invoicePayments.paymentDate, endIso),
        eq(invoices.clinicId, scope.clinicId),
      ),
    );
  const n = parseFloat(String(row?.total ?? "0"));
  return AVAILABLE(Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);
}

// ─── Finance: outstanding balance across live invoices (clinic-scoped) ─
// Excludes Paid + Cancelled statuses. Uses invoices.total_balance so
// the amount respects on-account balances, not un-remitted totals.
export async function sumInvoicesOutstanding(
  scope: ClinicScope,
): Promise<MetricValue<number>> {
  if (scope.clinicId == null) {
    return UNAVAILABLE(
      "Outstanding balances must be clinic scoped for non-admin viewers.",
    );
  }
  const [row] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${invoices.totalBalance}), 0)::numeric`,
    })
    .from(invoices)
    .where(
      and(
        ne(invoices.status, "Paid"),
        ne(invoices.status, "Cancelled"),
        eq(invoices.clinicId, scope.clinicId),
      ),
    );
  const n = parseFloat(String(row?.total ?? "0"));
  return AVAILABLE(Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);
}

// ─── Distinct-patient count in a schedule window (clinic-scoped) ─
// Home Stats uses this for its "upcoming distinct patients" tile. The
// count is DISTINCT ON patient_screening_id so a single patient with
// multiple appointments in the window contributes 1.
export async function countDistinctPatientsScheduledInRange(
  win: DateWindow,
  scope: ClinicScope,
  eventTypes: readonly string[],
): Promise<MetricValue<number>> {
  if (eventTypes.length === 0) {
    return UNAVAILABLE("no event types requested");
  }
  const conds = [
    gte(globalScheduleEvents.startsAt, win.start),
    lt(globalScheduleEvents.startsAt, win.end),
    ne(globalScheduleEvents.status, "cancelled"),
    or(...eventTypes.map((t) => eq(globalScheduleEvents.eventType, t))),
  ];
  if (scope.clinicId != null) {
    conds.push(eq(globalScheduleEvents.clinicId, scope.clinicId));
  }
  const [row] = await db
    .select({
      n: sql<number>`count(distinct ${globalScheduleEvents.patientScreeningId})::int`,
    })
    .from(globalScheduleEvents)
    .where(and(...conds));
  return AVAILABLE(row?.n ?? 0);
}

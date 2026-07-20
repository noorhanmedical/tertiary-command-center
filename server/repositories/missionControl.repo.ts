// Mission Control repository — bounded scoped counts, authoritative
// sources only, real enum values only. No proxy metrics.
//
// Every helper returns a discriminated union:
//   { available: true, value: N }   — authoritative query ran (N may be 0)
//   { available: false, reason: X } — no authoritative source or an
//                                     unresolvable scope
//
// This forces callers to distinguish "query ran, count is 0" from
// "there is no source to query." A DB or service ERROR from the query
// itself is NEVER silently converted to `available: false` — the
// exception propagates to the service, which surfaces 500 to the route.
//
// SCOPING RULE
//   • Any helper that accepts clinicId MUST honor it (either directly
//     via a clinic_id column or via a bounded JOIN through an
//     authoritative relationship). Silently ignoring scope is a bug.
//   • Helpers that CANNOT be safely clinic-scoped are named with a
//     `_platformWide` suffix and take a `PlatformScope` argument. The
//     Mission Control route is `requireRole("admin")`, so
//     platform-wide values are honest for it — the service surfaces
//     them as-is.
//
// TIMEZONE POLICY
//   This platform has no clinic-timezone table today. The temporary
//   canonical timezone for dashboard windows is UTC. All boundary
//   crossing happens in the service layer via injected Date values;
//   repositories never call `new Date()` themselves.

import { db } from "../db";
import { and, eq, gte, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { patientExecutionCases } from "@shared/schema/executionCase";
import { plexusTasks } from "@shared/schema/plexus";
import { analysisJobs } from "@shared/schema/analysisJobs";
import { globalScheduleEvents } from "@shared/schema/globalSchedule";
import { outreachCalls } from "@shared/schema/outreach";
import { billingReadinessChecks } from "@shared/schema/billingReadiness";
import { caseDocumentReadiness } from "@shared/schema/documentReadiness";
import { patientScreenings } from "@shared/schema/screening";

// ─── Discriminated union types ──────────────────────────────────
export type MetricValue<T> =
  | { available: true; value: T }
  | { available: false; reason: string };

export type ClinicScope = { clinicId: number | null };
export type PlatformScope = { platformOnly: true };

const AVAILABLE = <T,>(value: T): MetricValue<T> => ({ available: true, value });
const UNAVAILABLE = <T,>(reason: string): MetricValue<T> => ({
  available: false,
  reason,
});

// ─── Active execution cases (clinic-scoped) ─────────────────────
// Source: patient_execution_cases (has clinic_id + lifecycle_status).
// Definition: lifecycle_status = 'active'. This mirrors the canonical
// production check used by executionCase.repo.ts:632 — the schema
// declares lifecycle_status NOT NULL with default 'active', so a NULL
// value never legitimately appears; earlier Phase 3 code accepted NULL
// as a defensive coercion, but that risked counting bad rows silently
// AND diverged from every other repository. Corrected to the exact
// authoritative production check.
export async function countActiveExecutionCases(
  scope: ClinicScope,
): Promise<MetricValue<number>> {
  const conds = [eq(patientExecutionCases.lifecycleStatus, "active")];
  if (scope.clinicId != null) {
    conds.push(eq(patientExecutionCases.clinicId, scope.clinicId));
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(patientExecutionCases)
    .where(and(...conds));
  return AVAILABLE(row?.n ?? 0);
}

// ─── Open plexus tasks — PLATFORM-WIDE ──────────────────────────
// plexus_tasks has no clinic_id column; clinic scoping would require a
// JOIN through patient_screening_id → patient_screenings.clinic_id
// that has not been audited for duplicate-row safety. Mission Control
// route is admin-only, so platform-wide is honest.
//
// Real terminal statuses (verified in server/repositories/plexus.repo.ts):
//   "closed", "done"
// Everything else is treated as "open" — this matches the plexus repo
// which uses `ne(status, "closed")` + `ne(status, "done")`.
export async function countOpenPlexusTasks_platformWide(
  _scope: PlatformScope,
): Promise<MetricValue<number>> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(plexusTasks)
    .where(
      and(
        ne(plexusTasks.status, "closed"),
        ne(plexusTasks.status, "done"),
      ),
    );
  return AVAILABLE(row?.n ?? 0);
}

// ─── Running analysis jobs — PLATFORM-WIDE ──────────────────────
// analysis_jobs has no clinic_id column; tenancy is indirect via
// batch_id → screening_batches.clinic_id. Mission Control is
// admin-only, so platform-wide is honest.
// Real status: default is "running" (confirmed in schema).
export async function countRunningAnalysisJobs_platformWide(
  _scope: PlatformScope,
): Promise<MetricValue<number>> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(analysisJobs)
    .where(eq(analysisJobs.status, "running"));
  return AVAILABLE(row?.n ?? 0);
}

// ─── Callbacks pending — PLATFORM-WIDE, INJECTED CLOCK ─────────
// outreach_calls has no clinic_id column; clinic scoping would require
// a JOIN through patient_screening_id → patient_screenings.clinic_id.
// The service supplies `now`; the repo never calls `new Date()`.
// Definition: callback_at IS NOT NULL AND callback_at >= now.
export async function countCallbacksPending_platformWide(
  _scope: PlatformScope,
  now: Date,
): Promise<MetricValue<number>> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(outreachCalls)
    .where(gte(outreachCalls.callbackAt, now));
  return AVAILABLE(row?.n ?? 0);
}

// ─── Scheduled today (clinic-scoped) ────────────────────────────
// Source: global_schedule_events (has clinic_id + status).
// Window and clinic are both required in the args — no default clock.
// Cancelled events are excluded.
export async function countScheduledInWindow(
  scope: ClinicScope,
  window: { start: Date; end: Date },
): Promise<MetricValue<number>> {
  const conds = [
    or(
      eq(globalScheduleEvents.eventType, "doctor_visit"),
      eq(globalScheduleEvents.eventType, "ancillary_appointment"),
    ),
    gte(globalScheduleEvents.startsAt, window.start),
    lt(globalScheduleEvents.startsAt, window.end),
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

// ─── Ready for billing (clinic-scoped) ──────────────────────────
// Source: billing_readiness_checks (has clinic_id).
// Real enum: BILLING_READINESS_STATUSES = ("not_ready",
// "missing_requirements", "ready_to_generate",
// "billing_document_generated", "sent_to_billing"). Only
// "ready_to_generate" is the "ready" bucket. The prior code included
// a guessed "ready" string that never exists in the enum.
export async function countReadyForBilling(
  scope: ClinicScope,
): Promise<MetricValue<number>> {
  const conds = [
    eq(billingReadinessChecks.readinessStatus, "ready_to_generate"),
  ];
  if (scope.clinicId != null) {
    conds.push(eq(billingReadinessChecks.clinicId, scope.clinicId));
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(billingReadinessChecks)
    .where(and(...conds));
  return AVAILABLE(row?.n ?? 0);
}

// ─── Reports missing (clinic-scoped) ────────────────────────────
// Source: case_document_readiness (has clinic_id + document_type +
// document_status). Real DOCUMENT_STATUSES enum:
//   "missing", "pending", "uploaded", "generated", "approved",
//   "completed", "blocked".
//
// A report that is "uploaded" is NOT missing. The prior code counted
// ("pending","uploaded") as outstanding — that is wrong per the
// canonical enum. Corrected definition: document_type='report'
// AND document_status='missing'.
export async function countReportsMissing(
  scope: ClinicScope,
): Promise<MetricValue<number>> {
  const conds = [
    eq(caseDocumentReadiness.documentType, "report"),
    eq(caseDocumentReadiness.documentStatus, "missing"),
  ];
  if (scope.clinicId != null) {
    conds.push(eq(caseDocumentReadiness.clinicId, scope.clinicId));
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(caseDocumentReadiness)
    .where(and(...conds));
  return AVAILABLE(row?.n ?? 0);
}

// ─── Prescreen backlog (clinic-scoped) ──────────────────────────
// Source: patient_screenings (has clinic_id + status).
// Confirmed enum values in use (across the batch-analysis pipeline):
//   "pending" (default), "draft".
// "pending_review" is a QUALIFICATION_STATUS on execution_cases, not a
// screening status; the prior code guessed it here and was wrong.
export async function countPrescreenPending(
  scope: ClinicScope,
): Promise<MetricValue<number>> {
  const conds = [
    or(
      eq(patientScreenings.status, "pending"),
      eq(patientScreenings.status, "draft"),
    ),
    // Screening rows are soft-deleted; don't count them.
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

// ─── Upcoming ancillary patients — NOT IMPLEMENTED ──────────────
// The prior code proxied this from `countActiveExecutionCases` — that
// is not the same metric. "Upcoming ancillary patients" requires:
//   • active case
//   • with an ancillary assignment / procedure event scheduled
//   • inside a specific date window
//   • not cancelled
//   • DEDUPED by patient
// The current schema has procedure_events + global_schedule_events but
// no audited helper that dedupes by patient inside a window. Marking
// this metric explicitly unavailable until a proper repository helper
// is authored.
export async function countUpcomingAncillaryPatients_UNAVAILABLE(
  _scope: ClinicScope,
): Promise<MetricValue<number>> {
  return UNAVAILABLE(
    "No authoritative helper that dedupes upcoming-ancillary patients " +
      "by patient inside a window. Active-case count is NOT a valid " +
      "proxy for this metric.",
  );
}

// Helper: distinct-patient de-duped scheduled count. Used by home
// stats for "how many distinct patients are scheduled in window X."
// This is an authoritative count, but the metric definition must be
// exact — the caller decides which event types are included.
export async function countDistinctPatientsScheduledInWindow(
  scope: ClinicScope,
  window: { start: Date; end: Date },
  eventTypes: string[],
): Promise<MetricValue<number>> {
  if (eventTypes.length === 0) {
    return UNAVAILABLE("no event types requested");
  }
  const conds = [
    gte(globalScheduleEvents.startsAt, window.start),
    lt(globalScheduleEvents.startsAt, window.end),
    ne(globalScheduleEvents.status, "cancelled"),
    or(
      ...eventTypes.map((t) => eq(globalScheduleEvents.eventType, t)),
    ),
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

// ─── Platform-wide wrappers used by Mission Control ─────────────
// The Mission Control route is `requireRole("admin")` and the
// MissionControlSpine client contract does NOT carry a clinic scope
// parameter — the view is intentionally platform-wide today. Rather
// than pass `{ clinicId: null }` to the clinic-scoped helpers above
// (which reads as "clinic-scoped but the scope was silently dropped"),
// Mission Control calls these explicit wrappers. If Mission Control
// ever gains a clinic selector, the service will switch to the
// clinic-scoped helpers directly and these wrappers can be removed.
//
// These wrappers accept `PlatformScope` (a phantom type) so the
// intent is legible at the call site AND the type system prevents
// a future refactor from silently substituting a `ClinicScope` with
// a null clinic.
const PLATFORM: ClinicScope = { clinicId: null };

export function countActiveExecutionCases_platformWide(
  _scope: PlatformScope,
): Promise<MetricValue<number>> {
  return countActiveExecutionCases(PLATFORM);
}
export function countPrescreenPending_platformWide(
  _scope: PlatformScope,
): Promise<MetricValue<number>> {
  return countPrescreenPending(PLATFORM);
}
export function countReadyForBilling_platformWide(
  _scope: PlatformScope,
): Promise<MetricValue<number>> {
  return countReadyForBilling(PLATFORM);
}
export function countReportsMissing_platformWide(
  _scope: PlatformScope,
): Promise<MetricValue<number>> {
  return countReportsMissing(PLATFORM);
}
export function countScheduledInWindow_platformWide(
  _scope: PlatformScope,
  window: { start: Date; end: Date },
): Promise<MetricValue<number>> {
  return countScheduledInWindow(PLATFORM, window);
}

// ─── Test-visible constants ─────────────────────────────────────
export const OPEN_PLEXUS_TASK_TERMINAL_STATUSES = ["closed", "done"] as const;
// notInArray is intentionally re-exported so the static architecture
// test can reference the same alternative-definition pattern without
// duplicating the status list.
void notInArray;

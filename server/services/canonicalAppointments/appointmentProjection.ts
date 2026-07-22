/**
 * Phase 2D-C1 — canonical appointment read projection.
 *
 * The single server-side reader every clinic-facing surface uses to get
 * canonical ancillary appointment truth. The canonical source is
 * `global_schedule_events` (via canonicalAppointments.repo); this layer
 * shapes it into a stable projection, separates the one active scheduled
 * event from history, enforces tenant scope, and surfaces the
 * appointment-only Order Note eligibility (reusing the existing helper —
 * never re-deciding its rules).
 *
 * Feature contract:
 *   • FEATURE_CANONICAL_APPOINTMENT OFF → returns an empty, flag-off
 *     projection and performs ZERO canonical reads. Callers keep their
 *     legacy readers.
 *   • ON → reads canonical truth. A missing migration surfaces as the
 *     repo's controlled CANONICAL_APPOINTMENT_MIGRATION_MISSING (503);
 *     it is never masked by falling back to legacy data.
 *   • doctor_visit is NEVER treated as an ancillary appointment.
 *   • Another clinic's records are never returned.
 */

import { featureFlags } from "../../lib/featureFlags";
import type { GlobalScheduleEvent } from "@shared/schema/globalSchedule";
import {
  CANONICAL_ANCILLARY_EVENT_TYPES,
  type CanonicalAppointmentStatus,
} from "@shared/schema/canonicalAppointments";
import {
  listCanonicalAppointmentsForAncillaryCase,
  listCanonicalAppointmentsForScreening,
  listCanonicalAppointmentsForExecutionCase,
} from "../../repositories/canonicalAppointments.repo";
import { isOrderNoteAppointmentEligible } from "./canonicalAppointmentService";
import { db } from "../../db";
import { and, eq, inArray } from "drizzle-orm";
import { patientAncillaryCases } from "@shared/schema/ancillaryCases";
import type {
  CanonicalAppointmentView as SerializedAppointmentView,
  AncillaryAppointmentProjection as SerializedProjection,
} from "@shared/types/canonicalAppointment";

const HISTORY_STATUSES = new Set<CanonicalAppointmentStatus>([
  "completed",
  "cancelled",
  "no_show",
  "rescheduled",
]);

export type CanonicalAppointmentView = {
  globalScheduleEventId: number;
  ancillaryCaseId: number | null;
  patientScreeningId: number | null;
  executionCaseId: number | null;
  clinicId: number | null;
  serviceType: string | null;
  eventType: string;
  status: string;
  startsAt: Date;
  endsAt: Date | null;
  timezone: string | null;
  facilityId: string | null;
  assignedUserId: string | null;
  parentEventId: number | null;
  cancellationReason: string | null;
  noShowReason: string | null;
  source: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CanonicalAppointmentProjection = {
  flagOff: boolean;
  activeAppointment: CanonicalAppointmentView | null;
  appointmentHistory: CanonicalAppointmentView[];
  hasQualifyingOrderNoteAppointment: boolean;
  appointmentEligibleForOrderNote: boolean;
  appointmentEligibilityReason: string;
};

export type ProjectionQuery = {
  clinicId: number;
  ancillaryCaseId?: number;
  patientScreeningId?: number;
  executionCaseId?: number;
  includeHistory?: boolean;
};

function toView(e: GlobalScheduleEvent): CanonicalAppointmentView {
  const meta = (e.metadata ?? {}) as Record<string, unknown>;
  return {
    globalScheduleEventId: e.id,
    ancillaryCaseId: e.ancillaryCaseId ?? null,
    patientScreeningId: e.patientScreeningId ?? null,
    executionCaseId: e.executionCaseId ?? null,
    clinicId: e.clinicId ?? null,
    serviceType: e.serviceType ?? null,
    eventType: e.eventType,
    status: e.status,
    startsAt: e.startsAt,
    endsAt: e.endsAt ?? null,
    timezone: typeof meta.timezone === "string" ? (meta.timezone as string) : null,
    facilityId: e.facilityId ?? null,
    assignedUserId: e.assignedUserId ?? null,
    parentEventId: e.parentEventId ?? null,
    cancellationReason: e.cancellationReason ?? null,
    noShowReason: e.noShowReason ?? null,
    source: e.source,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

function emptyFlagOff(): CanonicalAppointmentProjection {
  return {
    flagOff: true,
    activeAppointment: null,
    appointmentHistory: [],
    hasQualifyingOrderNoteAppointment: false,
    appointmentEligibleForOrderNote: false,
    appointmentEligibilityReason: "flag_off",
  };
}

/** Tenant-scoped, canonical-typed, doctor_visit-excluded events. */
function scopeEvents(events: GlobalScheduleEvent[], clinicId: number): GlobalScheduleEvent[] {
  return events.filter(
    (e) =>
      (CANONICAL_ANCILLARY_EVENT_TYPES as readonly string[]).includes(e.eventType) &&
      (e.clinicId == null || e.clinicId === clinicId),
  );
}

function buildProjection(
  events: GlobalScheduleEvent[],
  includeHistory: boolean,
  eligibility: { eligible: boolean; reason: string },
): CanonicalAppointmentProjection {
  const active = events.find((e) => e.status === "scheduled") ?? null;
  const history = includeHistory
    ? events
        .filter((e) => HISTORY_STATUSES.has(e.status as CanonicalAppointmentStatus))
        // Ordered by actual event time, then immutable id for a stable
        // deterministic sequence.
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id - b.id)
        .map(toView)
    : [];
  return {
    flagOff: false,
    activeAppointment: active ? toView(active) : null,
    appointmentHistory: history,
    hasQualifyingOrderNoteAppointment: eligibility.eligible,
    appointmentEligibleForOrderNote: eligibility.eligible,
    appointmentEligibilityReason: eligibility.reason,
  };
}

/**
 * Per-ancillary-case projection. `ancillaryCaseId` gives the most
 * precise result (one active event by the partial-unique index + full
 * history + Order Note eligibility). Screening / execution-case queries
 * return the active event + history across that entity's canonical
 * events (use getCanonicalAppointmentsByService for per-service split).
 */
export async function getCanonicalAppointmentProjection(
  query: ProjectionQuery,
): Promise<CanonicalAppointmentProjection> {
  if (!featureFlags.canonicalAppointment) return emptyFlagOff();

  let events: GlobalScheduleEvent[] = [];
  if (query.ancillaryCaseId != null) {
    events = await listCanonicalAppointmentsForAncillaryCase(query.ancillaryCaseId);
  } else if (query.patientScreeningId != null) {
    events = await listCanonicalAppointmentsForScreening(query.patientScreeningId);
  } else if (query.executionCaseId != null) {
    events = await listCanonicalAppointmentsForExecutionCase(query.executionCaseId);
  }
  const scoped = scopeEvents(events, query.clinicId);

  // Order Note eligibility reuses the canonical helper (never re-decides).
  let eligibility = { eligible: false, reason: "no_qualifying_appointment" };
  if (query.ancillaryCaseId != null) {
    const r = await isOrderNoteAppointmentEligible({ ancillaryCaseId: query.ancillaryCaseId });
    eligibility = { eligible: r.eligible, reason: r.eligible ? "qualifying_appointment" : r.reason };
  }

  return buildProjection(scoped, query.includeHistory ?? true, eligibility);
}

/**
 * Per-service map for multi-service entities (Engagement / PCS). Groups
 * a screening's or execution case's canonical events by their ancillary
 * case's service_type and returns a projection per service. Never
 * attaches one execution-case appointment to every selected service.
 */
export async function getCanonicalAppointmentsByService(query: {
  clinicId: number;
  patientScreeningId?: number;
  executionCaseId?: number;
  includeHistory?: boolean;
}): Promise<Record<string, CanonicalAppointmentProjection>> {
  if (!featureFlags.canonicalAppointment) return {};

  let events: GlobalScheduleEvent[] = [];
  if (query.patientScreeningId != null) {
    events = await listCanonicalAppointmentsForScreening(query.patientScreeningId);
  } else if (query.executionCaseId != null) {
    events = await listCanonicalAppointmentsForExecutionCase(query.executionCaseId);
  }
  const scoped = scopeEvents(events, query.clinicId);
  if (scoped.length === 0) return {};

  // Resolve serviceType per ancillary case from the case table (the
  // event carries service_type too, but the case is authoritative).
  const caseIds = [...new Set(scoped.map((e) => e.ancillaryCaseId).filter((x): x is number => x != null))];
  const caseRows = caseIds.length
    ? await db
        .select({ id: patientAncillaryCases.id, serviceType: patientAncillaryCases.serviceType, clinicId: patientAncillaryCases.clinicId })
        .from(patientAncillaryCases)
        .where(and(inArray(patientAncillaryCases.id, caseIds), eq(patientAncillaryCases.clinicId, query.clinicId)))
    : [];
  const serviceByCase = new Map<number, string>();
  for (const c of caseRows) serviceByCase.set(c.id, c.serviceType);

  const out: Record<string, CanonicalAppointmentProjection> = {};
  const byCase = new Map<number, GlobalScheduleEvent[]>();
  for (const e of scoped) {
    if (e.ancillaryCaseId == null || !serviceByCase.has(e.ancillaryCaseId)) continue;
    const arr = byCase.get(e.ancillaryCaseId) ?? [];
    arr.push(e);
    byCase.set(e.ancillaryCaseId, arr);
  }
  for (const [caseId, evs] of byCase) {
    const serviceType = serviceByCase.get(caseId)!;
    const r = await isOrderNoteAppointmentEligible({ ancillaryCaseId: caseId });
    out[serviceType] = buildProjection(evs, query.includeHistory ?? false, {
      eligible: r.eligible,
      reason: r.eligible ? "qualifying_appointment" : r.reason,
    });
  }
  return out;
}

// ─── Serialization to the shared cross-boundary contract ─────────
// Express already stringifies Date → ISO on res.json, but explicit
// serialization guarantees the JSON-safe shape portal clients import
// from @shared/types/canonicalAppointment.

function serializeView(v: CanonicalAppointmentView): SerializedAppointmentView {
  return {
    globalScheduleEventId: v.globalScheduleEventId,
    ancillaryCaseId: v.ancillaryCaseId,
    patientScreeningId: v.patientScreeningId,
    executionCaseId: v.executionCaseId,
    serviceType: v.serviceType,
    eventType: v.eventType,
    status: v.status,
    startsAt: v.startsAt.toISOString(),
    endsAt: v.endsAt ? v.endsAt.toISOString() : null,
    timezone: v.timezone,
    facilityId: v.facilityId,
    location: v.facilityId,
    assignedUserId: v.assignedUserId,
    parentEventId: v.parentEventId,
    cancellationReason: v.cancellationReason,
    noShowReason: v.noShowReason,
  };
}

export function serializeProjection(p: CanonicalAppointmentProjection): SerializedProjection {
  return {
    activeAppointment: p.activeAppointment ? serializeView(p.activeAppointment) : null,
    appointmentHistory: p.appointmentHistory.map(serializeView),
    appointmentEligibleForOrderNote: p.appointmentEligibleForOrderNote,
    appointmentEligibilityReason: p.appointmentEligibilityReason,
  };
}

/** Serialized per-case projection for portal API responses. */
export async function getSerializedAppointmentProjection(
  query: ProjectionQuery,
): Promise<SerializedProjection & { flagOff: boolean }> {
  const p = await getCanonicalAppointmentProjection(query);
  return { flagOff: p.flagOff, ...serializeProjection(p) };
}

/** Serialized per-service map for portal API responses. */
export async function getSerializedAppointmentsByService(query: {
  clinicId: number;
  patientScreeningId?: number;
  executionCaseId?: number;
  includeHistory?: boolean;
}): Promise<Record<string, SerializedProjection>> {
  const m = await getCanonicalAppointmentsByService(query);
  const out: Record<string, SerializedProjection> = {};
  for (const [service, proj] of Object.entries(m)) out[service] = serializeProjection(proj);
  return out;
}

// Multi-service VISIT orchestration.
//
// A patient's selected ancillary services are ONE intended visit, but each
// service remains its own canonical global_schedule_event. This orchestrates
// writing every service block through the SAME single-service core the
// schedule-ancillary route uses (so there is no divergent write path), groups
// them with a shared visitGroupId, records any capacity/off-day OVERRIDE with a
// full audit, and reports an all-or-partial result so the UI never silently
// loses a service.
//
// Not a DB transaction across services (each service write has its own
// journey + execution-case side effects); instead it is best-effort with an
// explicit per-service outcome, matching the spec's "all persist OR a clear
// partial/failure state" requirement.

import { randomUUID } from "node:crypto";
import { createFacilityResolver } from "../facilityResolver";
import {
  scheduleAncillaryCoreShared,
  type ScheduleAncillaryCoreInput,
} from "../../routes/globalSchedule";
import { logAudit } from "../auditService";
import type { Request } from "express";

export type VisitServiceInput = {
  /** Canonical registry internalCode. */
  serviceType: string;
  /** "HH:MM" local start for this service block. */
  time: string;
  /** Ultrasound only — number of studies. */
  studyCount?: number;
};

export type VisitOverride = {
  /** The conflict being overridden (from the availability engine). */
  constraint: "full" | "off_day" | "outage";
  reason: string;
  /** Optional operator-chosen category (free-text reason is the minimum). */
  category?: string | null;
  /** Snapshot of capacity/availability at override time (audit). */
  capacityState?: Record<string, unknown> | null;
};

export type VisitScheduleInput = {
  facility: string | null;
  date: string; // YYYY-MM-DD
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  patientName?: string | null;
  patientDob?: string | null;
  services: VisitServiceInput[];
  /** Per-service override keyed by serviceType, when scheduling despite a conflict. */
  overrides?: Record<string, VisitOverride>;
};

export type VisitServiceResult = {
  serviceType: string;
  time: string;
  status: "scheduled" | "deferred" | "failed";
  httpStatus: number;
  globalScheduleEventId?: number | null;
  /** True when the patient already had this active appointment (no new write). */
  reused?: boolean;
  overridden: boolean;
  error?: string;
};

export type VisitScheduleResult = {
  visitGroupId: string;
  overall: "all_scheduled" | "partial" | "failed";
  scheduledCount: number;
  totalCount: number;
  services: VisitServiceResult[];
};

function combineToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const local = new Date(`${date}T${time.padStart(5, "0")}:00`);
  return Number.isNaN(local.getTime()) ? null : local.toISOString();
}

/**
 * Schedule every selected service for the visit. `req` is used only for the
 * session actor/role (audit) and clinic scope; override authorization is
 * enforced by the CALLER (route) before invoking this.
 */
export async function scheduleVisit(
  req: Request,
  input: VisitScheduleInput,
): Promise<VisitScheduleResult> {
  const actorUserId =
    (req as Request & { session?: { userId?: string } }).session?.userId ?? null;
  const actorRole =
    (req as Request & { session?: { role?: string } }).session?.role ?? null;
  let reqClinicId = (req as { clinicId?: number | null }).clinicId ?? null;
  if (reqClinicId == null && input.facility) {
    try {
      const { resolve } = await createFacilityResolver();
      reqClinicId = resolve(input.facility)?.clinicId ?? null;
    } catch {
      /* deferred path still handled downstream */
    }
  }

  const visitGroupId = randomUUID();
  const isMultiService = input.services.length > 1;
  const results: VisitServiceResult[] = [];

  for (const svc of input.services) {
    const startsAt = combineToIso(input.date, svc.time);
    if (!startsAt) {
      results.push({
        serviceType: svc.serviceType,
        time: svc.time,
        status: "failed",
        httpStatus: 400,
        overridden: false,
        error: "Invalid date/time",
      });
      continue;
    }
    const override = input.overrides?.[svc.serviceType] ?? null;
    const metadata: Record<string, unknown> = {
      source: "unified_scheduler_visit",
      visitGroupId,
      visitServiceCount: input.services.length,
      isMultiServiceVisit: isMultiService,
    };
    if (svc.studyCount && svc.studyCount > 1) metadata.ultrasoundStudyCount = svc.studyCount;
    else if (svc.studyCount) metadata.ultrasoundStudyCount = svc.studyCount;
    if (override) {
      // Operational override metadata rides on the event so reads (day agenda)
      // can show a subtle "capacity override" indicator.
      metadata.override = {
        constraint: override.constraint,
        reason: override.reason,
        category: override.category ?? null,
        actorUserId,
        actorRole,
        requestedTime: svc.time,
        capacityState: override.capacityState ?? null,
        at: new Date().toISOString(),
      };
    }

    const coreInput: ScheduleAncillaryCoreInput = {
      executionCaseId: input.executionCaseId ?? null,
      patientScreeningId: input.patientScreeningId ?? null,
      patientName: input.patientScreeningId == null ? input.patientName ?? null : null,
      patientDob: input.patientScreeningId == null ? input.patientDob ?? null : null,
      serviceType: svc.serviceType,
      startsAt,
      endsAt: null,
      facilityId: input.facility,
      metadata,
    };

    let outcome: VisitServiceResult;
    try {
      const res = await scheduleAncillaryCoreShared(coreInput, actorUserId, reqClinicId);
      const body = res.body as {
        deferred?: boolean;
        created?: boolean;
        event?: { id?: number };
        globalScheduleEventId?: number;
        error?: string;
      };
      const eventId = body.globalScheduleEventId ?? body.event?.id ?? null;
      const status: VisitServiceResult["status"] =
        res.httpStatus === 200 && !body.deferred
          ? "scheduled"
          : body.deferred || res.httpStatus === 202
            ? "deferred"
            : "failed";
      outcome = {
        serviceType: svc.serviceType,
        time: svc.time,
        status,
        httpStatus: res.httpStatus,
        globalScheduleEventId: eventId,
        // "reused" means the patient already had this active appointment — the
        // override didn't create anything new, so it isn't a real override.
        reused: status === "scheduled" && body.created === false,
        overridden: !!override && !(status === "scheduled" && body.created === false),
        error: status === "failed" ? body.error ?? "schedule failed" : undefined,
      };
    } catch (e) {
      outcome = {
        serviceType: svc.serviceType,
        time: svc.time,
        status: "failed",
        httpStatus: 500,
        overridden: !!override,
        error: e instanceof Error ? e.message : "schedule threw",
      };
    }

    // Audit every OVERRIDE with the full operational context (spec §4). Only
    // when the override actually produced a new appointment (not a reuse of a
    // pre-existing one — the canonical model allows one active appointment per
    // case+service, so a duplicate is a reuse, not a real override).
    if (override && outcome.overridden && outcome.status === "scheduled") {
      void logAudit(req, "override_schedule", "global_schedule_event", outcome.globalScheduleEventId ?? null, {
        visitGroupId,
        facility: input.facility,
        patientScreeningId: input.patientScreeningId ?? null,
        executionCaseId: input.executionCaseId ?? null,
        serviceType: svc.serviceType,
        requestedTime: svc.time,
        date: input.date,
        constraint: override.constraint,
        reason: override.reason,
        category: override.category ?? null,
        actorUserId,
        actorRole,
        capacityState: override.capacityState ?? null,
      });
    }

    results.push(outcome);
  }

  const scheduledCount = results.filter((r) => r.status === "scheduled").length;
  const overall: VisitScheduleResult["overall"] =
    scheduledCount === results.length
      ? "all_scheduled"
      : scheduledCount === 0
        ? "failed"
        : "partial";

  return {
    visitGroupId,
    overall,
    scheduledCount,
    totalCount: results.length,
    services: results,
  };
}

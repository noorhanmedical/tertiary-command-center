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

/** One date's worth of service blocks within a (possibly multi-date) visit. */
export type VisitGroupInput = {
  date: string; // YYYY-MM-DD
  services: VisitServiceInput[];
  /** Per-service override keyed by serviceType, for THIS date's blocks. */
  overrides?: Record<string, VisitOverride>;
};

export type VisitScheduleInput = {
  facility: string | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  patientName?: string | null;
  patientDob?: string | null;
  /**
   * Multi-date visit groups. A single-visit is just one group. Every event
   * across every group shares one visitGroupId.
   */
  groups: VisitGroupInput[];
  /** Reuse an existing visit group id (idempotent re-submits); else generated. */
  visitGroupId?: string | null;
};

export type VisitServiceResult = {
  date: string;
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
  /** Distinct dates the visit spans. */
  dates: string[];
  services: VisitServiceResult[];
};

function combineToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const local = new Date(`${date}T${time.padStart(5, "0")}:00`);
  return Number.isNaN(local.getTime()) ? null : local.toISOString();
}

/**
 * Schedule every selected service across one or more dates as ONE visit. Each
 * service is its own canonical event; all share a single visitGroupId. `req`
 * supplies the session actor/role (audit) and clinic scope; override
 * authorization is enforced by the CALLER (route) before invoking this.
 *
 * Idempotent orchestration (not a single cross-service DB transaction, because
 * each write has its own journey + execution-case side effects): every service
 * gets an explicit per-service result so a service is never silently lost.
 */
export async function scheduleVisit(
  req: Request,
  input: VisitScheduleInput,
): Promise<VisitScheduleResult> {
  const actorUserId =
    (req as Request & { session?: { userId?: string } }).session?.userId ?? null;
  const actorRole =
    (req as Request & { session?: { role?: string } }).session?.role ?? null;
  // Resolve the actor's display name once so overrides read cleanly in the
  // agenda ("By: Calista") instead of a raw user id.
  let actorName: string | null = null;
  if (actorUserId) {
    try {
      const { storage } = await import("../../storage");
      const u = await storage.getUser(actorUserId);
      actorName = (u as { name?: string; username?: string } | undefined)?.name
        ?? (u as { username?: string } | undefined)?.username
        ?? null;
    } catch {
      /* name is best-effort */
    }
  }
  let reqClinicId = (req as { clinicId?: number | null }).clinicId ?? null;
  if (reqClinicId == null && input.facility) {
    try {
      const { resolve } = await createFacilityResolver();
      reqClinicId = resolve(input.facility)?.clinicId ?? null;
    } catch {
      /* deferred path still handled downstream */
    }
  }

  const visitGroupId = input.visitGroupId ?? randomUUID();
  const totalServices = input.groups.reduce((n, g) => n + g.services.length, 0);
  const results: VisitServiceResult[] = [];

  for (const group of input.groups) {
   for (const svc of group.services) {
    const override = group.overrides?.[svc.serviceType] ?? null;
    const startsAt = combineToIso(group.date, svc.time);
    if (!startsAt) {
      results.push({
        date: group.date,
        serviceType: svc.serviceType,
        time: svc.time,
        status: "failed",
        httpStatus: 400,
        overridden: false,
        error: "Invalid date/time",
      });
      continue;
    }
    const metadata: Record<string, unknown> = {
      source: "unified_scheduler_visit",
      visitGroupId,
      visitServiceCount: totalServices,
      isMultiServiceVisit: totalServices > 1,
      isMultiDateVisit: input.groups.length > 1,
      visitDate: group.date,
    };
    if (svc.studyCount) metadata.ultrasoundStudyCount = svc.studyCount;
    if (override) {
      // Operational override metadata rides on the event so reads (day agenda)
      // can show a subtle "capacity override" indicator + who/why/when.
      metadata.override = {
        constraint: override.constraint,
        reason: override.reason,
        category: override.category ?? null,
        actorUserId,
        actorRole,
        actorName,
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
      facilityId: input.facility ?? undefined,
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
        date: group.date,
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
        date: group.date,
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
        date: group.date,
        constraint: override.constraint,
        reason: override.reason,
        category: override.category ?? null,
        actorUserId,
        actorRole,
        actorName,
        capacityState: override.capacityState ?? null,
      });
    }

    results.push(outcome);
   }
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
    dates: Array.from(new Set(results.map((r) => r.date))).sort(),
    services: results,
  };
}

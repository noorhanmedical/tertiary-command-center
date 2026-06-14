import type { Express, Request, Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { patientExecutionCases } from "@shared/schema/executionCase";
import {
  listGlobalScheduleEvents,
  getGlobalScheduleEventById,
  listTechnicianLiaisonClinicVisits,
  listTechnicianLiaisonAncillarySchedule,
  listTeamAvailabilityBlocks,
  listUltrasoundTechSchedule,
  upsertAncillaryScheduleEvent,
} from "../repositories/globalSchedule.repo";
import {
  getExecutionCaseById,
  getExecutionCaseByScreeningId,
} from "../repositories/executionCase.repo";
import { appendJourneyEvent } from "../services/journey/appendJourneyEvent";
import {
  applyScheduleTransition,
  type ScheduleTransition,
} from "../services/scheduling/scheduleStatusService";
// PHASE-1 FACILITY SCOPE — Phase 1 Slice 1.2 wires the team-portal
// feeds through the same role + facility access checks the rest of
// the portal endpoints already use. Without this, an authenticated
// user could request any facilityId in the query string and bypass
// the assigned-facility allow-list returned by /api/portal/my-facilities.
import { requirePortalRole, allowedFacilities, resolveAdminViewAsUserId, type ViewAsWorkspaceType } from "./portal";

// Resolves the requested facilityId for a Phase-1 team-portal feed.
// Returns either an HTTP error to send or the (admin-pass-through or
// scoped) facilityId to apply to the underlying repository call.
//
// ADMIN VIEW-AS: when the caller is admin AND a `viewAsTeamMemberId`
// query param is supplied, the facility allow-list narrows to that team
// member's assigned facilities. Admin's session identity is preserved
// so writes still log the real admin. The `workspace` argument
// additionally enforces role compatibility (PCS↔liaison, ACS↔technician).
async function resolvePhase1FacilityScope(
  req: Request,
  res: Response,
  rawFacilityId: string | undefined,
  rawViewAsTeamMemberId?: string,
  workspace?: ViewAsWorkspaceType,
): Promise<{ ok: true; facilityId: string | null; viewAsUserId: string | null } | { ok: false }> {
  const viewAsUserId = await resolveAdminViewAsUserId(req, rawViewAsTeamMemberId, workspace);
  const allowed = await allowedFacilities(req, { viewAsUserId });
  const facilityId = (rawFacilityId ?? "").trim() || null;
  if (allowed.all) {
    // Admin (no view-as): pass through whatever was requested (or null
    // = unfiltered).
    return { ok: true, facilityId, viewAsUserId };
  }
  if (!facilityId) {
    res
      .status(400)
      .json({ error: "facilityId is required for non-admin callers" });
    return { ok: false };
  }
  if (!allowed.facilities.has(facilityId)) {
    res
      .status(403)
      .json({ error: "Forbidden — clinic not assigned to this user" });
    return { ok: false };
  }
  return { ok: true, facilityId, viewAsUserId };
}

const transitionBodySchema = z.object({
  transition: z.enum(["cancel", "reschedule", "no_show", "confirm"]),
  newStartsAt: z.string().optional().nullable(),
  newEndsAt: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

const scheduleAncillaryBodySchema = z.object({
  executionCaseId: z.number().int().optional().nullable(),
  patientScreeningId: z.number().int().optional().nullable(),
  serviceType: z.string().min(1),
  startsAt: z.string().min(1),
  endsAt: z.string().optional().nullable(),
  facilityId: z.string().optional().nullable(),
  assignedUserId: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

function sessionUserIdFromGlobalSchedule(req: Request): string | null {
  const sess = (req as Request & { session?: { userId?: string } }).session;
  return sess?.userId ?? null;
}

export function registerGlobalScheduleRoutes(app: Express) {
  // GET /api/global-schedule-events
  // Filters: facilityId, eventType, status, assignedUserId, assignedRole,
  //          executionCaseId, patientScreeningId, startDate, endDate, limit
  app.get("/api/global-schedule-events", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listGlobalScheduleEvents>[0] = {};

      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.eventType) filters.eventType = q.eventType;
      if (q.status) filters.status = q.status;
      if (q.assignedUserId) filters.assignedUserId = q.assignedUserId;
      if (q.assignedRole) filters.assignedRole = q.assignedRole;
      if (q.executionCaseId) {
        const id = parseInt(q.executionCaseId, 10);
        if (!isNaN(id)) filters.executionCaseId = id;
      }
      if (q.patientScreeningId) {
        const id = parseInt(q.patientScreeningId, 10);
        if (!isNaN(id)) filters.patientScreeningId = id;
      }
      if (q.startDate) {
        const d = new Date(q.startDate);
        if (!isNaN(d.getTime())) filters.startDate = d;
      }
      if (q.endDate) {
        const d = new Date(q.endDate);
        if (!isNaN(d.getTime())) filters.endDate = d;
      }

      const rows = await listGlobalScheduleEvents(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/technician-liaison/clinic-visits
  // Filters: facilityId, assignedUserId, startDate, endDate, limit
  //
  // PHASE-1 FACILITY SCOPE: requirePortalRole gates the session role
  // and resolvePhase1FacilityScope verifies the requested facilityId
  // against allowedFacilities(req). Non-admin callers without a
  // facilityId receive 400; non-admin callers requesting a facility
  // outside their assigned set receive 403.
  app.get("/api/technician-liaison/clinic-visits", requirePortalRole, async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const scope = await resolvePhase1FacilityScope(req, res, q.facilityId, q.viewAsTeamMemberId);
      if (!scope.ok) return;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listTechnicianLiaisonClinicVisits>[0] = {};
      if (scope.facilityId) filters.facilityId = scope.facilityId;
      if (q.assignedUserId) filters.assignedUserId = q.assignedUserId;
      if (q.startDate) {
        const d = new Date(q.startDate);
        if (!isNaN(d.getTime())) filters.startDate = d;
      }
      if (q.endDate) {
        const d = new Date(q.endDate);
        if (!isNaN(d.getTime())) filters.endDate = d;
      }
      const rows = await listTechnicianLiaisonClinicVisits(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/technician-liaison/ancillary-schedule
  // Filters: facilityId, assignedUserId, serviceType, startDate, endDate, limit
  //
  // PHASE-1 FACILITY SCOPE: same role + facility access pattern as
  // /api/technician-liaison/clinic-visits above.
  app.get("/api/technician-liaison/ancillary-schedule", requirePortalRole, async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const scope = await resolvePhase1FacilityScope(req, res, q.facilityId, q.viewAsTeamMemberId);
      if (!scope.ok) return;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listTechnicianLiaisonAncillarySchedule>[0] = {};
      if (scope.facilityId) filters.facilityId = scope.facilityId;
      if (q.assignedUserId) filters.assignedUserId = q.assignedUserId;
      if (q.serviceType) filters.serviceType = q.serviceType;
      if (q.startDate) {
        const d = new Date(q.startDate);
        if (!isNaN(d.getTime())) filters.startDate = d;
      }
      if (q.endDate) {
        const d = new Date(q.endDate);
        if (!isNaN(d.getTime())) filters.endDate = d;
      }
      const rows = await listTechnicianLiaisonAncillarySchedule(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/global-schedule/team-availability-blocks
  // Filters: assignedUserId, facilityId, eventType, startDate, endDate, limit
  // Returns pto_block / sick_day / unavailable_block events ordered by startsAt ASC.
  app.get("/api/global-schedule/team-availability-blocks", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listTeamAvailabilityBlocks>[0] = {};
      if (q.assignedUserId) filters.assignedUserId = q.assignedUserId;
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.eventType === "pto_block" || q.eventType === "sick_day" || q.eventType === "unavailable_block") {
        filters.eventType = q.eventType;
      }
      if (q.startDate) {
        const d = new Date(q.startDate);
        if (!isNaN(d.getTime())) filters.startDate = d;
      }
      if (q.endDate) {
        const d = new Date(q.endDate);
        if (!isNaN(d.getTime())) filters.endDate = d;
      }
      const rows = await listTeamAvailabilityBlocks(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/ultrasound-tech/schedule
  // Filters: assignedUserId, facilityId, serviceType, status, startDate, endDate, limit
  // Returns ancillary_appointment + same_day_add events filtered to
  // ultrasound-relevant service types (default) ordered by startsAt ASC.
  app.get("/api/ultrasound-tech/schedule", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listUltrasoundTechSchedule>[0] = {};
      if (q.assignedUserId) filters.assignedUserId = q.assignedUserId;
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.serviceType) filters.serviceType = q.serviceType;
      if (q.status) filters.status = q.status;
      if (q.startDate) {
        const d = new Date(q.startDate);
        if (!isNaN(d.getTime())) filters.startDate = d;
      }
      if (q.endDate) {
        const d = new Date(q.endDate);
        if (!isNaN(d.getTime())) filters.endDate = d;
      }
      const rows = await listUltrasoundTechSchedule(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/global-schedule-events/schedule-ancillary
  // Body: serviceType (required), startsAt (required ISO), endsAt?,
  //       executionCaseId? | patientScreeningId? (one required),
  //       facilityId?, assignedUserId?, note?, metadata?
  // Upserts an ancillary_appointment global_schedule_event (deduped by
  // patientScreeningId + serviceType + startsAt), appends a
  // scheduled_ancillary patient journey event, and advances the execution
  // case to engagementStatus=scheduled with nextActionAt=startsAt.
  app.post("/api/global-schedule-events/schedule-ancillary", async (req, res) => {
    try {
      const parsed = scheduleAncillaryBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const data = parsed.data;
      const actorUserId = sessionUserIdFromGlobalSchedule(req);

      const startsAt = new Date(data.startsAt);
      if (isNaN(startsAt.getTime())) {
        return res.status(400).json({ error: "startsAt is not a valid datetime" });
      }
      const endsAt = data.endsAt ? new Date(data.endsAt) : null;
      if (endsAt && isNaN(endsAt.getTime())) {
        return res.status(400).json({ error: "endsAt is not a valid datetime" });
      }

      // Resolve patient context — must be able to identify the case
      let executionCaseId: number | null = data.executionCaseId ?? null;
      let patientScreeningId: number | null = data.patientScreeningId ?? null;
      let executionCase: Awaited<ReturnType<typeof getExecutionCaseById>> | null = null;

      if (executionCaseId !== null) {
        const ec = await getExecutionCaseById(executionCaseId);
        if (ec) {
          executionCase = ec;
          if (patientScreeningId === null) patientScreeningId = ec.patientScreeningId ?? null;
        }
      }
      if (executionCase === null && patientScreeningId !== null) {
        const ec = await getExecutionCaseByScreeningId(patientScreeningId);
        if (ec) {
          executionCase = ec;
          executionCaseId = ec.id;
        }
      }
      if (!executionCase) {
        return res.status(404).json({
          error: "Could not resolve an execution case from executionCaseId or patientScreeningId",
        });
      }

      const facilityId = data.facilityId ?? executionCase.facilityId ?? null;

      // Upsert ancillary appointment (dedup happens inside the repo helper)
      const { event, created } = await upsertAncillaryScheduleEvent({
        executionCaseId: executionCase.id,
        patientScreeningId: patientScreeningId ?? executionCase.patientScreeningId ?? null,
        patientName: executionCase.patientName,
        patientDob: executionCase.patientDob ?? null,
        facilityId,
        serviceType: data.serviceType,
        startsAt,
        endsAt,
        assignedUserId: data.assignedUserId ?? null,
        source: "scheduler_portal",
        note: data.note ?? null,
        metadata: { actorUserId, ...(data.metadata ?? {}) },
      });

      // Append journey event (best-effort)
      let journeyEvent: Awaited<ReturnType<typeof appendJourneyEvent>> | null = null;
      try {
        journeyEvent = await appendJourneyEvent({
          patientName: executionCase.patientName,
          patientDob: executionCase.patientDob ?? undefined,
          patientScreeningId: patientScreeningId ?? executionCase.patientScreeningId ?? undefined,
          executionCaseId: executionCase.id,
          eventType: "scheduled_ancillary",
          eventSource: "scheduler_portal",
          actorUserId,
          summary: `Ancillary ${data.serviceType} ${created ? "scheduled" : "rescheduled"} for ${startsAt.toISOString()}`,
          metadata: {
            globalScheduleEventId: event.id,
            serviceType: data.serviceType,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt ? endsAt.toISOString() : null,
            assignedUserId: data.assignedUserId ?? null,
            facilityId: facilityId ?? null,
            note: data.note ?? null,
            created,
            ...(data.metadata ?? {}),
          },
        });
      } catch (err: any) {
        console.error("[schedule-ancillary] journey event append failed:", err.message);
      }

      // Advance execution case state — engagementStatus=scheduled,
      // nextActionAt=startsAt. Update unconditionally because scheduling
      // is the operationally-correct next state regardless of prior state.
      let updatedExecutionCase = executionCase;
      try {
        const [row] = await db
          .update(patientExecutionCases)
          .set({
            engagementStatus: "scheduled",
            nextActionAt: startsAt,
            updatedAt: new Date(),
          })
          .where(eq(patientExecutionCases.id, executionCase.id))
          .returning();
        if (row) updatedExecutionCase = row;
      } catch (err: any) {
        console.error("[schedule-ancillary] execution case update failed:", err.message);
      }

      return res.json({
        ok: true,
        event,
        created,
        executionCase: updatedExecutionCase,
        journeyEvent,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  // POST /api/global-schedule-events/:id/transition  — PR 2.4
  //
  // Body: { transition: "cancel"|"reschedule"|"no_show"|"confirm",
  //         newStartsAt? (required for reschedule), newEndsAt?, note? }
  // Uses scheduleStatusService.applyScheduleTransition to update the
  // existing global_schedule_events row, append a canonical journey
  // event, and reflect status on the execution case. No local-only
  // events — single canonical writer.
  app.post("/api/global-schedule-events/:id/transition", async (req, res) => {
    try {
      const rawId = req.params.id as string;
      const id = parseInt(rawId, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const parsed = transitionBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const actorUserId = sessionUserIdFromGlobalSchedule(req);
      const result = await applyScheduleTransition({
        eventId: id,
        transition: parsed.data.transition as ScheduleTransition,
        actorUserId,
        newStartsAt: parsed.data.newStartsAt ? new Date(parsed.data.newStartsAt) : null,
        newEndsAt: parsed.data.newEndsAt ? new Date(parsed.data.newEndsAt) : null,
        note: parsed.data.note ?? null,
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error });
      }
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  // GET /api/global-schedule-events/:id
  app.get("/api/global-schedule-events/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getGlobalScheduleEventById(id);
      if (!row) return res.status(404).json({ error: "Global schedule event not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

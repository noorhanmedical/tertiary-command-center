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
  getQuickScheduleStubCase,
  createQuickScheduleExecutionCase,
} from "../repositories/executionCase.repo";
import { appendJourneyEvent } from "../services/journey/appendJourneyEvent";
import {
  applyScheduleTransition,
  type ScheduleTransition,
} from "../services/scheduling/scheduleStatusService";
import { featureFlags } from "../lib/featureFlags";
import { scheduleCanonicalAncillaryAppointment } from "../services/canonicalAppointments/scheduleAncillaryOrchestrator";
import { applyCanonicalAncillaryTransition } from "../services/canonicalAppointments/transitionOrchestrator";
import {
  getCanonicalAppointmentProjection,
  getCanonicalAppointmentsByService,
} from "../services/canonicalAppointments/appointmentProjection";

const CANONICAL_ANCILLARY_CALENDAR_TYPES = new Set(["ancillary_appointment", "same_day_add"]);

// Maps a controlled canonical read error to a 503; returns true if handled.
function handleCanonicalReadError(res: Response, e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  if (code === "42P01" || code === "42703" || code === "CANONICAL_APPOINTMENT_MIGRATION_MISSING") {
    res.status(503).json({
      error: "canonical appointment schema unavailable — apply migration 0052",
      code: "CANONICAL_APPOINTMENT_MIGRATION_MISSING",
    });
    return true;
  }
  return false;
}
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
  transition: z.enum(["cancel", "reschedule", "no_show", "confirm", "complete"]),
  newStartsAt: z.string().optional().nullable(),
  newEndsAt: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  // Phase 2D-B: canonical cancel/no_show require a nonblank reason.
  reason: z.string().optional().nullable(),
});

const scheduleAncillaryBodySchema = z.object({
  executionCaseId: z.number().int().optional().nullable(),
  patientScreeningId: z.number().int().optional().nullable(),
  // Quick-schedule for brand-new patients: when neither id resolves to an
  // execution case, a non-empty patientName lets the server create a
  // minimal case stub so the appointment can persist.
  patientName: z.string().optional().nullable(),
  patientDob: z.string().optional().nullable(),
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

      // Phase 2D-C1 — under the canonical flag, canonical ancillary
      // events (ancillary_appointment / same_day_add) expose a stable
      // globalScheduleEventId + ancillaryCaseId/serviceType so calendar
      // surfaces read the same canonical identity everyone else does.
      // doctor_visit and every general event pass through unchanged.
      if (featureFlags.canonicalAppointment) {
        return res.json(
          rows.map((r) =>
            CANONICAL_ANCILLARY_CALENDAR_TYPES.has(r.eventType)
              ? { ...r, globalScheduleEventId: r.id, canonicalAncillary: true }
              : r,
          ),
        );
      }
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/canonical-appointments — Phase 2D-C1 shared reader.
  // The single canonical appointment projection every clinic-facing
  // surface (Patient EHR, Engagement, PCS, ACS, scheduler) consumes.
  // Query by ancillaryCaseId | patientScreeningId | executionCaseId,
  // ?includeHistory=true, ?byService=true. Tenant-scoped from session.
  app.get("/api/canonical-appointments", async (req, res) => {
    try {
      const clinicId = (req as { clinicId?: number | null }).clinicId ?? null;
      if (!featureFlags.canonicalAppointment) {
        return res.json({ enabled: false, activeAppointment: null, appointmentHistory: [] });
      }
      if (clinicId == null) {
        return res.status(400).json({ error: "clinic scope is required" });
      }
      const q = req.query as Record<string, string | undefined>;
      const num = (v: string | undefined) => (v != null && /^\d+$/.test(v) ? parseInt(v, 10) : undefined);
      const ancillaryCaseId = num(q.ancillaryCaseId);
      const patientScreeningId = num(q.patientScreeningId);
      const executionCaseId = num(q.executionCaseId);
      const includeHistory = q.includeHistory === "true";
      if (ancillaryCaseId == null && patientScreeningId == null && executionCaseId == null) {
        return res.status(400).json({ error: "one of ancillaryCaseId, patientScreeningId, executionCaseId is required" });
      }
      if (q.byService === "true" && (patientScreeningId != null || executionCaseId != null)) {
        const byService = await getCanonicalAppointmentsByService({ clinicId, patientScreeningId, executionCaseId, includeHistory });
        return res.json({ enabled: true, appointmentByService: byService });
      }
      const projection = await getCanonicalAppointmentProjection({
        clinicId, ancillaryCaseId, patientScreeningId, executionCaseId, includeHistory,
      });
      return res.json({ enabled: true, ...projection });
    } catch (error: any) {
      if (handleCanonicalReadError(res, error)) return;
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
      const { buildAncillaryReadinessSummaries } = await import(
        "../services/ancillary/ancillaryReadinessSummary"
      );
      const readinessByRow = await buildAncillaryReadinessSummaries(
        rows.map((r) => ({
          id: r.id,
          executionCaseId: r.executionCaseId ?? null,
          patientScreeningId: r.patientScreeningId ?? null,
          serviceType: r.serviceType ?? null,
        })),
      );
      const enriched = rows.map((r) => ({
        ...r,
        readiness: readinessByRow.get(String(r.id)) ?? null,
      }));
      res.json(enriched);
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
      // Quick-schedule fallback: brand-new patients (walk-ins / not yet
      // screened) carry no ids. If a patientName is supplied, create a
      // minimal execution case stub so the appointment can persist.
      let createdStubCase = false;
      if (!executionCase) {
        // Trim + collapse internal whitespace so "Jon  Smith " stores as
        // "Jon Smith" (matching stays case-insensitive in the repo).
        const stubName = (data.patientName ?? "").trim().replace(/\s+/g, " ");
        if (!stubName) {
          return res.status(404).json({
            error: "Could not resolve an execution case from executionCaseId or patientScreeningId (provide patientName to quick-schedule a new patient)",
          });
        }
        const stubDob = (data.patientDob ?? "").trim() || null;
        const stubFacility = data.facilityId ?? null;
        // Double-submit protection: reuse ONLY a prior quick-schedule stub
        // matched on name + DOB + facility. Never reuse arbitrary existing
        // cases by name alone — a common-name collision could attach this
        // appointment (and case status updates) to the wrong patient.
        // Without a DOB there is no safe identity to match on, so a fresh
        // stub is always created.
        const existingStub = stubDob
          ? await getQuickScheduleStubCase(stubName, stubDob, stubFacility)
          : undefined;
        if (existingStub) {
          executionCase = existingStub;
          executionCaseId = existingStub.id;
        } else {
          executionCase = await createQuickScheduleExecutionCase({
            patientName: stubName,
            patientDob: stubDob,
            facilityId: stubFacility,
            serviceType: data.serviceType,
          });
          executionCaseId = executionCase.id;
          createdStubCase = true;

          // Phase 2B (hardened) — quick-schedule creates a walk-in
          // execution case WITHOUT Phase 2A identity. If
          // FEATURE_ANCILLARY_CASE_WRITE is ON, record durable retry
          // work so a future Phase 2A identity completion (or the
          // backfill) creates the canonical ancillary case for this
          // service. Never fabricates identity ids. No-op with flag OFF.
          try {
            const reqClinicId = (req as { clinicId?: number | null }).clinicId ?? null;
            if (reqClinicId) {
              const { featureFlags: ff } = await import("../lib/featureFlags");
              if (ff.ancillaryCaseWrite) {
                const { recordAncillaryReconciliationFailure } = await import(
                  "../repositories/ancillaryCases.repo"
                );
                await recordAncillaryReconciliationFailure({
                  patientScreeningId: null,
                  executionCaseId: executionCase.id,
                  clinicId: reqClinicId,
                  globalPlexusPatientId: null,
                  patientClinicMembershipId: null,
                  serviceType: data.serviceType,
                  requestedAction: "ensure_active",
                  sourceSystem: "quick_schedule_walk_in",
                  errorCode: "MISSING_IDENTITY_LINKS_QUICK_SCHEDULE",
                });
              }
            }
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error(JSON.stringify({
              level: "warn",
              source: "ancillary_case_retry",
              site: "quick_schedule_deferred",
              executionCaseId: executionCase.id,
              code: (e as { code?: string })?.code,
              message: (e as Error)?.message ?? String(e),
            }));
          }
        }
      }

      const facilityId = data.facilityId ?? executionCase.facilityId ?? null;

      // ── Phase 2D-B: canonical path ─────────────────────────────
      // When FEATURE_CANONICAL_APPOINTMENT is ON the canonical service
      // owns ancillary appointment truth. The legacy null-case upsert
      // below cannot run (migration 0052's CHECK forbids an ancillary
      // event without an ancillary_case_id), so we route through the
      // orchestrator. Deferred (walk-in / no identity) returns 202 with
      // the provisional stub preserved. Missing migration → 503.
      if (featureFlags.canonicalAppointment) {
        const reqClinicId = (req as { clinicId?: number | null }).clinicId ?? null;
        try {
          const canonical = await scheduleCanonicalAncillaryAppointment({
            clinicId: reqClinicId,
            executionCaseId: executionCase.id,
            patientScreeningId: patientScreeningId ?? executionCase.patientScreeningId ?? null,
            serviceType: data.serviceType,
            startsAt,
            endsAt,
            eventType: "ancillary_appointment",
            facilityId,
            assignedUserId: data.assignedUserId ?? null,
            actorUserId,
            source: "scheduler_portal",
            metadata: data.metadata ?? {},
          });
          if (canonical.status === "created" || canonical.status === "reused") {
            return res.json({
              ok: true,
              canonical: true,
              event: canonical.event,
              created: canonical.status === "created",
              createdStubCase,
              globalScheduleEventId: canonical.globalScheduleEventId,
              ancillaryCaseId: canonical.ancillaryCaseId,
              projectionDeferred: canonical.projectionDeferred,
              executionCase,
            });
          }
          if (canonical.status === "deferred") {
            return res.status(202).json({
              ok: true,
              canonical: true,
              deferred: true,
              reason: canonical.reason,
              createdStubCase,
              executionCase,
            });
          }
          return res.status(503).json({
            error: canonical.status === "error" ? canonical.message : "canonical scheduling unavailable",
          });
        } catch (e) {
          const code = (e as { code?: string })?.code;
          if (code === "42P01" || code === "42703" || code === "CANONICAL_APPOINTMENT_MIGRATION_MISSING") {
            return res.status(503).json({
              error: "canonical appointment schema unavailable — apply migration 0052",
              code: "CANONICAL_APPOINTMENT_MIGRATION_MISSING",
            });
          }
          throw e;
        }
      }

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
        createdStubCase,
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

      // Phase 2D-B: route canonical ancillary transitions through the
      // domain service when the flag is ON. doctor_visit / general
      // events and flag-OFF fall through to the legacy writer unchanged.
      const reqClinicId = (req as { clinicId?: number | null }).clinicId ?? null;
      try {
        const canonical = await applyCanonicalAncillaryTransition({
          eventId: id,
          transition: parsed.data.transition,
          clinicId: reqClinicId,
          reason: parsed.data.reason ?? parsed.data.note ?? null,
          newStartsAt: parsed.data.newStartsAt ? new Date(parsed.data.newStartsAt) : null,
          newEndsAt: parsed.data.newEndsAt ? new Date(parsed.data.newEndsAt) : null,
          actorUserId,
          source: "scheduler_portal",
        });
        if (canonical.handled) {
          if (!canonical.ok) return res.status(canonical.status).json({ error: canonical.error });
          return res.json(canonical.body);
        }
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === "42P01" || code === "42703" || code === "CANONICAL_APPOINTMENT_MIGRATION_MISSING") {
          return res.status(503).json({
            error: "canonical appointment schema unavailable — apply migration 0052",
            code: "CANONICAL_APPOINTMENT_MIGRATION_MISSING",
          });
        }
        throw e;
      }

      // "complete" is a canonical-only transition; the legacy writer
      // has no mapping for it.
      if (parsed.data.transition === "complete") {
        return res.status(400).json({ error: "complete is only supported for canonical ancillary events" });
      }
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

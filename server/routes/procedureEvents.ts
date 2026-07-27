import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  markProcedureComplete,
  listProcedureEventsForClinic,
  getProcedureEventByIdForClinic,
  listUltrasoundTechCompletedProceduresForClinic,
  type ProcedureEvent,
} from "../repositories/procedureEvents.repo";
import { updateGlobalScheduleEvent } from "../repositories/globalSchedule.repo";
import { featureFlags } from "../lib/featureFlags";
import {
  completeCanonicalProcedure,
  type CompleteCanonicalProcedureStatus,
} from "../services/procedureLifecycle/canonicalProcedureCompletion";
import {
  startProcedure, pauseProcedure, resumeProcedure, cancelProcedure,
  markProcedureNoShow, markProcedureUnableToComplete,
  type ProcedureTransitionResult, type StartProcedureResult,
} from "../services/procedureLifecycle/procedureStateMachine";

const procedureCompleteSchema = z.object({
  serviceType: z.string().min(1, "serviceType is required"),
  // Canonical case identity is server-validated; clinicId is NEVER accepted
  // from the body (it comes only from authenticated request context).
  ancillaryCaseId: z.number().int().optional().nullable(),
  executionCaseId: z.number().int().optional().nullable(),
  patientScreeningId: z.number().int().optional().nullable(),
  globalScheduleEventId: z.number().int().optional().nullable(),
  patientName: z.string().optional().nullable(),
  patientDob: z.string().optional().nullable(),
  facilityId: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  completedAt: z.string().datetime({ offset: true }).optional().nullable(),
});

/** Clinic scope comes ONLY from authenticated request context. Missing context
 *  fails closed. Never read clinicId from body/query. */
function requireClinicScope(req: Request, res: Response): number | null {
  const clinicId = (req as { clinicId?: number | null }).clinicId ?? null;
  if (clinicId == null) {
    res.status(403).json({ error: "Clinic scope required" });
    return null;
  }
  return clinicId;
}

/** Clinic-facing DTO — omits internal global identity (Plexus patient /
 *  membership) ids and any reconciliation internals. */
function toClinicDto(row: ProcedureEvent): Omit<ProcedureEvent, "globalPlexusPatientId" | "patientClinicMembershipId"> {
  const { globalPlexusPatientId: _g, patientClinicMembershipId: _m, ...dto } = row;
  return dto;
}

// Pre-commit resolution failures that behave as not-found (no disclosure).
const NOT_FOUND_STATUSES = new Set<CompleteCanonicalProcedureStatus>(["cross_clinic_denied", "case_not_found"]);
// Pre-commit conflict-style failures (identity/dedupe/timestamp).
const CONFLICT_STATUSES = new Set<CompleteCanonicalProcedureStatus>([
  "service_mismatch", "identity_mismatch", "invalid_schedule_event", "case_inactive",
  "exact_case_required", "procedure_event_ambiguous", "zero_row_conflict", "timestamp_conflict",
]);

export function registerProcedureEventRoutes(app: Express) {
  // GET /api/procedure-events — clinic-scoped.
  app.get("/api/procedure-events", async (req, res) => {
    try {
      const clinicId = requireClinicScope(req, res);
      if (clinicId == null) return;
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listProcedureEventsForClinic>[1] = {};
      if (q.executionCaseId) { const id = parseInt(q.executionCaseId, 10); if (!isNaN(id)) filters.executionCaseId = id; }
      if (q.patientScreeningId) { const id = parseInt(q.patientScreeningId, 10); if (!isNaN(id)) filters.patientScreeningId = id; }
      if (q.globalScheduleEventId) { const id = parseInt(q.globalScheduleEventId, 10); if (!isNaN(id)) filters.globalScheduleEventId = id; }
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.serviceType) filters.serviceType = q.serviceType;
      if (q.procedureStatus) filters.procedureStatus = q.procedureStatus;
      const rows = await listProcedureEventsForClinic(clinicId, filters, limit);
      res.json(rows.map(toClinicDto));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/procedure-events/complete — clinic-scoped write.
  app.post("/api/procedure-events/complete", async (req, res) => {
    try {
      const clinicId = requireClinicScope(req, res);
      if (clinicId == null) return;
      const parsed = procedureCompleteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const { completedAt, globalScheduleEventId, ...rest } = parsed.data;

      // Phase 2F canonical path — dedupe by ancillary case, awaited note ensure.
      if (featureFlags.canonicalProcedureLifecycle) {
        const result = await completeCanonicalProcedure({
          ...rest,
          clinicId,
          globalScheduleEventId: globalScheduleEventId ?? undefined,
          completedAt: completedAt ? new Date(completedAt) : undefined,
          completedByUserId: req.session?.userId ?? undefined,
          actorUserId: req.session?.userId ?? undefined,
        });
        // 201 ONLY when the completion genuinely committed (excluding a
        // timestamp conflict, which committed earlier but rejects THIS change).
        if (result.completionCommitted && result.status !== "timestamp_conflict") {
          const warnings = [...(result.warnings ?? [])];
          // Mirror ONLY the schedule event that completeCanonicalProcedure
          // VALIDATED (never a raw client-supplied id). Awaited + non-throwing;
          // completion remains committed even if the mirror fails.
          if (result.qualifyingScheduleEventId != null) {
            try {
              await updateGlobalScheduleEvent(result.qualifyingScheduleEventId, { status: "completed" });
            } catch (err) {
              warnings.push("schedule_mirror_failed");
              console.error("[procedureEvents.route] schedule mirror failed:", err);
            }
          }
          return res.status(201).json({ ...result, warnings });
        }
        // Not committed (or timestamp conflict) → truthful codes; NEVER mirror.
        if (result.status === "migration_missing") return res.status(503).json({ error: "Migration required", status: result.status });
        if (NOT_FOUND_STATUSES.has(result.status)) return res.status(404).json({ error: "Not found", status: result.status });
        if (CONFLICT_STATUSES.has(result.status)) return res.status(409).json({ error: "Canonical completion conflict", status: result.status, completionCommitted: result.completionCommitted });
        if (result.status === "deferred_ambiguous_case") return res.status(202).json(result);
        return res.status(500).json({ error: "Canonical completion error", status: result.status });
      }

      // Legacy path (flag OFF) — preserved behavior; legacy note writer is
      // suppressed only when FEATURE_CANONICAL_PROCEDURE_NOTE is ON.
      const { procedureEvent, documentRows } = await markProcedureComplete({
        ...rest,
        globalScheduleEventId: globalScheduleEventId ?? undefined,
        completedAt: completedAt ? new Date(completedAt) : undefined,
        completedByUserId: req.session?.userId ?? undefined,
      });
      if (globalScheduleEventId != null) {
        void updateGlobalScheduleEvent(globalScheduleEventId, { status: "completed" }).catch((err) => {
          console.error("[procedureEvents.route] global schedule update failed:", err);
        });
      }
      return res.status(201).json({ procedureEvent: toClinicDto(procedureEvent), documentReadinessRows: documentRows });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  // GET /api/ultrasound-tech/completed-procedures — clinic-scoped.
  app.get("/api/ultrasound-tech/completed-procedures", async (req, res) => {
    try {
      const clinicId = requireClinicScope(req, res);
      if (clinicId == null) return;
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listUltrasoundTechCompletedProceduresForClinic>[1] = {};
      if (q.completedByUserId) filters.completedByUserId = q.completedByUserId;
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.serviceType) filters.serviceType = q.serviceType;
      if (q.procedureStatus) filters.procedureStatus = q.procedureStatus;
      if (q.startDate) { const d = new Date(q.startDate); if (!isNaN(d.getTime())) filters.startDate = d; }
      if (q.endDate) { const d = new Date(q.endDate); if (!isNaN(d.getTime())) filters.endDate = d; }
      const rows = await listUltrasoundTechCompletedProceduresForClinic(clinicId, filters, limit);
      res.json(rows.map(toClinicDto));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Phase 2F-B procedure state machine (clinic-scoped) ───────────────────
  function mapTransition(res: Response, r: ProcedureTransitionResult) {
    if (r.status === "transitioned") return res.status(200).json({ status: r.status, procedureEvent: r.procedureEvent ? toClinicDto(r.procedureEvent) : undefined });
    if (r.status === "not_found") return res.status(404).json({ error: "Not found", status: r.status });
    if (r.status === "skipped_flag_off") return res.status(409).json({ error: "Canonical procedure lifecycle disabled", status: r.status });
    return res.status(409).json({ error: "Invalid transition", status: r.status });
  }
  function idParam(req: Request, res: Response): number | null {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return null; }
    return id;
  }

  app.post("/api/procedure-events/start", async (req, res) => {
    try {
      const clinicId = requireClinicScope(req, res); if (clinicId == null) return;
      const b = (req.body ?? {}) as Record<string, unknown>;
      if (typeof b.serviceType !== "string" || b.serviceType.length === 0) return res.status(400).json({ error: "serviceType is required" });
      const serviceType: string = b.serviceType;
      const r: StartProcedureResult = await startProcedure({
        clinicId, serviceType,
        ancillaryCaseId: typeof b.ancillaryCaseId === "number" ? b.ancillaryCaseId : undefined,
        globalScheduleEventId: typeof b.globalScheduleEventId === "number" ? b.globalScheduleEventId : undefined,
        executionCaseId: typeof b.executionCaseId === "number" ? b.executionCaseId : undefined,
        patientScreeningId: typeof b.patientScreeningId === "number" ? b.patientScreeningId : undefined,
        actorUserId: req.session?.userId ?? null, actorRole: req.session?.role ?? null,
      });
      if (r.status === "started") return res.status(201).json({ status: r.status, procedureEvent: r.procedureEvent ? toClinicDto(r.procedureEvent) : undefined, prerequisites: r.prerequisites });
      if (r.status === "prerequisites_blocked") return res.status(422).json({ status: r.status, prerequisites: r.prerequisites });
      if (r.status === "migration_missing") return res.status(503).json({ status: r.status });
      if (r.status === "case_not_found" || r.status === "cross_clinic_denied") return res.status(404).json({ error: "Not found", status: r.status });
      if (r.status === "skipped_flag_off") return res.status(409).json({ error: "Canonical procedure lifecycle disabled", status: r.status });
      return res.status(409).json({ error: "Cannot start", status: r.status });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  const bodyReason = (req: Request): string | null => {
    const r = (req.body ?? {}) as Record<string, unknown>;
    return typeof r.reason === "string" && r.reason.trim().length > 0 ? r.reason.trim() : null;
  };

  app.post("/api/procedure-events/:id/pause", async (req, res) => {
    try { const c = requireClinicScope(req, res); if (c == null) return; const id = idParam(req, res); if (id == null) return; mapTransition(res, await pauseProcedure(id, c, req.session?.userId ?? null)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/procedure-events/:id/resume", async (req, res) => {
    try { const c = requireClinicScope(req, res); if (c == null) return; const id = idParam(req, res); if (id == null) return; mapTransition(res, await resumeProcedure(id, c, req.session?.userId ?? null)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/procedure-events/:id/cancel", async (req, res) => {
    try { const c = requireClinicScope(req, res); if (c == null) return; const id = idParam(req, res); if (id == null) return; mapTransition(res, await cancelProcedure(id, c, bodyReason(req), req.session?.userId ?? null)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/procedure-events/:id/no-show", async (req, res) => {
    try { const c = requireClinicScope(req, res); if (c == null) return; const id = idParam(req, res); if (id == null) return; mapTransition(res, await markProcedureNoShow(id, c, bodyReason(req), req.session?.userId ?? null)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/procedure-events/:id/unable-to-complete", async (req, res) => {
    try { const c = requireClinicScope(req, res); if (c == null) return; const id = idParam(req, res); if (id == null) return; mapTransition(res, await markProcedureUnableToComplete(id, c, bodyReason(req), req.session?.userId ?? null)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/procedure-events/:id — clinic-scoped single-record.
  app.get("/api/procedure-events/:id", async (req, res) => {
    try {
      const clinicId = requireClinicScope(req, res);
      if (clinicId == null) return;
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getProcedureEventByIdForClinic(id, clinicId);
      if (!row) return res.status(404).json({ error: "Procedure event not found" });
      res.json(toClinicDto(row));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

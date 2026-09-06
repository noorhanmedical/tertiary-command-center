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
import {
  getExecutionCaseById,
  getExecutionCaseByScreeningId,
} from "../repositories/executionCase.repo";
import {
  resolveTeamPortalScope,
  scopeCapabilityForClinic,
} from "../services/teamPortalScope";
import {
  resolveAuthorizedClinicScope,
  scopePermitsClinic,
} from "../services/access/authorizedClinicScope";
import { getAncillaryCaseById } from "../repositories/ancillaryCases.repo";
import { getGlobalScheduleEventById } from "../repositories/globalSchedule.repo";
import { db } from "../db";
import { clinics } from "@shared/schema/clinics";
import { eq } from "drizzle-orm";
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

/** Map a facility NAME to its canonical clinic id (used only when a legacy
 *  execution case has no clinic_id populated). */
async function resolveClinicIdByFacilityName(name: string): Promise<number | null> {
  const [row] = await db.select({ id: clinics.id }).from(clinics).where(eq(clinics.name, name)).limit(1);
  return row?.id ?? null;
}

/**
 * Per-clinic authorization for procedure completion.
 *
 * The TARGET CLINIC is derived from server-owned canonical identity (ancillary
 * case → schedule event → execution case → screening), NEVER from the client
 * body. Behavior:
 *
 *   • Target clinic RESOLVED:
 *       - admin                          → allowed; completion runs against the
 *                                          target clinic.
 *       - non-admin in scope             → allowed (fast path: session clinic
 *                                          matches; else canonical multi-clinic
 *                                          scope). Completion runs against the
 *                                          target clinic.
 *       - non-admin NOT in scope         → 404 (tenant-safe not-found; never
 *                                          discloses cross-tenant existence,
 *                                          never mutates).
 *   • Target clinic UNRESOLVED (only a not-yet-linkable id, or a lookup that
 *     hit a missing schema element): DO NOT pre-empt with an error — defer to
 *     the caller's own clinic scope and let completeCanonicalProcedure resolve
 *     and return the truthful canonical status (migration_missing → 503,
 *     invalid_schedule_event → 409, case_not_found → 404, …). This preserves
 *     the canonical-writer contract that owns identity resolution.
 *   • No clinic context at all (no target clinic AND no session clinic):
 *     403 — missing clinic context fails closed.
 *
 * `ok.clinicId` is always a concrete clinic id to pass to the canonical writer.
 */
async function authorizeProcedureCompletion(
  req: Request,
  res: Response,
  target: {
    executionCaseId?: number | null;
    patientScreeningId?: number | null;
    ancillaryCaseId?: number | null;
    globalScheduleEventId?: number | null;
  },
): Promise<{ ok: true; clinicId: number } | { ok: false }> {
  const isAdmin = (req.session?.role ?? "") === "admin";
  const sessionClinicId = (req as { clinicId?: number | null }).clinicId ?? null;

  // Resolve the target clinic from any canonical identifier. A lookup that hits
  // a missing schema element (migration) must NOT block — the canonical writer
  // will surface migration_missing (→ 503). Best-effort; never throws out.
  let targetClinicId: number | null = null;
  try {
    if (target.ancillaryCaseId != null) {
      const ac = await getAncillaryCaseById(target.ancillaryCaseId);
      if (ac) targetClinicId = ac.clinicId ?? null;
    }
    if (targetClinicId == null && target.globalScheduleEventId != null) {
      const ev = await getGlobalScheduleEventById(target.globalScheduleEventId);
      if (ev) {
        targetClinicId = ev.clinicId ?? null;
        if (targetClinicId == null && ev.facilityId) targetClinicId = await resolveClinicIdByFacilityName(ev.facilityId);
      }
    }
    if (targetClinicId == null && (target.executionCaseId != null || target.patientScreeningId != null)) {
      const caseRow = target.executionCaseId != null
        ? await getExecutionCaseById(target.executionCaseId)
        : await getExecutionCaseByScreeningId(target.patientScreeningId as number);
      if (caseRow) {
        targetClinicId = caseRow.clinicId ?? null;
        if (targetClinicId == null && caseRow.facilityId) targetClinicId = await resolveClinicIdByFacilityName(caseRow.facilityId);
      }
    }
  } catch {
    // Lookup failed (e.g. migration-missing) — defer to the canonical writer.
    targetClinicId = null;
  }

  if (targetClinicId != null) {
    if (isAdmin) return { ok: true, clinicId: targetClinicId };
    let permitted = sessionClinicId != null && sessionClinicId === targetClinicId;
    if (!permitted) {
      try {
        const scope = await resolveAuthorizedClinicScope(req);
        permitted = scopePermitsClinic(scope, targetClinicId);
      } catch {
        permitted = false;
      }
    }
    if (!permitted) {
      res.status(404).json({ error: "Not found" });
      return { ok: false };
    }
    return { ok: true, clinicId: targetClinicId };
  }

  // Target clinic unresolved — need SOME clinic context to hand the canonical
  // writer. Use the caller's session clinic; if there is none, fail closed.
  if (sessionClinicId == null) {
    res.status(403).json({ error: "Clinic scope required" });
    return { ok: false };
  }
  return { ok: true, clinicId: sessionClinicId };
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
  "invalid_from_state",
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
      const parsed = procedureCompleteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      // Per-clinic authorization: derive the target clinic from canonical
      // identity (ancillary case / schedule event / execution case / screening)
      // and enforce tenant scope. Unresolved targets defer to the canonical
      // writer for a truthful status (409/503/404).
      const auth = await authorizeProcedureCompletion(req, res, {
        executionCaseId: parsed.data.executionCaseId ?? null,
        patientScreeningId: parsed.data.patientScreeningId ?? null,
        ancillaryCaseId: parsed.data.ancillaryCaseId ?? null,
        globalScheduleEventId: parsed.data.globalScheduleEventId ?? null,
      });
      if (!auth.ok) return;
      const clinicId = auth.clinicId;
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
    if (r.status === "transitioned") return res.status(200).json({ status: r.status, procedureEvent: r.procedureEvent ? toClinicDto(r.procedureEvent) : undefined, noteReconciliation: r.noteReconciliation ?? "not_required" });
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
      // Validate the override payload shape (actor identity/role NEVER from body).
      let override: { reason: string; requirementCodes: string[] } | null = null;
      if (b.override != null) {
        const ov = b.override as Record<string, unknown>;
        const reason = typeof ov.reason === "string" ? ov.reason.trim() : "";
        const codes = Array.isArray(ov.requirementCodes) ? ov.requirementCodes.filter((x): x is string => typeof x === "string") : [];
        if (reason.length === 0) return res.status(400).json({ error: "override.reason is required and must be non-empty" });
        if (codes.length === 0) return res.status(400).json({ error: "override.requirementCodes must name at least one requirement" });
        override = { reason, requirementCodes: codes };
      }
      const r: StartProcedureResult = await startProcedure({
        clinicId, serviceType,
        ancillaryCaseId: typeof b.ancillaryCaseId === "number" ? b.ancillaryCaseId : undefined,
        globalScheduleEventId: typeof b.globalScheduleEventId === "number" ? b.globalScheduleEventId : undefined,
        executionCaseId: typeof b.executionCaseId === "number" ? b.executionCaseId : undefined,
        patientScreeningId: typeof b.patientScreeningId === "number" ? b.patientScreeningId : undefined,
        actorUserId: req.session?.userId ?? null, actorRole: req.session?.role ?? null,
        override,
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
    try {
      const c = requireClinicScope(req, res); if (c == null) return; const id = idParam(req, res); if (id == null) return;
      const reason = bodyReason(req);
      if (reason == null) return res.status(400).json({ error: "A non-empty cancellation reason is required" });
      mapTransition(res, await cancelProcedure(id, c, reason, req.session?.userId ?? null));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/procedure-events/:id/no-show", async (req, res) => {
    // no_show reason is optional (kept when provided).
    try { const c = requireClinicScope(req, res); if (c == null) return; const id = idParam(req, res); if (id == null) return; mapTransition(res, await markProcedureNoShow(id, c, bodyReason(req), req.session?.userId ?? null)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/procedure-events/:id/unable-to-complete", async (req, res) => {
    try {
      const c = requireClinicScope(req, res); if (c == null) return; const id = idParam(req, res); if (id == null) return;
      const reason = bodyReason(req);
      if (reason == null) return res.status(400).json({ error: "A non-empty reason is required" });
      mapTransition(res, await markProcedureUnableToComplete(id, c, reason, req.session?.userId ?? null));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
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

  // ── Procedure component evidence (P1 — was BACKEND-ONLY / unwired) ────────
  // The performed-component record (BrainWave: neuropsych/EEG/ECG/VEP/AEP;
  // VitalWave: autonomic/tilt/BP-HR/segmental/waveform/rhythm-ECG) is what the
  // canonical Procedure Note renders and what billing CPT selection uses. The
  // persistence function existed but was reachable from NO route, so BW/VW
  // Procedure Notes could never render their real content. This exposes it.
  //
  // GET  → read the recorded components (clinic-scoped).
  // POST → validate + persist components (requires the procedure to be
  //        complete), then best-effort (re)generate the Procedure Note so it
  //        reflects the recorded evidence. Never fabricates completion.
  app.get("/api/procedure-events/:id/components", async (req, res) => {
    try {
      const clinicId = requireClinicScope(req, res);
      if (clinicId == null) return;
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getProcedureEventByIdForClinic(id, clinicId);
      if (!row) return res.status(404).json({ error: "Procedure event not found" });
      const { loadProcedureComponents } = await import(
        "../services/procedureLifecycle/procedureNoteContext"
      );
      const components = await loadProcedureComponents(id, row.serviceType);
      res.json({ procedureEventId: id, serviceType: row.serviceType, components });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/procedure-events/:id/components", async (req, res) => {
    try {
      const clinicId = requireClinicScope(req, res);
      if (clinicId == null) return;
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getProcedureEventByIdForClinic(id, clinicId);
      if (!row) return res.status(404).json({ error: "Procedure event not found" });
      const rawComponents = (req.body ?? {}).components ?? req.body;
      const { recordProcedureComponents } = await import(
        "../services/procedureLifecycle/procedureNoteContext"
      );
      const result = await recordProcedureComponents({
        clinicId,
        procedureEventId: id,
        serviceType: row.serviceType,
        rawComponents,
      });
      if (result.status !== "recorded") {
        const code =
          result.status === "invalid_components" ? 400
          : result.status === "not_complete" ? 409
          : result.status === "cross_clinic_denied" ? 403
          : 404;
        return res.status(code).json({ status: result.status });
      }
      // Best-effort Procedure Note (re)generation from the recorded evidence.
      // Non-throwing: recording succeeded regardless of note reconciliation.
      let noteReconciliation = "not_attempted";
      if (row.ancillaryCaseId != null) {
        try {
          const { ensureCanonicalProcedureNoteForAncillaryCase } = await import(
            "../services/procedureLifecycle/procedureLifecycleOrchestration"
          );
          const note = await ensureCanonicalProcedureNoteForAncillaryCase({
            clinicId,
            ancillaryCaseId: row.ancillaryCaseId,
            actorUserId: req.session?.userId ?? null,
            source: "procedure_components_recorded",
          });
          noteReconciliation = note.status;
        } catch (e) {
          noteReconciliation = "note_reconciliation_failed";
          console.error("[procedureEvents.route] component note reconcile failed:", e);
        }
      }
      res.status(200).json({ status: "recorded", noteReconciliation });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

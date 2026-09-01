/**
 * Phase 3 — Plexus Clinical Findings routes.
 *
 * CRUD + review endpoints for the plexus_clinical_findings table.
 * All endpoints are behind the global requireAuth middleware (/api).
 * Write operations require admin role.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  createFinding,
  createFindingsBulk,
  getFinding,
  listFindings,
  listFindingsForPatient,
  listFindingsForScreening,
  updateFinding,
  reviewFinding,
  deleteFinding,
} from "../repositories/plexusClinicalFindings.repo";
import {
  FINDING_TYPES,
  FINDING_SOURCE_TYPES,
  FINDING_REVIEW_STATUSES,
  FINDING_CONFIDENCE_LEVELS,
} from "@shared/schema/plexusClinicalFindings";

const createFindingSchema = z.object({
  clinicId: z.number().int().optional().nullable(),
  globalPlexusPatientId: z.number().int().optional().nullable(),
  patientScreeningId: z.number().int().optional().nullable(),
  facilityId: z.string().optional().nullable(),
  findingType: z.enum(FINDING_TYPES),
  displayName: z.string().min(1).max(500),
  normalizedConcept: z.string().max(500).optional().nullable(),
  suggestedIcd10: z.string().max(20).optional().nullable(),
  confirmedIcd10: z.string().max(20).optional().nullable(),
  sourceType: z.enum(FINDING_SOURCE_TYPES),
  sourceRecordId: z.string().max(200).optional().nullable(),
  sourceDate: z.string().max(20).optional().nullable(),
  sourceExcerpt: z.string().max(2000).optional().nullable(),
  sourceValue: z.string().max(1000).optional().nullable(),
  confidence: z.enum(FINDING_CONFIDENCE_LEVELS).optional().nullable(),
  aiModel: z.string().max(100).optional().nullable(),
  analysisRunId: z.number().int().optional().nullable(),
  reviewStatus: z.enum(FINDING_REVIEW_STATUSES).optional(),
});

const updateFindingSchema = createFindingSchema.partial();

const reviewSchema = z.object({
  reviewStatus: z.enum(FINDING_REVIEW_STATUSES),
  reviewNote: z.string().max(2000).optional().nullable(),
  confirmedIcd10: z.string().max(20).optional().nullable(),
});

const bulkCreateSchema = z.object({
  findings: z.array(createFindingSchema).min(1).max(200),
});

export function registerPlexusClinicalFindingsRoutes(app: Express) {
  // ─── LIST findings with filters ──────────────────────────────────────────
  app.get("/api/plexus-findings", async (req: Request, res: Response) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const findings = await listFindings({
        clinicId: q.clinicId ? parseInt(q.clinicId, 10) : undefined,
        globalPlexusPatientId: q.globalPlexusPatientId ? parseInt(q.globalPlexusPatientId, 10) : undefined,
        patientScreeningId: q.patientScreeningId ? parseInt(q.patientScreeningId, 10) : undefined,
        facilityId: q.facilityId || undefined,
        findingType: q.findingType || undefined,
        sourceType: q.sourceType || undefined,
        reviewStatus: q.reviewStatus || undefined,
        analysisRunId: q.analysisRunId ? parseInt(q.analysisRunId, 10) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : undefined,
      });
      res.json(findings);
    } catch (error: any) {
      console.error("[plexus-findings] list error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to list findings" });
    }
  });

  // ─── GET findings by global patient ID ───────────────────────────────────
  app.get("/api/plexus-findings/patient/:globalPatientId", async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.globalPatientId), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid patient ID" });
      const findings = await listFindingsForPatient(id);
      res.json(findings);
    } catch (error: any) {
      console.error("[plexus-findings] patient list error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to list findings for patient" });
    }
  });

  // ─── GET findings by screening ID ────────────────────────────────────────
  app.get("/api/plexus-findings/screening/:screeningId", async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.screeningId), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid screening ID" });
      const findings = await listFindingsForScreening(id);
      res.json(findings);
    } catch (error: any) {
      console.error("[plexus-findings] screening list error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to list findings for screening" });
    }
  });

  // ─── GET single finding ──────────────────────────────────────────────────
  app.get("/api/plexus-findings/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
      const finding = await getFinding(id);
      if (!finding) return res.status(404).json({ error: "Finding not found" });
      res.json(finding);
    } catch (error: any) {
      console.error("[plexus-findings] get error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to get finding" });
    }
  });

  // ─── CREATE single finding (admin only) ──────────────────────────────────
  app.post("/api/plexus-findings", async (req: Request, res: Response) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }
      const parsed = createFindingSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const finding = await createFinding({
        ...parsed.data,
        createdByUserId: req.session.userId ?? undefined,
      });
      res.status(201).json(finding);
    } catch (error: any) {
      console.error("[plexus-findings] create error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to create finding" });
    }
  });

  // ─── BULK CREATE findings (admin only, for AI ingestion) ─────────────────
  app.post("/api/plexus-findings/bulk", async (req: Request, res: Response) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }
      const parsed = bulkCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const inputs = parsed.data.findings.map((f) => ({
        ...f,
        createdByUserId: req.session.userId ?? undefined,
      }));
      const findings = await createFindingsBulk(inputs);
      res.status(201).json({ created: findings.length, findings });
    } catch (error: any) {
      console.error("[plexus-findings] bulk create error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to bulk create findings" });
    }
  });

  // ─── UPDATE finding (admin only) ─────────────────────────────────────────
  app.patch("/api/plexus-findings/:id", async (req: Request, res: Response) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
      const parsed = updateFindingSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const finding = await updateFinding(id, parsed.data);
      if (!finding) return res.status(404).json({ error: "Finding not found" });
      res.json(finding);
    } catch (error: any) {
      console.error("[plexus-findings] update error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to update finding" });
    }
  });

  // ─── REVIEW finding (admin/clinician) ────────────────────────────────────
  app.post("/api/plexus-findings/:id/review", async (req: Request, res: Response) => {
    try {
      const role = req.session.role ?? "clinician";
      if (!["admin", "clinician"].includes(role)) {
        return res.status(403).json({ error: "Admin or clinician access required" });
      }
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
      const parsed = reviewSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const finding = await reviewFinding(id, {
        ...parsed.data,
        reviewedByUserId: req.session.userId!,
      });
      if (!finding) return res.status(404).json({ error: "Finding not found" });
      res.json(finding);
    } catch (error: any) {
      console.error("[plexus-findings] review error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to review finding" });
    }
  });

  // ─── DELETE finding (admin only) ─────────────────────────────────────────
  app.delete("/api/plexus-findings/:id", async (req: Request, res: Response) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
      const deleted = await deleteFinding(id);
      if (!deleted) return res.status(404).json({ error: "Finding not found" });
      res.json({ ok: true });
    } catch (error: any) {
      console.error("[plexus-findings] delete error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to delete finding" });
    }
  });
}

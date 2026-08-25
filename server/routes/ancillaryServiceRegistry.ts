/**
 * Phase 4 — Ancillary Service Registry routes.
 *
 * Read endpoints are available to all authenticated users.
 * Write endpoints (create, update, facility settings) require admin role.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  listServices,
  getServiceByCode,
  getServiceById,
  createService,
  updateService,
  listFacilityServices,
  upsertFacilityService,
  getActiveServicesForFacility,
} from "../repositories/ancillaryServiceRegistry.repo";

const updateServiceSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  category: z.string().min(1).max(100).optional(),
  anatomicRegion: z.string().max(100).optional().nullable(),
  active: z.boolean().optional(),
  cptCode: z.string().max(20).optional().nullable(),
  hcpcsCode: z.string().max(20).optional().nullable(),
  cptConfirmed: z.boolean().optional(),
  qualifyingDiagnoses: z.array(z.string()).optional(),
  relevantIcd10Codes: z.array(z.string()).optional(),
  relevantMedications: z.array(z.string()).optional(),
  relevantSymptoms: z.array(z.string()).optional(),
  relevantLabFindings: z.array(z.string()).optional(),
  relevantImagingFindings: z.array(z.string()).optional(),
  relevantEncounterFindings: z.array(z.string()).optional(),
  inclusionCriteria: z.array(z.string()).optional(),
  exclusionCriteria: z.array(z.string()).optional(),
  aiInstructionsPermissive: z.string().max(5000).optional().nullable(),
  aiInstructionsStandard: z.string().max(5000).optional().nullable(),
  aiInstructionsConservative: z.string().max(5000).optional().nullable(),
  cooldownMonthsMedicare: z.number().int().min(0).max(120).optional().nullable(),
  cooldownMonthsPpo: z.number().int().min(0).max(120).optional().nullable(),
  cooldownMonthsOther: z.number().int().min(0).max(120).optional().nullable(),
  requiresConsent: z.boolean().optional(),
  requiresScreeningForm: z.boolean().optional(),
  requiresReport: z.boolean().optional(),
  requiresOrderSignature: z.boolean().optional(),
  requiresProcedureNoteSignature: z.boolean().optional(),
  billingBlockers: z.array(z.string()).optional(),
  sortOrder: z.number().int().optional(),
});

const facilityServiceSchema = z.object({
  serviceCode: z.string().min(1).max(100),
  enabled: z.boolean(),
  qualificationModeOverride: z.string().max(50).optional().nullable(),
  cooldownMonthsOverride: z.number().int().min(0).max(120).optional().nullable(),
});

export function registerAncillaryServiceRegistryRoutes(app: Express) {
  // ─── LIST all services ───────────────────────────────────────────────────
  app.get("/api/service-registry", async (req: Request, res: Response) => {
    try {
      const activeOnly = req.query.activeOnly === "true";
      const services = await listServices({ activeOnly });
      res.json(services);
    } catch (error: any) {
      console.error("[service-registry] list error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to list services" });
    }
  });

  // ─── GET service by internal code ────────────────────────────────────────
  app.get("/api/service-registry/code/:code", async (req: Request, res: Response) => {
    try {
      const service = await getServiceByCode(String(req.params.code));
      if (!service) return res.status(404).json({ error: "Service not found" });
      res.json(service);
    } catch (error: any) {
      console.error("[service-registry] get by code error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to get service" });
    }
  });

  // ─── GET service by ID ───────────────────────────────────────────────────
  app.get("/api/service-registry/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
      const service = await getServiceById(id);
      if (!service) return res.status(404).json({ error: "Service not found" });
      res.json(service);
    } catch (error: any) {
      console.error("[service-registry] get error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to get service" });
    }
  });

  // ─── UPDATE service (admin only) ────────────────────────────────────────
  app.patch("/api/service-registry/:id", async (req: Request, res: Response) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
      const parsed = updateServiceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const service = await updateService(id, parsed.data);
      if (!service) return res.status(404).json({ error: "Service not found" });
      res.json(service);
    } catch (error: any) {
      console.error("[service-registry] update error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to update service" });
    }
  });

  // ─── GET active services for a facility ──────────────────────────────────
  app.get("/api/service-registry/facility/:clinicId", async (req: Request, res: Response) => {
    try {
      const clinicId = parseInt(String(req.params.clinicId), 10);
      if (!Number.isFinite(clinicId)) return res.status(400).json({ error: "Invalid clinic ID" });
      const services = await getActiveServicesForFacility(clinicId);
      res.json(services);
    } catch (error: any) {
      console.error("[service-registry] facility services error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to get facility services" });
    }
  });

  // ─── GET facility service settings ───────────────────────────────────────
  app.get("/api/service-registry/facility/:clinicId/settings", async (req: Request, res: Response) => {
    try {
      const clinicId = parseInt(String(req.params.clinicId), 10);
      if (!Number.isFinite(clinicId)) return res.status(400).json({ error: "Invalid clinic ID" });
      const settings = await listFacilityServices(clinicId);
      res.json(settings);
    } catch (error: any) {
      console.error("[service-registry] facility settings error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to get facility settings" });
    }
  });

  // ─── UPSERT facility service setting (admin only) ────────────────────────
  app.put("/api/service-registry/facility/:clinicId/settings", async (req: Request, res: Response) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }
      const clinicId = parseInt(String(req.params.clinicId), 10);
      if (!Number.isFinite(clinicId)) return res.status(400).json({ error: "Invalid clinic ID" });
      const parsed = facilityServiceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const setting = await upsertFacilityService({
        clinicId,
        ...parsed.data,
      });
      res.json(setting);
    } catch (error: any) {
      console.error("[service-registry] upsert facility setting error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to save facility setting" });
    }
  });
}

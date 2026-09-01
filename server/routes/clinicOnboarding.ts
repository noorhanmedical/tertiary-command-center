import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { updateOnboardingChecklistItemSchema } from "@shared/schema/clinicOnboarding";
import {
  listClinics,
  listSectionTemplates,
  listChecklistItems,
  getChecklistItemById,
  updateChecklistItem,
  seedChecklistForClinic,
  addEvidenceToItem,
  getClinicMetrics,
  listSignoffs,
  recordSignoff,
  GoLiveGateError,
} from "../repositories/clinicOnboarding.repo";

function parseId(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null) return null;
  const id = parseInt(value, 10);
  return Number.isNaN(id) ? null : id;
}

/**
 * Onboarding is an admin-only surface (the "Clinic Onboarding" nav item is
 * gated to `roles: ["admin"]`). Authentication is already enforced globally
 * by `app.use("/api", requireAuth)` in routes.ts; here every endpoint —
 * reads and writes — is additionally gated behind `requireAdmin`, so the
 * entire onboarding surface is admin-only.
 */
export function registerClinicOnboardingRoutes(app: Express, requireAdmin: RequestHandler) {
  // GET /api/clinic-onboarding/clinics — clinics available for onboarding
  app.get("/api/clinic-onboarding/clinics", requireAdmin, async (_req, res) => {
    try {
      res.json(await listClinics());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/clinic-onboarding/sections — canonical section catalog
  app.get("/api/clinic-onboarding/sections", requireAdmin, async (_req, res) => {
    try {
      res.json(await listSectionTemplates());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/clinic-onboarding/:clinicId/checklist
  // Filters: sectionOrdinal, status, phase, blockedOnly, limit
  app.get("/api/clinic-onboarding/:clinicId/checklist", requireAdmin, async (req, res) => {
    try {
      const clinicId = parseId(req.params.clinicId);
      if (clinicId == null) return res.status(400).json({ error: "Invalid clinicId" });

      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 500, 1000) : 500;
      const filters: Parameters<typeof listChecklistItems>[0] = { clinicId };

      if (q.sectionOrdinal) {
        const n = parseInt(q.sectionOrdinal, 10);
        if (!Number.isNaN(n)) filters.sectionOrdinal = n;
      }
      if (q.status) filters.status = q.status;
      if (q.phase) filters.phase = q.phase;
      if (q.blockedOnly === "true") filters.blockedOnly = true;

      res.json(await listChecklistItems(filters, limit));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/clinic-onboarding/:clinicId/metrics — progress/maturity + go-live gate
  app.get("/api/clinic-onboarding/:clinicId/metrics", requireAdmin, async (req, res) => {
    try {
      const clinicId = parseId(req.params.clinicId);
      if (clinicId == null) return res.status(400).json({ error: "Invalid clinicId" });
      res.json(await getClinicMetrics(clinicId));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/clinic-onboarding/:clinicId/seed — seed checklist from catalog
  app.post("/api/clinic-onboarding/:clinicId/seed", requireAdmin, async (req, res) => {
    try {
      const clinicId = parseId(req.params.clinicId);
      if (clinicId == null) return res.status(400).json({ error: "Invalid clinicId" });
      const inserted = await seedChecklistForClinic(clinicId);
      res.status(201).json({ clinicId, inserted });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /api/clinic-onboarding/items/:id — status/maturity/owner transitions
  app.patch("/api/clinic-onboarding/items/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (id == null) return res.status(400).json({ error: "Invalid id" });

      const parsed = updateOnboardingChecklistItemSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid update", details: parsed.error.flatten() });
      }

      const updated = await updateChecklistItem(id, parsed.data);
      if (!updated) return res.status(404).json({ error: "Checklist item not found" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/clinic-onboarding/items/:id/evidence — attach evidence reference
  app.post("/api/clinic-onboarding/items/:id/evidence", requireAdmin, async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (id == null) return res.status(400).json({ error: "Invalid id" });

      const schema = z.object({
        key: z.string().min(1),
        fileName: z.string().min(1),
        uploadedAt: z.string().optional(),
        uploadedBy: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid evidence", details: parsed.error.flatten() });
      }

      const item = await getChecklistItemById(id);
      if (!item) return res.status(404).json({ error: "Checklist item not found" });

      const updated = await addEvidenceToItem(id, {
        key: parsed.data.key,
        fileName: parsed.data.fileName,
        uploadedAt: parsed.data.uploadedAt ?? new Date().toISOString(),
        uploadedBy: parsed.data.uploadedBy,
      });
      res.status(201).json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/clinic-onboarding/:clinicId/signoffs
  app.get("/api/clinic-onboarding/:clinicId/signoffs", requireAdmin, async (req, res) => {
    try {
      const clinicId = parseId(req.params.clinicId);
      if (clinicId == null) return res.status(400).json({ error: "Invalid clinicId" });
      res.json(await listSignoffs(clinicId));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/clinic-onboarding/:clinicId/signoffs — enforces go-live gate.
  // Signer identity is taken from the session, never trusted from the body.
  app.post("/api/clinic-onboarding/:clinicId/signoffs", requireAdmin, async (req, res) => {
    try {
      const clinicId = parseId(req.params.clinicId);
      if (clinicId == null) return res.status(400).json({ error: "Invalid clinicId" });

      const schema = z.object({
        role: z.enum(["admin", "owner"]),
        notes: z.string().max(2000).nullable().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid signoff", details: parsed.error.flatten() });
      }

      const result = await recordSignoff({
        clinicId,
        role: parsed.data.role,
        notes: parsed.data.notes ?? null,
        signedByUserId: req.session?.userId ?? null,
        signedByName: req.session?.username ?? null,
      });
      res.status(201).json(result);
    } catch (error: any) {
      if (error instanceof GoLiveGateError) {
        return res.status(409).json({ error: error.message, metrics: error.metrics });
      }
      res.status(500).json({ error: error.message });
    }
  });
}

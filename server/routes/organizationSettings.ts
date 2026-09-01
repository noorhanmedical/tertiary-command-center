// Organization Settings — Facilities + Clinicians management (admin-only).
//
// The source for Plexus IQ batch facility/clinician dropdowns. Facilities are
// backed by the canonical `clinics` table; clinicians by the new `clinicians`
// directory + `facility_clinicians` relationship. All mutations require the
// admin role, enforced SERVER-SIDE (the sibling scheduler routes historically
// omitted this — we add it explicitly here).
//
// Reads:
//   GET  /api/org/facilities            list facilities (?includeInactive)
//   GET  /api/org/clinicians            list clinicians + facilityIds (?includeInactive)
//   GET  /api/org/facilities/:id/clinicians  active clinicians for a facility
//                                            (used by the batch dropdown; open
//                                            to authenticated users)
// Mutations (admin only):
//   POST   /api/org/facilities                 create facility
//   PATCH  /api/org/facilities/:id             update facility
//   POST   /api/org/clinicians                 create clinician (+ optional facilityIds)
//   PATCH  /api/org/clinicians/:id             update clinician (+ optional facilityIds)
//   POST   /api/org/facilities/:id/clinicians  associate clinician { clinicianId }
//   DELETE /api/org/facilities/:id/clinicians/:clinicianId  dissociate

import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import {
  clinicianRepository,
  facilityRepository,
} from "../repositories/clinicians.repo";
import { insertClinicianSchema } from "@shared/schema/clinics";

const facilityBodySchema = z.object({
  name: z.string().trim().min(1, "Facility name is required").max(200),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens").optional(),
  shortName: z.string().trim().max(100).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  timezone: z.string().trim().max(60).optional().nullable(),
  facilityType: z.string().trim().max(60).optional().nullable(),
  code: z.string().trim().max(60).optional().nullable(),
  active: z.boolean().optional(),
});

const clinicianBodySchema = insertClinicianSchema.extend({
  facilityIds: z.array(z.number().int().positive()).optional(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || `facility-${Date.now()}`;
}

export function registerOrganizationSettingsRoutes(
  app: Express,
  requireRole: (...roles: string[]) => RequestHandler,
) {
  const requireAdmin = requireRole("admin");

  // ── Facilities ──────────────────────────────────────────────────────
  app.get("/api/org/facilities", async (req: Request, res: Response) => {
    try {
      const includeInactive = req.query.includeInactive === "true";
      res.json(await facilityRepository.list(includeInactive));
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed to list facilities" });
    }
  });

  app.post("/api/org/facilities", requireAdmin, async (req: Request, res: Response) => {
    const parsed = facilityBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    }
    try {
      const { slug, name, ...rest } = parsed.data;
      const created = await facilityRepository.create({
        name,
        slug: slug ?? slugify(name),
        ...rest,
      } as never);
      res.status(201).json(created);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed to create facility" });
    }
  });

  app.patch("/api/org/facilities/:id", requireAdmin, async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const parsed = facilityBodySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    }
    try {
      const updated = await facilityRepository.update(id, parsed.data as never);
      if (!updated) return res.status(404).json({ error: "Facility not found" });
      res.json(updated);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed to update facility" });
    }
  });

  // Active clinicians for a facility — the batch dropdown source. Open to any
  // authenticated user (they can run batches); mutations stay admin-only.
  app.get("/api/org/facilities/:id/clinicians", async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      const includeInactive = req.query.includeInactive === "true";
      res.json(await clinicianRepository.listForFacility(id, includeInactive));
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed to list facility clinicians" });
    }
  });

  app.post("/api/org/facilities/:id/clinicians", requireAdmin, async (req: Request, res: Response) => {
    const clinicId = parseInt(String(req.params.id), 10);
    const clinicianId = Number((req.body as { clinicianId?: unknown }).clinicianId);
    if (Number.isNaN(clinicId) || !Number.isInteger(clinicianId) || clinicianId <= 0) {
      return res.status(400).json({ error: "Valid clinicId and clinicianId are required" });
    }
    try {
      const row = await clinicianRepository.associate(clinicId, clinicianId);
      res.status(201).json(row);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed to associate clinician" });
    }
  });

  app.delete("/api/org/facilities/:id/clinicians/:clinicianId", requireAdmin, async (req: Request, res: Response) => {
    const clinicId = parseInt(String(req.params.id), 10);
    const clinicianId = parseInt(String(req.params.clinicianId), 10);
    if (Number.isNaN(clinicId) || Number.isNaN(clinicianId)) {
      return res.status(400).json({ error: "Invalid ids" });
    }
    try {
      await clinicianRepository.dissociate(clinicId, clinicianId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed to dissociate clinician" });
    }
  });

  // Batch-dropdown convenience: resolve active clinicians for a facility by
  // its NAME (the batch flow works in VALID_FACILITIES name strings, not
  // clinic ids). Returns [] when the facility has no clinic row yet — the
  // batch UI then simply offers Free Text. Authenticated users may read.
  app.get("/api/org/clinicians-by-facility-name", async (req: Request, res: Response) => {
    const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
    if (!name) return res.status(400).json({ error: "name query param is required" });
    try {
      const facilities = await facilityRepository.list(true);
      const match = facilities.find((f) => f.name === name);
      if (!match) return res.json({ facilityId: null, clinicians: [] });
      const list = await clinicianRepository.listForFacility(match.id, false);
      res.json({ facilityId: match.id, clinicians: list });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed to resolve clinicians" });
    }
  });

  // ── Clinicians ──────────────────────────────────────────────────────
  app.get("/api/org/clinicians", async (req: Request, res: Response) => {
    try {
      const includeInactive = req.query.includeInactive === "true";
      res.json(await clinicianRepository.listWithFacilities(includeInactive));
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed to list clinicians" });
    }
  });

  app.post("/api/org/clinicians", requireAdmin, async (req: Request, res: Response) => {
    const parsed = clinicianBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    }
    try {
      const { facilityIds, ...clinicianData } = parsed.data;
      const created = await clinicianRepository.create(clinicianData as never);
      if (facilityIds && facilityIds.length > 0) {
        await clinicianRepository.setFacilities(created.id, facilityIds);
      }
      const facilities = await clinicianRepository.facilityIdsForClinician(created.id);
      res.status(201).json({ ...created, facilityIds: facilities });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed to create clinician" });
    }
  });

  app.patch("/api/org/clinicians/:id", requireAdmin, async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const parsed = clinicianBodySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    }
    try {
      const { facilityIds, ...clinicianData } = parsed.data;
      if (Object.keys(clinicianData).length > 0) {
        const updated = await clinicianRepository.update(id, clinicianData as never);
        if (!updated) return res.status(404).json({ error: "Clinician not found" });
      }
      if (facilityIds) {
        await clinicianRepository.setFacilities(id, facilityIds);
      }
      const row = await clinicianRepository.getById(id);
      if (!row) return res.status(404).json({ error: "Clinician not found" });
      const facilities = await clinicianRepository.facilityIdsForClinician(id);
      res.json({ ...row, facilityIds: facilities });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed to update clinician" });
    }
  });
}

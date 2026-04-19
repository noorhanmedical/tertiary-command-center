import type { Express } from "express";
import { storage } from "../storage";
import { VALID_FACILITIES } from "./helpers";
import { insertOutreachSchedulerSchema } from "../../shared/schema";
import { buildOutreachDashboard } from "../services/outreachService";

export function registerOutreachRoutes(app: Express) {
  app.get("/api/outreach/dashboard", async (_req, res) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const dashboard = await buildOutreachDashboard(storage, today);
      res.json(dashboard);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message || "Failed to build outreach dashboard" });
    }
  });

  app.get("/api/outreach/schedulers", async (_req, res) => {
    try {
      const schedulers = await storage.getOutreachSchedulers();
      res.json(schedulers);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/outreach/schedulers", async (req, res) => {
    try {
      const parsed = insertOutreachSchedulerSchema.extend({
        facility: insertOutreachSchedulerSchema.shape.facility.refine(
          (f) => (VALID_FACILITIES as readonly string[]).includes(f),
          { message: "facility must be one of the three valid clinics" },
        ),
        capacityPercent: insertOutreachSchedulerSchema.shape.capacityPercent
          .refine((n) => n != null && n >= 0 && n <= 100, { message: "capacityPercent must be between 0 and 100" })
          .optional(),
      }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      const scheduler = await storage.createOutreachScheduler(parsed.data);
      res.status(201).json(scheduler);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/outreach/schedulers/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const patchSchema = insertOutreachSchedulerSchema.partial().extend({
        facility: insertOutreachSchedulerSchema.shape.facility.refine(
          (f) => (VALID_FACILITIES as readonly string[]).includes(f),
          { message: "facility must be one of the three valid clinics" },
        ).optional(),
        capacityPercent: insertOutreachSchedulerSchema.shape.capacityPercent
          .refine((n) => n != null && n >= 0 && n <= 100, { message: "capacityPercent must be between 0 and 100" })
          .optional(),
      });
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      if (Object.keys(parsed.data).length === 0) return res.status(400).json({ error: "No fields provided to update" });
      const updated = await storage.updateOutreachScheduler(id, parsed.data);
      if (!updated) return res.status(404).json({ error: "Scheduler not found" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/outreach/schedulers/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const deleted = await storage.deleteOutreachScheduler(id);
      if (!deleted) return res.status(404).json({ error: "Scheduler not found" });
      res.json({ success: true, deleted });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

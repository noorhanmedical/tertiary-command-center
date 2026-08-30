// Capacity-aware scheduling availability endpoint.
//
// ONE endpoint consumed by BOTH the full UnifiedScheduler and the Quick
// Schedule popover so they never compute availability differently. The client
// renders these server decisions (slots / conflict / suggestions / agenda); it
// does not recompute overlaps.

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { RESOURCE_TYPES } from "@shared/schema/schedulingCapacity";
import { computeAvailability } from "../services/scheduling/availabilityService";

const serviceRequestSchema = z.object({
  resourceType: z.enum(RESOURCE_TYPES),
  studyCount: z.number().int().min(1).max(20).optional(),
});

const availabilityBodySchema = z.object({
  facility: z.string().nullable().optional(),
  clinicId: z.number().int().nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  services: z.array(serviceRequestSchema).default([]),
  patientKey: z.string().nullable().optional(),
  preferredTime: z
    .string()
    .regex(/^\d{1,2}:\d{2}$/)
    .nullable()
    .optional(),
});

export function registerSchedulingAvailabilityRoutes(app: Express) {
  // POST /api/scheduling/availability
  app.post("/api/scheduling/availability", async (req: Request, res: Response) => {
    const parsed = availabilityBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    }
    try {
      const result = await computeAvailability({
        facilityName: parsed.data.facility ?? null,
        clinicId: parsed.data.clinicId ?? null,
        isoDate: parsed.data.date,
        services: parsed.data.services,
        patientKey: parsed.data.patientKey ?? null,
        preferredTime: parsed.data.preferredTime ?? null,
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Availability failed" });
    }
  });
}

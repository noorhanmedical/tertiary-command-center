// Multi-service VISIT scheduling endpoint.
//
// POST /api/scheduling/visit — schedules every selected service for a patient
// as one visit (shared visitGroupId), each as its own canonical event, through
// the same single-service core the schedule-ancillary route uses. Capacity /
// off-day conflicts are SOFT: an authorized (admin | PCS | ACS) user may
// override with a required reason, which is audited. Hard blocks (bad
// service code, invalid date/time, unauthorized override) are rejected.

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { scheduleVisit } from "../services/scheduling/visitOrchestration";
import { canOverrideCapacity } from "../services/scheduling/capacityAuthorization";

const overrideSchema = z.object({
  constraint: z.enum(["full", "off_day", "outage"]),
  reason: z.string().trim().min(1, "Override reason is required").max(500),
  category: z.string().trim().max(80).nullable().optional(),
  capacityState: z.record(z.unknown()).nullable().optional(),
});

const serviceSchema = z.object({
  serviceType: z.string().min(1),
  time: z.string().regex(/^\d{1,2}:\d{2}$/, "time must be HH:MM"),
  studyCount: z.number().int().min(1).max(20).optional(),
});

const groupSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  services: z.array(serviceSchema).min(1, "Each group needs at least one service"),
  overrides: z.record(overrideSchema).optional(),
});

// Accepts EITHER the single-date shape { date, services, overrides } OR the
// multi-date shape { groups: [{ date, services, overrides }] }. Both write one
// visit sharing a visitGroupId.
const visitBodySchema = z
  .object({
    facility: z.string().nullable().optional(),
    patientScreeningId: z.number().int().nullable().optional(),
    executionCaseId: z.number().int().nullable().optional(),
    patientName: z.string().nullable().optional(),
    patientDob: z.string().nullable().optional(),
    visitGroupId: z.string().nullable().optional(),
    // Single-date form:
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    services: z.array(serviceSchema).optional(),
    overrides: z.record(overrideSchema).optional(),
    // Multi-date form:
    groups: z.array(groupSchema).optional(),
  })
  .refine(
    (b) => (b.groups && b.groups.length > 0) || (b.date && b.services && b.services.length > 0),
    { message: "Provide either { groups } or { date + services }" },
  );

export function registerSchedulingVisitRoutes(app: Express) {
  app.post("/api/scheduling/visit", async (req: Request, res: Response) => {
    const parsed = visitBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    }
    const data = parsed.data;

    // Hard block: a patient must be identifiable.
    if (
      data.patientScreeningId == null &&
      data.executionCaseId == null &&
      !(data.patientName && data.patientName.trim())
    ) {
      return res.status(400).json({
        error: "A patient (screening id, execution case id, or name) is required",
        code: "MISSING_PATIENT",
      });
    }

    // Normalize to the multi-date group model (single-date → one group).
    const groups =
      data.groups && data.groups.length > 0
        ? data.groups
        : [{ date: data.date!, services: data.services!, overrides: data.overrides }];

    // Override authorization (soft-constraint bypass) is gated. If ANY group
    // carries an override, the caller must be admin or an authorized PCS/ACS.
    const hasOverride = groups.some((g) => g.overrides && Object.keys(g.overrides).length > 0);
    if (hasOverride && !(await canOverrideCapacity(req))) {
      return res.status(403).json({
        error: "Overriding a scheduling constraint requires admin or an authorized PCS/ACS role",
        code: "OVERRIDE_NOT_AUTHORIZED",
      });
    }

    try {
      const result = await scheduleVisit(req, {
        facility: data.facility ?? null,
        patientScreeningId: data.patientScreeningId ?? null,
        executionCaseId: data.executionCaseId ?? null,
        patientName: data.patientName ?? null,
        patientDob: data.patientDob ?? null,
        visitGroupId: data.visitGroupId ?? null,
        groups,
      });
      // 200 all scheduled; 207-ish partial surfaced as 200 with overall flag so
      // the client can show a clear partial state; 502 when nothing persisted.
      const httpStatus = result.overall === "failed" ? 502 : 200;
      return res.status(httpStatus).json(result);
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : "Visit scheduling failed" });
    }
  });
}

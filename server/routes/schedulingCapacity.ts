// Scheduling Resource Capacity routes.
//
// Facility equipment defaults (machine counts / durations / ultrasound
// turnover) and temporary date-range outages. Reads are open to authenticated
// users; permanent-default writes require admin; temporary overrides require
// admin OR an authorized PCS/ACS team member. All writes are audited, and a
// capacity-reducing override triggers the machine-outage conflict workflow.

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { createFacilityResolver } from "../services/facilityResolver";
import {
  listFacilityCapacity,
  getEffectiveCapacityConfig,
  upsertFacilityCapacity,
  listOverridesForClinic,
  getOverrideById,
  createOverride,
  deactivateOverride,
} from "../repositories/schedulingCapacity.repo";
import {
  insertFacilityResourceCapacitySchema,
  insertTemporaryCapacityOverrideSchema,
  RESOURCE_TYPES,
} from "@shared/schema/schedulingCapacity";
import {
  canEditDefaultCapacity,
  canOverrideCapacity,
  sessionUserId,
} from "../services/scheduling/capacityAuthorization";
import { logAudit } from "../services/auditService";
import { detectAndNotifyOutageConflicts } from "../services/scheduling/outageWorkflow";

// Resolve a clinic id + canonical name from either a numeric id or a facility
// NAME. The Team Portal works in names; Admin Settings works in clinic ids.
async function resolveClinic(
  raw: string | number | null | undefined,
): Promise<{ clinicId: number; name: string } | null> {
  if (raw == null) return null;
  const asNum = typeof raw === "number" ? raw : Number(raw);
  const { facilities, resolve } = await createFacilityResolver();
  if (Number.isInteger(asNum) && String(asNum) === String(raw).trim()) {
    const byId = facilities.find((f) => f.clinicId === asNum);
    if (byId?.clinicId != null) return { clinicId: byId.clinicId, name: byId.name };
  }
  const match = resolve(String(raw));
  if (match?.clinicId != null) return { clinicId: match.clinicId, name: match.name };
  return null;
}

const capacityUpsertSchema = insertFacilityResourceCapacitySchema.omit({
  clinicId: true,
});

export function registerSchedulingCapacityRoutes(app: Express) {
  // ── Read effective + raw capacity for a facility ──────────────────────────
  // GET /api/scheduling/capacity?facility=<name|id>
  app.get("/api/scheduling/capacity", async (req: Request, res: Response) => {
    try {
      const raw = (req.query.facility ?? req.query.clinicId ?? req.query.name) as
        | string
        | undefined;
      const resolved = await resolveClinic(raw ?? null);
      if (!resolved) {
        // Unknown facility → return code defaults so the UI still renders.
        const effective = await getEffectiveCapacityConfig(null);
        return res.json({ clinicId: null, facility: raw ?? null, effective, rows: [], overrides: [] });
      }
      const [effective, rows, overrides] = await Promise.all([
        getEffectiveCapacityConfig(resolved.clinicId),
        listFacilityCapacity(resolved.clinicId),
        listOverridesForClinic(resolved.clinicId, { activeOnly: false }),
      ]);
      res.json({ clinicId: resolved.clinicId, facility: resolved.name, effective, rows, overrides });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed to load capacity" });
    }
  });

  // ── Edit permanent DEFAULT capacity for one resource (admin only) ─────────
  // PUT /api/scheduling/capacity/:facility/:resourceType
  app.put(
    "/api/scheduling/capacity/:facility/:resourceType",
    async (req: Request, res: Response) => {
      if (!canEditDefaultCapacity(req)) {
        return res.status(403).json({ error: "Forbidden — requires admin" });
      }
      const resourceType = String(req.params.resourceType);
      if (!RESOURCE_TYPES.includes(resourceType as (typeof RESOURCE_TYPES)[number])) {
        return res.status(400).json({ error: "Invalid resourceType" });
      }
      const resolved = await resolveClinic(String(req.params.facility));
      if (!resolved) return res.status(404).json({ error: "Unknown facility" });
      const parsed = capacityUpsertSchema.safeParse({ ...req.body, resourceType });
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      }
      try {
        const row = await upsertFacilityCapacity(resolved.clinicId, parsed.data);
        void logAudit(req, "update", "facility_resource_capacity", row.id, {
          clinicId: resolved.clinicId,
          resourceType,
          machineCount: row.machineCount,
          durationMinutes: row.durationMinutes,
          minutesPerStudy: row.minutesPerStudy,
          turnoverMinutes: row.turnoverMinutes,
        });
        res.json(row);
      } catch (e) {
        res.status(500).json({ error: e instanceof Error ? e.message : "Failed to save capacity" });
      }
    },
  );

  // ── Temporary overrides list (read) ──────────────────────────────────────
  // GET /api/scheduling/capacity/:facility/overrides
  app.get(
    "/api/scheduling/capacity/:facility/overrides",
    async (req: Request, res: Response) => {
      const resolved = await resolveClinic(String(req.params.facility));
      if (!resolved) return res.status(404).json({ error: "Unknown facility" });
      const activeOnly = req.query.activeOnly === "true";
      const rows = await listOverridesForClinic(resolved.clinicId, { activeOnly });
      res.json(rows);
    },
  );

  // ── Create a temporary override (admin OR authorized PCS/ACS) ─────────────
  // POST /api/scheduling/capacity/:facility/overrides
  app.post(
    "/api/scheduling/capacity/:facility/overrides",
    async (req: Request, res: Response) => {
      if (!(await canOverrideCapacity(req))) {
        return res
          .status(403)
          .json({ error: "Forbidden — requires admin or an authorized PCS/ACS team member" });
      }
      const resolved = await resolveClinic(String(req.params.facility));
      if (!resolved) return res.status(404).json({ error: "Unknown facility" });
      const parsed = insertTemporaryCapacityOverrideSchema
        .omit({ clinicId: true })
        .safeParse({ ...req.body, facilityId: req.body.facilityId ?? resolved.name });
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      }
      if (parsed.data.endDate < parsed.data.startDate) {
        return res.status(400).json({ error: "endDate cannot be before startDate" });
      }
      try {
        const row = await createOverride({
          ...parsed.data,
          clinicId: resolved.clinicId,
          createdBy: sessionUserId(req),
        });
        void logAudit(req, "create", "temporary_capacity_override", row.id, {
          clinicId: resolved.clinicId,
          facility: resolved.name,
          resourceType: row.resourceType,
          startDate: row.startDate,
          endDate: row.endDate,
          availableCapacity: row.availableCapacity,
          reason: row.reason,
        });
        // Machine-outage workflow: detect appointments that now exceed the
        // reduced capacity and alert the relevant team. Never auto-cancels.
        const conflicts = await detectAndNotifyOutageConflicts({
          clinicId: resolved.clinicId,
          facilityName: resolved.name,
          override: row,
          actorUserId: sessionUserId(req),
        }).catch(() => null);
        res.status(201).json({ override: row, conflicts });
      } catch (e) {
        res.status(500).json({ error: e instanceof Error ? e.message : "Failed to create override" });
      }
    },
  );

  // ── Lift an override early (admin OR authorized PCS/ACS) ──────────────────
  // DELETE /api/scheduling/capacity/overrides/:id
  app.delete(
    "/api/scheduling/capacity/overrides/:id",
    async (req: Request, res: Response) => {
      if (!(await canOverrideCapacity(req))) {
        return res
          .status(403)
          .json({ error: "Forbidden — requires admin or an authorized PCS/ACS team member" });
      }
      const id = parseInt(String(req.params.id), 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const existing = await getOverrideById(id);
      if (!existing) return res.status(404).json({ error: "Override not found" });
      const row = await deactivateOverride(id);
      void logAudit(req, "deactivate", "temporary_capacity_override", id, {
        resourceType: existing.resourceType,
      });
      res.json({ ok: true, override: row });
    },
  );
}

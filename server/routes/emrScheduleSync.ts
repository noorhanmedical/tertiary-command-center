// Admin route: EMR Encounter → schedule sync (Batch: EMR roster sync).
//
// POST /api/admin/emr-schedule-sync
//   - admin-only (guarded by requireAdmin in routes.ts)
//   - feature-flagged: USE_EMR_SCHEDULE_SYNC (default OFF)
//   - ?dryRun=1 resolves + maps + reports without writing
//
// Body: { encounters: ParsedEncounter[] } — already-parsed FHIR Encounters
// from the bulk import pipeline. Kept decoupled from S3 fetch so it is
// independently testable and the same payload can be dry-run first.

import type { Express, Request, Response } from "express";
import { sendPublicOperationalResponse } from "../middleware/requestObservability";
import {
  syncEmrEncounterSchedule,
  isEmrScheduleSyncEnabled,
  type ParsedEncounter,
} from "../services/emrSync/emrEncounterScheduleSync";

export function registerEmrScheduleSyncRoutes(app: Express) {
  app.post("/api/admin/emr-schedule-sync", async (req: Request, res: Response) => {
    if (!isEmrScheduleSyncEnabled()) {
      return sendPublicOperationalResponse(res, "EMR_SCHEDULE_SYNC_DISABLED");
    }

    const encounters = (req.body?.encounters ?? null) as ParsedEncounter[] | null;
    if (!Array.isArray(encounters)) {
      return res.status(400).json({ error: "Body must include an 'encounters' array." });
    }

    const dryRun =
      req.query.dryRun === "1" ||
      req.query.dryRun === "true" ||
      req.body?.dryRun === true;

    const today = typeof req.body?.today === "string" ? req.body.today : undefined;
    const recentWindowDays =
      typeof req.body?.recentWindowDays === "number" ? req.body.recentWindowDays : undefined;

    try {
      const result = await syncEmrEncounterSchedule(encounters, {
        dryRun,
        today,
        recentWindowDays,
      });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });
}

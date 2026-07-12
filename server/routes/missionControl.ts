// Mission Control routes — admin-only MONITORING endpoint.
//
// Route file responsibilities: auth + delegation only.
// Data assembly lives in ../services/missionControl/missionControlService.
// DB access lives in ../repositories/missionControl.repo.

import type { Express, RequestHandler } from "express";
import { buildMissionControlSpine } from "../services/missionControl/missionControlService";

export function registerMissionControlRoutes(
  app: Express,
  requireRole: (...roles: string[]) => RequestHandler,
) {
  app.get(
    "/api/mission-control/spine",
    requireRole("admin"),
    async (_req, res) => {
      try {
        const spine = await buildMissionControlSpine();
        res.json(spine);
      } catch (error: any) {
        console.error("[missionControl] error:", error?.message ?? error);
        res.status(500).json({
          error: error?.message ?? "Failed to load mission control spine",
        });
      }
    },
  );
}

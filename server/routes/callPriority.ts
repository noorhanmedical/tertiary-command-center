// /api/call-priority — Phase 3 PR 3.7.

import type { Express, Request, Response, NextFunction } from "express";
import { computeCallPriorityQueue } from "../services/exceptionIntelligence/callPriorityService";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  return next();
}

export function registerCallPriorityRoutes(app: Express) {
  app.get("/api/call-priority", requireAuth, async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const result = await computeCallPriorityQueue({
        facilityId: q.facilityId ?? null,
        ownerRole: q.ownerRole ?? null,
      }, limit);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

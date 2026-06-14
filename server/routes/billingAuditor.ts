// /api/billing-auditor/* — Phase 4 PR 4.7.

import type { Express, Request, Response, NextFunction } from "express";
import {
  getWorklistSummary, getWorklistItems, WORKLIST_QUEUE_IDS, type WorklistQueueId,
} from "../services/billing/billingAuditorWorklistService";

function requireAdminOrBiller(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  const role = req.session.role ?? "";
  if (role !== "admin" && role !== "biller") return res.status(403).json({ error: "Forbidden — admin or biller role required" });
  return next();
}

export function registerBillingAuditorRoutes(app: Express) {
  app.get("/api/billing-auditor/summary", requireAdminOrBiller, async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const summary = await getWorklistSummary(q.facilityId ?? null);
      res.json({ queues: WORKLIST_QUEUE_IDS, summary });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/billing-auditor/worklist", requireAdminOrBiller, async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const queueId = q.queueId as WorklistQueueId | undefined;
      if (!queueId || !(WORKLIST_QUEUE_IDS as readonly string[]).includes(queueId)) {
        return res.status(400).json({ error: "queueId is required and must be a valid worklist queue" });
      }
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 200, 500) : 200;
      const items = await getWorklistItems(queueId, q.facilityId ?? null, limit);
      res.json({ queueId, items });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

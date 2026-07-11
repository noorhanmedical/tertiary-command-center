// /api/ai-recommendations/* — Phase 3 PR 3.4.

import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  listRecommendations, getRecommendation,
  acceptRecommendation, rejectRecommendation,
} from "../services/exceptionIntelligence/aiRecommendationLogService";
import { getEffectiveAiSafetyPolicy } from "../services/exceptionIntelligence/aiSafetyPolicyService";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  return next();
}

function requireAdminOrBiller(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  const role = req.session.role ?? "";
  if (role !== "admin" && role !== "biller") return res.status(403).json({ error: "Forbidden — admin or biller role required" });
  return next();
}

const rejectBody = z.object({ reason: z.string().min(1).max(2048) });

export function registerAiRecommendationsRoutes(app: Express) {
  app.get("/api/ai-recommendations/safety-policy", requireAuth, async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const policy = await getEffectiveAiSafetyPolicy({
        facilityId: q.facilityId ?? null,
        userId: q.userId ?? null,
        testType: q.testType ?? null,
      });
      res.json(policy);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/ai-recommendations", requireAuth, async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const filters: Parameters<typeof listRecommendations>[0] = {};
      if (q.status) filters.status = q.status.includes(",") ? q.status.split(",") : q.status;
      if (q.exceptionSnapshotId) filters.exceptionSnapshotId = parseInt(q.exceptionSnapshotId, 10);
      if (q.modelProvider) filters.modelProvider = q.modelProvider;
      if (q.recommendedAction) filters.recommendedAction = q.recommendedAction;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 200, 1000) : 200;
      const rows = await listRecommendations(filters, limit);
      res.json(rows);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/ai-recommendations/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getRecommendation(id);
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/ai-recommendations/:id/accept", requireAdminOrBiller, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const r = await acceptRecommendation(id, { actorUserId: req.session?.userId ?? null });
      if (!r.ok) return res.status(r.status).json({ error: r.error });
      res.json(r);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/ai-recommendations/:id/reject", requireAdminOrBiller, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const parsed = rejectBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      const r = await rejectRecommendation(id, { actorUserId: req.session?.userId ?? null, reason: parsed.data.reason });
      if (!r.ok) return res.status(r.status).json({ error: r.error });
      res.json(r);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });
}

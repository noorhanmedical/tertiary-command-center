// /api/exception-settings/* — Phase 3 PR 3.1.

import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  getEffectiveExceptionPolicy,
  EXCEPTION_INTELLIGENCE_DOMAIN,
  getDetectorRegistrySnapshot,
} from "../services/exceptionIntelligence/exceptionSettingsService";
import {
  listAdminSettings,
  createAdminSetting,
  updateAdminSetting,
} from "../repositories/adminSettings.repo";

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  const role = req.session.role ?? "";
  if (role !== "admin") return res.status(403).json({ error: "Forbidden — admin role required" });
  return next();
}

const upsertSchema = z.object({
  settingKey: z.string().min(1),
  settingValue: z.record(z.unknown()),
  facilityId: z.string().optional().nullable(),
  testType: z.string().optional().nullable(),
  userId: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

export function registerExceptionSettingsRoutes(app: Express) {
  app.get("/api/exception-settings/effective", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const policy = await getEffectiveExceptionPolicy({
        facilityId: q.facilityId ?? null,
        userId: q.userId ?? null,
        testType: q.testType ?? null,
      });
      res.json({ policy, registry: getDetectorRegistrySnapshot() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/exception-settings/settings", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const filters: Parameters<typeof listAdminSettings>[0] = {
        settingDomain: EXCEPTION_INTELLIGENCE_DOMAIN,
      };
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.testType) filters.testType = q.testType;
      if (q.settingKey) filters.settingKey = q.settingKey;
      const rows = await listAdminSettings(filters, 500);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/exception-settings/settings", requireAdmin, async (req, res) => {
    try {
      const parsed = upsertSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      const row = await createAdminSetting({
        settingDomain: EXCEPTION_INTELLIGENCE_DOMAIN,
        settingKey: parsed.data.settingKey,
        settingValue: parsed.data.settingValue,
        description: parsed.data.description ?? null,
        facilityId: parsed.data.facilityId ?? null,
        userId: parsed.data.userId ?? null,
        testType: parsed.data.testType ?? null,
        active: true,
      });
      res.status(201).json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/exception-settings/settings/:id", requireAdmin, async (req, res) => {
    try {
      const rawId = req.params.id as string;
      const id = parseInt(rawId, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const body = req.body as { settingValue?: Record<string, unknown>; active?: boolean; description?: string | null };
      const row = await updateAdminSetting(id, {
        settingValue: body.settingValue,
        active: body.active,
        description: body.description,
      } as any);
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

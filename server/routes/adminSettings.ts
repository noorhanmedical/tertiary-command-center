import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  listAdminSettings,
  getAdminSettingById,
  createAdminSetting,
  updateAdminSetting,
  upsertAdminSetting,
} from "../repositories/adminSettings.repo";
import { getEffectiveAdminSettings } from "../services/adminSettings/adminSettingsEffectiveService";

// PR 2.1 — Admin write/effective routes are admin-only. List + read
// stay open to authenticated sessions because the Admin Settings
// Center surfaces them for inspection (the Admin page still gates
// the navigation to admins).
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  if ((req.session.role ?? "") !== "admin") return res.status(403).json({ error: "Forbidden — admin role required" });
  return next();
}

const createBodySchema = z.object({
  settingDomain: z.string().min(1),
  settingKey: z.string().min(1),
  settingValue: z.record(z.unknown()),
  description: z.string().optional().nullable(),
  facilityId: z.string().optional().nullable(),
  userId: z.string().optional().nullable(),
  testType: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

const patchBodySchema = z.object({
  settingValue: z.record(z.unknown()).optional(),
  description: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

export function registerAdminSettingsRoutes(app: Express) {
  // GET /api/admin-settings — list with filters.
  app.get("/api/admin-settings", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listAdminSettings>[0] = {};

      if (q.settingDomain) filters.settingDomain = q.settingDomain;
      if (q.settingKey) filters.settingKey = q.settingKey;
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.userId) filters.userId = q.userId;
      if (q.active !== undefined) filters.active = q.active === "true";

      const rows = await listAdminSettings(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/admin-settings/effective — resolves the effective
  // settings bundle for an optional (facilityId, userId, testType)
  // scope. Phase 2 hardening item 5 adds testType. The sources
  // ledger now also surfaces "test_type" as a source label.
  app.get("/api/admin-settings/effective", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const bundle = await getEffectiveAdminSettings({
        facilityId: q.facilityId ?? null,
        userId: q.userId ?? null,
        testType: q.testType ?? null,
      });
      res.json(bundle);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/admin-settings/:id
  app.get("/api/admin-settings/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getAdminSettingById(id);
      if (!row) return res.status(404).json({ error: "Admin setting not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/admin-settings — create a new (or scoped-override) row.
  app.post("/api/admin-settings", requireAdmin, async (req, res) => {
    try {
      const parsed = createBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const row = await createAdminSetting({
        settingDomain: parsed.data.settingDomain,
        settingKey: parsed.data.settingKey,
        settingValue: parsed.data.settingValue,
        description: parsed.data.description ?? null,
        facilityId: parsed.data.facilityId ?? null,
        userId: parsed.data.userId ?? null,
        testType: parsed.data.testType ?? null,
        active: parsed.data.active ?? true,
      });
      res.status(201).json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/admin-settings/upsert — idempotent scoped upsert by
  // (domain, key, facilityId, userId, testType). The canonical write path for
  // scoped settings such as the team-member workspace_profile (previously the
  // client called this route but it did not exist → saves 404'd).
  app.post("/api/admin-settings/upsert", requireAdmin, async (req, res) => {
    try {
      const parsed = createBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const row = await upsertAdminSetting({
        settingDomain: parsed.data.settingDomain,
        settingKey: parsed.data.settingKey,
        settingValue: parsed.data.settingValue,
        facilityId: parsed.data.facilityId ?? null,
        userId: parsed.data.userId ?? null,
        testType: parsed.data.testType ?? null,
        description: parsed.data.description ?? null,
      });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /api/admin-settings/:id — update settingValue / description /
  // active flag. Setting `active: false` is the supported deactivation
  // path (in lieu of DELETE — admin-settings history is preserved).
  app.patch("/api/admin-settings/:id", requireAdmin, async (req, res) => {
    try {
      const rawId = req.params.id as string;
      const id = parseInt(rawId, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const parsed = patchBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const updates: Partial<Parameters<typeof updateAdminSetting>[1]> = {};
      if (parsed.data.settingValue !== undefined) updates.settingValue = parsed.data.settingValue;
      if (parsed.data.description !== undefined) updates.description = parsed.data.description;
      if (parsed.data.active !== undefined) updates.active = parsed.data.active;
      const row = await updateAdminSetting(id, updates);
      if (!row) return res.status(404).json({ error: "Admin setting not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

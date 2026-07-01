import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  listWidgetsForUser,
  replaceWidgetsForUser,
} from "../repositories/portalWidgets.repo";

// Per-user Team Portal Playground widgets (Task #657). Any authenticated
// session may read/write its OWN widgets; the owning user always comes from
// the session, never the client, so widgets can never bleed across users.

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  return next();
}

const WIDGET_TYPES = ["sticky", "email", "teamChat"] as const;
const WIDGET_COLORS = ["yellow", "pink", "blue", "green", "purple", "gray"] as const;

const patientContextSchema = z
  .object({
    patientScreeningId: z.number().nullable(),
    name: z.string().nullable(),
  })
  .nullable();

const widgetSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.enum(WIDGET_TYPES),
  x: z.number().int(),
  y: z.number().int(),
  color: z.enum(WIDGET_COLORS),
  text: z.string().max(20000),
  collapsed: z.boolean(),
  patientContext: patientContextSchema.optional().default(null),
  createdBy: z.string().max(200),
});

const replaceSchema = z.object({
  widgets: z.array(widgetSchema).max(200),
});

export function registerPortalWidgetsRoutes(app: Express) {
  app.get("/api/portal/widgets", requireAuth, async (req, res) => {
    try {
      const rows = await listWidgetsForUser(req.session.userId!);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/portal/widgets", requireAuth, async (req, res) => {
    try {
      const parsed = replaceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const rows = await replaceWidgetsForUser(
        req.session.userId!,
        parsed.data.widgets.map((w) => ({
          id: w.id,
          type: w.type,
          x: w.x,
          y: w.y,
          color: w.color,
          text: w.text,
          collapsed: w.collapsed,
          patientContext: w.patientContext ?? null,
          createdBy: w.createdBy,
        })),
      );
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

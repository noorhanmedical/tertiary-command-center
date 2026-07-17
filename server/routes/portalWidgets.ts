import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  listWidgetsForUser,
  applyWidgetChangesForUser,
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

// Incremental change payload. `upserts` are widgets to create/update, `deletes`
// are widget ids to remove. Only these rows are touched, so two devices editing
// different notes no longer overwrite each other (Task #661). The legacy
// full-array `{ widgets }` shape is still accepted (treated as an upsert of the
// whole set with no deletes) for backward compatibility.
const changeSchema = z
  .object({
    upserts: z.array(widgetSchema).max(200).optional(),
    deletes: z.array(z.string().min(1).max(128)).max(200).optional(),
    widgets: z.array(widgetSchema).max(200).optional(),
  })
  .refine(
    (v) => v.upserts !== undefined || v.deletes !== undefined || v.widgets !== undefined,
    { message: "Provide upserts, deletes, or widgets" },
  );

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
      const parsed = changeSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const upsertSource = parsed.data.upserts ?? parsed.data.widgets ?? [];
      const rows = await applyWidgetChangesForUser(
        req.session.userId!,
        upsertSource.map((w) => ({
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
        parsed.data.deletes ?? [],
      );
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

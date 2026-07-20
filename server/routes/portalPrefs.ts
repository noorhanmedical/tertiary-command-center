import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  getWorkspacePrefsForUser,
  upsertWorkspacePrefsForUser,
} from "../repositories/portalPrefs.repo";

// Per-user Team Portal workspace preferences. Any authenticated session may
// read/write its OWN prefs; the owning user always comes from the session,
// never the client, so prefs can never bleed across users.

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  return next();
}

// Every value here MUST match the client's TrayTab / PlaygroundLayout /
// CalendarBehavior unions and the SelectItem list in
// client/src/components/portal/tools/WorkspaceSettingsDialog.tsx.
// The dialog offers Patient Messages, Direct Messages, and Team Chat —
// prior schema omitted "patients" here, so every PUT with
// { defaultTrayTab: "patients" } was rejected 400 and the client's
// best-effort `.catch(() => {})` swallowed the failure silently. The
// tray tab therefore never persisted for Patient Messages.
const prefsSchema = z.object({
  defaultTrayTab: z.enum(["patients", "direct", "team"]),
  stickyNotesVisible: z.boolean(),
  toolsPinnedByDefault: z.boolean(),
  workQueuePinnedByDefault: z.boolean(),
  playgroundLayout: z.enum(["docked", "split"]),
  calendarBehavior: z.enum(["playground", "quickSchedule"]),
});

export function registerPortalPrefsRoutes(app: Express) {
  app.get("/api/portal/workspace-prefs", requireAuth, async (req, res) => {
    try {
      const row = await getWorkspacePrefsForUser(req.session.userId!);
      // null means "no saved prefs yet" — the client falls back to defaults.
      res.json(row ? row.prefs : null);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/portal/workspace-prefs", requireAuth, async (req, res) => {
    try {
      const parsed = prefsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const row = await upsertWorkspacePrefsForUser(req.session.userId!, parsed.data);
      res.json(row.prefs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

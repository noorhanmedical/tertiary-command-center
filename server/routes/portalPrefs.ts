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
// Patient Messages / patient SMS is intentionally NOT exposed — the
// platform does not ship a live patient-messaging path, so the only
// tray tabs are Direct Messages and Team Chat.
const prefsSchema = z.object({
  // K7 — which top-level left-rail tab opens by default. Optional for
  // backward compatibility with older clients that don't send it; the
  // client always falls back to "tools" when absent.
  defaultLeftTab: z.enum(["tools", "messaging"]).optional(),
  defaultTrayTab: z.enum(["direct", "team"]),
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

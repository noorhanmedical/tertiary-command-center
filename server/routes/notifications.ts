// Notification routes (Phase 6A). The notification center reads/acts here.
// Every endpoint is scoped to the authenticated recipient — a user can only
// ever see and mutate their OWN notifications (no client-provided userId is
// trusted; scope comes from the session).
//
//   GET  /api/notifications                 → recent (opt ?unreadOnly=1&limit=)
//   GET  /api/notifications/unread-count     → { count } for the badge
//   POST /api/notifications/:id/read         → mark one read (recipient-scoped)
//   POST /api/notifications/:id/acknowledge  → ack a high-signal item
//   POST /api/notifications/mark-all-read    → clear the badge

import type { Express, Request, Response } from "express";
import { notificationsRepository } from "../repositories/notifications.repo";

function sessionUserId(req: Request): string | null {
  return (req as Request & { session?: { userId?: string } }).session?.userId ?? null;
}

function parseId(raw: string | string[] | undefined): number | null {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function registerNotificationRoutes(app: Express) {
  app.get("/api/notifications", async (req: Request, res: Response) => {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const unreadOnly = String(req.query.unreadOnly ?? "") === "1";
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const rows = await notificationsRepository.listForRecipient(userId, {
        unreadOnly,
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      return res.json({ notifications: rows, total: rows.length });
    } catch (err) {
      console.error("[notifications] list failed:", err instanceof Error ? err.message : err);
      return res.status(500).json({ error: "Failed to load notifications" });
    }
  });

  app.get("/api/notifications/unread-count", async (req: Request, res: Response) => {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const count = await notificationsRepository.unreadCount(userId);
      return res.json({ count });
    } catch (err) {
      console.error("[notifications] unread-count failed:", err instanceof Error ? err.message : err);
      return res.status(500).json({ error: "Failed to load unread count" });
    }
  });

  app.post("/api/notifications/:id/read", async (req: Request, res: Response) => {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    try {
      const row = await notificationsRepository.markRead(id, userId);
      // Idempotent: already-read or not-yours resolves to ok without leaking
      // whether the id exists for another user.
      return res.json(row ?? { ok: true });
    } catch (err) {
      console.error("[notifications] read failed:", err instanceof Error ? err.message : err);
      return res.status(500).json({ error: "Failed to mark read" });
    }
  });

  app.post("/api/notifications/:id/acknowledge", async (req: Request, res: Response) => {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    try {
      const row = await notificationsRepository.acknowledge(id, userId);
      if (!row) return res.status(404).json({ error: "Notification not found" });
      return res.json(row);
    } catch (err) {
      console.error("[notifications] acknowledge failed:", err instanceof Error ? err.message : err);
      return res.status(500).json({ error: "Failed to acknowledge" });
    }
  });

  app.post("/api/notifications/mark-all-read", async (req: Request, res: Response) => {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const cleared = await notificationsRepository.markAllRead(userId);
      return res.json({ ok: true, cleared });
    } catch (err) {
      console.error("[notifications] mark-all-read failed:", err instanceof Error ? err.message : err);
      return res.status(500).json({ error: "Failed to mark all read" });
    }
  });
}

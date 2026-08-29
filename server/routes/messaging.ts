// First-class messaging routes (Phase 1).
//
// The ONE canonical internal-messaging API. Replaces the flag-gated
// /api/internal-messages backend and the commented-out
// /api/portal/direct-messages endpoints. INTERNAL user-to-user only.
//
// Endpoints (all require an authenticated session + resolved clinic tenancy):
//   GET  /api/messaging/roster                          — recipient picker
//   GET  /api/messaging/conversations                   — my conversations + unread
//   GET  /api/messaging/unread-count                    — total unread
//   POST /api/messaging/direct                          — open (find-or-create) a 1:1
//   GET  /api/messaging/conversations/:id/messages      — messages in a conversation
//   POST /api/messaging/conversations/:id/messages      — send a message
//   POST /api/messaging/conversations/:id/mark-read     — advance my read marker

import type { Express, Request, Response, NextFunction } from "express";
import {
  getMyConversations,
  getMyUnreadCount,
  getRoster,
  openDirectConversation,
  getConversationMessages,
  postMessage,
  markRead,
} from "../services/messaging/messagingService";

function resolveClinicId(req: Request): number | null {
  const raw =
    (req.session as { clinicId?: number } | undefined)?.clinicId ??
    (req as { clinicId?: number | null }).clinicId ??
    null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function requireAuthAndClinic(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  const clinicId = resolveClinicId(req);
  if (clinicId == null) {
    return res.status(403).json({ error: "No clinic tenancy resolved for this session" });
  }
  (req as Request & { resolvedClinicId?: number }).resolvedClinicId = clinicId;
  return next();
}

function statusForCode(code: string | undefined): number {
  switch (code) {
    case "VALIDATION": return 400;
    case "FORBIDDEN": return 403;
    case "RATE_LIMITED": return 429;
    default: return 500;
  }
}

function parseId(v: string | string[] | undefined): number | null {
  const s = Array.isArray(v) ? v[0] : v;
  const n = parseInt(String(s ?? ""), 10);
  return Number.isFinite(n) ? n : null;
}

export function registerMessagingRoutes(app: Express) {
  app.get("/api/messaging/roster", requireAuthAndClinic, async (req, res) => {
    try {
      const clinicId = (req as Request & { resolvedClinicId: number }).resolvedClinicId;
      const roster = await getRoster({ clinicId, meUserId: req.session!.userId! });
      res.json({ roster });
    } catch (e) {
      const err = e as Error & { code?: string };
      res.status(statusForCode(err.code)).json({ error: err.message ?? "Failed to load roster" });
    }
  });

  app.get("/api/messaging/conversations", requireAuthAndClinic, async (req, res) => {
    try {
      const clinicId = (req as Request & { resolvedClinicId: number }).resolvedClinicId;
      const conversations = await getMyConversations({ clinicId, userId: req.session!.userId! });
      res.json({ conversations });
    } catch (e) {
      const err = e as Error & { code?: string };
      res.status(statusForCode(err.code)).json({ error: err.message ?? "Failed to load conversations" });
    }
  });

  app.get("/api/messaging/unread-count", requireAuthAndClinic, async (req, res) => {
    try {
      const clinicId = (req as Request & { resolvedClinicId: number }).resolvedClinicId;
      const unread = await getMyUnreadCount({ clinicId, userId: req.session!.userId! });
      res.json({ unread });
    } catch (e) {
      const err = e as Error & { code?: string };
      res.status(statusForCode(err.code)).json({ error: err.message ?? "Failed to count unread" });
    }
  });

  app.post("/api/messaging/direct", requireAuthAndClinic, async (req, res) => {
    try {
      const clinicId = (req as Request & { resolvedClinicId: number }).resolvedClinicId;
      const otherUserId = String(req.body?.otherUserId ?? "");
      const result = await openDirectConversation({
        clinicId,
        meUserId: req.session!.userId!,
        otherUserId,
      });
      res.status(201).json(result);
    } catch (e) {
      const err = e as Error & { code?: string };
      res.status(statusForCode(err.code)).json({ error: err.message ?? "Failed to open conversation" });
    }
  });

  app.get("/api/messaging/conversations/:id/messages", requireAuthAndClinic, async (req, res) => {
    try {
      const conversationId = parseId(req.params.id);
      if (conversationId == null) return res.status(400).json({ error: "Invalid conversation id" });
      const messages = await getConversationMessages({
        conversationId,
        userId: req.session!.userId!,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json({ messages });
    } catch (e) {
      const err = e as Error & { code?: string };
      res.status(statusForCode(err.code)).json({ error: err.message ?? "Failed to load messages" });
    }
  });

  app.post("/api/messaging/conversations/:id/messages", requireAuthAndClinic, async (req, res) => {
    try {
      const conversationId = parseId(req.params.id);
      if (conversationId == null) return res.status(400).json({ error: "Invalid conversation id" });
      const body = String(req.body?.body ?? "");
      const message = await postMessage({
        conversationId,
        senderUserId: req.session!.userId!,
        body,
      });
      res.status(201).json(message);
    } catch (e) {
      const err = e as Error & { code?: string };
      res.status(statusForCode(err.code)).json({ error: err.message ?? "Failed to send message" });
    }
  });

  // Phase 5A — PHI-safe SSE nudge. Forwards the liveActivityBus 'message_sent'
  // signal so clients refetch conversations/unread within ~1s instead of
  // waiting on the polling tick. Payload carries only the event type — never
  // message bodies, patient identity, or conversation contents.
  app.get("/api/messaging/stream", requireAuthAndClinic, async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(": connected\n\n");

    const { subscribeLiveActivity } = await import("../services/engagement/liveActivityBus");
    const unsubscribe = subscribeLiveActivity((signal) => {
      if (signal.eventType !== "message_sent") return;
      res.write(`event: message\ndata: ${JSON.stringify({ eventType: signal.eventType })}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
    const cleanup = () => { clearInterval(heartbeat); unsubscribe(); };
    req.on("close", cleanup);
    res.on("close", cleanup);
  });

  app.post("/api/messaging/conversations/:id/mark-read", requireAuthAndClinic, async (req, res) => {
    try {
      const conversationId = parseId(req.params.id);
      if (conversationId == null) return res.status(400).json({ error: "Invalid conversation id" });
      const result = await markRead({ conversationId, userId: req.session!.userId! });
      res.json(result);
    } catch (e) {
      const err = e as Error & { code?: string };
      res.status(statusForCode(err.code)).json({ error: err.message ?? "Failed to mark read" });
    }
  });
}

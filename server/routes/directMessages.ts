// Internal direct-messages routes.
//
// Gated by FEATURE_INTERNAL_DIRECT_MESSAGES (default OFF). When
// disabled, every endpoint returns 501 { error: "feature disabled" }
// so the client falls back to its local mock UI (mockPortalMessages).

import type { Express, Request, Response, NextFunction } from "express";
import { isEnabled } from "../lib/featureFlags";
import {
  listMyInbox,
  listMyConversation,
  sendMessage,
  markRead,
  unreadCount,
} from "../services/directMessages/directMessagesService";

function requireAuthAndClinic(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const clinicId = Number(
    (req.session as any).clinicId ?? (req as any).clinicId ?? NaN,
  );
  if (!Number.isFinite(clinicId) || clinicId <= 0) {
    return res
      .status(403)
      .json({ error: "No clinic tenancy resolved for this session" });
  }
  (req as any).resolvedClinicId = clinicId;
  return next();
}

function featureGate(_req: Request, res: Response, next: NextFunction) {
  if (!isEnabled("internalDirectMessages")) {
    return res
      .status(501)
      .json({ error: "internal direct messages feature disabled" });
  }
  return next();
}

export function registerDirectMessagesRoutes(app: Express) {
  // GET /api/internal-messages/inbox
  app.get(
    "/api/internal-messages/inbox",
    featureGate,
    requireAuthAndClinic,
    async (req, res) => {
      try {
        const clinicId = (req as any).resolvedClinicId as number;
        const limit = Number((req.query as any).limit ?? 50);
        const rows = await listMyInbox({
          clinicId,
          recipientUserId: req.session!.userId!,
          limit,
        });
        res.json({ rows });
      } catch (err: any) {
        const code = err?.code === "FEATURE_DISABLED" ? 501 : 500;
        res.status(code).json({ error: err?.message ?? "Failed to load inbox" });
      }
    },
  );

  // GET /api/internal-messages/conversation/:otherUserId
  app.get(
    "/api/internal-messages/conversation/:otherUserId",
    featureGate,
    requireAuthAndClinic,
    async (req, res) => {
      try {
        const clinicId = (req as any).resolvedClinicId as number;
        const otherUserId = String(req.params.otherUserId ?? "");
        if (!otherUserId) {
          return res.status(400).json({ error: "otherUserId required" });
        }
        const rows = await listMyConversation({
          clinicId,
          meUserId: req.session!.userId!,
          otherUserId,
          limit: Number((req.query as any).limit ?? 100),
        });
        res.json({ rows });
      } catch (err: any) {
        const code =
          err?.code === "VALIDATION"
            ? 400
            : err?.code === "FEATURE_DISABLED"
              ? 501
              : 500;
        res.status(code).json({ error: err?.message ?? "Failed to load conversation" });
      }
    },
  );

  // POST /api/internal-messages
  app.post(
    "/api/internal-messages",
    featureGate,
    requireAuthAndClinic,
    async (req, res) => {
      try {
        const clinicId = (req as any).resolvedClinicId as number;
        const recipientUserId = String(req.body?.recipientUserId ?? "");
        const body = String(req.body?.body ?? "");
        if (!recipientUserId || !body) {
          return res
            .status(400)
            .json({ error: "recipientUserId and body required" });
        }
        const row = await sendMessage({
          clinicId,
          senderUserId: req.session!.userId!,
          recipientUserId,
          body,
        });
        res.status(201).json(row);
      } catch (err: any) {
        const code =
          err?.code === "VALIDATION"
            ? 400
            : err?.code === "RATE_LIMITED"
              ? 429
              : err?.code === "FEATURE_DISABLED"
                ? 501
                : 500;
        res.status(code).json({ error: err?.message ?? "Failed to send message" });
      }
    },
  );

  // POST /api/internal-messages/conversation/:otherUserId/mark-read
  app.post(
    "/api/internal-messages/conversation/:otherUserId/mark-read",
    featureGate,
    requireAuthAndClinic,
    async (req, res) => {
      try {
        const clinicId = (req as any).resolvedClinicId as number;
        const otherUserId = String(req.params.otherUserId ?? "");
        const updated = await markRead({
          clinicId,
          meUserId: req.session!.userId!,
          otherUserId,
        });
        res.json({ updated });
      } catch (err: any) {
        res.status(500).json({ error: err?.message ?? "Failed to mark read" });
      }
    },
  );

  // GET /api/internal-messages/unread-count
  app.get(
    "/api/internal-messages/unread-count",
    featureGate,
    requireAuthAndClinic,
    async (req, res) => {
      try {
        const clinicId = (req as any).resolvedClinicId as number;
        const n = await unreadCount({
          clinicId,
          recipientUserId: req.session!.userId!,
        });
        res.json({ unread: n });
      } catch (err: any) {
        res.status(500).json({ error: err?.message ?? "Failed to count unread" });
      }
    },
  );
}

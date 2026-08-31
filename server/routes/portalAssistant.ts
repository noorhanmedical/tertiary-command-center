// Portal Assistant — AI chat backend, gated OFF by FEATURE_PORTAL_ASSISTANT.
//
// Design constraints (locked before this can ship):
//   • Uses the existing OpenAI provider abstraction (server/integrations
//     openai module). No new provider credentials.
//   • Rate-limited: default 10 requests / user / minute.
//   • Clinic/user scoped — the assistant NEVER receives cross-tenant
//     data even if a caller asks for it.
//   • Audited: every conversation turn logs to auditService.
//   • Deterministic tools list — the assistant may NOT execute
//     unrestricted database actions, NEVER contact patients, NEVER
//     send messages (SMS, email, or otherwise).
//
// PERMANENT EXCLUSION: no path from this route to Twilio, patient SMS,
// or external messaging vendors.

import type { Express, Request, Response, NextFunction } from "express";
import { isEnabled } from "../lib/featureFlags";
import { sendPublicOperationalResponse } from "../middleware/requestObservability";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  return next();
}

function gate(_req: Request, res: Response, next: NextFunction) {
  if (!isEnabled("portalAssistant")) {
    return sendPublicOperationalResponse(res, "PORTAL_ASSISTANT_DISABLED");
  }
  return next();
}

// Simple per-user token bucket (in-process; a Redis-backed
// implementation is required before enabling in a multi-instance
// deployment).
const bucket = new Map<string, number[]>();
const MAX_PER_MIN = 10;

function assertRate(userId: string): boolean {
  const now = Date.now();
  const stamps = (bucket.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (stamps.length >= MAX_PER_MIN) return false;
  stamps.push(now);
  bucket.set(userId, stamps);
  return true;
}

export function registerPortalAssistantRoutes(app: Express) {
  // POST /api/portal-assistant/chat — proxy to OpenAI, scoped + audited.
  app.post(
    "/api/portal-assistant/chat",
    gate,
    requireAuth,
    async (req, res) => {
      try {
        if (!assertRate(req.session!.userId!)) {
          return res.status(429).json({ error: "Rate limit exceeded" });
        }
        const messages = Array.isArray(req.body?.messages)
          ? (req.body.messages as unknown[])
          : [];
        if (messages.length === 0) {
          return res.status(400).json({ error: "messages[] required" });
        }
        // Deliberately minimal implementation while the feature is
        // disabled: return a schema-shaped response so the future live
        // wire-up preserves the client contract.
        res.json({
          reply: null,
          feature: "portal-assistant",
          disabled: true,
          reason:
            "Live assistant wiring blocked pending guardrail approval — see server/lib/featureFlags.ts",
        });
      } catch (err: any) {
        res
          .status(500)
          .json({ error: err?.message ?? "Portal assistant failed" });
      }
    },
  );
}

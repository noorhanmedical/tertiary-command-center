// Phase 6 — telephony routes.
//
//   POST /api/telephony/calls            → initiate an integrated provider call
//                                          (CLAIM-GUARDED; fail-closed).
//   POST /telephony/webhooks/:provider   → provider telephony events (signature
//                                          verified, idempotent, order-safe).
//                                          NON-/api so providers (which can't
//                                          hold a Plexus session) can deliver.
//
// Telephony evidence NEVER becomes a business disposition. The initiate route
// requires the caller to HOLD the active work claim (Phase 4/5) — a stale/no
// claim cannot start a provider call. The webhook only records provider
// evidence + emits a live signal; it can never fabricate a call outcome.

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { getClaim, resolveActingSchedulerId } from "../services/engagement/workClaimService";
import { initiateProviderCall } from "../services/telephony/serverTelephonyService";
import {
  applyProviderTelephonyEvent,
  type ProviderTelephonyEvent,
} from "../services/telephony/telephonySessionService";
import { TELEPHONY_SESSION_STATES, type TelephonySessionState } from "@shared/phoneProvider";
import { publishLiveActivity } from "../services/engagement/liveActivityBus";

/** Live-activity signal emitted when a telephony session's provider state
 *  advances. PHI-free — a pure "something changed, refetch" nudge. */
export const TELEPHONY_ACTIVITY_EVENT = "telephony_session_updated";

const initiateSchema = z.object({
  executionCaseId: z.number().int().positive(),
  patientScreeningId: z.number().int().positive().nullable().optional(),
  toNumber: z.string().trim().min(3).max(32),
  facilityId: z.string().trim().nullable().optional(),
  fromExtension: z.string().trim().nullable().optional(),
});

const STATE_SET = new Set<string>(TELEPHONY_SESSION_STATES);

/** Normalize an inbound provider event to the internal shape. Supports the
 *  canonical normalized body AND a best-effort RingCentral telephony-session
 *  shape. Returns null when no provider session id / state can be resolved. */
function normalizeEvent(provider: string, body: any): ProviderTelephonyEvent | null {
  // Canonical normalized shape (used by mock validation + any adapter that
  // pre-normalizes): { providerSessionId, state, at?, seq?, durationSeconds? }.
  if (body && typeof body.providerSessionId === "string" && typeof body.state === "string") {
    if (!STATE_SET.has(body.state)) return null;
    return {
      provider,
      providerSessionId: body.providerSessionId,
      state: body.state as TelephonySessionState,
      at: body.at ? new Date(body.at) : null,
      seq: typeof body.seq === "number" ? body.seq : null,
      durationSeconds: typeof body.durationSeconds === "number" ? body.durationSeconds : null,
      executionCaseId: typeof body.executionCaseId === "number" ? body.executionCaseId : null,
      patientScreeningId: typeof body.patientScreeningId === "number" ? body.patientScreeningId : null,
    };
  }
  // Best-effort RingCentral telephony-session event shape.
  if (provider === "ringcentral" && body?.body) {
    const b = body.body;
    const providerSessionId: string | null =
      b.telephonySessionId ?? b.sessionId ?? (body.subscriptionId ? String(body.subscriptionId) : null);
    if (!providerSessionId) return null;
    const party = Array.isArray(b.parties) ? b.parties[0] : null;
    const code = String(party?.status?.code ?? "").toLowerCase();
    const state: TelephonySessionState =
      code === "answered" ? "connected"
        : code === "setup" || code === "proceeding" ? "proceeding"
          : code === "disconnected" || code === "gone" ? "ended"
            : code === "voicemail" ? "no_answer"
              : "initiated";
    return {
      provider,
      providerSessionId: String(providerSessionId),
      state,
      at: body.eventTime ? new Date(body.eventTime) : null,
      seq: typeof b.sequence === "number" ? b.sequence : null,
      durationSeconds: null,
    };
  }
  return null;
}

/** Verify a provider webhook. Fail-closed: unknown provider or bad/absent
 *  secret → not verified. RingCentral subscription handshake (Validation-Token)
 *  is handled by the caller before this. */
function verifyWebhook(provider: string, req: Request): boolean {
  if (provider === "ringcentral") {
    const secret = process.env.RINGCENTRAL_WEBHOOK_SECRET;
    if (!secret || String(secret).trim() === "") return false; // fail closed
    const token = req.header("verification-token") ?? req.header("Verification-Token");
    return token === secret;
  }
  // No other provider delivers verifiable events today (Doximity/manual are
  // never event sources) → fail closed.
  return false;
}

export function registerTelephonyRoutes(app: Express) {
  // ── Initiate an integrated provider call (claim-guarded) ──────────────────
  app.post("/api/telephony/calls", async (req: Request, res: Response) => {
    try {
      const parsed = initiateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const userId = req.session?.userId ?? null;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { executionCaseId, patientScreeningId, toNumber, facilityId, fromExtension } = parsed.data;

      // CLAIM GUARD (Phase 4/5): the caller MUST hold the active work claim on
      // this case. A stale / absent claim cannot initiate a provider call.
      const actingSchedulerId = await resolveActingSchedulerId(userId);
      const claim = await getClaim(executionCaseId);
      const holdsClaim =
        !!claim && claim.active && actingSchedulerId != null && claim.claimedBySchedulerId === actingSchedulerId;
      if (!holdsClaim) {
        return res.status(409).json({
          error: "You no longer hold this patient's active work — refresh before calling.",
          code: "no_active_claim",
        });
      }

      const result = await initiateProviderCall({
        facilityId: facilityId ?? null,
        userId,
        actingSchedulerId,
        executionCaseId,
        patientScreeningId: patientScreeningId ?? null,
        toNumber,
        fromExtension: fromExtension ?? null,
      });

      if (!result.initiated) {
        // not_integrated / not_ready → the client falls back to manual/launch;
        // this is an HONEST 200 (no call was faked). provider_error → 502.
        const status = result.code === "provider_error" ? 502 : 200;
        return res.status(status).json({
          initiated: false,
          provider: result.provider,
          code: result.code,
          reason: result.reason,
        });
      }

      return res.json({
        initiated: true,
        provider: result.provider,
        sessionId: result.session.id,
        providerSessionId: result.providerSessionId,
        state: result.state,
      });
    } catch (e: unknown) {
      // Never leak provider internals / PHI.
      return res.status(500).json({ error: "Failed to initiate call" });
    }
  });

  // ── Read a telephony session's live state (evidence only, PHI-free) ───────
  app.get("/api/telephony/calls/:sessionId", async (req: Request, res: Response) => {
    const id = Number(req.params.sessionId);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid session id" });
    }
    const { getTelephonySessionById } = await import("../repositories/telephonySessions.repo");
    const s = await getTelephonySessionById(id);
    if (!s) return res.status(404).json({ error: "Not found" });
    // Return ONLY line-level evidence — never patient identity.
    return res.json({
      sessionId: s.id,
      provider: s.provider,
      providerState: s.providerState,
      connectedAt: s.connectedAt,
      endedAt: s.endedAt,
      durationSeconds: s.durationSeconds,
    });
  });

  // ── Provider telephony webhook (evidence only) ────────────────────────────
  app.post("/telephony/webhooks/:provider", async (req: Request, res: Response) => {
    const provider = String(req.params.provider || "").toLowerCase();

    // RingCentral subscription handshake: echo the Validation-Token.
    const validationToken = req.header("validation-token") ?? req.header("Validation-Token");
    if (validationToken) {
      res.setHeader("Validation-Token", validationToken);
      return res.status(200).end();
    }

    // Fail closed on signature.
    if (!verifyWebhook(provider, req)) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const event = normalizeEvent(provider, req.body);
    if (!event) {
      // Acknowledge (200) so the provider doesn't retry-storm a payload we
      // simply don't act on, but record nothing.
      return res.status(200).json({ ok: true, applied: false });
    }

    try {
      const result = await applyProviderTelephonyEvent(event);
      // Emit a PHI-free live signal only when the authoritative state advanced.
      if (result.stateChanged) publishLiveActivity(TELEPHONY_ACTIVITY_EVENT);
      return res.status(200).json({ ok: true, applied: !result.ignored, stateChanged: result.stateChanged });
    } catch {
      return res.status(200).json({ ok: true, applied: false });
    }
  });
}

// Call handoff routes (Phase 3C / K6). Staff create/acknowledge/complete/recall
// their own handoffs; managers (admin) get the cross-team view + override.
//
//   POST /api/engagement/handoffs                 → create (staff/manager)
//   GET  /api/engagement/handoffs/inbox           → my open received handoffs
//   POST /api/engagement/handoffs/:id/acknowledge → recipient acknowledges
//   POST /api/engagement/handoffs/:id/view        → recipient marks viewed
//   POST /api/engagement/handoffs/:id/complete    → recipient completes
//   POST /api/engagement/handoffs/:id/cancel      → sender/manager recalls
//   GET  /api/engagement/handoffs/eligibility     → pre-check recipient (staff)
//   GET  /api/engagement/handoffs/manager         → cross-team view (admin)

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { PLEXUS_TASK_PRIORITY_LEVELS } from "@shared/schema";
import {
  createHandoff,
  acknowledgeHandoff,
  markHandoffViewed,
  completeHandoff,
  cancelHandoff,
  checkHandoffEligibility,
  callHandoffsRepository,
  HandoffError,
} from "../services/engagement/callHandoffService";

function sessionUserId(req: Request): string | null {
  return (req as Request & { session?: { userId?: string } }).session?.userId ?? null;
}
function sessionRole(req: Request): string | null {
  return (req as Request & { session?: { role?: string } }).session?.role ?? null;
}
function sessionClinicId(req: Request): number | null {
  const raw =
    (req as Request & { session?: { clinicId?: number } }).session?.clinicId ??
    (req as unknown as { clinicId?: number | null }).clinicId ??
    null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const createSchema = z.object({
  executionCaseId: z.number().int().positive(),
  toUserId: z.string().min(1),
  priorityLevel: z.enum(PLEXUS_TASK_PRIORITY_LEVELS),
  reason: z.string().min(1).max(500),
  note: z.string().max(2000).optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
  managerOverride: z.boolean().optional(),
});

function handleError(res: Response, err: unknown) {
  if (err instanceof HandoffError) {
    const body: Record<string, unknown> = { error: err.message, code: err.code };
    const elig = (err as unknown as { eligibility?: unknown }).eligibility;
    if (elig) body.eligibility = elig;
    return res.status(err.status).json(body);
  }
  console.error("[call-handoffs] error:", err instanceof Error ? err.message : err);
  return res.status(500).json({ error: "Handoff operation failed" });
}

export function registerCallHandoffRoutes(app: Express) {
  // Create a handoff. Manager (admin) may use source=manager + override.
  app.post("/api/engagement/handoffs", async (req: Request, res: Response) => {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    }
    const isManager = sessionRole(req) === "admin";
    try {
      const result = await createHandoff({
        executionCaseId: parsed.data.executionCaseId,
        toUserId: parsed.data.toUserId,
        priorityLevel: parsed.data.priorityLevel,
        reason: parsed.data.reason,
        note: parsed.data.note ?? null,
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
        source: isManager ? "manager" : "peer",
        // Only a manager may override capacity for P3–P5.
        managerOverride: isManager ? parsed.data.managerOverride ?? false : false,
        actorUserId: userId,
        clinicId: sessionClinicId(req),
      });
      return res.json(result);
    } catch (err) {
      return handleError(res, err);
    }
  });

  // Pre-check a recipient before confirming (staff sees capacity for P1/P2).
  app.get("/api/engagement/handoffs/eligibility", async (req: Request, res: Response) => {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const toUserId = String(req.query.toUserId ?? "");
    const facilityId = req.query.facilityId ? String(req.query.facilityId) : null;
    const plRaw = String(req.query.priorityLevel ?? "P3").toUpperCase();
    if (!toUserId) return res.status(400).json({ error: "toUserId required" });
    const priorityLevel = (PLEXUS_TASK_PRIORITY_LEVELS as readonly string[]).includes(plRaw)
      ? (plRaw as (typeof PLEXUS_TASK_PRIORITY_LEVELS)[number])
      : "P3";
    const managerOverride =
      sessionRole(req) === "admin" && String(req.query.managerOverride ?? "") === "true";
    try {
      const result = await checkHandoffEligibility({
        toUserId,
        facilityId,
        priorityLevel,
        managerOverride,
      });
      return res.json(result);
    } catch (err) {
      return handleError(res, err);
    }
  });

  // My open received handoffs (right-rail PRIORITY / TEAM HANDOFFS section).
  app.get("/api/engagement/handoffs/inbox", async (req: Request, res: Response) => {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const rows = await callHandoffsRepository.listOpenForRecipient(userId);
      return res.json(rows);
    } catch (err) {
      return handleError(res, err);
    }
  });

  // Manager cross-team view (Phase 4E): admin sees all; a team manager sees
  // handoffs to/from users in their scope; ordinary staff forbidden.
  app.get("/api/engagement/handoffs/manager", async (req: Request, res: Response) => {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const { resolveManagerScope, isManagerOrAdmin, scopeCoversUser } =
        await import("../services/teams/managerScope");
      const scope = await resolveManagerScope(userId, sessionRole(req));
      if (!isManagerOrAdmin(scope)) {
        return res.status(403).json({ error: "Manager view requires admin or a team-manager role" });
      }
      const rows = await callHandoffsRepository.listForManager(200);
      const scoped = scope.isAdmin
        ? rows
        : rows.filter((h) =>
            (h.toUserId && scopeCoversUser(scope, h.toUserId)) ||
            (h.fromUserId && scopeCoversUser(scope, h.fromUserId)),
          );
      return res.json(scoped);
    } catch (err) {
      return handleError(res, err);
    }
  });

  app.post("/api/engagement/handoffs/:id/acknowledge", async (req: Request, res: Response) => {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      return res.json(await acknowledgeHandoff(id, userId));
    } catch (err) {
      return handleError(res, err);
    }
  });

  app.post("/api/engagement/handoffs/:id/view", async (req: Request, res: Response) => {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      return res.json((await markHandoffViewed(id, userId)) ?? { ok: true });
    } catch (err) {
      return handleError(res, err);
    }
  });

  app.post("/api/engagement/handoffs/:id/complete", async (req: Request, res: Response) => {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      return res.json(await completeHandoff(id, userId));
    } catch (err) {
      return handleError(res, err);
    }
  });

  app.post("/api/engagement/handoffs/:id/cancel", async (req: Request, res: Response) => {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      return res.json(await cancelHandoff(id, userId, sessionRole(req) === "admin"));
    } catch (err) {
      return handleError(res, err);
    }
  });
}

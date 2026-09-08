// Phase 4 — ACTIVE-WORK CLAIM routes (minimal control surface).
//
//   POST /api/engagement/work-claims/:executionCaseId/acquire        → claim
//   POST /api/engagement/work-claims/:executionCaseId/renew          → heartbeat
//   POST /api/engagement/work-claims/:executionCaseId/release        → release
//   GET  /api/engagement/work-claims/:executionCaseId                → inspect
//   POST /api/engagement/work-claims/:executionCaseId/force-release  → admin/mgr
//
// This is the SERVER contract that a future Phone <-> Calendar Team Portal will
// call on workspace open / periodic heartbeat / close. It intentionally does
// NOT redesign Team Portal or CallWorkspace (Phase 5). Concurrency + lease
// semantics live in workClaimService; these routes are thin auth + mapping.
//
// AuthN: every /api route is already behind requireAuth. AuthZ here: a caller
// may act on a case they OWN, or that is within their manager scope, or if they
// are an admin. force-release additionally requires admin OR manager-in-scope
// (it overrides another member's claim).

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { patientExecutionCases } from "@shared/schema/executionCase";
import {
  acquireClaim,
  renewClaim,
  releaseClaim,
  forceReleaseClaim,
  getClaim,
  resolveActingSchedulerId,
  WORKCLAIM_LEASE_SECONDS,
  WORKCLAIM_RENEW_SECONDS,
} from "../services/engagement/workClaimService";
import {
  resolveManagerScope,
  isManagerOrAdmin,
  schedulerIdsInScope,
} from "../services/teams/managerScope";
import { logAudit } from "../services/auditService";

type Authz = {
  executionCaseId: number;
  assignedTeamMemberId: number | null;
  actingSchedulerId: number | null;
  isAdmin: boolean;
  isManagerInScope: boolean;
};

function parseCaseId(req: Request, res: Response): number | null {
  const id = Number(req.params.executionCaseId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid executionCaseId", code: "bad_request" });
    return null;
  }
  return id;
}

/** Resolve the case + the caller's authority over it. Owner / admin / manager-
 *  in-scope may act; everyone else is 403. Returns null (after writing the
 *  response) when the case is missing or the caller is unauthorized. */
async function authorize(req: Request, res: Response, executionCaseId: number): Promise<Authz | null> {
  const [ec] = await db
    .select({
      id: patientExecutionCases.id,
      assignedTeamMemberId: patientExecutionCases.assignedTeamMemberId,
    })
    .from(patientExecutionCases)
    .where(eq(patientExecutionCases.id, executionCaseId))
    .limit(1);
  if (!ec) {
    res.status(404).json({ error: "Execution case not found", code: "not_found" });
    return null;
  }
  const userId = (req.session as { userId?: string }).userId ?? null;
  const role = (req.session as { role?: string }).role ?? null;
  const isAdmin = role === "admin";
  const actingSchedulerId = await resolveActingSchedulerId(userId);

  let isManagerInScope = false;
  if (!isAdmin) {
    const scope = await resolveManagerScope(userId, role);
    if (isManagerOrAdmin(scope)) {
      const ids = await schedulerIdsInScope(scope); // null = admin (all)
      isManagerInScope =
        ids == null || (ec.assignedTeamMemberId != null && ids.includes(ec.assignedTeamMemberId));
    }
  }

  const isOwner = actingSchedulerId != null && ec.assignedTeamMemberId === actingSchedulerId;
  if (!(isAdmin || isOwner || isManagerInScope)) {
    res.status(403).json({ error: "Not authorized for this case", code: "forbidden" });
    return null;
  }
  return {
    executionCaseId,
    assignedTeamMemberId: ec.assignedTeamMemberId,
    actingSchedulerId,
    isAdmin,
    isManagerInScope,
  };
}

const actorOf = (req: Request): string | null => (req.session as { userId?: string }).userId ?? null;

export function registerWorkClaimRoutes(app: Express) {
  // ── Inspect the current claim ────────────────────────────────────────────
  app.get(
    "/api/engagement/work-claims/:executionCaseId",
    async (req: Request, res: Response) => {
      const id = parseCaseId(req, res);
      if (id == null) return;
      const authz = await authorize(req, res, id);
      if (!authz) return;
      try {
        const claim = await getClaim(id);
        return res.json({ claim, leaseSeconds: WORKCLAIM_LEASE_SECONDS, renewSeconds: WORKCLAIM_RENEW_SECONDS });
      } catch (error: unknown) {
        console.error("[work-claims:get]", error instanceof Error ? error.message : error);
        return res.status(500).json({ error: "Failed to load claim" });
      }
    },
  );

  // ── Acquire (claim on workspace open) ────────────────────────────────────
  app.post(
    "/api/engagement/work-claims/:executionCaseId/acquire",
    async (req: Request, res: Response) => {
      const id = parseCaseId(req, res);
      if (id == null) return;
      const authz = await authorize(req, res, id);
      if (!authz) return;
      if (authz.actingSchedulerId == null) {
        // A claim is HELD BY a roster scheduler; a caller with no roster
        // identity (e.g. a pure admin login) cannot actively hold work.
        return res.status(409).json({
          error: "Caller has no roster identity to hold an active claim",
          code: "no_roster_identity",
        });
      }
      try {
        const outcome = await acquireClaim({
          executionCaseId: id,
          schedulerId: authz.actingSchedulerId,
          actorUserId: actorOf(req),
        });
        if (outcome.ok) {
          void logAudit(req, "acquire", "work_claim", id, {
            schedulerId: authz.actingSchedulerId,
            state: outcome.state,
          });
          return res.json({
            ok: true,
            state: outcome.state,
            claim: outcome.claim,
            leaseSeconds: outcome.leaseSeconds,
            renewSeconds: WORKCLAIM_RENEW_SECONDS,
          });
        }
        if (outcome.code === "not_found") {
          return res.status(404).json({ ok: false, error: "Execution case not found", code: "not_found" });
        }
        // conflict / conflict_sibling → 409 with who holds the patient.
        return res.status(409).json({
          ok: false,
          code: outcome.code,
          error:
            outcome.code === "conflict_sibling"
              ? "This patient is already being worked for another service."
              : "This patient is already being worked by another team member.",
          claim: outcome.claim,
        });
      } catch (error: unknown) {
        console.error("[work-claims:acquire]", error instanceof Error ? error.message : error);
        return res.status(500).json({ error: "Failed to acquire claim" });
      }
    },
  );

  // ── Renew (heartbeat while the workspace stays open) ─────────────────────
  app.post(
    "/api/engagement/work-claims/:executionCaseId/renew",
    async (req: Request, res: Response) => {
      const id = parseCaseId(req, res);
      if (id == null) return;
      const authz = await authorize(req, res, id);
      if (!authz) return;
      if (authz.actingSchedulerId == null) {
        return res.status(409).json({ error: "Caller has no roster identity", code: "no_roster_identity" });
      }
      try {
        const outcome = await renewClaim({ executionCaseId: id, schedulerId: authz.actingSchedulerId });
        if (outcome.ok) {
          return res.json({ ok: true, claim: outcome.claim, leaseSeconds: outcome.leaseSeconds });
        }
        if (outcome.code === "not_found") {
          return res.status(404).json({ ok: false, code: "not_found" });
        }
        // not_holder / expired → the caller must re-acquire (409 Conflict).
        return res.status(409).json({ ok: false, code: outcome.code });
      } catch (error: unknown) {
        console.error("[work-claims:renew]", error instanceof Error ? error.message : error);
        return res.status(500).json({ error: "Failed to renew claim" });
      }
    },
  );

  // ── Release (workspace close / done) ─────────────────────────────────────
  app.post(
    "/api/engagement/work-claims/:executionCaseId/release",
    async (req: Request, res: Response) => {
      const id = parseCaseId(req, res);
      if (id == null) return;
      const authz = await authorize(req, res, id);
      if (!authz) return;
      if (authz.actingSchedulerId == null) {
        return res.status(409).json({ error: "Caller has no roster identity", code: "no_roster_identity" });
      }
      try {
        const outcome = await releaseClaim({
          executionCaseId: id,
          schedulerId: authz.actingSchedulerId,
          actorUserId: actorOf(req),
        });
        if (outcome.ok) return res.json({ ok: true, released: outcome.released });
        if (outcome.code === "not_found") return res.status(404).json({ ok: false, code: "not_found" });
        return res.status(409).json({ ok: false, code: outcome.code });
      } catch (error: unknown) {
        console.error("[work-claims:release]", error instanceof Error ? error.message : error);
        return res.status(500).json({ error: "Failed to release claim" });
      }
    },
  );

  // ── Force-release (admin / manager emergency override) ───────────────────
  app.post(
    "/api/engagement/work-claims/:executionCaseId/force-release",
    async (req: Request, res: Response) => {
      const id = parseCaseId(req, res);
      if (id == null) return;
      const authz = await authorize(req, res, id);
      if (!authz) return;
      // Force-release OVERRIDES another member's claim → admin or manager only.
      if (!(authz.isAdmin || authz.isManagerInScope)) {
        return res.status(403).json({ error: "Force-release requires admin or a team manager", code: "forbidden" });
      }
      const parsed = z.object({ reason: z.string().min(1).max(500) }).safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "reason required", code: "bad_request" });
      }
      try {
        const outcome = await forceReleaseClaim({ executionCaseId: id, actorUserId: actorOf(req), reason: parsed.data.reason });
        if (!outcome.ok) return res.status(404).json({ ok: false, code: "not_found" });
        void logAudit(req, "force_release", "work_claim", id, {
          previousHolder: outcome.previousHolder,
          reason: parsed.data.reason,
        });
        return res.json({ ok: true, previousHolder: outcome.previousHolder });
      } catch (error: unknown) {
        console.error("[work-claims:force-release]", error instanceof Error ? error.message : error);
        return res.status(500).json({ error: "Failed to force-release claim" });
      }
    },
  );
}

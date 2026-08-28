// Engagement Distribution Engine routes (Phase 2) — admin only.
//
//   GET  /api/engagement/distribution/preview  → read-only proposed plan
//   POST /api/engagement/distribution/apply     → atomic commit of a freshly
//                                                  re-run plan
//
// Both endpoints are gated behind requireRole("admin"). Apply never trusts a
// client-submitted plan: it re-runs the allocator inside a transaction and
// re-validates capacity + conflicts at commit time (see distributionService).

import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  previewDistribution,
  applyDistribution,
  getLiveProgress,
  getMemberCases,
  ACTIVITY_EVENT_TYPES,
} from "../services/engagement/distributionService";
import { subscribeLiveActivity } from "../services/engagement/liveActivityBus";
import { requireManagerOrAdmin, schedulerIdsInScope, type ManagerScope } from "../services/teams/managerScope";

type RequireRole = (
  ...roles: string[]
) => (req: Request, res: Response, next: () => void) => void;

const applySchema = z.object({
  assignedRole: z
    .enum(["scheduler", "patientCareSpecialist", "ancillaryCareSpecialist"])
    .optional(),
});

export function registerEngagementDistributionRoutes(
  app: Express,
  requireRole: RequireRole,
) {
  app.get(
    "/api/engagement/distribution/preview",
    requireRole("admin"),
    async (_req: Request, res: Response) => {
      try {
        const { plan, members, cases } = await previewDistribution();
        return res.json({
          plan,
          roster: members,
          poolSize: cases.length,
        });
      } catch (error: unknown) {
        console.error(
          "[engagement/distribution:preview] error:",
          error instanceof Error ? error.message : error,
        );
        return res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to build distribution preview",
        });
      }
    },
  );

  app.get(
    "/api/engagement/distribution/live",
    requireRole("admin"),
    async (_req: Request, res: Response) => {
      try {
        const result = await getLiveProgress();
        return res.json(result);
      } catch (error: unknown) {
        console.error(
          "[engagement/distribution:live] error:",
          error instanceof Error ? error.message : error,
        );
        return res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to load live progress",
        });
      }
    },
  );

  app.get(
    "/api/engagement/distribution/member/:id/cases",
    requireRole("admin"),
    async (req: Request, res: Response) => {
      const schedulerId = Number(req.params.id);
      if (!Number.isInteger(schedulerId) || schedulerId <= 0) {
        return res.status(400).json({
          error: "Invalid team member id",
          code: "bad_request",
        });
      }
      try {
        const result = await getMemberCases(schedulerId);
        return res.json(result);
      } catch (error: unknown) {
        console.error(
          "[engagement/distribution:member-cases] error:",
          error instanceof Error ? error.message : error,
        );
        return res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to load member cases",
        });
      }
    },
  );

  // Server-Sent Events stream that pushes a lightweight "refresh" signal the
  // moment a feed-worthy journey event is written, so the client refetches
  // /live within ~1s instead of waiting on its polling tick. The client falls
  // back to polling automatically if this stream drops.
  app.get(
    "/api/engagement/distribution/stream",
    requireRole("admin"),
    (req: Request, res: Response) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      // Initial comment so the client's onopen fires promptly.
      res.write(": connected\n\n");

      const feedWorthy = new Set<string>(
        ACTIVITY_EVENT_TYPES as unknown as string[],
      );

      const unsubscribe = subscribeLiveActivity((signal) => {
        if (!feedWorthy.has(signal.eventType)) return;
        res.write(
          `event: activity\ndata: ${JSON.stringify({
            eventType: signal.eventType,
          })}\n\n`,
        );
      });

      // Heartbeat keeps proxies from idling the connection closed.
      const heartbeat = setInterval(() => {
        res.write(": ping\n\n");
      }, 25_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      req.on("close", cleanup);
      res.on("close", cleanup);
    },
  );

  // ─── OWNERSHIP TIMELINE (K17) — manager-visible per-case history ─────────
  app.get(
    "/api/engagement/cases/:executionCaseId/ownership-timeline",
    requireManagerOrAdmin,
    async (req: Request, res: Response) => {
      const executionCaseId = Number(req.params.executionCaseId);
      if (!Number.isInteger(executionCaseId) || executionCaseId <= 0) {
        return res.status(400).json({ error: "Invalid executionCaseId" });
      }
      try {
        const { getOwnershipTimeline } = await import(
          "../services/engagement/ownershipTimelineService"
        );
        const timeline = await getOwnershipTimeline(executionCaseId);
        // Manager scope: a non-admin may only view a timeline for a case
        // currently or historically owned by a member in their scope.
        const scope = (req as { managerScope?: ManagerScope }).managerScope;
        if (scope && !scope.isAdmin) {
          const inScope = await schedulerIdsInScope(scope);
          const scopeSet = new Set(inScope ?? []);
          const touchesScope =
            (timeline.currentOwnerSchedulerId != null && scopeSet.has(timeline.currentOwnerSchedulerId)) ||
            timeline.entries.some((e) =>
              (e.toSchedulerId != null && scopeSet.has(e.toSchedulerId)) ||
              (e.fromSchedulerId != null && scopeSet.has(e.fromSchedulerId)),
            );
          if (!touchesScope) {
            return res.status(403).json({ error: "Case is outside your team scope" });
          }
        }
        return res.json(timeline);
      } catch (error: unknown) {
        console.error(
          "[engagement/ownership-timeline] error:",
          error instanceof Error ? error.message : error,
        );
        return res.status(500).json({ error: "Failed to load ownership timeline" });
      }
    },
  );

  // ─── NEEDS COVERAGE (K8) — manager view of uncovered cases + hold/clear ──

  // List open (unresolved) needs-coverage rows + a per-category summary.
  app.get(
    "/api/engagement/needs-coverage",
    requireManagerOrAdmin,
    async (req: Request, res: Response) => {
      try {
        const { needsCoverageRepository } = await import(
          "../repositories/needsCoverage.repo"
        );
        const category = req.query.category ? String(req.query.category) : undefined;
        const facilityId = req.query.facilityId ? String(req.query.facilityId) : undefined;
        let [items, byCategory] = await Promise.all([
          needsCoverageRepository.listOpen({ category, facilityId }),
          needsCoverageRepository.countOpenByCategory(),
        ]);
        // Manager scope: narrow to the facilities the manager's team(s) cover
        // (admin sees all). When a manager's scope has no facility narrowing,
        // they still see all rows (facility-agnostic teams).
        const scope = (req as { managerScope?: ManagerScope }).managerScope;
        if (scope && !scope.isAdmin && scope.facilityIds.size > 0) {
          items = items.filter((i) => i.facilityId && scope.facilityIds.has(i.facilityId));
        }
        return res.json({ items, byCategory, total: items.length });
      } catch (error: unknown) {
        console.error(
          "[engagement/needs-coverage:list] error:",
          error instanceof Error ? error.message : error,
        );
        return res.status(500).json({ error: "Failed to load needs coverage" });
      }
    },
  );

  // Manager places a case on hold (structured manager_hold) — it stays
  // canonically unassigned but the reason is explicit.
  app.post(
    "/api/engagement/needs-coverage/hold",
    requireRole("admin"),
    async (req: Request, res: Response) => {
      const schema = z.object({
        executionCaseId: z.number().int().positive(),
        reason: z.string().min(1).max(500),
      });
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      try {
        const { needsCoverageRepository } = await import(
          "../repositories/needsCoverage.repo"
        );
        const row = await needsCoverageRepository.upsert({
          executionCaseId: parsed.data.executionCaseId,
          category: "manager_hold",
          reason: parsed.data.reason,
          source: "manager",
        });
        return res.json(row);
      } catch (error: unknown) {
        console.error(
          "[engagement/needs-coverage:hold] error:",
          error instanceof Error ? error.message : error,
        );
        return res.status(500).json({ error: "Failed to place hold" });
      }
    },
  );

  app.post(
    "/api/engagement/distribution/apply",
    requireRole("admin"),
    async (req: Request, res: Response) => {
      const parsed = applySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.errors[0]?.message ?? "Invalid input",
          code: "bad_request",
        });
      }
      try {
        const actorUserId = (req.session as { userId?: string }).userId ?? null;
        const result = await applyDistribution(
          actorUserId,
          parsed.data.assignedRole ?? "scheduler",
        );
        return res.json(result);
      } catch (error: unknown) {
        console.error(
          "[engagement/distribution:apply] error:",
          error instanceof Error ? error.message : error,
        );
        return res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to apply distribution",
        });
      }
    },
  );
}

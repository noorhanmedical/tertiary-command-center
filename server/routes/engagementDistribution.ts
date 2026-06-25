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
} from "../services/engagement/distributionService";

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

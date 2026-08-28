// Team Operations admin routes (Phase 4A). Admin-gated CRUD for teams,
// memberships, and manager relationships — the authoritative management
// surface. Engagement/messaging/tasks consume these; they are not configured
// elsewhere. Every mutation records a relationship-change audit event (K25).

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { TEAM_TYPES, TEAM_MEMBERSHIP_ROLES } from "@shared/schema";
import { teamsRepository } from "../repositories/teams.repo";

type RequireRole = (...roles: string[]) => (req: Request, res: Response, next: () => void) => void;

function actor(req: Request): string | null {
  return (req as Request & { session?: { userId?: string } }).session?.userId ?? null;
}

const createTeamSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/).optional(),
  type: z.enum(TEAM_TYPES),
  facilityId: z.string().optional().nullable(),
});
const updateTeamSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  type: z.enum(TEAM_TYPES).optional(),
  facilityId: z.string().optional().nullable(),
  active: z.boolean().optional(),
});
const membershipSchema = z.object({
  userId: z.string().min(1),
  membershipRole: z.enum(TEAM_MEMBERSHIP_ROLES).optional(),
  primaryTeam: z.boolean().optional(),
});
const managerSchema = z.object({
  managerUserId: z.string().min(1),
  facilityId: z.string().optional().nullable(),
});

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "team";
}

export function registerTeamRoutes(app: Express, requireRole: RequireRole) {
  const admin = requireRole("admin");

  // ─── Teams ───────────────────────────────────────────────
  app.get("/api/teams", admin, async (req: Request, res: Response) => {
    const activeOnly = String(req.query.activeOnly ?? "") === "true";
    res.json(await teamsRepository.listTeams({ activeOnly }));
  });

  app.post("/api/teams", admin, async (req: Request, res: Response) => {
    const parsed = createTeamSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    const slug = parsed.data.slug ?? slugify(parsed.data.name);
    if (await teamsRepository.getTeamBySlug(slug)) {
      return res.status(409).json({ error: `A team with slug "${slug}" already exists.` });
    }
    const team = await teamsRepository.createTeam({
      name: parsed.data.name, slug, type: parsed.data.type, facilityId: parsed.data.facilityId ?? null,
    });
    await teamsRepository.recordEvent({
      eventType: "team_created", actorUserId: actor(req), teamId: team.id,
      facilityId: team.facilityId, summary: `Team "${team.name}" (${team.type}) created`,
      metadata: { slug: team.slug, type: team.type },
    });
    res.json(team);
  });

  app.patch("/api/teams/:id", admin, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
    const parsed = updateTeamSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    const existing = await teamsRepository.getTeam(id);
    if (!existing) return res.status(404).json({ error: "Team not found" });
    const team = await teamsRepository.updateTeam(id, parsed.data);
    const eventType = parsed.data.active === false ? "team_deactivated"
      : parsed.data.active === true && !existing.active ? "team_activated" : "team_updated";
    await teamsRepository.recordEvent({
      eventType, actorUserId: actor(req), teamId: id, facilityId: team?.facilityId ?? null,
      summary: `Team "${team?.name}" ${eventType.replace("team_", "")}`, metadata: { ...parsed.data },
    });
    res.json(team);
  });

  // ─── Memberships ─────────────────────────────────────────
  app.get("/api/teams/:id/members", admin, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
    res.json(await teamsRepository.listMembershipsForTeam(id, String(req.query.activeOnly ?? "true") !== "false"));
  });

  app.post("/api/teams/:id/members", admin, async (req: Request, res: Response) => {
    const teamId = Number(req.params.id);
    if (!Number.isInteger(teamId)) return res.status(400).json({ error: "Invalid id" });
    const parsed = membershipSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    if (!(await teamsRepository.getTeam(teamId))) return res.status(404).json({ error: "Team not found" });
    const membership = await teamsRepository.addMembership({
      teamId, userId: parsed.data.userId,
      membershipRole: parsed.data.membershipRole ?? "member", primaryTeam: parsed.data.primaryTeam ?? false,
    });
    await teamsRepository.recordEvent({
      eventType: "membership_added", actorUserId: actor(req), subjectUserId: parsed.data.userId,
      teamId, summary: `User added to team ${teamId} as ${membership.membershipRole}`,
      metadata: { membershipRole: membership.membershipRole, primaryTeam: membership.primaryTeam },
    });
    res.json(membership);
  });

  app.delete("/api/teams/:id/members/:userId", admin, async (req: Request, res: Response) => {
    const teamId = Number(req.params.id);
    if (!Number.isInteger(teamId)) return res.status(400).json({ error: "Invalid id" });
    const userId = String(req.params.userId);
    const ended = await teamsRepository.endMembership(teamId, userId);
    if (ended > 0) {
      await teamsRepository.recordEvent({
        eventType: "membership_removed", actorUserId: actor(req), subjectUserId: userId,
        teamId, summary: `User removed from team ${teamId}`, metadata: {},
      });
    }
    res.json({ ok: true, ended });
  });

  // ─── Managers ────────────────────────────────────────────
  app.get("/api/teams/:id/managers", admin, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
    res.json(await teamsRepository.listManagersForTeam(id));
  });

  app.post("/api/teams/:id/managers", admin, async (req: Request, res: Response) => {
    const teamId = Number(req.params.id);
    if (!Number.isInteger(teamId)) return res.status(400).json({ error: "Invalid id" });
    const parsed = managerSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    if (!(await teamsRepository.getTeam(teamId))) return res.status(404).json({ error: "Team not found" });
    const rel = await teamsRepository.addTeamManager(parsed.data.managerUserId, teamId, parsed.data.facilityId ?? null);
    await teamsRepository.recordEvent({
      eventType: "manager_added", actorUserId: actor(req), subjectUserId: parsed.data.managerUserId,
      teamId, summary: `Manager assigned to team ${teamId}`, metadata: { facilityId: parsed.data.facilityId ?? null },
    });
    res.json(rel);
  });

  app.delete("/api/teams/:id/managers/:managerUserId", admin, async (req: Request, res: Response) => {
    const teamId = Number(req.params.id);
    if (!Number.isInteger(teamId)) return res.status(400).json({ error: "Invalid id" });
    const managerUserId = String(req.params.managerUserId);
    const removed = await teamsRepository.removeTeamManager(managerUserId, teamId);
    if (removed > 0) {
      await teamsRepository.recordEvent({
        eventType: "manager_removed", actorUserId: actor(req), subjectUserId: managerUserId,
        teamId, summary: `Manager removed from team ${teamId}`, metadata: {},
      });
    }
    res.json({ ok: true, removed });
  });

  // Manager scope inspection (admin, or the manager themselves).
  app.get("/api/teams/manager-scope/:userId", admin, async (req: Request, res: Response) => {
    const { resolveManagerScope } = await import("../services/teams/managerScope");
    const scope = await resolveManagerScope(String(req.params.userId), null);
    res.json({ teamIds: scope.teamIds, userIds: [...scope.userIds], facilityIds: [...scope.facilityIds] });
  });
}

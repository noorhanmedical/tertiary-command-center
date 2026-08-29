import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { patientScreenings } from "@shared/schema";
import {
  getExecutionCaseById,
  getExecutionCaseByScreeningId,
} from "../repositories/executionCase.repo";
import { appendJourneyEvent } from "../services/journey/appendJourneyEvent";
import {
  legacyPriorityToLevel,
  levelToLegacyPriority,
  effectiveTaskPriorityLevel,
  type PlexusTaskPriorityLevel,
} from "@shared/schema/plexus";
import type { ManagerTaskFilters } from "../repositories/plexus.repo";
import { featureFlags } from "../lib/featureFlags";

// Terminal task statuses that stamp completion provenance.
const TERMINAL_TASK_STATUSES = new Set(["done", "closed"]);

/** Keep the legacy `priority` and canonical `priorityLevel` coherent on a
 *  create/update payload. Whichever the caller supplied drives the other so a
 *  row never carries a contradictory pair. Returns the fields to merge in. */
function coherentPriorityFields(input: {
  priority?: string | null;
  priorityLevel?: string | null;
}): { priority?: string; priorityLevel?: string } {
  const out: { priority?: string; priorityLevel?: string } = {};
  if (input.priorityLevel != null) {
    out.priorityLevel = input.priorityLevel;
    out.priority = levelToLegacyPriority(input.priorityLevel as PlexusTaskPriorityLevel);
  } else if (input.priority != null) {
    out.priority = input.priority;
    out.priorityLevel = legacyPriorityToLevel(input.priority);
  }
  return out;
}
import {
  runCallResultScheduling,
  plexusActionForAppointmentStatus,
} from "../services/canonicalAppointments/callResultSchedulingBridge";

// ── Typed event payloads ───────────────────────────────────────────────────
type EventPayload =
  | { title: string; projectType?: string }
  | { title: string }
  | { from: string; to: string }
  | { messageId: number }
  | { collaboratorUserId: string; role: string }
  | { readAt: string }
  | Record<string, string | number | boolean | null | undefined>;

// ── Event type enum (mirrors DB check constraint on plexus_task_events.event_type) ──
type PlexusEventType =
  | "created" | "updated" | "deleted"
  | "status_changed" | "assignment_changed"
  | "project_created" | "project_updated" | "project_deleted"
  | "collaborator_added" | "collaborator_role_changed"
  | "message_sent" | "read" | "call_logged";

// ── Enum constants (mirror DB check constraints) ───────────────────────────
const TASK_TYPE = ["task", "subtask", "milestone", "approval", "urgent_call", "scheduler_assignment", "tech_assignment"] as const;
const TASK_STATUS = ["open", "in_progress", "done", "closed"] as const;
const TASK_URGENCY = ["none", "EOD", "within 3 hours", "within 1 hour"] as const;
const TASK_PRIORITY = ["low", "normal", "high"] as const;
const PROJECT_TYPE = ["operational", "clinical", "admin", "training"] as const;
const PROJECT_STATUS = ["active", "archived", "closed"] as const;

// ── Validation schemas ─────────────────────────────────────────────────────
const createProjectSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  projectType: z.enum(PROJECT_TYPE).default("operational"),
  facility: z.string().optional(),
  status: z.enum(PROJECT_STATUS).default("active"),
});

// Canonical P1..P5 operational priority (decision K5). Accepted on create/
// update alongside the legacy low/normal/high `priority`. When one is given
// the other is kept coherent via the shared mapping helpers.
const TASK_PRIORITY_LEVEL = ["P1", "P2", "P3", "P4", "P5"] as const;

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  projectId: z.number().optional().nullable(),
  parentTaskId: z.number().optional().nullable(),
  taskType: z.enum(TASK_TYPE).default("task"),
  urgency: z.enum(TASK_URGENCY).default("none"),
  priority: z.enum(TASK_PRIORITY).default("normal"),
  priorityLevel: z.enum(TASK_PRIORITY_LEVEL).optional().nullable(),
  assignedToUserId: z.string().optional().nullable(),
  assignedTeamId: z.number().int().optional().nullable(),
  patientScreeningId: z.number().optional().nullable(),
  executionCaseId: z.number().int().optional().nullable(),
  ancillaryCaseId: z.number().int().optional().nullable(),
  facilityId: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  status: z.enum(TASK_STATUS).optional(),
  urgency: z.enum(TASK_URGENCY).optional(),
  priority: z.enum(TASK_PRIORITY).optional(),
  priorityLevel: z.enum(TASK_PRIORITY_LEVEL).optional().nullable(),
  assignedToUserId: z.string().optional().nullable(),
  assignedTeamId: z.number().int().optional().nullable(),
  projectId: z.number().optional().nullable(),
  executionCaseId: z.number().int().optional().nullable(),
  ancillaryCaseId: z.number().int().optional().nullable(),
  facilityId: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  taskType: z.enum(TASK_TYPE).optional(),
});

const createMessageSchema = z.object({
  body: z.string().min(1, "Message body is required"),
});

const addCollaboratorSchema = z.object({
  role: z.enum(["owner", "assignee", "collaborator", "watcher"]).default("collaborator"),
  userId: z.string().optional(),
});

const createPatientTaskSchema = z.object({
  title: z.string().min(1),
  taskType: z.enum(TASK_TYPE),
  priority: z.enum(TASK_PRIORITY).default("normal"),
  priorityLevel: z.enum(TASK_PRIORITY_LEVEL).optional().nullable(),
  urgency: z.enum(TASK_URGENCY).optional(),
  assignedUserId: z.string().optional().nullable(),
  assignedRole: z.string().optional().nullable(),
  facilityId: z.string().optional().nullable(),
  executionCaseId: z.number().int().optional().nullable(),
  ancillaryCaseId: z.number().int().optional().nullable(),
  patientScreeningId: z.number().int().optional().nullable(),
  patientName: z.string().optional().nullable(),
  patientDob: z.string().optional().nullable(),
  dueAt: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

// ── Helpers ────────────────────────────────────────────────────────────────
function uid(req: Request): string {
  return req.session.userId!;
}

function parseId(param: string | string[] | undefined): number | null {
  const s = Array.isArray(param) ? param[0] : param;
  const n = parseInt(String(s ?? ""), 10);
  return Number.isFinite(n) ? n : null;
}

async function enrichWithPatientNames<T extends { patientScreeningId?: number | null }>(
  tasks: T[]
): Promise<(T & { patientName?: string | null })[]> {
  const ids = Array.from(new Set(tasks.map((t) => t.patientScreeningId).filter((id): id is number => id != null)));
  if (ids.length === 0) return tasks.map((t) => ({ ...t, patientName: null }));
  const patients = await Promise.all(ids.map((id) => storage.getPatientById(id)));
  const nameMap = new Map(patients.filter(Boolean).map((p) => [p!.id, p!.name]));
  return tasks.map((t) => ({ ...t, patientName: t.patientScreeningId ? (nameMap.get(t.patientScreeningId) ?? null) : null }));
}

function canEditTask(task: { createdByUserId?: string | null; assignedToUserId?: string | null }, userId: string): boolean {
  return task.createdByUserId === userId || task.assignedToUserId === userId;
}

// Collaborators (added via the Help button) may also update task status
async function canEditTaskOrCollaborator(taskId: number, task: { createdByUserId?: string | null; assignedToUserId?: string | null }, userId: string): Promise<boolean> {
  if (canEditTask(task, userId)) return true;
  const collabs = await storage.getCollaborators(taskId);
  return collabs.some((c) => c.userId === userId);
}

function canEditProject(project: { createdByUserId?: string | null }, userId: string): boolean {
  return project.createdByUserId === userId;
}

async function canViewTask(taskId: number, userId: string): Promise<boolean> {
  const task = await storage.getTaskById(taskId);
  if (!task) return false;
  if (task.createdByUserId === userId || task.assignedToUserId === userId) return true;
  const collabs = await storage.getCollaborators(taskId);
  return collabs.some((c) => c.userId === userId);
}

async function canViewProject(projectId: number, userId: string): Promise<boolean> {
  const project = await storage.getProjectById(projectId);
  if (!project) return false;
  if (project.createdByUserId === userId) return true;
  const tasks = await storage.getTasksByProject(projectId);
  for (const t of tasks) {
    if (t.createdByUserId === userId || t.assignedToUserId === userId) return true;
    const collabs = await storage.getCollaborators(t.id);
    if (collabs.some((c) => c.userId === userId)) return true;
  }
  return false;
}

async function writeEvent(
  data: { taskId?: number | null; projectId?: number | null; userId: string; eventType: PlexusEventType; payload: EventPayload }
) {
  await storage.writeEvent({
    taskId: data.taskId ?? null,
    projectId: data.projectId ?? null,
    userId: data.userId,
    eventType: data.eventType,
    payload: data.payload,
  });
}

export function registerPlexusTasksRoutes(app: Express) {
  // ── Users list ────────────────────────────────────────────────────────────
  app.get("/api/plexus/users", async (_req, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users.map((u) => ({ id: u.id, username: u.username, role: u.role, active: u.active })));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Patient search ────────────────────────────────────────────────────────
  app.get("/api/plexus/patients/search", async (req: Request, res: Response) => {
    try {
      const q = String(req.query.q ?? "").trim();
      if (!q || q.length < 2) return res.json([]);
      const patients = await storage.searchPatientsByName(q);
      // qualifyingTests is additive on this response (existing consumers ignore
      // extra fields). The Team Portal quick-schedule popover uses it to offer
      // the patient's ACTUAL Plexus IQ–qualified services instead of a static
      // list, so a PCS never schedules a test the patient isn't qualified for.
      res.json(
        patients.map((p) => ({
          id: p.id,
          name: p.name,
          dob: p.dob,
          insurance: p.insurance,
          qualifyingTests: Array.isArray(p.qualifyingTests) ? p.qualifyingTests : [],
        })),
      );
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Projects ──────────────────────────────────────────────────────────────
  // Intentional policy: returns only projects the requesting user is a member of
  // (creator, assignee on any task, or explicit collaborator). Global project listing
  // is not implemented — all clinic staff work within their own project scope.
  app.get("/api/plexus/projects", async (req: Request, res: Response) => {
    try {
      const projects = await storage.getProjectsForUser(uid(req));
      res.json(projects);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/plexus/projects", async (req: Request, res: Response) => {
    try {
      const parsed = createProjectSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message });
      const userId = uid(req);
      const project = await storage.createProject({ ...parsed.data, createdByUserId: userId });
      await writeEvent({ projectId: project.id, userId, eventType: "project_created", payload: { title: project.title, projectType: project.projectType } });
      res.status(201).json(project);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/plexus/projects/:id", async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id); if (id === null) return res.status(400).json({ error: "Invalid id" });
      const userId = uid(req);
      if (!await canViewProject(id, userId)) return res.status(403).json({ error: "Not authorized to view this project" });
      const project = await storage.getProjectById(id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      res.json(project);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/plexus/projects/:id", async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id); if (id === null) return res.status(400).json({ error: "Invalid id" });
      const userId = uid(req);
      const parsed = createProjectSchema.partial().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message });
      const existing = await storage.getProjectById(id);
      if (!existing) return res.status(404).json({ error: "Project not found" });
      if (!canEditProject(existing, userId)) return res.status(403).json({ error: "Only the project owner can update this project" });
      const project = await storage.updateProject(id, parsed.data);
      await writeEvent({ projectId: id, userId, eventType: "project_updated", payload: parsed.data as EventPayload });
      res.json(project);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/plexus/projects/:id", async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id); if (id === null) return res.status(400).json({ error: "Invalid id" });
      const userId = uid(req);
      const existing = await storage.getProjectById(id);
      if (!existing) return res.status(404).json({ error: "Project not found" });
      if (!canEditProject(existing, userId)) return res.status(403).json({ error: "Only the project owner can delete this project" });
      await writeEvent({ projectId: id, userId, eventType: "project_deleted", payload: { title: existing.title } });
      await storage.deleteProject(id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/plexus/projects/:id/summary", async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id); if (id === null) return res.status(400).json({ error: "Invalid id" });
      const userId = uid(req);
      if (!await canViewProject(id, userId)) return res.status(403).json({ error: "Not authorized" });
      const tasks = await storage.getTasksByProject(id);
      const counts = tasks.reduce<Record<string, number>>((acc, t) => {
        acc[t.status] = (acc[t.status] ?? 0) + 1;
        return acc;
      }, {});
      res.json({ taskCount: tasks.length, counts });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Manager cross-team task visibility (Phase 2, decision K5/manager) ──────
  // ADMIN-GATED for now. Full manager/team relationship scoping lands in
  // Phase 4 (K4); until then only admins get the org-wide view so the existing
  // self-scoped authorization on every other task endpoint is NOT weakened.
  // Returns tasks across all users enriched with owner/creator display names,
  // canonical priorityLevel, completion provenance, and a derived overdue flag
  // so a manager can see who owns what, how long it's been open, and what's
  // overdue — without inferring from the current owner alone.
  app.get("/api/plexus/tasks/manager", async (req: Request, res: Response) => {
    try {
      const userId = uid(req);
      const actor = await storage.getUser(userId);
      // Phase 4E — admin sees org-wide; a manager sees only tasks owned by
      // members of the team(s) they manage; ordinary staff are forbidden.
      const { resolveManagerScope, scopeCoversUser, isManagerOrAdmin } =
        await import("../services/teams/managerScope");
      const scope = await resolveManagerScope(userId, actor?.role ?? null);
      if (!isManagerOrAdmin(scope)) {
        return res.status(403).json({ error: "Manager task view requires admin or a team-manager role" });
      }
      const q = req.query as Record<string, string | undefined>;
      const filters: ManagerTaskFilters = {};
      if (q.status) filters.status = q.status;
      if (q.assignedToUserId) filters.assignedToUserId = q.assignedToUserId;
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.priorityLevel) filters.priorityLevel = q.priorityLevel;
      if (q.overdueOnly === "true") filters.overdueOnly = true;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 200, 500) : 200;

      const allTasks = await storage.getTasksForManager(filters, limit);
      // Manager scope filter (admin: no filter). A task is in scope if its
      // assignee OR its creator is a scoped user (covers unassigned team tasks
      // a manager created too).
      const tasks = scope.isAdmin
        ? allTasks
        : allTasks.filter((t) =>
            (t.assignedToUserId && scopeCoversUser(scope, t.assignedToUserId)) ||
            (t.createdByUserId && scopeCoversUser(scope, t.createdByUserId)),
          );
      const withNames = await enrichWithPatientNames(tasks);

      // Resolve owner/creator/completer usernames in one batch.
      const userIds = Array.from(new Set(
        tasks.flatMap((t) => [t.assignedToUserId, t.createdByUserId, t.completedByUserId])
          .filter((id): id is string => !!id),
      ));
      const userMap = new Map<string, string>();
      await Promise.all(userIds.map(async (id) => {
        const u = await storage.getUser(id);
        if (u) userMap.set(id, u.username);
      }));

      const today = new Date().toISOString().slice(0, 10);
      const enriched = withNames.map((t) => {
        const isTerminal = t.status === "done" || t.status === "closed";
        const overdue = !isTerminal && !!t.dueDate && t.dueDate < today;
        return {
          ...t,
          priorityLevel: effectiveTaskPriorityLevel(t),
          assignedToUsername: t.assignedToUserId ? (userMap.get(t.assignedToUserId) ?? null) : null,
          createdByUsername: t.createdByUserId ? (userMap.get(t.createdByUserId) ?? null) : null,
          completedByUsername: t.completedByUserId ? (userMap.get(t.completedByUserId) ?? null) : null,
          overdue,
          ageDays: Math.max(0, Math.floor((Date.now() - new Date(t.createdAt as unknown as string).getTime()) / 86_400_000)),
        };
      });
      res.json({ tasks: enriched, count: enriched.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Tasks ─────────────────────────────────────────────────────────────────
  // Returns all tasks where the user is creator or assignee (union, deduplicated)
  app.get("/api/plexus/tasks", async (req: Request, res: Response) => {
    try {
      const userId = uid(req);
      const patientScreeningIdParam = req.query.patientScreeningId;
      if (patientScreeningIdParam != null) {
        const patientScreeningId = parseInt(String(patientScreeningIdParam), 10);
        if (!Number.isFinite(patientScreeningId)) return res.status(400).json({ error: "Invalid patientScreeningId" });
        const tasks = await storage.getTasksByPatientScreeningId(patientScreeningId);
        // Apply the same visibility policy as by-patient/:patientId:
        // only return tasks where the requester is creator, assignee, collaborator, or project member.
        const visible = (
          await Promise.all(
            tasks.map(async (t) => {
              if (t.createdByUserId === userId || t.assignedToUserId === userId) return t;
              const collabs = await storage.getCollaborators(t.id);
              if (collabs.some((c) => c.userId === userId)) return t;
              if (t.projectId != null && (await canViewProject(t.projectId, userId))) return t;
              return null;
            })
          )
        ).filter((t): t is typeof tasks[number] => t !== null);
        return res.json(await enrichWithPatientNames(visible));
      }
      const [assigned, created] = await Promise.all([
        storage.getTasksByAssignee(userId),
        storage.getTasksByCreator(userId),
      ]);
      const seen = new Set<number>();
      const all: typeof assigned = [];
      for (const t of [...assigned, ...created]) {
        if (!seen.has(t.id)) { seen.add(t.id); all.push(t); }
      }
      res.json(await enrichWithPatientNames(all));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/plexus/tasks/my-work", async (req: Request, res: Response) => {
    try {
      const tasks = await storage.getTasksByAssignee(uid(req));
      res.json(await enrichWithPatientNames(tasks));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/plexus/tasks/sent", async (req: Request, res: Response) => {
    try {
      const tasks = await storage.getTasksByCreatorWithActivity(uid(req));
      res.json(await enrichWithPatientNames(tasks));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Phase 4D — TEAM WORK POOL. Unclaimed tasks assigned to the caller's active
  // teams. An authorized team member can claim one (below). A team task is NOT
  // duplicated into N per-member tasks — it stays one task in the pool.
  app.get("/api/plexus/tasks/team-pool", async (req: Request, res: Response) => {
    try {
      const userId = uid(req);
      const { teamsRepository } = await import("../repositories/teams.repo");
      const memberships = await teamsRepository.listMembershipsForUser(userId, true);
      const teamIds = memberships.map((m) => m.teamId);
      const tasks = teamIds.length ? await storage.getTeamPoolTasks(teamIds) : [];
      res.json(await enrichWithPatientNames(tasks));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Claim a team-pool task: sets assignedToUserId to the caller (keeping
  // assignedTeamId as the origin team) so it leaves the pool and enters the
  // member's my-work. Only an active member of the task's team may claim.
  app.post("/api/plexus/tasks/:id/claim", async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id); if (id === null) return res.status(400).json({ error: "Invalid id" });
      const userId = uid(req);
      const task = await storage.getTaskById(id);
      if (!task) return res.status(404).json({ error: "Task not found" });
      if (task.assignedTeamId == null) return res.status(400).json({ error: "Task is not a team task" });
      if (task.assignedToUserId != null) {
        return res.status(409).json({ error: "Task already claimed", claimedBy: task.assignedToUserId });
      }
      const { teamsRepository } = await import("../repositories/teams.repo");
      const memberships = await teamsRepository.listMembershipsForUser(userId, true);
      const isMember = memberships.some((m) => m.teamId === task.assignedTeamId);
      const actor = await storage.getUser(userId);
      const isAdmin = (actor?.role ?? "") === "admin";
      if (!isMember && !isAdmin) {
        return res.status(403).json({ error: "Only an active member of the task's team can claim it" });
      }
      const updated = await storage.updateTask(id, { assignedToUserId: userId });
      await writeEvent({ taskId: id, userId, eventType: "assignment_changed", payload: { from: null, to: userId, claimedFromTeam: task.assignedTeamId } });
      // Durable notification for the claimer (best-effort; Phase 6A).
      try {
        const { notifyTaskAssigned } = await import("../services/notifications/notificationService");
        await notifyTaskAssigned({
          recipientUserId: userId,
          taskId: id,
          title: task.title,
          priorityLevel: effectiveTaskPriorityLevel(task),
          patientScreeningId: task.patientScreeningId ?? null,
          facilityId: task.facilityId ?? null,
        });
      } catch { /* best-effort */ }
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Policy: urgent tasks (high/critical urgency, non-closed) are visible to all authenticated
  // clinic staff so team members can volunteer via the Help button. This is intentional
  // operational coordination policy — all users are authenticated clinic personnel.
  app.get("/api/plexus/tasks/urgent", async (_req, res: Response) => {
    try {
      const tasks = await storage.getUrgentTasks();
      res.json(await enrichWithPatientNames(tasks));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/plexus/tasks/overdue", async (req: Request, res: Response) => {
    try {
      const userId = uid(req);
      const tasks = await storage.getOverdueTasksForUser(userId);
      const today = new Date().toISOString().slice(0, 10);
      const enriched = await enrichWithPatientNames(tasks);
      const overdue = enriched.filter((t) => (t.dueDate ?? "") < today);
      const dueToday = enriched.filter((t) => t.dueDate === today);
      res.json({ overdue, dueToday, overdueCount: overdue.length, dueTodayCount: dueToday.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/plexus/tasks/unread-count", async (req: Request, res: Response) => {
    try {
      const count = await storage.getUnreadCount(uid(req));
      res.json({ count });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/plexus/tasks/unread-per-task", async (req: Request, res: Response) => {
    try {
      const perTask = await storage.getUnreadPerTask(uid(req));
      res.json(perTask);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/plexus/tasks/by-patient/:patientId", async (req: Request, res: Response) => {
    try {
      const patientId = parseId(req.params.patientId);
      if (patientId === null) return res.status(400).json({ error: "Invalid patientId" });
      const userId = uid(req);
      const tasks = await storage.getTasksByPatient(patientId);
      // Filter to tasks the requester is permitted to view: creator, assignee,
      // collaborator, or a member of the task's project. Mirrors the policy
      // used by canViewTask / canViewProject elsewhere in this router.
      const visible = (
        await Promise.all(
          tasks.map(async (t) => {
            if (t.createdByUserId === userId || t.assignedToUserId === userId) return t;
            const collabs = await storage.getCollaborators(t.id);
            if (collabs.some((c) => c.userId === userId)) return t;
            if (t.projectId != null && (await canViewProject(t.projectId, userId))) return t;
            return null;
          })
        )
      ).filter((t): t is typeof tasks[number] => t !== null);
      // Minimal response shape — only the fields the patient card needs.
      res.json(
        visible.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          urgency: t.urgency,
          priority: t.priority,
          priorityLevel: effectiveTaskPriorityLevel(t),
        }))
      );
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/plexus/tasks/by-project/:projectId", async (req: Request, res: Response) => {
    try {
      const projectId = parseId(req.params.projectId); if (projectId === null) return res.status(400).json({ error: "Invalid projectId" });
      const userId = uid(req);
      if (!await canViewProject(projectId, userId)) return res.status(403).json({ error: "Not authorized to view this project" });
      const tasks = await storage.getTasksByProject(projectId);
      res.json(await enrichWithPatientNames(tasks));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/plexus/tasks/:id", async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id); if (id === null) return res.status(400).json({ error: "Invalid id" });
      const userId = uid(req);
      if (!await canViewTask(id, userId)) return res.status(403).json({ error: "Not authorized to view this task" });
      const task = await storage.getTaskById(id);
      if (!task) return res.status(404).json({ error: "Task not found" });
      res.json(task);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Patient-linked task creation (cross-role) ───────────────────────────
  // Resolves patient context from executionCaseId / patientScreeningId / name+dob,
  // creates a plexus_task with the resolved patientScreeningId, writes the
  // standard task events, and appends a `task_created` journey event when
  // patient context is available. Fields the plexus_tasks table cannot store
  // (assignedRole, facilityId, free metadata) are recorded on the journey
  // event metadata only.
  app.post("/api/plexus/tasks/patient-task", async (req: Request, res: Response) => {
    try {
      const parsed = createPatientTaskSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message });
      const userId = uid(req);
      const data = parsed.data;

      // Resolve patient context — prefer executionCaseId, fall back to screening
      let patientScreeningId: number | null = data.patientScreeningId ?? null;
      let executionCaseId: number | null = data.executionCaseId ?? null;
      let patientName: string | null = data.patientName ?? null;
      let patientDob: string | null = data.patientDob ?? null;

      if (executionCaseId !== null) {
        const ec = await getExecutionCaseById(executionCaseId);
        if (ec) {
          if (patientScreeningId === null && ec.patientScreeningId != null) patientScreeningId = ec.patientScreeningId;
          if (!patientName && ec.patientName) patientName = ec.patientName;
          if (!patientDob && ec.patientDob) patientDob = ec.patientDob;
        }
      }

      if (executionCaseId === null && patientScreeningId !== null) {
        const ec = await getExecutionCaseByScreeningId(patientScreeningId);
        if (ec) executionCaseId = ec.id;
      }

      if (patientScreeningId !== null && (!patientName || !patientDob)) {
        const [screening] = await db
          .select({ name: patientScreenings.name, dob: patientScreenings.dob })
          .from(patientScreenings)
          .where(eq(patientScreenings.id, patientScreeningId))
          .limit(1);
        if (screening) {
          if (!patientName) patientName = screening.name;
          if (!patientDob && screening.dob) patientDob = screening.dob;
        }
      }

      // Create the task. Phase 2 — persist the canonical case links
      // (executionCaseId / ancillaryCaseId / facilityId) ON THE TASK ITSELF
      // (previously only recorded on the journey-event metadata), and keep the
      // legacy priority ↔ canonical priorityLevel coherent.
      const task = await storage.createTask({
        title: data.title,
        description: data.note ?? undefined,
        taskType: data.taskType,
        urgency: data.urgency ?? "none",
        ...coherentPriorityFields({ priority: data.priority, priorityLevel: data.priorityLevel }),
        assignedToUserId: data.assignedUserId ?? null,
        patientScreeningId: patientScreeningId,
        executionCaseId: executionCaseId ?? null,
        ancillaryCaseId: data.ancillaryCaseId ?? null,
        facilityId: data.facilityId ?? null,
        dueDate: data.dueAt ?? null,
        createdByUserId: userId,
      });

      // Standard task events
      await writeEvent({ taskId: task.id, userId, eventType: "created", payload: { title: task.title } });
      if (task.assignedToUserId) {
        await writeEvent({
          taskId: task.id,
          userId,
          eventType: "assignment_changed",
          payload: { from: null as unknown as string, to: task.assignedToUserId },
        });
      }

      // Patient journey event (best-effort; needs patientName because it's NOT NULL)
      let journeyEvent = null;
      if (patientName) {
        try {
          journeyEvent = await appendJourneyEvent({
            patientName,
            patientDob: patientDob ?? undefined,
            patientScreeningId: patientScreeningId ?? undefined,
            executionCaseId: executionCaseId ?? undefined,
            eventType: "task_created",
            eventSource: "plexus_tasks",
            actorUserId: userId,
            summary: `Task created: ${task.title}`,
            metadata: {
              taskId: task.id,
              taskType: task.taskType,
              priority: task.priority,
              urgency: task.urgency,
              assignedUserId: task.assignedToUserId,
              assignedRole: data.assignedRole ?? null,
              facilityId: data.facilityId ?? null,
              dueAt: task.dueDate,
              ...(data.metadata ?? {}),
            },
          });
        } catch (jerr: any) {
          console.error("[plexus-tasks] journey event append failed (non-fatal):", jerr.message);
        }
      }

      return res.status(201).json({ ok: true, task, journeyEvent });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/plexus/tasks", async (req: Request, res: Response) => {
    try {
      const parsed = createTaskSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message });
      const userId = uid(req);
      if (parsed.data.projectId != null) {
        if (!await canViewProject(parsed.data.projectId, userId)) {
          return res.status(403).json({ error: "Not authorized to add tasks to this project" });
        }
      }
      // Keep the legacy priority (low/normal/high) and canonical
      // priorityLevel (P1..P5) coherent regardless of which the caller sent.
      const task = await storage.createTask({
        ...parsed.data,
        ...coherentPriorityFields(parsed.data),
        createdByUserId: userId,
      });
      await writeEvent({ taskId: task.id, userId, eventType: "created", payload: { title: task.title } });
      if (task.assignedToUserId) {
        await writeEvent({ taskId: task.id, userId, eventType: "assignment_changed", payload: { from: null, to: task.assignedToUserId } });
      }
      res.status(201).json(task);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/plexus/tasks/:id", async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id); if (id === null) return res.status(400).json({ error: "Invalid id" });
      const parsed = updateTaskSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message });
      const userId = uid(req);
      const prev = await storage.getTaskById(id);
      if (!prev) return res.status(404).json({ error: "Task not found" });
      const actor = await storage.getUser(userId);
      const role = actor?.role ?? "";
      const isAdmin = role === "admin";
      const onlyAssignmentChange =
        parsed.data.assignedToUserId !== undefined &&
        Object.keys(parsed.data).every((k) => k === "assignedToUserId");
      const canChangeAssignment = isAdmin || role === "clinician" || role === "scheduler";
      const allowed = isAdmin
        || (onlyAssignmentChange && canChangeAssignment && await canViewTask(id, userId))
        || await canEditTaskOrCollaborator(id, prev, userId);
      if (!allowed) return res.status(403).json({ error: "Only the task creator, assignee, or a collaborator can update this task" });
      if (parsed.data.projectId != null && parsed.data.projectId !== prev.projectId) {
        if (!await canViewProject(parsed.data.projectId, userId)) {
          return res.status(403).json({ error: "Not authorized to move task to this project" });
        }
      }
      // Build the normalized update: keep priority↔priorityLevel coherent and
      // stamp/clear completion provenance when status crosses the terminal
      // boundary (was only inferable from status+updatedAt before Phase 2).
      const updates: Record<string, unknown> = {
        ...parsed.data,
        ...coherentPriorityFields(parsed.data),
      };
      if (parsed.data.status && parsed.data.status !== prev.status) {
        const nowTerminal = TERMINAL_TASK_STATUSES.has(parsed.data.status);
        const wasTerminal = TERMINAL_TASK_STATUSES.has(prev.status);
        if (nowTerminal && !wasTerminal) {
          updates.completedAt = new Date();
          updates.completedByUserId = userId;
        } else if (!nowTerminal && wasTerminal) {
          // Reopened — clear completion provenance.
          updates.completedAt = null;
          updates.completedByUserId = null;
        }
      }
      const task = await storage.updateTask(id, updates);
      const eventWrites: Promise<void>[] = [];
      if (parsed.data.status && parsed.data.status !== prev.status) {
        eventWrites.push(writeEvent({ taskId: id, userId, eventType: "status_changed", payload: { from: prev.status, to: parsed.data.status } }));
      }
      if (parsed.data.assignedToUserId !== undefined && parsed.data.assignedToUserId !== prev.assignedToUserId) {
        eventWrites.push(writeEvent({ taskId: id, userId, eventType: "assignment_changed", payload: { from: prev.assignedToUserId, to: parsed.data.assignedToUserId } }));
        // Notify the new assignee (unless they assigned it to themselves).
        const newAssignee = parsed.data.assignedToUserId;
        if (newAssignee && newAssignee !== userId) {
          eventWrites.push(
            (async () => {
              try {
                const { notifyTaskAssigned } = await import("../services/notifications/notificationService");
                await notifyTaskAssigned({
                  recipientUserId: newAssignee,
                  taskId: id,
                  title: prev.title,
                  priorityLevel: effectiveTaskPriorityLevel(prev),
                  patientScreeningId: prev.patientScreeningId ?? null,
                  facilityId: prev.facilityId ?? null,
                });
              } catch { /* best-effort */ }
            })(),
          );
        }
      }
      const DEDICATED_EVENTS = new Set(["status", "assignedToUserId"]);
      const otherChangedFields = Object.fromEntries(
        Object.entries(parsed.data).filter(([k, v]) => v !== undefined && !DEDICATED_EVENTS.has(k))
      ) as EventPayload;
      if (Object.keys(otherChangedFields).length > 0) {
        eventWrites.push(writeEvent({ taskId: id, userId, eventType: "updated", payload: otherChangedFields }));
      }
      await Promise.all(eventWrites);
      res.json(task);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/plexus/tasks/:id", async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id); if (id === null) return res.status(400).json({ error: "Invalid id" });
      const userId = uid(req);
      const task = await storage.getTaskById(id);
      if (!task) return res.status(404).json({ error: "Task not found" });
      if (!canEditTask(task, userId)) return res.status(403).json({ error: "Only the task creator or assignee can delete this task" });
      await writeEvent({ taskId: id, userId, eventType: "deleted", payload: { title: task.title } });
      await storage.deleteTask(id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Collaborators ─────────────────────────────────────────────────────────
  app.get("/api/plexus/tasks/:id/collaborators", async (req: Request, res: Response) => {
    try {
      const taskId = parseId(req.params.id); if (taskId === null) return res.status(400).json({ error: "Invalid id" });
      const userId = uid(req);
      if (!await canViewTask(taskId, userId)) return res.status(403).json({ error: "Not authorized" });
      const collabs = await storage.getCollaborators(taskId);
      res.json(collabs);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/plexus/tasks/:id/collaborators", async (req: Request, res: Response) => {
    try {
      const taskId = parseId(req.params.id); if (taskId === null) return res.status(400).json({ error: "Invalid id" });
      const actingUserId = uid(req);
      const parsed = addCollaboratorSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message });
      const task = await storage.getTaskById(taskId);
      if (!task) return res.status(404).json({ error: "Task not found" });
      const targetUserId = parsed.data.userId ?? actingUserId;
      if (targetUserId !== actingUserId) {
        if (!canEditTask(task, actingUserId)) {
          return res.status(403).json({ error: "Only task owner/assignee can add collaborators for others" });
        }
      } else {
        const isUrgent = task.status !== "closed" && task.status !== "done" && task.urgency !== "none";
        if (!isUrgent && !await canViewTask(taskId, actingUserId)) {
          return res.status(403).json({ error: "Self-join is only allowed on urgent non-closed tasks" });
        }
      }
      const existingCollabs = await storage.getCollaborators(taskId);
      const wasExisting = existingCollabs.some((c) => c.userId === targetUserId);
      const collab = await storage.addCollaborator({ taskId, userId: targetUserId, role: parsed.data.role });
      const eventType = wasExisting ? "collaborator_role_changed" : "collaborator_added";
      await writeEvent({ taskId, userId: actingUserId, eventType, payload: { collaboratorUserId: targetUserId, role: parsed.data.role } });
      res.status(201).json(collab);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Messages ──────────────────────────────────────────────────────────────
  app.get("/api/plexus/tasks/:id/messages", async (req: Request, res: Response) => {
    try {
      const taskId = parseId(req.params.id); if (taskId === null) return res.status(400).json({ error: "Invalid id" });
      const userId = uid(req);
      if (!await canViewTask(taskId, userId)) return res.status(403).json({ error: "Not authorized" });
      const messages = await storage.getMessages(taskId);
      res.json(messages);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/plexus/tasks/:id/messages", async (req: Request, res: Response) => {
    try {
      const taskId = parseId(req.params.id); if (taskId === null) return res.status(400).json({ error: "Invalid id" });
      const userId = uid(req);
      if (!await canViewTask(taskId, userId)) return res.status(403).json({ error: "Not authorized" });
      const parsed = createMessageSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message });
      const message = await storage.addMessage({ taskId, senderUserId: userId, body: parsed.data.body });
      await writeEvent({ taskId, userId, eventType: "message_sent", payload: { messageId: message.id } });
      res.status(201).json(message);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Events ────────────────────────────────────────────────────────────────
  app.get("/api/plexus/tasks/:id/events", async (req: Request, res: Response) => {
    try {
      const taskId = parseId(req.params.id); if (taskId === null) return res.status(400).json({ error: "Invalid id" });
      const userId = uid(req);
      if (!await canViewTask(taskId, userId)) return res.status(403).json({ error: "Not authorized" });
      const events = await storage.getEvents(taskId);
      res.json(events);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Read tracking ─────────────────────────────────────────────────────────
  app.post("/api/plexus/tasks/:id/read", async (req: Request, res: Response) => {
    try {
      const taskId = parseId(req.params.id); if (taskId === null) return res.status(400).json({ error: "Invalid id" });
      const userId = uid(req);
      if (!await canViewTask(taskId, userId)) return res.status(403).json({ error: "Not authorized" });
      await storage.markRead(taskId, userId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Call outcome logging ──────────────────────────────────────────────────
  const callOutcomeSchema = z.object({
    outcome: z.enum(["no_answer", "callback", "scheduled", "declined"]),
    notes: z.string().optional(),
    appointmentStatus: z.string().optional(),
    // Phase 2D-B3 — optional REAL canonical scheduling inputs. Only
    // consulted when FEATURE_CANONICAL_APPOINTMENT is ON. Never fabricated.
    schedulingAction: z.enum(["cancel", "no_show", "complete", "reschedule"]).optional(),
    globalScheduleEventId: z.number().int().optional(),
    reason: z.string().optional(),
    newStartsAt: z.string().optional(),
  });

  app.post("/api/plexus/tasks/:id/call-outcome", async (req: Request, res: Response) => {
    try {
      const taskId = parseId(req.params.id); if (taskId === null) return res.status(400).json({ error: "Invalid id" });
      const userId = uid(req);
      // Only schedulers and admins may log call outcomes
      const sessionRole = req.session.role;
      if (sessionRole !== "scheduler" && sessionRole !== "admin") {
        return res.status(403).json({ error: "Only schedulers and admins can log call outcomes" });
      }
      const task = await storage.getTaskById(taskId);
      if (!task) return res.status(404).json({ error: "Task not found" });
      if (!await canEditTaskOrCollaborator(taskId, task, userId)) return res.status(403).json({ error: "Not authorized" });
      const parsed = callOutcomeSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message });
      const { outcome, notes, appointmentStatus } = parsed.data;
      const newStatus = outcome === "scheduled" ? "done" : "in_progress";
      const updatedTask = await storage.updateTask(taskId, { status: newStatus });
      const eventWrites: Promise<void>[] = [
        writeEvent({ taskId, userId, eventType: "call_logged", payload: { outcome, notes: notes ?? null } }),
      ];
      if (newStatus !== task.status) {
        eventWrites.push(writeEvent({ taskId, userId, eventType: "status_changed", payload: { from: task.status, to: newStatus } }));
      }
      await Promise.all(eventWrites);

      // ── Phase 2D-B3: canonical scheduling bridge ───────────────
      // When the flag is ON and the outcome carries a scheduling-state
      // intent (explicit schedulingAction, or an appointmentStatus that
      // maps to a canonical transition), route it through the canonical
      // orchestration. We DO NOT directly assign appointment truth
      // (patient_screenings.appointmentStatus) before canonical success.
      if (featureFlags.canonicalAppointment && (parsed.data.schedulingAction != null || appointmentStatus != null)) {
        const schedulingAction = parsed.data.schedulingAction ?? plexusActionForAppointmentStatus(appointmentStatus);
        const reqClinicId = (req as { clinicId?: number | null }).clinicId ?? null;
        const bridged = await runCallResultScheduling({
          clinicId: reqClinicId,
          executionCaseId: null,
          patientScreeningId: task.patientScreeningId ?? null,
          callOutcome: outcome,
          schedulingAction,
          appointmentInput: {
            eventId: parsed.data.globalScheduleEventId,
            reason: parsed.data.reason,
            newStartsAt: parsed.data.newStartsAt ? new Date(parsed.data.newStartsAt) : undefined,
          },
          actorUserId: userId,
          source: "plexus_task_call_outcome",
        });
        if (bridged.handled) {
          return res.status(bridged.http).json({ task: updatedTask, ...bridged.body });
        }
        // schedulingAction 'none' (e.g. appointmentStatus 'scheduled'):
        // audit recorded; the direct appointmentStatus write is
        // intentionally skipped — canonical projection owns that truth.
        return res.json({ task: updatedTask, scheduling: { status: "none" } });
      }

      if (task.patientScreeningId && appointmentStatus) {
        await storage.updatePatientScreening(task.patientScreeningId, { appointmentStatus });
      }
      res.json(updatedTask);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}

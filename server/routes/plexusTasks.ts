import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";

// ── Typed event payloads ───────────────────────────────────────────────────
type EventPayload =
  | { title: string; projectType?: string }
  | { title: string }
  | { from: string; to: string }
  | { messageId: number }
  | { collaboratorUserId: string; role: string }
  | { readAt: string }
  | Record<string, string | number | boolean | null | undefined>;

// ── Validation schemas ─────────────────────────────────────────────────────
const createProjectSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  projectType: z.enum(["clinical", "operational", "admin"]).default("operational"),
  facility: z.string().optional(),
  status: z.string().default("active"),
});

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  projectId: z.number().optional().nullable(),
  parentTaskId: z.number().optional().nullable(),
  taskType: z.string().default("task"),
  urgency: z.enum(["none", "EOD", "within 3 hours", "within 1 hour"]).default("none"),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  assignedToUserId: z.string().optional().nullable(),
  patientScreeningId: z.number().optional().nullable(),
  dueDate: z.string().optional().nullable(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  status: z.string().optional(),
  urgency: z.enum(["none", "EOD", "within 3 hours", "within 1 hour"]).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  assignedToUserId: z.string().optional().nullable(),
  projectId: z.number().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  taskType: z.string().optional(),
});

const createMessageSchema = z.object({
  body: z.string().min(1, "Message body is required"),
});

const addCollaboratorSchema = z.object({
  role: z.enum(["collaborator", "reviewer", "owner"]).default("collaborator"),
  userId: z.string().optional(),
});

// ── Helpers ────────────────────────────────────────────────────────────────
function uid(req: Request): string {
  return req.session.userId!;
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
  data: { taskId?: number | null; projectId?: number | null; userId: string; eventType: string; payload: EventPayload }
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
      res.json(users.map((u) => ({ id: u.id, username: u.username })));
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
      res.json(patients.map((p) => ({ id: p.id, name: p.name, dob: p.dob, insurance: p.insurance })));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Projects ──────────────────────────────────────────────────────────────
  app.get("/api/plexus/projects", async (_req, res: Response) => {
    try {
      const projects = await storage.getProjects();
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

  app.patch("/api/plexus/projects/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
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
      const id = parseInt(String(req.params.id));
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
      const id = parseInt(String(req.params.id));
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

  // ── Tasks ─────────────────────────────────────────────────────────────────
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

  app.get("/api/plexus/tasks/urgent", async (_req, res: Response) => {
    try {
      const tasks = await storage.getUrgentTasks();
      res.json(await enrichWithPatientNames(tasks));
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

  app.get("/api/plexus/tasks/by-project/:projectId", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(String(req.params.projectId));
      const userId = uid(req);
      if (!await canViewProject(projectId, userId)) return res.status(403).json({ error: "Not authorized to view this project" });
      const tasks = await storage.getTasksByProject(projectId);
      res.json(tasks);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/plexus/tasks/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      const userId = uid(req);
      if (!await canViewTask(id, userId)) return res.status(403).json({ error: "Not authorized to view this task" });
      const task = await storage.getTaskById(id);
      if (!task) return res.status(404).json({ error: "Task not found" });
      res.json(task);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/plexus/tasks", async (req: Request, res: Response) => {
    try {
      const parsed = createTaskSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message });
      const userId = uid(req);
      const task = await storage.createTask({ ...parsed.data, createdByUserId: userId });
      await writeEvent({ taskId: task.id, userId, eventType: "created", payload: { title: task.title } });
      res.status(201).json(task);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/plexus/tasks/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      const parsed = updateTaskSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message });
      const userId = uid(req);
      const prev = await storage.getTaskById(id);
      if (!prev) return res.status(404).json({ error: "Task not found" });
      if (!canEditTask(prev, userId)) return res.status(403).json({ error: "Only the task creator or assignee can update this task" });
      const task = await storage.updateTask(id, parsed.data);
      if (parsed.data.status && parsed.data.status !== prev.status) {
        await writeEvent({ taskId: id, userId, eventType: "status_changed", payload: { from: prev.status, to: parsed.data.status } });
      } else {
        const safePayload: EventPayload = Object.fromEntries(
          Object.entries(parsed.data).filter(([, v]) => v !== undefined)
        );
        await writeEvent({ taskId: id, userId, eventType: "updated", payload: safePayload });
      }
      res.json(task);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/plexus/tasks/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
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
      const taskId = parseInt(String(req.params.id));
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
      const taskId = parseInt(String(req.params.id));
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
        if (task.status === "closed") {
          return res.status(403).json({ error: "Cannot join a closed task" });
        }
      }
      const collab = await storage.addCollaborator({ taskId, userId: targetUserId, role: parsed.data.role });
      await writeEvent({ taskId, userId: actingUserId, eventType: "collaborator_added", payload: { collaboratorUserId: targetUserId, role: parsed.data.role } });
      res.status(201).json(collab);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Messages ──────────────────────────────────────────────────────────────
  app.get("/api/plexus/tasks/:id/messages", async (req: Request, res: Response) => {
    try {
      const taskId = parseInt(String(req.params.id));
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
      const taskId = parseInt(String(req.params.id));
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
      const taskId = parseInt(String(req.params.id));
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
      const taskId = parseInt(String(req.params.id));
      const userId = uid(req);
      if (!await canViewTask(taskId, userId)) return res.status(403).json({ error: "Not authorized" });
      await storage.markRead(taskId, userId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}

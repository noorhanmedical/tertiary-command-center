import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";

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

export function registerPlexusTasksRoutes(app: Express) {
  // ── Users list (for assignee picker) ──────────────────────────────────────
  app.get("/api/plexus/users", async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users.map((u) => ({ id: u.id, username: u.username })));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Projects ───────────────────────────────────────────────────────────────
  app.get("/api/plexus/projects", async (_req, res) => {
    try {
      const projects = await storage.getProjects();
      res.json(projects);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/plexus/projects", async (req, res) => {
    try {
      const parsed = createProjectSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message });
      const project = await storage.createProject({
        ...parsed.data,
        createdByUserId: req.session.userId ?? null,
      });
      res.status(201).json(project);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/plexus/projects/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = createProjectSchema.partial().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message });
      const project = await storage.updateProject(id, parsed.data);
      if (!project) return res.status(404).json({ error: "Project not found" });
      res.json(project);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Tasks ──────────────────────────────────────────────────────────────────
  app.get("/api/plexus/tasks/my-work", async (req, res) => {
    try {
      const userId = req.session.userId!;
      const tasks = await storage.getTasksByAssignee(userId);
      res.json(tasks);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/plexus/tasks/sent", async (req, res) => {
    try {
      const userId = req.session.userId!;
      const tasks = await storage.getTasksByCreator(userId);
      res.json(tasks);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/plexus/tasks/urgent", async (_req, res) => {
    try {
      const tasks = await storage.getUrgentTasks();
      res.json(tasks);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/plexus/tasks/unread-count", async (req, res) => {
    try {
      const userId = req.session.userId!;
      const count = await storage.getUnreadCount(userId);
      res.json({ count });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/plexus/tasks/by-project/:projectId", async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      const tasks = await storage.getTasksByProject(projectId);
      res.json(tasks);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/plexus/tasks/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const task = await storage.getTaskById(id);
      if (!task) return res.status(404).json({ error: "Task not found" });
      res.json(task);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/plexus/tasks", async (req, res) => {
    try {
      const parsed = createTaskSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message });
      const userId = req.session.userId!;
      const task = await storage.createTask({
        ...parsed.data,
        createdByUserId: userId,
      });
      await storage.writeEvent({
        taskId: task.id,
        userId,
        eventType: "created",
        payload: { title: task.title },
      });
      res.status(201).json(task);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/plexus/tasks/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = updateTaskSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message });
      const userId = req.session.userId!;
      const prev = await storage.getTaskById(id);
      if (!prev) return res.status(404).json({ error: "Task not found" });
      const task = await storage.updateTask(id, parsed.data);
      if (parsed.data.status && parsed.data.status !== prev.status) {
        await storage.writeEvent({
          taskId: id,
          userId,
          eventType: "status_changed",
          payload: { from: prev.status, to: parsed.data.status },
        });
      } else {
        await storage.writeEvent({
          taskId: id,
          userId,
          eventType: "updated",
          payload: parsed.data as Record<string, unknown>,
        });
      }
      res.json(task);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Collaborators ─────────────────────────────────────────────────────────
  app.get("/api/plexus/tasks/:id/collaborators", async (req, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const collabs = await storage.getCollaborators(taskId);
      res.json(collabs);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/plexus/tasks/:id/collaborators", async (req, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const actingUserId = req.session.userId!;
      const role: string = req.body.role ?? "collaborator";
      const collab = await storage.addCollaborator({ taskId, userId: actingUserId, role });
      await storage.writeEvent({
        taskId,
        userId: actingUserId,
        eventType: "collaborator_added",
        payload: { collaboratorUserId: actingUserId, role },
      });
      res.status(201).json(collab);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Messages ───────────────────────────────────────────────────────────────
  app.get("/api/plexus/tasks/:id/messages", async (req, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const messages = await storage.getMessages(taskId);
      res.json(messages);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/plexus/tasks/:id/messages", async (req, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const { body } = req.body;
      if (!body?.trim()) return res.status(400).json({ error: "body required" });
      const userId = req.session.userId!;
      const message = await storage.addMessage({ taskId, senderUserId: userId, body });
      await storage.writeEvent({
        taskId,
        userId,
        eventType: "message_sent",
        payload: { messageId: message.id },
      });
      res.status(201).json(message);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Events (audit log) ───────────────────────────────────────────────────
  app.get("/api/plexus/tasks/:id/events", async (req, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const events = await storage.getEvents(taskId);
      res.json(events);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Read tracking ─────────────────────────────────────────────────────────
  app.post("/api/plexus/tasks/:id/read", async (req, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const userId = req.session.userId!;
      await storage.markRead(taskId, userId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Delete task ───────────────────────────────────────────────────────────
  app.delete("/api/plexus/tasks/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const task = await storage.getTaskById(id);
      if (!task) return res.status(404).json({ error: "Task not found" });
      await storage.deleteTask(id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Delete project ────────────────────────────────────────────────────────
  app.delete("/api/plexus/projects/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteProject(id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Project task counts ───────────────────────────────────────────────────
  app.get("/api/plexus/projects/:id/summary", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
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
}

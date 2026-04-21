import { db } from "../db";
import { and, asc, desc, eq, inArray, lte, ne, or, sql } from "drizzle-orm";
import {
  plexusProjects,
  plexusTasks,
  plexusTaskCollaborators,
  plexusTaskMessages,
  plexusTaskEvents,
  plexusTaskReads,
  type PlexusProject,
  type InsertPlexusProject,
  type PlexusTask,
  type InsertPlexusTask,
  type PlexusTaskCollaborator,
  type InsertPlexusTaskCollaborator,
  type PlexusTaskMessage,
  type InsertPlexusTaskMessage,
  type PlexusTaskEvent,
  type InsertPlexusTaskEvent,
} from "@shared/schema/plexus";

export interface IPlexusRepository {
  // Projects
  createProject(record: InsertPlexusProject): Promise<PlexusProject>;
  listProjects(): Promise<PlexusProject[]>;
  listProjectsForUser(userId: string): Promise<PlexusProject[]>;
  getProject(id: number): Promise<PlexusProject | undefined>;
  updateProject(id: number, updates: Partial<InsertPlexusProject>): Promise<PlexusProject | undefined>;
  deleteProject(id: number): Promise<void>;

  // Tasks
  createTask(record: InsertPlexusTask): Promise<PlexusTask>;
  getTask(id: number): Promise<PlexusTask | undefined>;
  listTasksByProject(projectId: number): Promise<PlexusTask[]>;
  listTasksByAssignee(userId: string): Promise<PlexusTask[]>;
  listTasksByCreator(userId: string): Promise<PlexusTask[]>;
  listTasksByCreatorWithActivity(userId: string): Promise<(PlexusTask & { lastActivityAt: Date | null })[]>;
  listTasksByPatient(patientScreeningId: number): Promise<PlexusTask[]>;
  listUrgentTasks(): Promise<PlexusTask[]>;
  listOverdueTasksForUser(userId: string): Promise<PlexusTask[]>;
  updateTask(id: number, updates: Partial<InsertPlexusTask>): Promise<PlexusTask | undefined>;
  deleteTask(id: number): Promise<void>;

  // Collaborators
  addCollaborator(record: InsertPlexusTaskCollaborator): Promise<PlexusTaskCollaborator>;
  listCollaborators(taskId: number): Promise<PlexusTaskCollaborator[]>;

  // Messages
  addMessage(record: InsertPlexusTaskMessage): Promise<PlexusTaskMessage>;
  listMessages(taskId: number): Promise<PlexusTaskMessage[]>;

  // Events
  writeEvent(record: InsertPlexusTaskEvent): Promise<PlexusTaskEvent>;
  listEvents(taskId: number): Promise<PlexusTaskEvent[]>;

  // Reads / unread
  markRead(taskId: number, userId: string): Promise<void>;
  unreadCount(userId: string): Promise<number>;
  unreadPerTask(userId: string): Promise<{ taskId: number; unreadCount: number }[]>;
}

export class DbPlexusRepository implements IPlexusRepository {
  async createProject(record: InsertPlexusProject): Promise<PlexusProject> {
    const [result] = await db.insert(plexusProjects).values(record).returning();
    return result;
  }

  async listProjects(): Promise<PlexusProject[]> {
    return db.select().from(plexusProjects).orderBy(asc(plexusProjects.title));
  }

  async listProjectsForUser(userId: string): Promise<PlexusProject[]> {
    const ownedProjects = await db.select({ id: plexusProjects.id })
      .from(plexusProjects)
      .where(eq(plexusProjects.createdByUserId, userId));
    const taskRows = await db.select({ projectId: plexusTasks.projectId })
      .from(plexusTasks)
      .where(and(
        sql`${plexusTasks.projectId} IS NOT NULL`,
        sql`(${plexusTasks.createdByUserId} = ${userId} OR ${plexusTasks.assignedToUserId} = ${userId})`,
      ));
    const collabRows = await db.select({ taskId: plexusTaskCollaborators.taskId })
      .from(plexusTaskCollaborators)
      .where(eq(plexusTaskCollaborators.userId, userId));
    const taskIds = collabRows.map((c) => c.taskId);
    let collabProjectIds: number[] = [];
    if (taskIds.length > 0) {
      const collabTasks = await db.select({ projectId: plexusTasks.projectId })
        .from(plexusTasks)
        .where(and(inArray(plexusTasks.id, taskIds), sql`${plexusTasks.projectId} IS NOT NULL`));
      collabProjectIds = collabTasks.map((t) => t.projectId).filter((id): id is number => id != null);
    }
    const allIds = Array.from(new Set([
      ...ownedProjects.map((p) => p.id),
      ...taskRows.map((t) => t.projectId).filter((id): id is number => id != null),
      ...collabProjectIds,
    ]));
    if (allIds.length === 0) return [];
    return db.select().from(plexusProjects)
      .where(inArray(plexusProjects.id, allIds))
      .orderBy(asc(plexusProjects.title));
  }

  async getProject(id: number): Promise<PlexusProject | undefined> {
    const [result] = await db.select().from(plexusProjects).where(eq(plexusProjects.id, id));
    return result;
  }

  async updateProject(id: number, updates: Partial<InsertPlexusProject>): Promise<PlexusProject | undefined> {
    const [result] = await db.update(plexusProjects).set(updates).where(eq(plexusProjects.id, id)).returning();
    return result;
  }

  async deleteProject(id: number): Promise<void> {
    await db.delete(plexusProjects).where(eq(plexusProjects.id, id));
  }

  async createTask(record: InsertPlexusTask): Promise<PlexusTask> {
    const [result] = await db.insert(plexusTasks).values(record).returning();
    return result;
  }

  async getTask(id: number): Promise<PlexusTask | undefined> {
    const [result] = await db.select().from(plexusTasks).where(eq(plexusTasks.id, id));
    return result;
  }

  async listTasksByProject(projectId: number): Promise<PlexusTask[]> {
    return db.select().from(plexusTasks)
      .where(eq(plexusTasks.projectId, projectId))
      .orderBy(asc(plexusTasks.createdAt));
  }

  async listTasksByAssignee(userId: string): Promise<PlexusTask[]> {
    return db.select().from(plexusTasks)
      .where(and(eq(plexusTasks.assignedToUserId, userId), ne(plexusTasks.status, "closed")))
      .orderBy(desc(plexusTasks.createdAt));
  }

  async listTasksByCreator(userId: string): Promise<PlexusTask[]> {
    return db.select().from(plexusTasks)
      .where(eq(plexusTasks.createdByUserId, userId))
      .orderBy(desc(plexusTasks.createdAt));
  }

  async listTasksByPatient(patientScreeningId: number): Promise<PlexusTask[]> {
    return db.select().from(plexusTasks)
      .where(eq(plexusTasks.patientScreeningId, patientScreeningId))
      .orderBy(desc(plexusTasks.createdAt));
  }

  async listTasksByCreatorWithActivity(userId: string): Promise<(PlexusTask & { lastActivityAt: Date | null })[]> {
    const tasks = await db.select().from(plexusTasks)
      .where(eq(plexusTasks.createdByUserId, userId))
      .orderBy(desc(plexusTasks.updatedAt));
    if (tasks.length === 0) return [];
    const taskIds = tasks.map((t) => t.id);
    const latestMsgs = await db.select({
      taskId: plexusTaskMessages.taskId,
      latestAt: sql<Date>`MAX(${plexusTaskMessages.createdAt})`,
    })
      .from(plexusTaskMessages)
      .where(inArray(plexusTaskMessages.taskId, taskIds))
      .groupBy(plexusTaskMessages.taskId);
    const msgMap = new Map(latestMsgs.map((m) => [m.taskId, m.latestAt]));
    return tasks.map((t) => ({
      ...t,
      lastActivityAt: msgMap.get(t.id) ?? t.updatedAt,
    }));
  }

  async listUrgentTasks(): Promise<PlexusTask[]> {
    return db.select().from(plexusTasks)
      .where(and(
        ne(plexusTasks.urgency, "none"),
        ne(plexusTasks.status, "closed"),
        ne(plexusTasks.status, "done"),
      ))
      .orderBy(desc(plexusTasks.createdAt));
  }

  async listOverdueTasksForUser(userId: string): Promise<PlexusTask[]> {
    const today = new Date().toISOString().slice(0, 10);
    return db.select().from(plexusTasks)
      .where(and(
        or(
          eq(plexusTasks.assignedToUserId, userId),
          eq(plexusTasks.createdByUserId, userId),
        ),
        ne(plexusTasks.status, "closed"),
        ne(plexusTasks.status, "done"),
        sql`${plexusTasks.dueDate} IS NOT NULL`,
        lte(plexusTasks.dueDate, today),
      ))
      .orderBy(asc(plexusTasks.dueDate));
  }

  async updateTask(id: number, updates: Partial<InsertPlexusTask>): Promise<PlexusTask | undefined> {
    const [result] = await db.update(plexusTasks)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(plexusTasks.id, id))
      .returning();
    return result;
  }

  async deleteTask(id: number): Promise<void> {
    await db.delete(plexusTasks).where(eq(plexusTasks.id, id));
  }

  async addCollaborator(record: InsertPlexusTaskCollaborator): Promise<PlexusTaskCollaborator> {
    const existing = await db.select().from(plexusTaskCollaborators)
      .where(and(eq(plexusTaskCollaborators.taskId, record.taskId), eq(plexusTaskCollaborators.userId, record.userId)))
      .limit(1);
    if (existing.length > 0) {
      const [updated] = await db.update(plexusTaskCollaborators)
        .set({ role: record.role })
        .where(eq(plexusTaskCollaborators.id, existing[0].id))
        .returning();
      return updated;
    }
    const [result] = await db.insert(plexusTaskCollaborators).values(record).returning();
    return result;
  }

  async listCollaborators(taskId: number): Promise<PlexusTaskCollaborator[]> {
    return db.select().from(plexusTaskCollaborators).where(eq(plexusTaskCollaborators.taskId, taskId));
  }

  async addMessage(record: InsertPlexusTaskMessage): Promise<PlexusTaskMessage> {
    const [result] = await db.insert(plexusTaskMessages).values(record).returning();
    await db.update(plexusTasks).set({ updatedAt: new Date() }).where(eq(plexusTasks.id, record.taskId));
    return result;
  }

  async listMessages(taskId: number): Promise<PlexusTaskMessage[]> {
    return db.select().from(plexusTaskMessages)
      .where(eq(plexusTaskMessages.taskId, taskId))
      .orderBy(asc(plexusTaskMessages.createdAt));
  }

  async writeEvent(record: InsertPlexusTaskEvent): Promise<PlexusTaskEvent> {
    const [result] = await db.insert(plexusTaskEvents).values(record).returning();
    return result;
  }

  async listEvents(taskId: number): Promise<PlexusTaskEvent[]> {
    return db.select().from(plexusTaskEvents)
      .where(eq(plexusTaskEvents.taskId, taskId))
      .orderBy(asc(plexusTaskEvents.createdAt));
  }

  async markRead(taskId: number, userId: string): Promise<void> {
    const now = new Date();
    const existing = await db.select().from(plexusTaskReads)
      .where(and(eq(plexusTaskReads.taskId, taskId), eq(plexusTaskReads.userId, userId)))
      .limit(1);
    if (existing.length > 0) {
      await db.update(plexusTaskReads)
        .set({ lastReadAt: now })
        .where(eq(plexusTaskReads.id, existing[0].id));
    } else {
      await db.insert(plexusTaskReads).values({ taskId, userId });
    }
    await db.insert(plexusTaskEvents).values({
      taskId,
      userId,
      eventType: "read",
      payload: { readAt: now.toISOString() },
    });
  }

  // Returns task IDs where the user has membership for unread counting.
  // Closed tasks are excluded from direct membership; collaborator tasks are
  // always included (to catch team-help scenarios).
  private async getMemberTaskIds(userId: string): Promise<number[]> {
    const [directRows, collabRows] = await Promise.all([
      db.select({ id: plexusTasks.id }).from(plexusTasks)
        .where(and(
          ne(plexusTasks.status, "closed"),
          sql`(${plexusTasks.assignedToUserId} = ${userId} OR ${plexusTasks.createdByUserId} = ${userId})`,
        )),
      db.select({ taskId: plexusTaskCollaborators.taskId })
        .from(plexusTaskCollaborators)
        .where(eq(plexusTaskCollaborators.userId, userId)),
    ]);
    return Array.from(new Set([
      ...directRows.map((t) => t.id),
      ...collabRows.map((c) => c.taskId),
    ]));
  }

  async unreadCount(userId: string): Promise<number> {
    const taskIds = await this.getMemberTaskIds(userId);
    if (taskIds.length === 0) return 0;
    const [msgRows, readRows] = await Promise.all([
      db.select({ taskId: plexusTaskMessages.taskId, createdAt: plexusTaskMessages.createdAt })
        .from(plexusTaskMessages)
        .where(and(
          inArray(plexusTaskMessages.taskId, taskIds),
          sql`${plexusTaskMessages.senderUserId} != ${userId}`,
        )),
      db.select({ taskId: plexusTaskReads.taskId, lastReadAt: plexusTaskReads.lastReadAt })
        .from(plexusTaskReads)
        .where(and(eq(plexusTaskReads.userId, userId), inArray(plexusTaskReads.taskId, taskIds))),
    ]);
    const readMap = new Map(readRows.map((r) => [r.taskId, r.lastReadAt]));
    return msgRows.filter((m) => {
      const lastRead = readMap.get(m.taskId);
      return !lastRead || m.createdAt > lastRead;
    }).length;
  }

  async unreadPerTask(userId: string): Promise<{ taskId: number; unreadCount: number }[]> {
    const taskIds = await this.getMemberTaskIds(userId);
    if (taskIds.length === 0) return [];
    const [msgRows, readRows] = await Promise.all([
      db.select({ taskId: plexusTaskMessages.taskId, createdAt: plexusTaskMessages.createdAt })
        .from(plexusTaskMessages)
        .where(and(
          inArray(plexusTaskMessages.taskId, taskIds),
          sql`${plexusTaskMessages.senderUserId} != ${userId}`,
        )),
      db.select({ taskId: plexusTaskReads.taskId, lastReadAt: plexusTaskReads.lastReadAt })
        .from(plexusTaskReads)
        .where(and(eq(plexusTaskReads.userId, userId), inArray(plexusTaskReads.taskId, taskIds))),
    ]);
    const readMap = new Map(readRows.map((r) => [r.taskId, r.lastReadAt]));
    const perTask = new Map<number, number>();
    for (const m of msgRows) {
      const lastRead = readMap.get(m.taskId);
      if (!lastRead || m.createdAt > lastRead) {
        perTask.set(m.taskId, (perTask.get(m.taskId) ?? 0) + 1);
      }
    }
    return Array.from(perTask.entries()).map(([taskId, unreadCount]) => ({ taskId, unreadCount }));
  }
}

export const plexusRepository: IPlexusRepository = new DbPlexusRepository();

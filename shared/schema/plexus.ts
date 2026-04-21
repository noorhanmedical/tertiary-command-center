import { sql, pgTable, serial, text, varchar, integer, timestamp, jsonb, index, AnyPgColumn, createInsertSchema, z } from "./_common";
import { users } from "./users";
import { patientScreenings, screeningBatches } from "./screening";

export const plexusProjects = pgTable("plexus_projects", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  projectType: text("project_type").notNull().default("operational"),
  facility: text("facility"),
  status: text("status").notNull().default("active"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_plexus_projects_created_by").on(table.createdByUserId),
  index("idx_plexus_projects_status").on(table.status),
]);

export const insertPlexusProjectSchema = createInsertSchema(plexusProjects).omit({ id: true, createdAt: true });
export type PlexusProject = typeof plexusProjects.$inferSelect;
export type InsertPlexusProject = z.infer<typeof insertPlexusProjectSchema>;

export const plexusTasks = pgTable("plexus_tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => plexusProjects.id, { onDelete: "set null" }),
  parentTaskId: integer("parent_task_id").references((): AnyPgColumn => plexusTasks.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  taskType: text("task_type").notNull().default("task"),
  urgency: text("urgency").notNull().default("none"),
  priority: text("priority").notNull().default("normal"),
  status: text("status").notNull().default("open"),
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  batchId: integer("batch_id").references(() => screeningBatches.id, { onDelete: "set null" }),
  dueDate: text("due_date"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_plexus_tasks_project_id").on(table.projectId),
  index("idx_plexus_tasks_assigned_to").on(table.assignedToUserId),
  index("idx_plexus_tasks_created_by").on(table.createdByUserId),
  index("idx_plexus_tasks_status").on(table.status),
  index("idx_plexus_tasks_urgency").on(table.urgency),
  index("idx_plexus_tasks_batch_id").on(table.batchId),
]);

export const insertPlexusTaskSchema = createInsertSchema(plexusTasks).omit({ id: true, createdAt: true, updatedAt: true });
export type PlexusTask = typeof plexusTasks.$inferSelect;
export type InsertPlexusTask = z.infer<typeof insertPlexusTaskSchema>;

export const plexusTaskCollaborators = pgTable("plexus_task_collaborators", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => plexusTasks.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("collaborator"),
  addedAt: timestamp("added_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_plexus_task_collab_task_id").on(table.taskId),
  index("idx_plexus_task_collab_user_id").on(table.userId),
]);

export const insertPlexusTaskCollaboratorSchema = createInsertSchema(plexusTaskCollaborators).omit({ id: true, addedAt: true });
export type PlexusTaskCollaborator = typeof plexusTaskCollaborators.$inferSelect;
export type InsertPlexusTaskCollaborator = z.infer<typeof insertPlexusTaskCollaboratorSchema>;

export const plexusTaskMessages = pgTable("plexus_task_messages", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => plexusTasks.id, { onDelete: "cascade" }),
  senderUserId: varchar("sender_user_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_plexus_task_messages_task_id").on(table.taskId),
]);

export const insertPlexusTaskMessageSchema = createInsertSchema(plexusTaskMessages).omit({ id: true, createdAt: true });
export type PlexusTaskMessage = typeof plexusTaskMessages.$inferSelect;
export type InsertPlexusTaskMessage = z.infer<typeof insertPlexusTaskMessageSchema>;

export const plexusTaskEvents = pgTable("plexus_task_events", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").references(() => plexusTasks.id, { onDelete: "set null" }),
  projectId: integer("project_id").references(() => plexusProjects.id, { onDelete: "set null" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_plexus_task_events_task_id").on(table.taskId),
  index("idx_plexus_task_events_project_id").on(table.projectId),
]);

export const insertPlexusTaskEventSchema = createInsertSchema(plexusTaskEvents).omit({ id: true, createdAt: true });
export type PlexusTaskEvent = typeof plexusTaskEvents.$inferSelect;
export type InsertPlexusTaskEvent = z.infer<typeof insertPlexusTaskEventSchema>;

export const plexusTaskReads = pgTable("plexus_task_reads", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => plexusTasks.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lastReadAt: timestamp("last_read_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_plexus_task_reads_user_id").on(table.userId),
  index("idx_plexus_task_reads_task_id").on(table.taskId),
]);

export const insertPlexusTaskReadSchema = createInsertSchema(plexusTaskReads).omit({ id: true, lastReadAt: true });
export type PlexusTaskRead = typeof plexusTaskReads.$inferSelect;
export type InsertPlexusTaskRead = z.infer<typeof insertPlexusTaskReadSchema>;

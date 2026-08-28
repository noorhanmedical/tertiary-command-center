import { sql, pgTable, serial, text, varchar, integer, timestamp, jsonb, index, AnyPgColumn, createInsertSchema, z } from "./_common";
import { users } from "./users";
import { patientScreenings, screeningBatches } from "./screening";
import { clinics } from "./clinics";

export const plexusProjects = pgTable("plexus_projects", {
  id: serial("id").primaryKey(),
  // Multi-tenancy: nullable during backfill; filter enforced in repository layer.
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
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
  // Canonical operational priority P1..P5 (Phase 2 / decision K5). Kept
  // ALONGSIDE the legacy `priority` (low/normal/high) for backward
  // compatibility; new code reads priorityLevel, old rows are mapped
  // deterministically (see PLEXUS_TASK_PRIORITY_LEVELS / mapping helpers).
  // Nullable during backfill; the API defaults it from legacy priority.
  priorityLevel: text("priority_level"),
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  // Phase 2 — team/workgroup assignment. FK wired to canonical teams in
  // Phase 4 (K4); nullable until then. Lets a task be owned by a team.
  assignedTeamId: integer("assigned_team_id"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  // Phase 2 — canonical case linkage. Lets a task point at the exact
  // execution case / ancillary case (not just the patient screening) so a
  // task click can open the right Playground workspace with full context.
  executionCaseId: integer("execution_case_id"),
  ancillaryCaseId: integer("ancillary_case_id"),
  facilityId: text("facility_id"),
  batchId: integer("batch_id").references(() => screeningBatches.id, { onDelete: "set null" }),
  dueDate: text("due_date"),
  // Phase 2 — explicit completion provenance (was only inferable from
  // status='done'/'closed' + updatedAt). Set when status becomes terminal.
  completedAt: timestamp("completed_at"),
  completedByUserId: varchar("completed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_plexus_tasks_project_id").on(table.projectId),
  index("idx_plexus_tasks_assigned_to").on(table.assignedToUserId),
  index("idx_plexus_tasks_assigned_team").on(table.assignedTeamId),
  index("idx_plexus_tasks_created_by").on(table.createdByUserId),
  index("idx_plexus_tasks_status").on(table.status),
  index("idx_plexus_tasks_urgency").on(table.urgency),
  index("idx_plexus_tasks_priority_level").on(table.priorityLevel),
  index("idx_plexus_tasks_batch_id").on(table.batchId),
  index("idx_plexus_tasks_facility").on(table.facilityId),
  index("idx_plexus_tasks_execution_case").on(table.executionCaseId),
  index("idx_plexus_tasks_ancillary_case").on(table.ancillaryCaseId),
]);

// ─── Canonical operational priority (P1..P5) — decision K5 ───────────────────
// Shared by tasks and (Phase 3) call handoffs. Meaning:
//   P1 immediate · P2 same day · P3 next business day · P4 routine · P5 low
export const PLEXUS_TASK_PRIORITY_LEVELS = ["P1", "P2", "P3", "P4", "P5"] as const;
export type PlexusTaskPriorityLevel = (typeof PLEXUS_TASK_PRIORITY_LEVELS)[number];

// Backward-compatible mapping between the legacy 3-level priority and the
// canonical P1..P5 scale. Deterministic both ways so historical rows keep a
// stable meaning and old clients keep working.
//   high → P1 (was the top of a 3-level scale) — but a task marked urgency
//          "within 1 hour" is escalated to P1 by the API; plain high → P2.
//   normal → P3 · low → P4. (P5 is reserved for explicit "when able".)
export function legacyPriorityToLevel(
  priority: string | null | undefined,
): PlexusTaskPriorityLevel {
  switch ((priority ?? "normal").toLowerCase()) {
    case "high": return "P2";
    case "low": return "P4";
    case "normal":
    default: return "P3";
  }
}

// Reverse map so writing a P-level keeps the legacy column coherent for any
// old reader (high/normal/low). P1+P2 → high, P3 → normal, P4+P5 → low.
export function levelToLegacyPriority(
  level: PlexusTaskPriorityLevel | null | undefined,
): "low" | "normal" | "high" {
  switch (level) {
    case "P1":
    case "P2": return "high";
    case "P4":
    case "P5": return "low";
    case "P3":
    default: return "normal";
  }
}

/** Resolve the effective P-level for a row: explicit priorityLevel wins;
 *  otherwise derive from legacy priority. */
export function effectiveTaskPriorityLevel(row: {
  priorityLevel?: string | null;
  priority?: string | null;
}): PlexusTaskPriorityLevel {
  const pl = (row.priorityLevel ?? "").toUpperCase();
  if ((PLEXUS_TASK_PRIORITY_LEVELS as readonly string[]).includes(pl)) {
    return pl as PlexusTaskPriorityLevel;
  }
  return legacyPriorityToLevel(row.priority);
}

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

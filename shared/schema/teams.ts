import {
  sql, pgTable, serial, text, varchar, integer, boolean, timestamp, jsonb,
  uniqueIndex, index, createInsertSchema, z,
} from "./_common";
import { users } from "./users";

// ─── Canonical organizational teams (Phase 4 / decision K4) ──────────────────
//
// First-class teams entity. Product behavior keys off the stable `type`
// (PCS/ACS/management/custom), NOT the free-text name — so renaming a team
// never changes capability semantics.

export const TEAM_TYPES = ["PCS", "ACS", "management", "custom"] as const;
export type TeamType = (typeof TEAM_TYPES)[number];

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // Stable machine slug (unique, lowercase) — safe for code references.
  slug: text("slug").notNull(),
  type: text("type").notNull().default("custom"),
  // Optional facility association (a team may be facility-scoped or org-wide).
  facilityId: text("facility_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("uq_teams_slug").on(table.slug),
  index("idx_teams_type").on(table.type),
  index("idx_teams_active").on(table.active),
]);

export const insertTeamSchema = createInsertSchema(teams)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    name: z.string().min(1).max(120),
    slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric/hyphen"),
    type: z.enum(TEAM_TYPES),
    active: z.boolean().optional(),
  });
export type Team = typeof teams.$inferSelect;
export type InsertTeam = z.infer<typeof insertTeamSchema>;

// ─── Team memberships (multi-team) ───────────────────────────────────────────
//
// A user may belong to more than one team. `active` + `endAt` mark historical
// membership without deletion. A partial unique index enforces ONE active row
// per (team,user) (see migration) — concurrency-safe.

export const TEAM_MEMBERSHIP_ROLES = ["member", "lead", "manager"] as const;
export type TeamMembershipRole = (typeof TEAM_MEMBERSHIP_ROLES)[number];

export const teamMemberships = pgTable("team_memberships", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  membershipRole: text("membership_role").notNull().default("member"),
  primaryTeam: boolean("primary_team").notNull().default(false),
  active: boolean("active").notNull().default(true),
  startAt: timestamp("start_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  endAt: timestamp("end_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_team_memberships_team").on(table.teamId),
  index("idx_team_memberships_user").on(table.userId),
  index("idx_team_memberships_active").on(table.active),
]);

export const insertTeamMembershipSchema = createInsertSchema(teamMemberships)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    membershipRole: z.enum(TEAM_MEMBERSHIP_ROLES).optional(),
    primaryTeam: z.boolean().optional(),
    active: z.boolean().optional(),
  });
export type TeamMembership = typeof teamMemberships.$inferSelect;
export type InsertTeamMembership = z.infer<typeof insertTeamMembershipSchema>;

// ─── Manager relationships (team-level, with optional direct override) ───────
//
// Management authority is CANONICAL — never inferred from title/role string/
// email/facility. A manager is authorized for a team (and optionally scoped to
// a facility). Direct manager→user overrides are supported only as an explicit
// scope="user" row.

export const MANAGER_SCOPE_TYPES = ["team", "user"] as const;
export type ManagerScopeType = (typeof MANAGER_SCOPE_TYPES)[number];

export const managerRelationships = pgTable("manager_relationships", {
  id: serial("id").primaryKey(),
  managerUserId: varchar("manager_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  scopeType: text("scope_type").notNull().default("team"),
  // Team-scoped management (the primary model). Null for a user-scoped override.
  teamId: integer("team_id").references(() => teams.id, { onDelete: "cascade" }),
  // Explicit direct-report override (scopeType="user"). Null for team scope.
  subordinateUserId: varchar("subordinate_user_id").references(() => users.id, { onDelete: "cascade" }),
  // Optional additional facility narrowing.
  facilityId: text("facility_id"),
  active: boolean("active").notNull().default(true),
  startAt: timestamp("start_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  endAt: timestamp("end_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_manager_rel_manager").on(table.managerUserId),
  index("idx_manager_rel_team").on(table.teamId),
  index("idx_manager_rel_subordinate").on(table.subordinateUserId),
  index("idx_manager_rel_active").on(table.active),
]);

export const insertManagerRelationshipSchema = createInsertSchema(managerRelationships)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    scopeType: z.enum(MANAGER_SCOPE_TYPES).optional(),
    active: z.boolean().optional(),
  });
export type ManagerRelationship = typeof managerRelationships.$inferSelect;
export type InsertManagerRelationship = z.infer<typeof insertManagerRelationshipSchema>;

// ─── Relationship-change audit (K25) ─────────────────────────────────────────
//
// Smallest canonical home for Team-Ops relationship events (not patient-scoped,
// so kept out of patient_journey_events). Append-only.

export const TEAM_RELATIONSHIP_EVENT_TYPES = [
  "team_created",
  "team_updated",
  "team_activated",
  "team_deactivated",
  "membership_added",
  "membership_removed",
  "membership_updated",
  "manager_added",
  "manager_removed",
  "coverage_changed",
  "capability_changed",
  "workload_changed",
  "user_deactivated",
  "user_reactivated",
  "call_eligibility_changed",
] as const;
export type TeamRelationshipEventType = (typeof TEAM_RELATIONSHIP_EVENT_TYPES)[number];

export const teamRelationshipEvents = pgTable("team_relationship_events", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull(),
  actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  // Subject of the change (the member/manager affected), when applicable.
  subjectUserId: varchar("subject_user_id").references(() => users.id, { onDelete: "set null" }),
  teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
  facilityId: text("facility_id"),
  summary: text("summary").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_team_rel_events_type").on(table.eventType),
  index("idx_team_rel_events_subject").on(table.subjectUserId),
  index("idx_team_rel_events_team").on(table.teamId),
  index("idx_team_rel_events_created").on(table.createdAt),
]);

export const insertTeamRelationshipEventSchema = createInsertSchema(teamRelationshipEvents)
  .omit({ id: true, createdAt: true })
  .extend({ eventType: z.enum(TEAM_RELATIONSHIP_EVENT_TYPES) });
export type TeamRelationshipEvent = typeof teamRelationshipEvents.$inferSelect;
export type InsertTeamRelationshipEvent = z.infer<typeof insertTeamRelationshipEventSchema>;

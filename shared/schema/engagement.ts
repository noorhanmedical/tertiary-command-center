import {
  sql, pgTable, serial, integer, text, boolean, timestamp, uniqueIndex,
  createInsertSchema, z,
} from "./_common";
import { outreachSchedulers } from "./outreach";

// Per-team-member Call Settings for the Engagement Center distribution
// brain. Additive and narrow: one row per roster member
// (outreach_schedulers.id). Holds only the persistent admin-configured
// inputs — every target (completed-call KPI, scheduled KPI, visit/
// outreach split, capacity) is DERIVED at read time from these inputs
// (see server/services/engagement/callSettingsService.ts), never stored,
// so the math stays a single source of truth.
//
// manualWorkingToday is a tri-state: null = follow the platform calendar
// (PTO/roster), true = admin forces "working", false = admin forces "off".
export const ENGAGEMENT_TEAMS = ["PCS", "ACS"] as const;
export type EngagementTeam = typeof ENGAGEMENT_TEAMS[number];

export const engagementCallSettings = pgTable("engagement_call_settings", {
  id: serial("id").primaryKey(),
  schedulerId: integer("scheduler_id")
    .notNull()
    .references(() => outreachSchedulers.id, { onDelete: "cascade" }),
  // Patient Care Specialist vs Ancillary Care Specialist.
  team: text("team").notNull().default("PCS"),
  // % of the workday spent on calls (0–100). Drives completed-call KPI.
  callWorkdayPercent: integer("call_workday_percent").notNull().default(100),
  // % of calls that are Visit calls (0–100). Outreach = 100 - visit.
  visitPercent: integer("visit_percent").notNull().default(75),
  // Completed-call KPI at a 100% workday (the base the % scales).
  baseCompletedCallKpi: integer("base_completed_call_kpi").notNull().default(30),
  // Scheduled-patient KPI as a % of the completed-call KPI.
  scheduledKpiPercent: integer("scheduled_kpi_percent").notNull().default(50),
  // Optional hard cap on new daily assignment capacity. Null = derive
  // from the completed-call KPI.
  maxDailyCapacity: integer("max_daily_capacity"),
  // Tri-state working override. Null = follow platform calendar/PTO.
  manualWorkingToday: boolean("manual_working_today"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("uq_engagement_call_settings_scheduler").on(table.schedulerId),
]);

export const insertEngagementCallSettingsSchema = createInsertSchema(engagementCallSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  team: z.enum(ENGAGEMENT_TEAMS).optional(),
  callWorkdayPercent: z.number().int().min(0).max(100).optional(),
  visitPercent: z.number().int().min(0).max(100).optional(),
  baseCompletedCallKpi: z.number().int().min(0).max(1000).optional(),
  scheduledKpiPercent: z.number().int().min(0).max(100).optional(),
  maxDailyCapacity: z.number().int().min(0).max(1000).optional().nullable(),
  manualWorkingToday: z.boolean().optional().nullable(),
  active: z.boolean().optional(),
});

export type EngagementCallSettings = typeof engagementCallSettings.$inferSelect;
export type InsertEngagementCallSettings = z.infer<typeof insertEngagementCallSettingsSchema>;

import {
  sql, pgTable, serial, integer, text, boolean, timestamp, uniqueIndex,
  createInsertSchema, z,
} from "./_common";
import { outreachSchedulers } from "./outreach";

// Per-team-member Call Settings for the Engagement Center distribution
// brain. Additive and narrow: one row per roster member
// (outreach_schedulers.id). Holds only the persistent admin-configured
// inputs — every target (completed-call KPI, scheduled KPI, visit/
// outreach split, capacity) is DERIVED at read time from these inputs plus
// the global call config (see server/services/engagement/
// callSettingsService.ts), never stored, so the math stays a single source
// of truth.
//
// manualWorkingToday is a tri-state: null = follow the platform calendar
// (PTO/roster), true = admin forces "working", false = admin forces "off".
export const ENGAGEMENT_TEAMS = ["PCS", "ACS"] as const;
export type EngagementTeam = typeof ENGAGEMENT_TEAMS[number];

// ─── Global, admin-configurable call-distribution config ────────────────────
// Persisted as a single JSON blob in app_settings (key "engagement.callConfig")
// via server/services/engagement/callConfigService.ts. It is one row of global
// knobs plus a small workday-tier table, so key/value JSON is the right fit —
// no dedicated table needed. The rounding mode applies to the scheduled-call
// KPI and the visit-target split (the completed-call KPI formula always floors
// so it never overstates capacity).
export const ROUNDING_MODES = ["round", "floor", "ceil"] as const;
export type RoundingMode = typeof ROUNDING_MODES[number];

export interface WorkdayTier {
  workdayPercent: number;
  completedCallKpi: number;
}

export interface EngagementCallConfig {
  fullDayCompletedCallTarget: number;
  scheduledPatientTargetPercent: number;
  defaultVisitCallPercent: number;
  defaultOutreachCallPercent: number;
  roundingMode: RoundingMode;
  workdayTiers: WorkdayTier[];
}

export const DEFAULT_WORKDAY_TIERS: WorkdayTier[] = [
  { workdayPercent: 100, completedCallKpi: 30 },
  { workdayPercent: 50, completedCallKpi: 15 },
  { workdayPercent: 25, completedCallKpi: 7 },
  { workdayPercent: 0, completedCallKpi: 0 },
];

export const DEFAULT_CALL_CONFIG: EngagementCallConfig = {
  fullDayCompletedCallTarget: 30,
  scheduledPatientTargetPercent: 50,
  defaultVisitCallPercent: 75,
  defaultOutreachCallPercent: 25,
  roundingMode: "round",
  workdayTiers: DEFAULT_WORKDAY_TIERS,
};

export const workdayTierSchema = z.object({
  workdayPercent: z.number().int().min(0).max(100),
  completedCallKpi: z.number().int().min(0).max(1000),
});

export const callConfigSchema = z.object({
  fullDayCompletedCallTarget: z.number().int().min(0).max(1000),
  scheduledPatientTargetPercent: z.number().int().min(0).max(100),
  defaultVisitCallPercent: z.number().int().min(0).max(100),
  defaultOutreachCallPercent: z.number().int().min(0).max(100),
  roundingMode: z.enum(ROUNDING_MODES),
  workdayTiers: z.array(workdayTierSchema).max(50),
});

export const callConfigPatchSchema = callConfigSchema.partial();
export type CallConfigPatch = z.infer<typeof callConfigPatchSchema>;

// ─── Per-team-member Call Settings table ────────────────────────────────────
export const engagementCallSettings = pgTable("engagement_call_settings", {
  id: serial("id").primaryKey(),
  schedulerId: integer("scheduler_id")
    .notNull()
    .references(() => outreachSchedulers.id, { onDelete: "cascade" }),
  // Patient Care Specialist vs Ancillary Care Specialist.
  team: text("team").notNull().default("PCS"),
  // % of the workday spent on calls (0–100). Drives completed-call KPI.
  callWorkdayPercent: integer("call_workday_percent").notNull().default(100),
  // Per-member Visit % (0–100). Null → use global defaultVisitCallPercent.
  visitPercent: integer("visit_percent"),
  // Per-member Outreach % (0–100). Null → use global defaultOutreachCallPercent.
  // Always paired with visitPercent so the two sum to 100.
  outreachPercent: integer("outreach_percent"),
  // Explicit per-member overrides — when set, they win over tiers/formulas.
  explicitCompletedCallKpi: integer("explicit_completed_call_kpi"),
  explicitScheduledKpi: integer("explicit_scheduled_kpi"),
  // Facilities this member covers (names from outreach_schedulers.facility).
  // Stored here now; routing consumption arrives with the distribution engine.
  facilitiesCovered: text("facilities_covered").array(),
  // Legacy Phase-1 inputs — superseded by the global config + explicit
  // overrides above and no longer used in the target math. Kept (non-null,
  // defaulted) for backward-compatible rows; safe to ignore.
  baseCompletedCallKpi: integer("base_completed_call_kpi").notNull().default(30),
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
  visitPercent: z.number().int().min(0).max(100).optional().nullable(),
  outreachPercent: z.number().int().min(0).max(100).optional().nullable(),
  explicitCompletedCallKpi: z.number().int().min(0).max(1000).optional().nullable(),
  explicitScheduledKpi: z.number().int().min(0).max(1000).optional().nullable(),
  facilitiesCovered: z.array(z.string()).optional().nullable(),
  baseCompletedCallKpi: z.number().int().min(0).max(1000).optional(),
  scheduledKpiPercent: z.number().int().min(0).max(100).optional(),
  maxDailyCapacity: z.number().int().min(0).max(1000).optional().nullable(),
  manualWorkingToday: z.boolean().optional().nullable(),
  active: z.boolean().optional(),
});

export type EngagementCallSettings = typeof engagementCallSettings.$inferSelect;
export type InsertEngagementCallSettings = z.infer<typeof insertEngagementCallSettingsSchema>;

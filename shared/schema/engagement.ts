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

// ─── Rounding mode (shared by the global config + the derivation service) ────
export const ROUNDING_MODES = ["round", "floor", "ceil"] as const;
export type RoundingMode = typeof ROUNDING_MODES[number];

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
  // Per-member Visit % (0–100). Null → use global defaultVisitPercent.
  visitPercent: integer("visit_percent"),
  // Per-member outreach %, mirror of visitPercent (visit + outreach = 100).
  // Null → derive outreach as 100 - visitPercent.
  outreachPercent: integer("outreach_percent"),
  // ─── Explicit per-member overrides — win over tiers/formulas when set ─────
  // All nullable: null means "fall back to the tier/global formula".
  explicitCompletedKpi: integer("explicit_completed_call_kpi"),
  explicitScheduledKpi: integer("explicit_scheduled_kpi"),
  // Facilities this member covers (informational/edited here; routing use
  // arrives with the distribution engine — Phase 2).
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
  explicitCompletedKpi: z.number().int().min(0).max(1000).optional().nullable(),
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

// ─── Global Engagement Call config + workday tiers (app_settings JSON) ───────
//
// Admin-configurable distribution model defaults. Persisted as JSON in the
// key-value app_settings store (not a dedicated table), so the whole model is
// editable without code/schema changes. Targets are still DERIVED at read
// time (see callSettingsService) — this just supplies the configurable
// inputs/defaults the derivation consumes.

// app_settings keys.
export const ENGAGEMENT_CALL_CONFIG_KEY = "engagement.callConfig";
export const ENGAGEMENT_WORKDAY_TIERS_KEY = "engagement.workdayTiers";

export const globalCallConfigSchema = z
  .object({
    // Completed-call KPI for a full (100%) workday — the base the formula scales.
    fullDayCompletedTarget: z.number().int().min(0).max(1000),
    // Scheduled-patient KPI as a % of the completed-call KPI.
    scheduledKpiPercent: z.number().int().min(0).max(100),
    // Default visit/outreach split (visit + outreach must equal 100).
    defaultVisitPercent: z.number().int().min(0).max(100),
    defaultOutreachPercent: z.number().int().min(0).max(100),
    roundingMode: z.enum(ROUNDING_MODES),
  })
  .refine((c) => c.defaultVisitPercent + c.defaultOutreachPercent === 100, {
    message: "visit % and outreach % must sum to 100",
    path: ["defaultOutreachPercent"],
  });

export type GlobalCallConfig = z.infer<typeof globalCallConfigSchema>;

export const workdayTierSchema = z.object({
  workdayPercent: z.number().int().min(0).max(100),
  completedKpi: z.number().int().min(0).max(1000),
});
export type WorkdayTier = z.infer<typeof workdayTierSchema>;

// A well-formed tier list: unique workday percents, sorted desc by the caller.
export const workdayTiersSchema = z
  .array(workdayTierSchema)
  .max(50)
  .refine(
    (tiers) =>
      new Set(tiers.map((t) => t.workdayPercent)).size === tiers.length,
    { message: "workday tiers must have unique workday %" },
  );

export const DEFAULT_GLOBAL_CALL_CONFIG: GlobalCallConfig = {
  fullDayCompletedTarget: 30,
  scheduledKpiPercent: 50,
  defaultVisitPercent: 75,
  defaultOutreachPercent: 25,
  roundingMode: "round",
};

export const DEFAULT_WORKDAY_TIERS: WorkdayTier[] = [
  { workdayPercent: 100, completedKpi: 30 },
  { workdayPercent: 50, completedKpi: 15 },
  { workdayPercent: 25, completedKpi: 7 },
  { workdayPercent: 0, completedKpi: 0 },
];

// Combined admin update payload for the global config + tier table.
export const updateGlobalCallConfigSchema = z.object({
  config: globalCallConfigSchema,
  tiers: workdayTiersSchema,
});
export type UpdateGlobalCallConfig = z.infer<typeof updateGlobalCallConfigSchema>;

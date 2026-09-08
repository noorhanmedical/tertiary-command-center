// Phase 3 — workforce shifts + intra-day availability.
//
// ONE minimal companion table for a team member's DATE-SPECIFIC shift window
// AND their real-time availability state for that day. The RECURRING DEFAULT
// pattern lives on engagement_call_settings (default_shift_start/end +
// work_weekdays) so we don't duplicate a per-day row for every ordinary day.
// Full-day PTO stays in the existing pto_requests table.
//
// This is NOT a new allocator/capacity/PTO system — it is the missing
// "planned shift window + right-now availability" input that
// callSettingsService (capacity) and distributionService (eligibility) read.
//
// OPT-IN: a member with NO shift row and NO recurring default behaves EXACTLY
// as before Phase 3 (available the whole working day, capacity from
// callWorkdayPercent). Shifts only add gating/proration once configured.
//
// Times are wall-clock "HH:MM" interpreted in the member's clinic timezone
// (Phase 2 clinics.timezone). No server-local time. No PHI in this table.
//
// Migration: 0083_add_workforce_shifts.sql (applied manually).

import {
  sql,
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  index,
  createInsertSchema,
  z,
} from "./_common";
import { outreachSchedulers } from "./outreach";
import { clinics } from "./clinics";

/**
 * Real-time availability for NEW assignments. Only `available` accepts new
 * work. `finish_current_only` is the deliberate early-departure state: no NEW
 * work, keep handling current work, due work may be redistributed.
 */
export const WORKFORCE_AVAILABILITY_STATES = [
  "available",
  "off_shift", // before/after the shift window
  "on_break",
  "meeting",
  "finish_current_only",
  "unavailable",
] as const;
export type WorkforceAvailabilityState = (typeof WORKFORCE_AVAILABILITY_STATES)[number];

/** States (other than available) that STOP new assignments. */
export const NON_ACCEPTING_AVAILABILITY_STATES: readonly WorkforceAvailabilityState[] = [
  "off_shift",
  "on_break",
  "meeting",
  "finish_current_only",
  "unavailable",
];

/** How a shift row was created — for audit/observability. */
export const WORKFORCE_SHIFT_SOURCES = [
  "manual",
  "recurring_materialized",
  "partial_pto",
  "early_departure",
  "late_start",
  "system",
] as const;
export type WorkforceShiftSource = (typeof WORKFORCE_SHIFT_SOURCES)[number];

export const teamMemberShifts = pgTable(
  "team_member_shifts",
  {
    id: serial("id").primaryKey(),
    schedulerId: integer("scheduler_id")
      .notNull()
      .references(() => outreachSchedulers.id, { onDelete: "cascade" }),
    /** Clinic used to interpret the shift wall-clock times (timezone source).
     *  Nullable → fall back to the member's roster clinic / Central. */
    clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
    /** Clinic-local operational date this row applies to (YYYY-MM-DD). */
    workDate: text("work_date").notNull(),
    /** false = day off / not scheduled this date (overrides recurring default). */
    working: boolean("working").notNull().default(true),
    /** Shift window wall-clock in the clinic tz. Null start/end with working=true
     *  means "working all day" (no time gating) for that date. */
    shiftStart: text("shift_start"), // "HH:MM"
    shiftEnd: text("shift_end"), // "HH:MM"
    /** Explicit completed-call KPI for the day — bypasses shift proration. */
    capacityOverride: integer("capacity_override"),
    /** Real-time availability for NEW work (today). Null → derive from the
     *  shift window (within window = available, else off_shift). */
    availabilityState: text("availability_state"),
    availabilityReason: text("availability_reason"),
    /** When the current availability state was set (audit). */
    availabilitySetAt: timestamp("availability_set_at"),
    source: text("source").notNull().default("manual"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("uq_tms_scheduler_date").on(table.schedulerId, table.workDate),
    index("idx_tms_work_date").on(table.workDate),
  ],
);

export const insertTeamMemberShiftSchema = createInsertSchema(teamMemberShifts)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "workDate must be YYYY-MM-DD"),
    shiftStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "shiftStart must be HH:MM").nullable().optional(),
    shiftEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "shiftEnd must be HH:MM").nullable().optional(),
    capacityOverride: z.number().int().min(0).max(1000).nullable().optional(),
    availabilityState: z.enum(WORKFORCE_AVAILABILITY_STATES).nullable().optional(),
    working: z.boolean().optional(),
  });

export type TeamMemberShift = typeof teamMemberShifts.$inferSelect;
export type InsertTeamMemberShift = z.infer<typeof insertTeamMemberShiftSchema>;

/**
 * Scheduling Resource Capacity.
 *
 * The single source of truth for how much equipment each facility has, how
 * long each service occupies a machine, and any temporary outages that reduce
 * capacity for a date range. The capacity-aware scheduling availability engine
 * reads these tables to compute open time slots, conflicts, and suggestions.
 *
 * Design mirrors `facility_service_settings`: one row per (clinic, resource),
 * clinic-scoped FK, jsonb metadata, created/updated timestamps.
 *
 * We deliberately model RESOURCE POOLS (machine counts) rather than boolean
 * "allow double booking" flags. The number of simultaneous appointments a
 * facility can run for a service is derived from that service's available
 * machines — 2 BrainWave machines → two overlapping BrainWave appointments.
 * When a machine goes down, a temporary override lowers the effective count.
 */

import {
  sql,
  pgTable,
  serial,
  text,
  varchar,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  boolean,
  createInsertSchema,
  z,
} from "./_common";
import { clinics } from "./clinics";

// ─── Resource types ─────────────────────────────────────────────────────────
// The three scheduler resource pools. These match the top-level scheduler
// buckets (getAncillaryCategory → brainwave / vitalwave / ultrasound) so the
// availability engine can map any service's category to its resource pool.
export const RESOURCE_TYPES = ["brainwave", "vitalwave", "ultrasound"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

// ─── facility_resource_capacity ─────────────────────────────────────────────
// Permanent/default equipment configuration for a facility + resource. Absent
// row falls back to the system defaults in `sharedSchedulingDefaults` (server
// side) so an unconfigured clinic still schedules sensibly.
export const facilityResourceCapacity = pgTable(
  "facility_resource_capacity",
  {
    id: serial("id").primaryKey(),
    clinicId: integer("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    /** One of RESOURCE_TYPES. */
    resourceType: text("resource_type").notNull(),
    /** Number of physical machines of this resource (concurrency limit). */
    machineCount: integer("machine_count").notNull().default(1),
    /**
     * Default per-appointment resource occupancy in minutes for BrainWave /
     * VitalWave. For ultrasound this is unused (ultrasound duration is derived
     * from minutesPerStudy × study count) but kept for shape symmetry.
     */
    durationMinutes: integer("duration_minutes").notNull().default(30),
    /**
     * Ultrasound only — minutes consumed PER study. Total ultrasound block =
     * numberOfStudies × minutesPerStudy. Null for non-ultrasound resources.
     */
    minutesPerStudy: integer("minutes_per_study"),
    /**
     * Rooming / preparation buffer applied BETWEEN different patients on the
     * same resource (never between studies of the same patient). Primarily
     * used for ultrasound; defaults to 0 for machines without turnover.
     */
    turnoverMinutes: integer("turnover_minutes").notNull().default(0),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("uq_frc_clinic_resource").on(table.clinicId, table.resourceType),
    index("idx_frc_clinic").on(table.clinicId),
  ],
);

// ─── temporary_capacity_overrides ────────────────────────────────────────────
// A date/date-range reduction (or change) of a resource's available capacity,
// e.g. a machine down for maintenance. When active, the override's
// availableCapacity replaces the facility default for that resource on the
// covered dates. Ending the override automatically restores the default.
export const temporaryCapacityOverrides = pgTable(
  "temporary_capacity_overrides",
  {
    id: serial("id").primaryKey(),
    clinicId: integer("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    /** Canonical facility display NAME (denormalized for read-side matching
     *  against global_schedule_events.facilityId, which stores the name). */
    facilityId: text("facility_id"),
    /** One of RESOURCE_TYPES. */
    resourceType: text("resource_type").notNull(),
    /** Inclusive start date (YYYY-MM-DD). */
    startDate: text("start_date").notNull(),
    /** Inclusive end date (YYYY-MM-DD). Equals startDate for a single day. */
    endDate: text("end_date").notNull(),
    /** The reduced (or changed) number of machines available in this window. */
    availableCapacity: integer("available_capacity").notNull(),
    reason: text("reason"),
    createdBy: varchar("created_by"),
    /** Soft-disable so an override can be lifted early without losing history. */
    active: boolean("active").notNull().default(true),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("idx_tco_clinic").on(table.clinicId),
    index("idx_tco_resource").on(table.resourceType),
    index("idx_tco_dates").on(table.startDate, table.endDate),
    index("idx_tco_active").on(table.active),
  ],
);

// ─── Schemas / Types ──────────────────────────────────────────────────────

export const insertFacilityResourceCapacitySchema = createInsertSchema(
  facilityResourceCapacity,
)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    resourceType: z.enum(RESOURCE_TYPES),
    machineCount: z.number().int().min(0, "Machine count cannot be negative"),
    durationMinutes: z.number().int().min(1, "Duration must be at least 1 minute"),
    minutesPerStudy: z
      .number()
      .int()
      .min(1, "Minutes per study must be at least 1")
      .nullable()
      .optional(),
    turnoverMinutes: z.number().int().min(0, "Turnover cannot be negative"),
  });

export const insertTemporaryCapacityOverrideSchema = createInsertSchema(
  temporaryCapacityOverrides,
)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    resourceType: z.enum(RESOURCE_TYPES),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD"),
    availableCapacity: z
      .number()
      .int()
      .min(0, "Available capacity cannot be negative"),
    reason: z.string().trim().max(280).nullable().optional(),
  });

export type FacilityResourceCapacity =
  typeof facilityResourceCapacity.$inferSelect;
export type InsertFacilityResourceCapacity = z.infer<
  typeof insertFacilityResourceCapacitySchema
>;
export type TemporaryCapacityOverride =
  typeof temporaryCapacityOverrides.$inferSelect;
export type InsertTemporaryCapacityOverride = z.infer<
  typeof insertTemporaryCapacityOverrideSchema
>;

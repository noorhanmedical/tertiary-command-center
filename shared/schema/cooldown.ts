import {
  sql, pgTable, serial, text, varchar, integer, timestamp, jsonb, index,
  createInsertSchema, z,
} from "./_common";
import { users } from "./users";
import { patientExecutionCases } from "./executionCase";
import { patientScreenings } from "./screening";

export const COOLDOWN_STATUSES = [
  "active",
  "expired",
  "not_applicable",
  "unknown",
] as const;
export type CooldownStatus = typeof COOLDOWN_STATUSES[number];

export const COOLDOWN_OVERRIDE_STATUSES = [
  "none",
  "pending",
  "approved",
  "denied",
] as const;
export type CooldownOverrideStatus = typeof COOLDOWN_OVERRIDE_STATUSES[number];

export const cooldownRecords = pgTable("cooldown_records", {
  id: serial("id").primaryKey(),
  executionCaseId: integer("execution_case_id").references(() => patientExecutionCases.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  patientName: text("patient_name"),
  patientDob: text("patient_dob"),
  facilityId: text("facility_id"),
  serviceType: text("service_type").notNull(),
  priorServiceDate: text("prior_service_date"),
  cooldownStartDate: text("cooldown_start_date"),
  cooldownEndDate: text("cooldown_end_date"),
  cooldownStatus: text("cooldown_status").notNull().default("unknown"),
  overrideStatus: text("override_status").notNull().default("none"),
  reviewedByUserId: varchar("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  note: text("note"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_cooldown_execution_case_id").on(table.executionCaseId),
  index("idx_cooldown_patient_screening_id").on(table.patientScreeningId),
  index("idx_cooldown_facility_id").on(table.facilityId),
  index("idx_cooldown_service_type").on(table.serviceType),
  index("idx_cooldown_status").on(table.cooldownStatus),
  index("idx_cooldown_override_status").on(table.overrideStatus),
  index("idx_cooldown_patient_name_dob").on(table.patientName, table.patientDob),
]);

export const insertCooldownRecordSchema = createInsertSchema(cooldownRecords).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CooldownRecord = typeof cooldownRecords.$inferSelect;
export type InsertCooldownRecord = z.infer<typeof insertCooldownRecordSchema>;

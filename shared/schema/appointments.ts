import { sql, pgTable, serial, text, integer, timestamp, index, createInsertSchema, z } from "./_common";
import { patientScreenings } from "./screening";
import { clinics } from "./clinics";

export const ancillaryAppointments = pgTable("ancillary_appointments", {
  id: serial("id").primaryKey(),
  // Multi-tenancy: nullable during backfill; filter enforced in repository layer.
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  patientName: text("patient_name").notNull(),
  facility: text("facility").notNull(),
  scheduledDate: text("scheduled_date").notNull(),
  scheduledTime: text("scheduled_time").notNull(),
  testType: text("test_type").notNull(),
  status: text("status").notNull().default("scheduled"),
  // Phase 2D — compatibility back-pointer to the canonical
  // global_schedule_events row. When FEATURE_CANONICAL_APPOINTMENT is
  // ON, this table becomes a compatibility projection; the canonical
  // event owns the state. Nullable so legacy rows continue to compile.
  globalScheduleEventId: integer("global_schedule_event_id"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_ancillary_appointments_facility").on(table.facility),
  index("idx_ancillary_appointments_scheduled_date").on(table.scheduledDate),
  index("idx_ancillary_appointments_status").on(table.status),
  index("idx_aa_global_schedule_event").on(table.globalScheduleEventId),
]);

export const insertAncillaryAppointmentSchema = createInsertSchema(ancillaryAppointments).omit({
  id: true,
  createdAt: true,
  // Phase 2D — server-owned back-pointer to the canonical
  // global_schedule_events row. Written only by the canonical
  // projection/backfill path, never accepted from client insert.
  globalScheduleEventId: true,
});

export type AncillaryAppointment = typeof ancillaryAppointments.$inferSelect;
export type InsertAncillaryAppointment = z.infer<typeof insertAncillaryAppointmentSchema>;

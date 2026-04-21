import { sql, pgTable, serial, text, integer, timestamp, index, createInsertSchema, z } from "./_common";
import { patientScreenings } from "./screening";

export const ancillaryAppointments = pgTable("ancillary_appointments", {
  id: serial("id").primaryKey(),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  patientName: text("patient_name").notNull(),
  facility: text("facility").notNull(),
  scheduledDate: text("scheduled_date").notNull(),
  scheduledTime: text("scheduled_time").notNull(),
  testType: text("test_type").notNull(),
  status: text("status").notNull().default("scheduled"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_ancillary_appointments_facility").on(table.facility),
  index("idx_ancillary_appointments_scheduled_date").on(table.scheduledDate),
  index("idx_ancillary_appointments_status").on(table.status),
]);

export const insertAncillaryAppointmentSchema = createInsertSchema(ancillaryAppointments).omit({
  id: true,
  createdAt: true,
});

export type AncillaryAppointment = typeof ancillaryAppointments.$inferSelect;
export type InsertAncillaryAppointment = z.infer<typeof insertAncillaryAppointmentSchema>;
